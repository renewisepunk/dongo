import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "../../_generated/server";
import {
  agentContextValidator,
  attentionKindValidator,
  MAX_BODY_LENGTH,
  MAX_TITLE_LENGTH,
  urgencyValidator,
} from "../../lib/validators";
import {
  assertSameProject,
  requireHumanProject,
  requireMembership,
  resolveAgentPrincipal,
} from "../../lib/authz";
import { appendEvent } from "../../lib/events";
import {
  assertExpectedRevision,
  fail,
  optionalString,
  requireString,
} from "../../lib/errors";
import { runIdempotent } from "../../lib/idempotency";
import { pauseRunForAttention } from "../work/service";
import {
  cancelOutstandingNotifications,
  enqueueAttentionNotifications,
} from "../notifications/service";

export const request = internalMutation({
  args: {
    authorization: agentContextValidator,
    workItemId: v.id("workItems"),
    runId: v.id("runs"),
    expectedRevision: v.number(),
    kind: attentionKindValidator,
    title: v.string(),
    body: v.optional(v.string()),
    options: v.optional(v.array(v.string())),
    urgency: urgencyValidator,
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:write",
    );
    const work = await ctx.db.get(args.workItemId);
    if (!work) fail("not_found", "Work item not found");
    assertSameProject(work, principal.project);
    const recipientProfileId = principal.authorizedByProfileId;
    if (!recipientProfileId) {
      fail("validation", "Installation has no human attention recipient");
    }
    await requireMembership(
      ctx,
      principal.project.organizationId,
      recipientProfileId,
    );
    const now = Date.now();
    if (
      args.options !== undefined &&
      (args.options.length < 2 || args.options.length > 20)
    ) {
      fail("validation", "Attention options must contain 2 to 20 choices");
    }
    const options = args.options?.map((option) =>
      requireString(option, "option", 2_000),
    );
    if (options && new Set(options).size !== options.length) {
      fail("validation", "Attention response options must be unique");
    }
    return await runIdempotent(
      ctx,
      {
        organizationId: work.organizationId,
        projectId: work.projectId,
        principalKey: principal.principalKey,
        operation: "attention.request",
        key: args.idempotencyKey,
        payload: {
          workItemId: args.workItemId,
          runId: args.runId,
          expectedRevision: args.expectedRevision,
          kind: args.kind,
          title: args.title,
          body: args.body,
          options,
          urgency: args.urgency,
        },
        now,
      },
      async () => {
        assertExpectedRevision(work.revision, args.expectedRevision);
        const run = await ctx.db.get(args.runId);
        if (
          !run ||
          run.workItemId !== work._id ||
          run.installationId !== principal.installation._id ||
          run.status !== "running"
        ) {
          fail("claim_conflict", "The active Run cannot request attention");
        }
        const attentionRequestId = await ctx.db.insert("attentionRequests", {
          organizationId: work.organizationId,
          projectId: work.projectId,
          workItemId: work._id,
          runId: run._id,
          requestedByActorId: principal.actor._id,
          requestedFromProfileId: recipientProfileId,
          kind: args.kind,
          title: requireString(args.title, "title", MAX_TITLE_LENGTH),
          body: optionalString(args.body, "body", MAX_BODY_LENGTH),
          options,
          urgency: args.urgency,
          status: "open",
          createdAt: now,
        });
        const revision = await pauseRunForAttention(ctx, {
          workItemId: work._id,
          runId: run._id,
          installationId: principal.installation._id,
          now,
        });
        await appendEvent(ctx, {
          organizationId: work.organizationId,
          projectId: work.projectId,
          workItemId: work._id,
          runId: run._id,
          actorId: principal.actor._id,
          type: "attention.requested",
          data: { attentionRequestId, kind: args.kind, urgency: args.urgency },
          requestId: principal.requestId,
          createdAt: now,
        });
        await enqueueAttentionNotifications(ctx, {
          attentionRequestId,
          now,
        });
        return { attentionRequestId, runId: run._id, revision };
      },
    );
  },
});

export const markSeen = mutation({
  args: { attentionRequestId: v.id("attentionRequests") },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.attentionRequestId);
    if (!request) fail("not_found", "Attention request not found");
    const principal = await requireHumanProject(ctx, request.projectId);
    if (request.requestedFromProfileId !== principal.profile._id) {
      fail("not_found", "Attention request not found");
    }
    if (request.status !== "open") return { status: request.status };
    const now = Date.now();
    await ctx.db.patch(request._id, { status: "seen", seenAt: now });
    await appendEvent(ctx, {
      organizationId: request.organizationId,
      projectId: request.projectId,
      workItemId: request.workItemId,
      runId: request.runId,
      actorId: principal.actor._id,
      type: "attention.seen",
      data: { attentionRequestId: request._id },
      createdAt: now,
    });
    return { status: "seen" as const };
  },
});

export const respond = mutation({
  args: {
    attentionRequestId: v.id("attentionRequests"),
    body: v.optional(v.string()),
    selectedOption: v.optional(v.string()),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.attentionRequestId);
    if (!request) fail("not_found", "Attention request not found");
    const principal = await requireHumanProject(ctx, request.projectId);
    if (request.requestedFromProfileId !== principal.profile._id) {
      fail("not_found", "Attention request not found");
    }
    const now = Date.now();
    const body = optionalString(args.body, "body", MAX_BODY_LENGTH);
    const selectedOption = optionalString(
      args.selectedOption,
      "selectedOption",
      2_000,
    );
    if (!body && !selectedOption) {
      fail("validation", "A response or selected option is required");
    }
    if (
      selectedOption &&
      (!request.options || !request.options.includes(selectedOption))
    ) {
      fail("validation", "selectedOption is not valid for this request");
    }
    return await runIdempotent(
      ctx,
      {
        organizationId: request.organizationId,
        projectId: request.projectId,
        principalKey: principal.principalKey,
        operation: "attention.respond",
        key: args.idempotencyKey,
        payload: {
          attentionRequestId: request._id,
          body,
          selectedOption,
        },
        now,
      },
      async () => {
        if (request.status === "resolved") {
          fail("invalid_transition", "Attention request is already resolved");
        }
        const commentId = await ctx.db.insert("comments", {
          organizationId: request.organizationId,
          projectId: request.projectId,
          workItemId: request.workItemId,
          actorId: principal.actor._id,
          body: body ?? `Selected: ${selectedOption}`,
          createdAt: now,
        });
        await ctx.db.patch(request._id, {
          status: "resolved",
          seenAt: request.seenAt ?? now,
          resolvedAt: now,
          resolvedByActorId: principal.actor._id,
          resolutionCommentId: commentId,
          selectedOption,
          resolutionKind: "responded",
        });
        await cancelOutstandingNotifications(ctx, {
          attentionRequestId: request._id,
          now,
        });
        await appendEvent(ctx, {
          organizationId: request.organizationId,
          projectId: request.projectId,
          workItemId: request.workItemId,
          runId: request.runId,
          actorId: principal.actor._id,
          type: "attention.responded",
          data: {
            attentionRequestId: request._id,
            commentId,
            selectedOption: selectedOption ?? null,
          },
          createdAt: now,
        });
        return { attentionRequestId: request._id, commentId, status: "resolved" as const };
      },
    );
  },
});

export const resolveWithoutResponse = mutation({
  args: {
    attentionRequestId: v.id("attentionRequests"),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.attentionRequestId);
    if (!request) fail("not_found", "Attention request not found");
    const principal = await requireHumanProject(ctx, request.projectId);
    if (request.requestedFromProfileId !== principal.profile._id) {
      fail("not_found", "Attention request not found");
    }
    const now = Date.now();
    return await runIdempotent(
      ctx,
      {
        organizationId: request.organizationId,
        projectId: request.projectId,
        principalKey: principal.principalKey,
        operation: "attention.resolve",
        key: args.idempotencyKey,
        payload: { attentionRequestId: request._id },
        now,
      },
      async () => {
        if (request.status === "resolved") {
          fail("invalid_transition", "Attention request is already resolved");
        }
        await ctx.db.patch(request._id, {
          status: "resolved",
          seenAt: request.seenAt ?? now,
          resolvedAt: now,
          resolvedByActorId: principal.actor._id,
          resolutionKind: "resolved",
        });
        await cancelOutstandingNotifications(ctx, {
          attentionRequestId: request._id,
          now,
        });
        await appendEvent(ctx, {
          organizationId: request.organizationId,
          projectId: request.projectId,
          workItemId: request.workItemId,
          runId: request.runId,
          actorId: principal.actor._id,
          type: "attention.resolved",
          data: { attentionRequestId: request._id },
          createdAt: now,
        });
        return { attentionRequestId: request._id, status: "resolved" as const };
      },
    );
  },
});

export const cancel = internalMutation({
  args: {
    authorization: agentContextValidator,
    attentionRequestId: v.id("attentionRequests"),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:write",
    );
    const request = await ctx.db.get(args.attentionRequestId);
    if (!request) fail("not_found", "Attention request not found");
    assertSameProject(request, principal.project);
    if (request.requestedByActorId !== principal.actor._id) {
      fail("forbidden", "Only the requesting agent may cancel attention");
    }
    const now = Date.now();
    return await runIdempotent(
      ctx,
      {
        organizationId: request.organizationId,
        projectId: request.projectId,
        principalKey: principal.principalKey,
        operation: "attention.cancel",
        key: args.idempotencyKey,
        payload: { attentionRequestId: request._id },
        now,
      },
      async () => {
        if (request.status === "resolved") {
          fail("invalid_transition", "Attention request is already resolved");
        }
        await ctx.db.patch(request._id, {
          status: "resolved",
          resolvedAt: now,
          resolvedByActorId: principal.actor._id,
          resolutionKind: "cancelled",
        });
        await cancelOutstandingNotifications(ctx, {
          attentionRequestId: request._id,
          now,
        });
        await appendEvent(ctx, {
          organizationId: request.organizationId,
          projectId: request.projectId,
          workItemId: request.workItemId,
          runId: request.runId,
          actorId: principal.actor._id,
          type: "attention.cancelled",
          data: { attentionRequestId: request._id },
          requestId: principal.requestId,
          createdAt: now,
        });
        return { attentionRequestId: request._id, status: "resolved" as const };
      },
    );
  },
});

export const resolveForAgent = internalMutation({
  args: {
    authorization: agentContextValidator,
    attentionRequestId: v.id("attentionRequests"),
    body: v.optional(v.string()),
    selectedOption: v.optional(v.string()),
    resolveWithoutResponse: v.optional(v.boolean()),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:write",
    );
    const request = await ctx.db.get(args.attentionRequestId);
    if (!request) fail("not_found", "Attention request not found");
    assertSameProject(request, principal.project);
    if (request.requestedByActorId !== principal.actor._id) {
      fail("forbidden", "Only the requesting installation may resolve attention");
    }
    const body = optionalString(args.body, "body", MAX_BODY_LENGTH);
    const selectedOption = optionalString(
      args.selectedOption,
      "selectedOption",
      2_000,
    );
    if (
      selectedOption &&
      (!request.options || !request.options.includes(selectedOption))
    ) {
      fail("validation", "selectedOption is not valid for this request");
    }
    if (!args.resolveWithoutResponse && !body && !selectedOption) {
      fail("validation", "A response or resolveWithoutResponse is required");
    }
    const now = Date.now();
    return await runIdempotent(
      ctx,
      {
        organizationId: request.organizationId,
        projectId: request.projectId,
        principalKey: principal.principalKey,
        operation: "attention.resolve_agent",
        key: args.idempotencyKey,
        payload: {
          attentionRequestId: request._id,
          body,
          selectedOption,
          resolveWithoutResponse: args.resolveWithoutResponse ?? false,
        },
        now,
      },
      async () => {
        if (request.status === "resolved") {
          fail("invalid_transition", "Attention request is already resolved");
        }
        const commentId =
          body || selectedOption
            ? await ctx.db.insert("comments", {
                organizationId: request.organizationId,
                projectId: request.projectId,
                workItemId: request.workItemId,
                actorId: principal.actor._id,
                body: body ?? `Selected: ${selectedOption}`,
                createdAt: now,
              })
            : undefined;
        await ctx.db.patch(request._id, {
          status: "resolved",
          resolvedAt: now,
          resolvedByActorId: principal.actor._id,
          resolutionCommentId: commentId,
          selectedOption,
          resolutionKind: commentId ? "responded" : "resolved",
        });
        await cancelOutstandingNotifications(ctx, {
          attentionRequestId: request._id,
          now,
        });
        await appendEvent(ctx, {
          organizationId: request.organizationId,
          projectId: request.projectId,
          workItemId: request.workItemId,
          runId: request.runId,
          actorId: principal.actor._id,
          type: commentId ? "attention.responded" : "attention.resolved",
          data: {
            attentionRequestId: request._id,
            commentId: commentId ?? null,
            selectedOption: selectedOption ?? null,
          },
          requestId: principal.requestId,
          createdAt: now,
        });
        return { attentionRequestId: request._id };
      },
    );
  },
});

export const listMine = query({
  args: {
    projectId: v.id("projects"),
    includeResolved: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const principal = await requireHumanProject(ctx, args.projectId, {
      allowArchived: true,
    });
    const limit = Math.max(1, Math.min(args.limit ?? 50, 100));
    const statuses = args.includeResolved
      ? (["open", "seen", "resolved"] as const)
      : (["open", "seen"] as const);
    const batches = await Promise.all(
      statuses.map((status) =>
        ctx.db
          .query("attentionRequests")
          .withIndex("by_project_profile_status_created", (q) =>
            q
              .eq("projectId", args.projectId)
              .eq("requestedFromProfileId", principal.profile._id)
              .eq("status", status),
          )
          .order("desc")
          .take(limit),
      ),
    );
    return batches
      .flat()
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, limit);
  },
});

export const getForAgent = internalQuery({
  args: {
    authorization: agentContextValidator,
    attentionRequestId: v.id("attentionRequests"),
  },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:read",
    );
    const request = await ctx.db.get(args.attentionRequestId);
    if (!request) fail("not_found", "Attention request not found");
    assertSameProject(request, principal.project);
    const [work, response] = await Promise.all([
      ctx.db.get(request.workItemId),
      request.resolutionCommentId
        ? ctx.db.get(request.resolutionCommentId)
        : null,
    ]);
    return { request, work, response };
  },
});
