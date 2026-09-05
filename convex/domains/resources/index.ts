import { v } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { internalMutation } from "../../_generated/server";
import { assertSameProject, requireSystemActor, resolveAgentPrincipal } from "../../lib/authz";
import { appendEvent } from "../../lib/events";
import { assertExpectedRevision, fail, requireString } from "../../lib/errors";
import { runIdempotent } from "../../lib/idempotency";
import { isLeaseActive, newLease } from "../../lib/leases";
import { agentContextValidator } from "../../lib/validators";
import {
  promoteResourceWaiter,
  releaseResourceClaim,
} from "./service";

const RESOURCE_KEY_PATTERN = /^[a-z0-9](?:[a-z0-9._:/-]{0,118}[a-z0-9])?$/u;

function resourceKey(value: string): string {
  const normalized = requireString(value, "resourceKey", 120).toLowerCase();
  if (!RESOURCE_KEY_PATTERN.test(normalized)) {
    fail(
      "validation",
      "resourceKey must use 1-120 lowercase letters, numbers, dots, colons, slashes, underscores, or hyphens",
    );
  }
  return normalized;
}

function resourceLabel(value: string | undefined, key: string): string {
  const label = value === undefined ? key : requireString(value, "resourceLabel", 120);
  if (/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(label)) {
    fail("validation", "resourceLabel must be plain single-line text");
  }
  return label;
}

async function activeClaimForRun(
  ctx: Pick<MutationCtx, "db">,
  runId: Id<"runs">,
  key: string,
) {
  const claims = await ctx.db
    .query("resourceClaims")
    .withIndex("by_run_resource", (query) =>
      query.eq("runId", runId).eq("resourceKey", key),
    )
    .order("desc")
    .collect();
  return claims.find((claim) => claim.status !== "released");
}

async function resultDto(
  ctx: Pick<MutationCtx, "db">,
  claim: Doc<"resourceClaims">,
  workRevision: number,
  workClaimExpiresAt: number,
) {
  const held = await ctx.db
    .query("resourceClaims")
    .withIndex("by_project_resource_status_requested", (query) =>
      query
        .eq("projectId", claim.projectId)
        .eq("resourceKey", claim.resourceKey)
        .eq("status", "held"),
    )
    .first();
  const holderWork = held ? await ctx.db.get(held.workItemId) : undefined;
  let queuePosition: number | undefined;
  if (claim.status === "waiting") {
    const waiting = await ctx.db
      .query("resourceClaims")
      .withIndex("by_project_resource_status_requested", (query) =>
        query
          .eq("projectId", claim.projectId)
          .eq("resourceKey", claim.resourceKey)
          .eq("status", "waiting"),
      )
      .collect();
    const index = waiting.findIndex((candidate) => candidate._id === claim._id);
    queuePosition = index >= 0 ? index + 1 : undefined;
  }
  return {
    resourceKey: claim.resourceKey,
    resourceLabel: claim.resourceLabel,
    state: claim.status,
    queuePosition,
    holderWorkIdentifier: holderWork?.identifier,
    requestedAt: claim.requestedAt,
    acquiredAt: claim.acquiredAt,
    leaseExpiresAt: claim.status === "released" ? undefined : claim.leaseExpiresAt,
    releasedAt: claim.releasedAt,
    workRevision,
    workClaimExpiresAt,
  };
}

async function requireRunContext(
  ctx: MutationCtx,
  args: {
    authorization: Parameters<typeof resolveAgentPrincipal>[1];
    workItemId: Id<"workItems">;
    runId: Id<"runs">;
  },
) {
  const principal = await resolveAgentPrincipal(
    ctx,
    args.authorization,
    "dongo:work:write",
  );
  const [work, run] = await Promise.all([
    ctx.db.get(args.workItemId),
    ctx.db.get(args.runId),
  ]);
  if (!work || !run) fail("not_found", "Work item or Run not found");
  assertSameProject(work, principal.project);
  return { principal, work, run };
}

function assertActiveRun(
  work: Doc<"workItems">,
  run: Doc<"runs">,
  installationId: Id<"installations">,
  expectedRevision: number,
  now: number,
) {
  assertExpectedRevision(work.revision, expectedRevision);
  if (
    work.claimedRunId !== run._id ||
    work.claimedByInstallationId !== installationId ||
    run.installationId !== installationId ||
    run.status !== "running"
  ) {
    fail("claim_conflict", "The active Run no longer owns this WorkItem");
  }
  if (!isLeaseActive(work.claimExpiresAt, now)) {
    fail("lease_expired", "The WorkItem claim has expired");
  }
}

export const acquire = internalMutation({
  args: {
    authorization: agentContextValidator,
    workItemId: v.id("workItems"),
    runId: v.id("runs"),
    expectedRevision: v.number(),
    resourceKey: v.string(),
    resourceLabel: v.optional(v.string()),
    leaseSeconds: v.optional(v.number()),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const { principal, work, run } = await requireRunContext(ctx, args);
    const key = resourceKey(args.resourceKey);
    const label = resourceLabel(args.resourceLabel, key);
    return await runIdempotent(ctx, {
      organizationId: work.organizationId,
      projectId: work.projectId,
      principalKey: principal.principalKey,
      operation: "resource.acquire",
      key: args.idempotencyKey,
      payload: {
        workItemId: work._id,
        runId: run._id,
        expectedRevision: args.expectedRevision,
        resourceKey: key,
        resourceLabel: label,
        leaseSeconds: args.leaseSeconds,
      },
      now,
    }, async () => {
      assertActiveRun(
        work,
        run,
        principal.installation._id,
        args.expectedRevision,
        now,
      );
      const lease = newLease(now, args.leaseSeconds);
      await promoteResourceWaiter(ctx, {
        projectId: work.projectId,
        resourceKey: key,
        actorId: principal.actor._id,
        now,
      });
      let claim = await activeClaimForRun(ctx, run._id, key);
      const created = claim === undefined;
      if (!claim) {
        const claimId = await ctx.db.insert("resourceClaims", {
          organizationId: work.organizationId,
          projectId: work.projectId,
          workItemId: work._id,
          runId: run._id,
          actorId: principal.actor._id,
          installationId: principal.installation._id,
          resourceKey: key,
          resourceLabel: label,
          status: "waiting",
          requestedAt: now,
          leaseExpiresAt: lease.claimExpiresAt,
          updatedAt: now,
        });
        const inserted = await ctx.db.get(claimId);
        if (!inserted) fail("internal", "Resource claim was not created");
        claim = inserted;
      } else {
        await ctx.db.patch(claim._id, {
          resourceLabel: label,
          leaseExpiresAt: lease.claimExpiresAt,
          updatedAt: now,
        });
        claim = { ...claim, resourceLabel: label, leaseExpiresAt: lease.claimExpiresAt, updatedAt: now };
      }
      await promoteResourceWaiter(ctx, {
        projectId: work.projectId,
        resourceKey: key,
        actorId: principal.actor._id,
        now,
      });
      const refreshed = await ctx.db.get(claim._id);
      if (!refreshed || refreshed.status === "released") {
        fail("lease_expired", "The shared-resource request expired before it could be renewed");
      }
      claim = refreshed;
      await ctx.db.patch(claim._id, {
        resourceLabel: label,
        leaseExpiresAt: lease.claimExpiresAt,
        updatedAt: now,
      });
      claim = { ...claim, resourceLabel: label, leaseExpiresAt: lease.claimExpiresAt, updatedAt: now };
      await ctx.db.patch(work._id, {
        claimExpiresAt: lease.claimExpiresAt,
        revision: work.revision + 1,
        updatedAt: now,
      });
      await ctx.db.patch(run._id, {
        activityKind: claim.status === "held" ? "executing" : "waiting_for_resource",
        activityLabel: claim.status === "held"
          ? `Using ${label}`
          : `Waiting for ${label}`,
        activityNextStep: claim.status === "held"
          ? `Release ${label} when the exclusive live step finishes.`
          : `Retry this bounded claim while continuing any work that does not need ${label}.`,
        activityUpdatedAt: now,
        lastHeartbeatAt: now,
      });
      if (created && claim.status === "waiting") {
        await appendEvent(ctx, {
          organizationId: work.organizationId,
          projectId: work.projectId,
          workItemId: work._id,
          runId: run._id,
          actorId: principal.actor._id,
          type: "resource.waiting",
          data: { resourceKey: key, leaseExpiresAt: lease.claimExpiresAt },
          requestId: principal.requestId,
          createdAt: now,
        });
      }
      return await resultDto(
        ctx,
        claim,
        work.revision + 1,
        lease.claimExpiresAt,
      );
    });
  },
});

export const release = internalMutation({
  args: {
    authorization: agentContextValidator,
    workItemId: v.id("workItems"),
    runId: v.id("runs"),
    expectedRevision: v.number(),
    resourceKey: v.string(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const { principal, work, run } = await requireRunContext(ctx, args);
    const key = resourceKey(args.resourceKey);
    return await runIdempotent(ctx, {
      organizationId: work.organizationId,
      projectId: work.projectId,
      principalKey: principal.principalKey,
      operation: "resource.release",
      key: args.idempotencyKey,
      payload: {
        workItemId: work._id,
        runId: run._id,
        expectedRevision: args.expectedRevision,
        resourceKey: key,
      },
      now,
    }, async () => {
      assertActiveRun(
        work,
        run,
        principal.installation._id,
        args.expectedRevision,
        now,
      );
      const claim = await activeClaimForRun(ctx, run._id, key);
      if (!claim) fail("not_found", "This Run has no active claim for that resource");
      const next = await releaseResourceClaim(ctx, {
        claim,
        actorId: principal.actor._id,
        now,
        reason: "released",
      });
      const lease = newLease(now);
      await ctx.db.patch(work._id, {
        claimExpiresAt: lease.claimExpiresAt,
        revision: work.revision + 1,
        updatedAt: now,
      });
      await ctx.db.patch(run._id, {
        activityKind: "executing",
        activityLabel: `Released ${claim.resourceLabel}`,
        activityNextStep: "Continue work that does not require this exclusive resource.",
        activityUpdatedAt: now,
        lastHeartbeatAt: now,
      });
      const released = await ctx.db.get(claim._id);
      if (!released) fail("internal", "Resource claim disappeared during release");
      const result = await resultDto(
        ctx,
        released,
        work.revision + 1,
        lease.claimExpiresAt,
      );
      if (!next) return result;
      const nextWork = await ctx.db.get(next.workItemId);
      return {
        ...result,
        holderWorkIdentifier: nextWork?.identifier,
      };
    });
  },
});

export const reconcileExpiredClaims = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const limit = Math.max(1, Math.min(args.limit ?? 100, 200));
    const perStateLimit = Math.max(1, Math.ceil(limit / 2));
    const expired = (
      await Promise.all(
        (["waiting", "held"] as const).map((status) =>
          ctx.db
            .query("resourceClaims")
            .withIndex("by_status_lease", (query) =>
              query.eq("status", status).lte("leaseExpiresAt", now),
            )
            .take(perStateLimit),
        ),
      )
    ).flat().slice(0, limit);
    let reconciled = 0;
    for (const candidate of expired) {
      const claim = await ctx.db.get(candidate._id);
      if (!claim || claim.status === "released" || claim.leaseExpiresAt > now) continue;
      const systemActor = await requireSystemActor(ctx, claim.organizationId);
      await releaseResourceClaim(ctx, {
        claim,
        actorId: systemActor._id,
        now,
        reason: "lease_expired",
      });
      reconciled += 1;
    }
    return { reconciled };
  },
});
