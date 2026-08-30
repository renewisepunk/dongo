import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import {
  agentContextValidator,
  artifactTypeValidator,
  MAX_DESCRIPTION_LENGTH,
  MAX_TITLE_LENGTH,
  workKindValidator,
} from "../../lib/validators";
import {
  assertSameProject,
  requireHumanProject,
  requireSystemActor,
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
import { isLeaseActive, newLease } from "../../lib/leases";
import { createWorkItem, linkIntakeToWork } from "./service";

const inlineArtifactValidator = v.object({
  type: artifactTypeValidator,
  title: v.string(),
  url: v.optional(v.string()),
  repositoryPath: v.optional(v.string()),
});

type InlineArtifact = {
  type:
    | "commit"
    | "pull_request"
    | "deployment"
    | "preview"
    | "url"
    | "image"
    | "file"
    | "report";
  title: string;
  url?: string;
  repositoryPath?: string;
};

async function recordInlineArtifacts(
  ctx: MutationCtx,
  work: Doc<"workItems">,
  runId: Id<"runs">,
  actorId: Id<"actors">,
  artifacts: InlineArtifact[],
  now: number,
): Promise<Array<Id<"artifacts">>> {
  if (artifacts.length > 100) {
    fail("validation", "A Work update may include at most 100 artifacts");
  }
  const artifactIds: Array<Id<"artifacts">> = [];
  for (const artifact of artifacts) {
    const title = requireString(artifact.title, "artifact.title", MAX_TITLE_LENGTH);
    const url = optionalString(artifact.url, "artifact.url", 2_048);
    if (
      ["commit", "pull_request", "deployment", "preview", "url"].includes(
        artifact.type,
      ) && !url
    ) {
      fail("validation", `${artifact.type} artifacts require a URL`);
    }
    const repositoryPath = optionalString(
      artifact.repositoryPath,
      "artifact.repositoryPath",
      2_048,
    );
    artifactIds.push(
      await ctx.db.insert("artifacts", {
        organizationId: work.organizationId,
        projectId: work.projectId,
        workItemId: work._id,
        runId,
        actorId,
        type: artifact.type,
        title,
        url,
        metadata: repositoryPath ? { repositoryPath } : undefined,
        createdAt: now,
      }),
    );
  }
  return artifactIds;
}

async function expireStaleWorkClaim(
  ctx: MutationCtx,
  work: Doc<"workItems">,
  now: number,
): Promise<Doc<"workItems">> {
  if (!work.claimedRunId || isLeaseActive(work.claimExpiresAt, now)) return work;
  const run = await ctx.db.get(work.claimedRunId);
  if (run && run.status === "running") {
    await ctx.db.patch(run._id, {
      status: "failed",
      failureCode: "lease_expired",
      finishedAt: now,
      lastHeartbeatAt: now,
    });
  }
  const systemActor = await requireSystemActor(ctx, work.organizationId);
  await ctx.db.patch(work._id, {
    state: "ready",
    claimedByActorId: undefined,
    claimedByInstallationId: undefined,
    claimedRunId: undefined,
    claimedAt: undefined,
    claimExpiresAt: undefined,
    revision: work.revision + 1,
    updatedAt: now,
  });
  await appendEvent(ctx, {
    organizationId: work.organizationId,
    projectId: work.projectId,
    workItemId: work._id,
    runId: run?._id,
    actorId: systemActor._id,
    type: "work.claim_expired",
    data: { previousRunId: run?._id },
    createdAt: now,
  });
  return (await ctx.db.get(work._id))!;
}

export const createForHuman = mutation({
  args: {
    projectId: v.id("projects"),
    title: v.string(),
    description: v.optional(v.string()),
    kind: workKindValidator,
    parentId: v.optional(v.id("workItems")),
    sourceIntakeIds: v.optional(v.array(v.id("intakes"))),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await requireHumanProject(ctx, args.projectId);
    const now = Date.now();
    return await runIdempotent(
      ctx,
      {
        organizationId: principal.project!.organizationId,
        projectId: args.projectId,
        principalKey: principal.principalKey,
        operation: "work.create",
        key: args.idempotencyKey,
        payload: args,
        now,
      },
      async () => {
        if ((args.sourceIntakeIds?.length ?? 0) > 500) {
          fail("validation", "Work may link at most 500 source Intakes");
        }
        const workItemId = await createWorkItem(ctx, {
          projectId: args.projectId,
          actorId: principal.actor._id,
          input: args,
          now,
        });
        for (const intakeId of [...new Set(args.sourceIntakeIds ?? [])]) {
          const intake = await ctx.db.get(intakeId);
          if (
            !intake ||
            intake.projectId !== args.projectId ||
            intake.organizationId !== principal.project!.organizationId
          ) {
            fail("not_found", "Source Intake not found");
          }
          await linkIntakeToWork(ctx, {
            intakeId,
            workItemId,
            relation: "linked",
            now,
          });
        }
        return { workItemId };
      },
    );
  },
});

export const createForAgent = internalMutation({
  args: {
    authorization: agentContextValidator,
    title: v.string(),
    description: v.optional(v.string()),
    kind: workKindValidator,
    parentId: v.optional(v.id("workItems")),
    sourceIntakeIds: v.optional(v.array(v.id("intakes"))),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:write",
    );
    const now = Date.now();
    return await runIdempotent(
      ctx,
      {
        organizationId: principal.project.organizationId,
        projectId: principal.project._id,
        principalKey: principal.principalKey,
        operation: "work.create",
        key: args.idempotencyKey,
        payload: {
          title: args.title,
          description: args.description,
          kind: args.kind,
          parentId: args.parentId,
          sourceIntakeIds: args.sourceIntakeIds,
        },
        now,
      },
      async () => {
        if ((args.sourceIntakeIds?.length ?? 0) > 500) {
          fail("validation", "Work may link at most 500 source Intakes");
        }
        const workItemId = await createWorkItem(ctx, {
          projectId: principal.project._id,
          actorId: principal.actor._id,
          input: args,
          now,
          requestId: principal.requestId,
        });
        for (const intakeId of [...new Set(args.sourceIntakeIds ?? [])]) {
          const intake = await ctx.db.get(intakeId);
          if (!intake) fail("not_found", "Source Intake not found");
          assertSameProject(intake, principal.project);
          await linkIntakeToWork(ctx, {
            intakeId,
            workItemId,
            relation: "linked",
            now,
          });
        }
        return { workItemId };
      },
    );
  },
});

async function workDetail(ctx: QueryCtx, work: Doc<"workItems">) {
  const [runs, comments, artifacts, attention, sources] = await Promise.all([
    ctx.db
      .query("runs")
      .withIndex("by_work_started", (q) => q.eq("workItemId", work._id))
      .order("desc")
      .take(25),
    ctx.db
      .query("comments")
      .withIndex("by_work_created", (q) => q.eq("workItemId", work._id))
      .order("asc")
      .take(100),
    ctx.db
      .query("artifacts")
      .withIndex("by_work_created", (q) => q.eq("workItemId", work._id))
      .order("asc")
      .take(100),
    ctx.db
      .query("attentionRequests")
      .withIndex("by_work_status", (q) => q.eq("workItemId", work._id))
      .order("desc")
      .take(50),
    ctx.db
      .query("intakeWorkLinks")
      .withIndex("by_work", (q) => q.eq("workItemId", work._id))
      .take(50),
  ]);
  return { work, runs, comments, artifacts, attention, sources };
}

export const getForHuman = query({
  args: { workItemId: v.id("workItems") },
  handler: async (ctx, args) => {
    const work = await ctx.db.get(args.workItemId);
    if (!work) fail("not_found", "Work item not found");
    await requireHumanProject(ctx, work.projectId, { allowArchived: true });
    return await workDetail(ctx, work);
  },
});

export const getDetailForHuman = query({
  args: { workItemId: v.id("workItems") },
  handler: async (ctx, args) => {
    const work = await ctx.db.get(args.workItemId);
    if (!work) fail("not_found", "Work item not found");
    await requireHumanProject(ctx, work.projectId, { allowArchived: true });
    const detail = await workDetail(ctx, work);
    const actorIds = new Set<Id<"actors">>();
    for (const run of detail.runs) actorIds.add(run.actorId);
    for (const comment of detail.comments) actorIds.add(comment.actorId);
    for (const artifact of detail.artifacts) actorIds.add(artifact.actorId);
    for (const request of detail.attention) {
      actorIds.add(request.requestedByActorId);
      if (request.resolvedByActorId) actorIds.add(request.resolvedByActorId);
    }
    const actors = (
      await Promise.all([...actorIds].map((actorId) => ctx.db.get(actorId)))
    ).filter((actor): actor is Doc<"actors"> => actor !== null);
    return { ...detail, actors };
  },
});

export const listCompletedForHuman = query({
  args: {
    projectId: v.id("projects"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireHumanProject(ctx, args.projectId, { allowArchived: true });
    return await ctx.db
      .query("workItems")
      .withIndex("by_project_state_updated", (q) =>
        q.eq("projectId", args.projectId).eq("state", "done"),
      )
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const getForAgent = internalQuery({
  args: { authorization: agentContextValidator, workItemId: v.id("workItems") },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:read",
    );
    const work = await ctx.db.get(args.workItemId);
    if (!work) fail("not_found", "Work item not found");
    assertSameProject(work, principal.project);
    return await workDetail(ctx, work);
  },
});

export const getByIdentifierForAgent = internalQuery({
  args: { authorization: agentContextValidator, identifier: v.string() },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:read",
    );
    const identifier = requireString(args.identifier, "identifier", 80);
    const work = await ctx.db
      .query("workItems")
      .withIndex("by_project_identifier", (q) =>
        q
          .eq("projectId", principal.project._id)
          .eq("identifier", identifier),
      )
      .unique();
    if (!work) fail("not_found", "Work item not found");
    return await workDetail(ctx, work);
  },
});

export const start = internalMutation({
  args: {
    authorization: agentContextValidator,
    workItemId: v.id("workItems"),
    expectedRevision: v.number(),
    resumeRunId: v.optional(v.id("runs")),
    leaseSeconds: v.optional(v.number()),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:write",
    );
    let work = await ctx.db.get(args.workItemId);
    if (!work) fail("not_found", "Work item not found");
    assertSameProject(work, principal.project);
    const now = Date.now();
    work = await expireStaleWorkClaim(ctx, work, now);
    return await runIdempotent(
      ctx,
      {
        organizationId: work.organizationId,
        projectId: work.projectId,
        principalKey: principal.principalKey,
        operation: "work.start",
        key: args.idempotencyKey,
        payload: {
          workItemId: args.workItemId,
          expectedRevision: args.expectedRevision,
          resumeRunId: args.resumeRunId,
          externalSessionId: args.authorization.externalSessionId,
          leaseSeconds: args.leaseSeconds,
        },
        now,
      },
      async () => {
        assertExpectedRevision(work.revision, args.expectedRevision);
        if (work.state === "done" || work.state === "cancelled") {
          fail("invalid_transition", "Closed work cannot be started");
        }
        if (work.claimedRunId && isLeaseActive(work.claimExpiresAt, now)) {
          fail("claim_conflict", "Work is claimed by another active Run", {
            claimExpiresAt: work.claimExpiresAt ?? null,
          });
        }
        let runId: Id<"runs">;
        if (args.resumeRunId) {
          const run = await ctx.db.get(args.resumeRunId);
          if (
            !run ||
            run.workItemId !== work._id ||
            run.installationId !== principal.installation._id ||
            run.status !== "waiting"
          ) {
            fail("invalid_transition", "Waiting Run cannot be resumed");
          }
          runId = run._id;
          await ctx.db.patch(run._id, {
            status: "running",
            externalSessionId:
              args.authorization.externalSessionId ?? run.externalSessionId,
            lastHeartbeatAt: now,
          });
        } else {
          runId = await ctx.db.insert("runs", {
            organizationId: work.organizationId,
            projectId: work.projectId,
            workItemId: work._id,
            actorId: principal.actor._id,
            installationId: principal.installation._id,
            status: "running",
            externalSessionId: args.authorization.externalSessionId,
            startedAt: now,
            lastHeartbeatAt: now,
          });
        }
        const lease = newLease(now, args.leaseSeconds);
        await ctx.db.patch(work._id, {
          state: "working",
          claimedByActorId: principal.actor._id,
          claimedByInstallationId: principal.installation._id,
          claimedRunId: runId,
          ...lease,
          revision: work.revision + 1,
          updatedAt: now,
        });
        await appendEvent(ctx, {
          organizationId: work.organizationId,
          projectId: work.projectId,
          workItemId: work._id,
          runId,
          actorId: principal.actor._id,
          type: args.resumeRunId ? "run.resumed" : "run.started",
          data: { claimExpiresAt: lease.claimExpiresAt },
          requestId: principal.requestId,
          createdAt: now,
        });
        return { runId, revision: work.revision + 1, ...lease };
      },
    );
  },
});

export const update = internalMutation({
  args: {
    authorization: agentContextValidator,
    workItemId: v.id("workItems"),
    runId: v.id("runs"),
    expectedRevision: v.number(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    summary: v.optional(v.string()),
    artifact: v.optional(inlineArtifactValidator),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:write",
    );
    const work = await ctx.db.get(args.workItemId);
    const run = await ctx.db.get(args.runId);
    if (!work || !run) fail("not_found", "Work item or Run not found");
    assertSameProject(work, principal.project);
    const now = Date.now();
    return await runIdempotent(
      ctx,
      {
        organizationId: work.organizationId,
        projectId: work.projectId,
        principalKey: principal.principalKey,
        operation: "work.update",
        key: args.idempotencyKey,
        payload: {
          workItemId: args.workItemId,
          runId: args.runId,
          expectedRevision: args.expectedRevision,
          title: args.title,
          description: args.description,
          summary: args.summary,
          artifact: args.artifact,
        },
        now,
      },
      async () => {
        assertExpectedRevision(work.revision, args.expectedRevision);
        if (
          work.claimedRunId !== run._id ||
          work.claimedByInstallationId !== principal.installation._id ||
          run.installationId !== principal.installation._id ||
          run.status !== "running"
        ) {
          fail("claim_conflict", "The active Run no longer owns this WorkItem");
        }
        if (!isLeaseActive(work.claimExpiresAt, now)) {
          fail("lease_expired", "The WorkItem claim has expired");
        }
        if (
          args.title === undefined &&
          args.description === undefined &&
          args.summary === undefined &&
          args.artifact === undefined
        ) {
          fail("validation", "Update requires a changed field or progress summary");
        }
        const lease = newLease(now);
        await ctx.db.patch(work._id, {
          title:
            args.title === undefined
              ? work.title
              : requireString(args.title, "title", MAX_TITLE_LENGTH),
          description:
            args.description === undefined
              ? work.description
              : optionalString(args.description, "description", MAX_DESCRIPTION_LENGTH),
          claimExpiresAt: lease.claimExpiresAt,
          revision: work.revision + 1,
          updatedAt: now,
        });
        await ctx.db.patch(run._id, {
          summary:
            args.summary === undefined
              ? run.summary
              : optionalString(args.summary, "summary", MAX_DESCRIPTION_LENGTH),
          lastHeartbeatAt: now,
        });
        const artifactIds = args.artifact
          ? await recordInlineArtifacts(
              ctx,
              work,
              run._id,
              principal.actor._id,
              [args.artifact],
              now,
            )
          : [];
        await appendEvent(ctx, {
          organizationId: work.organizationId,
          projectId: work.projectId,
          workItemId: work._id,
          runId: run._id,
          actorId: principal.actor._id,
          type: "work.updated",
          data: {
            progress: args.summary !== undefined,
            artifactIds,
          },
          requestId: principal.requestId,
          createdAt: now,
        });
        return { revision: work.revision + 1, claimExpiresAt: lease.claimExpiresAt };
      },
    );
  },
});

export const renewClaim = internalMutation({
  args: {
    authorization: agentContextValidator,
    workItemId: v.id("workItems"),
    runId: v.id("runs"),
    expectedRevision: v.number(),
    leaseSeconds: v.optional(v.number()),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:write",
    );
    const work = await ctx.db.get(args.workItemId);
    const run = await ctx.db.get(args.runId);
    if (!work || !run) fail("not_found", "Work item or Run not found");
    assertSameProject(work, principal.project);
    const now = Date.now();
    return await runIdempotent(
      ctx,
      {
        organizationId: work.organizationId,
        projectId: work.projectId,
        principalKey: principal.principalKey,
        operation: "work.renew_claim",
        key: args.idempotencyKey,
        payload: {
          workItemId: work._id,
          runId: run._id,
          expectedRevision: args.expectedRevision,
          leaseSeconds: args.leaseSeconds,
        },
        now,
      },
      async () => {
        assertExpectedRevision(work.revision, args.expectedRevision);
        if (
          work.claimedRunId !== run._id ||
          work.claimedByInstallationId !== principal.installation._id ||
          run.installationId !== principal.installation._id ||
          run.status !== "running"
        ) {
          fail("claim_conflict", "The active Run no longer owns this WorkItem");
        }
        if (!isLeaseActive(work.claimExpiresAt, now)) {
          fail("lease_expired", "The WorkItem claim has expired");
        }
        const lease = newLease(now, args.leaseSeconds);
        await ctx.db.patch(work._id, {
          claimExpiresAt: lease.claimExpiresAt,
          revision: work.revision + 1,
          updatedAt: now,
        });
        await ctx.db.patch(run._id, { lastHeartbeatAt: now });
        await appendEvent(ctx, {
          organizationId: work.organizationId,
          projectId: work.projectId,
          workItemId: work._id,
          runId: run._id,
          actorId: principal.actor._id,
          type: "work.claim_renewed",
          data: { claimExpiresAt: lease.claimExpiresAt },
          requestId: principal.requestId,
          createdAt: now,
        });
        return {
          claimExpiresAt: lease.claimExpiresAt,
          revision: work.revision + 1,
        };
      },
    );
  },
});

export const wait = internalMutation({
  args: {
    authorization: agentContextValidator,
    workItemId: v.id("workItems"),
    runId: v.id("runs"),
    expectedRevision: v.number(),
    summary: v.optional(v.string()),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:write",
    );
    const work = await ctx.db.get(args.workItemId);
    const run = await ctx.db.get(args.runId);
    if (!work || !run) fail("not_found", "Work item or Run not found");
    assertSameProject(work, principal.project);
    const now = Date.now();
    return await runIdempotent(
      ctx,
      {
        organizationId: work.organizationId,
        projectId: work.projectId,
        principalKey: principal.principalKey,
        operation: "work.wait",
        key: args.idempotencyKey,
        payload: {
          workItemId: work._id,
          runId: run._id,
          expectedRevision: args.expectedRevision,
          summary: args.summary,
        },
        now,
      },
      async () => {
        assertExpectedRevision(work.revision, args.expectedRevision);
        if (
          work.claimedRunId !== run._id ||
          work.claimedByInstallationId !== principal.installation._id ||
          run.installationId !== principal.installation._id ||
          run.status !== "running"
        ) {
          fail("claim_conflict", "The active Run no longer owns this WorkItem");
        }
        if (!isLeaseActive(work.claimExpiresAt, now)) {
          fail("lease_expired", "The WorkItem claim has expired");
        }
        await ctx.db.patch(run._id, {
          status: "waiting",
          summary: optionalString(
            args.summary,
            "summary",
            MAX_DESCRIPTION_LENGTH,
          ),
          lastHeartbeatAt: now,
        });
        await ctx.db.patch(work._id, {
          claimedByActorId: undefined,
          claimedByInstallationId: undefined,
          claimedRunId: undefined,
          claimedAt: undefined,
          claimExpiresAt: undefined,
          revision: work.revision + 1,
          updatedAt: now,
        });
        await appendEvent(ctx, {
          organizationId: work.organizationId,
          projectId: work.projectId,
          workItemId: work._id,
          runId: run._id,
          actorId: principal.actor._id,
          type: "run.waiting",
          data: {},
          requestId: principal.requestId,
          createdAt: now,
        });
        return { runId: run._id, revision: work.revision + 1 };
      },
    );
  },
});

export const finish = internalMutation({
  args: {
    authorization: agentContextValidator,
    workItemId: v.id("workItems"),
    runId: v.id("runs"),
    expectedRevision: v.number(),
    result: v.union(
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    summary: v.optional(v.string()),
    failureCode: v.optional(v.string()),
    artifacts: v.optional(v.array(inlineArtifactValidator)),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:write",
    );
    const work = await ctx.db.get(args.workItemId);
    const run = await ctx.db.get(args.runId);
    if (!work || !run) fail("not_found", "Work item or Run not found");
    assertSameProject(work, principal.project);
    const now = Date.now();
    return await runIdempotent(
      ctx,
      {
        organizationId: work.organizationId,
        projectId: work.projectId,
        principalKey: principal.principalKey,
        operation: "work.finish",
        key: args.idempotencyKey,
        payload: {
          workItemId: args.workItemId,
          runId: args.runId,
          expectedRevision: args.expectedRevision,
          result: args.result,
          summary: args.summary,
          failureCode: args.failureCode,
          artifacts: args.artifacts,
        },
        now,
      },
      async () => {
        assertExpectedRevision(work.revision, args.expectedRevision);
        if (
          work.claimedRunId !== run._id ||
          work.claimedByInstallationId !== principal.installation._id ||
          run.installationId !== principal.installation._id ||
          run.status !== "running"
        ) {
          fail("claim_conflict", "The active Run no longer owns this WorkItem");
        }
        if (!isLeaseActive(work.claimExpiresAt, now)) {
          fail("lease_expired", "The WorkItem claim has expired");
        }
        const state =
          args.result === "completed"
            ? "done"
            : args.result === "cancelled"
              ? "cancelled"
              : "ready";
        await ctx.db.patch(run._id, {
          status: args.result,
          summary: optionalString(args.summary, "summary", MAX_DESCRIPTION_LENGTH),
          failureCode:
            args.result === "failed"
              ? optionalString(args.failureCode, "failureCode", 200) ?? "agent_failed"
              : undefined,
          lastHeartbeatAt: now,
          finishedAt: now,
        });
        await ctx.db.patch(work._id, {
          state,
          claimedByActorId: undefined,
          claimedByInstallationId: undefined,
          claimedRunId: undefined,
          claimedAt: undefined,
          claimExpiresAt: undefined,
          completedAt: state === "done" ? now : undefined,
          revision: work.revision + 1,
          updatedAt: now,
        });
        const artifactIds = await recordInlineArtifacts(
          ctx,
          work,
          run._id,
          principal.actor._id,
          args.artifacts ?? [],
          now,
        );
        await appendEvent(ctx, {
          organizationId: work.organizationId,
          projectId: work.projectId,
          workItemId: work._id,
          runId: run._id,
          actorId: principal.actor._id,
          type:
            args.result === "completed"
              ? "work.completed"
              : args.result === "failed"
                ? "run.failed"
                : "work.cancelled",
          data: {
            state,
            failureCode: args.failureCode ?? null,
            artifactIds,
          },
          requestId: principal.requestId,
          createdAt: now,
        });
        return { workItemId: work._id, runId: run._id, state, revision: work.revision + 1 };
      },
    );
  },
});

export const reorder = mutation({
  args: {
    workItemId: v.id("workItems"),
    expectedRevision: v.number(),
    rank: v.number(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const work = await ctx.db.get(args.workItemId);
    if (!work) fail("not_found", "Work item not found");
    const principal = await requireHumanProject(ctx, work.projectId);
    const now = Date.now();
    return await runIdempotent(
      ctx,
      {
        organizationId: work.organizationId,
        projectId: work.projectId,
        principalKey: principal.principalKey,
        operation: "work.reorder",
        key: args.idempotencyKey,
        payload: args,
        now,
      },
      async () => {
        assertExpectedRevision(work.revision, args.expectedRevision);
        if (work.state !== "ready") {
          fail("invalid_transition", "Only Ready work may be reordered");
        }
        if (!Number.isFinite(args.rank)) fail("validation", "rank must be finite");
        await ctx.db.patch(work._id, {
          rank: args.rank,
          revision: work.revision + 1,
          updatedAt: now,
        });
        await appendEvent(ctx, {
          organizationId: work.organizationId,
          projectId: work.projectId,
          workItemId: work._id,
          actorId: principal.actor._id,
          type: "work.reordered",
          data: { rank: args.rank },
          createdAt: now,
        });
        return { revision: work.revision + 1, rank: args.rank };
      },
    );
  },
});

export const cancelForHuman = mutation({
  args: {
    workItemId: v.id("workItems"),
    expectedRevision: v.number(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const work = await ctx.db.get(args.workItemId);
    if (!work) fail("not_found", "Work item not found");
    const principal = await requireHumanProject(ctx, work.projectId);
    const now = Date.now();
    return await runIdempotent(
      ctx,
      {
        organizationId: work.organizationId,
        projectId: work.projectId,
        principalKey: principal.principalKey,
        operation: "work.cancel",
        key: args.idempotencyKey,
        payload: {
          workItemId: work._id,
          expectedRevision: args.expectedRevision,
        },
        now,
      },
      async () => {
        assertExpectedRevision(work.revision, args.expectedRevision);
        if (work.state === "done" || work.state === "cancelled") {
          fail("invalid_transition", "Work item is already closed");
        }
        if (work.claimedRunId) {
          const run = await ctx.db.get(work.claimedRunId);
          if (run && (run.status === "running" || run.status === "waiting")) {
            await ctx.db.patch(run._id, {
              status: "cancelled",
              failureCode: "cancelled_by_human",
              lastHeartbeatAt: now,
              finishedAt: now,
            });
          }
        }
        const openAttention = await Promise.all(
          (["open", "seen"] as const).map((status) =>
            ctx.db
              .query("attentionRequests")
              .withIndex("by_work_status", (q) =>
                q.eq("workItemId", work._id).eq("status", status),
              )
              .collect(),
          ),
        );
        for (const request of openAttention.flat()) {
          await ctx.db.patch(request._id, {
            status: "resolved",
            resolvedAt: now,
            resolvedByActorId: principal.actor._id,
            resolutionKind: "cancelled",
          });
        }
        await ctx.db.patch(work._id, {
          state: "cancelled",
          claimedByActorId: undefined,
          claimedByInstallationId: undefined,
          claimedRunId: undefined,
          claimedAt: undefined,
          claimExpiresAt: undefined,
          completedAt: undefined,
          revision: work.revision + 1,
          updatedAt: now,
        });
        await appendEvent(ctx, {
          organizationId: work.organizationId,
          projectId: work.projectId,
          workItemId: work._id,
          actorId: principal.actor._id,
          type: "work.cancelled",
          data: {},
          createdAt: now,
        });
        return {
          workItemId: work._id,
          state: "cancelled" as const,
          revision: work.revision + 1,
        };
      },
    );
  },
});

export const reconcileExpiredClaims = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("workItems")
      .withIndex("by_claim_expiry", (q) =>
        q.gt("claimExpiresAt", 0).lte("claimExpiresAt", now),
      )
      .take(Math.max(1, Math.min(args.limit ?? 100, 200)));
    let reconciled = 0;
    for (const work of expired) {
      if (!work.claimedRunId) continue;
      await expireStaleWorkClaim(ctx, work, now);
      reconciled += 1;
    }
    return { reconciled };
  },
});
