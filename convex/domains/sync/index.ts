import { v } from "convex/values";
import { internalMutation, internalQuery } from "../../_generated/server";
import { agentContextValidator } from "../../lib/validators";
import { fail } from "../../lib/errors";
import { resolveAgentPrincipal } from "../../lib/authz";
import { buildOverview } from "../overview/index";

const SYNC_LIMIT = 100;

export const sessionStart = internalQuery({
  args: { authorization: agentContextValidator },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:read",
    );
    const cursor = await ctx.db
      .query("agentSyncCursors")
      .withIndex("by_installation", (q) =>
        q.eq("installationId", principal.installation._id),
      )
      .unique();
    const responses = await ctx.db
      .query("attentionRequests")
      .withIndex("by_requester_resolved", (q) =>
        q
          .eq("requestedByActorId", principal.actor._id)
          .gt("resolvedAt", cursor?.lastAcknowledgedAt ?? 0),
      )
      .order("asc")
      .take(SYNC_LIMIT);
    const newlyResolvedAttention = await Promise.all(
      responses.map(async (request) => ({
        request,
        response: request.resolutionCommentId
          ? await ctx.db.get(request.resolutionCommentId)
          : null,
      })),
    );
    return {
      project: principal.project,
      installation: principal.installation,
      overview: await buildOverview(ctx, principal.project),
      newlyResolvedAttention,
      instructions: {
        executionMode: principal.project.executionMode,
        maxNewWorkItemsPerSession: 1 as const,
        wakeUpSemantics: "next_pull" as const,
      },
    };
  },
});

export const snapshot = internalQuery({
  args: { authorization: agentContextValidator },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:read",
    );
    const now = Date.now();
    const cursor = await ctx.db
      .query("agentSyncCursors")
      .withIndex("by_installation", (q) =>
        q.eq("installationId", principal.installation._id),
      )
      .unique();
    const since = cursor?.lastAcknowledgedAt ?? 0;
    const [ready, newIntakes, runningRuns, waitingRuns, responses, events] =
      await Promise.all([
        ctx.db
          .query("workItems")
          .withIndex("by_project_state_rank", (q) =>
            q.eq("projectId", principal.project._id).eq("state", "ready"),
          )
          .order("asc")
          .take(SYNC_LIMIT),
        ctx.db
          .query("intakes")
          .withIndex("by_project_status_created", (q) =>
            q.eq("projectId", principal.project._id).eq("status", "new"),
          )
          .order("asc")
          .take(SYNC_LIMIT),
        ctx.db
          .query("runs")
          .withIndex("by_installation_status", (q) =>
            q
              .eq("installationId", principal.installation._id)
              .eq("status", "running"),
          )
          .order("desc")
          .take(SYNC_LIMIT),
        ctx.db
          .query("runs")
          .withIndex("by_installation_status", (q) =>
            q
              .eq("installationId", principal.installation._id)
              .eq("status", "waiting"),
          )
          .order("desc")
          .take(SYNC_LIMIT),
        ctx.db
          .query("attentionRequests")
          .withIndex("by_requester_resolved", (q) =>
            q
              .eq("requestedByActorId", principal.actor._id)
              .gt("resolvedAt", since),
          )
          .order("asc")
          .take(SYNC_LIMIT),
        ctx.db
          .query("events")
          .withIndex("by_project_created", (q) =>
            q.eq("projectId", principal.project._id).gt("createdAt", since),
          )
          .order("asc")
          .take(SYNC_LIMIT),
      ]);
    const activeRuns = await Promise.all(
      [...runningRuns, ...waitingRuns].map(async (run) => {
        const work = await ctx.db.get(run.workItemId);
        const activelyClaimed =
          run.status === "running" &&
          work?.claimedRunId === run._id &&
          work.claimExpiresAt !== undefined &&
          work.claimExpiresAt > now;
        return { run, work, activelyClaimed };
      }),
    );
    const resolvedAttention = await Promise.all(
      responses.map(async (request) => ({
        request,
        response: request.resolutionCommentId
          ? await ctx.db.get(request.resolutionCommentId)
          : null,
      })),
    );
    return {
      project: principal.project,
      installation: principal.installation,
      generatedAt: now,
      acknowledgedThrough: since,
      nextAcknowledgement: now,
      ready,
      inbox: newIntakes,
      activeRuns,
      resolvedAttention,
      events,
      truncated: {
        ready: ready.length === SYNC_LIMIT,
        inbox: newIntakes.length === SYNC_LIMIT,
        activeRuns:
          runningRuns.length === SYNC_LIMIT || waitingRuns.length === SYNC_LIMIT,
        responses: responses.length === SYNC_LIMIT,
        events: events.length === SYNC_LIMIT,
      },
    };
  },
});

export const acknowledge = internalMutation({
  args: {
    authorization: agentContextValidator,
    acknowledgedThrough: v.number(),
  },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:read",
    );
    const now = Date.now();
    if (
      !Number.isFinite(args.acknowledgedThrough) ||
      args.acknowledgedThrough < 0 ||
      args.acknowledgedThrough > now
    ) {
      fail("validation", "Acknowledgement cursor is outside the valid range");
    }
    const existing = await ctx.db
      .query("agentSyncCursors")
      .withIndex("by_installation", (q) =>
        q.eq("installationId", principal.installation._id),
      )
      .unique();
    const lastAcknowledgedAt = Math.max(
      existing?.lastAcknowledgedAt ?? 0,
      args.acknowledgedThrough,
    );
    if (existing) {
      await ctx.db.patch(existing._id, { lastAcknowledgedAt, updatedAt: now });
    } else {
      await ctx.db.insert("agentSyncCursors", {
        organizationId: principal.project.organizationId,
        projectId: principal.project._id,
        installationId: principal.installation._id,
        lastAcknowledgedAt,
        updatedAt: now,
      });
    }
    return { acknowledgedThrough: lastAcknowledgedAt };
  },
});
