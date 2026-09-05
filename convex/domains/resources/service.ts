import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { appendEvent } from "../../lib/events";

export const DEFAULT_RESOURCE_LEASE_MS = 90_000;

type ResourceReleaseReason = Doc<"resourceClaims">["releaseReason"];

async function claimOwnerIsActive(
  ctx: Pick<MutationCtx, "db">,
  claim: Doc<"resourceClaims">,
  now: number,
): Promise<boolean> {
  if (claim.leaseExpiresAt <= now) return false;
  const [run, work] = await Promise.all([
    ctx.db.get(claim.runId),
    ctx.db.get(claim.workItemId),
  ]);
  return Boolean(
    run &&
      work &&
      run.projectId === claim.projectId &&
      run.workItemId === work._id &&
      run.status === "running" &&
      work.state === "working" &&
      work.claimedRunId === run._id &&
      work.claimedByInstallationId === claim.installationId &&
      (work.claimExpiresAt ?? 0) > now,
  );
}

async function releaseClaim(
  ctx: MutationCtx,
  claim: Doc<"resourceClaims">,
  actorId: Id<"actors">,
  now: number,
  reason: NonNullable<ResourceReleaseReason>,
) {
  if (claim.status === "released") return;
  await ctx.db.patch(claim._id, {
    status: "released",
    releasedAt: now,
    releaseReason: reason,
    updatedAt: now,
  });
  await appendEvent(ctx, {
    organizationId: claim.organizationId,
    projectId: claim.projectId,
    workItemId: claim.workItemId,
    runId: claim.runId,
    actorId,
    type: "resource.released",
    data: {
      resourceKey: claim.resourceKey,
      reason,
    },
    createdAt: now,
  });
}

export async function promoteResourceWaiter(
  ctx: MutationCtx,
  options: {
    projectId: Id<"projects">;
    resourceKey: string;
    actorId: Id<"actors">;
    now: number;
  },
): Promise<Doc<"resourceClaims"> | undefined> {
  const held = await ctx.db
    .query("resourceClaims")
    .withIndex("by_project_resource_status_requested", (query) =>
      query
        .eq("projectId", options.projectId)
        .eq("resourceKey", options.resourceKey)
        .eq("status", "held"),
    )
    .collect();
  for (const claim of held) {
    if (await claimOwnerIsActive(ctx, claim, options.now)) return claim;
    await releaseClaim(
      ctx,
      claim,
      options.actorId,
      options.now,
      claim.leaseExpiresAt <= options.now ? "lease_expired" : "owner_inactive",
    );
  }

  const waiting = await ctx.db
    .query("resourceClaims")
    .withIndex("by_project_resource_status_requested", (query) =>
      query
        .eq("projectId", options.projectId)
        .eq("resourceKey", options.resourceKey)
        .eq("status", "waiting"),
    )
    .collect();
  for (const claim of waiting) {
    if (!(await claimOwnerIsActive(ctx, claim, options.now))) {
      await releaseClaim(
        ctx,
        claim,
        options.actorId,
        options.now,
        claim.leaseExpiresAt <= options.now ? "lease_expired" : "owner_inactive",
      );
      continue;
    }
    const leaseExpiresAt = Math.max(
      claim.leaseExpiresAt,
      options.now + DEFAULT_RESOURCE_LEASE_MS,
    );
    await ctx.db.patch(claim._id, {
      status: "held",
      acquiredAt: options.now,
      leaseExpiresAt,
      updatedAt: options.now,
    });
    const run = await ctx.db.get(claim.runId);
    if (run?.status === "running") {
      await ctx.db.patch(run._id, {
        activityKind: "executing",
        activityLabel: `Resource available: ${claim.resourceLabel}`,
        activityNextStep: `Continue the live step and release ${claim.resourceLabel} when finished.`,
        activityUpdatedAt: options.now,
        lastHeartbeatAt: options.now,
      });
    }
    await appendEvent(ctx, {
      organizationId: claim.organizationId,
      projectId: claim.projectId,
      workItemId: claim.workItemId,
      runId: claim.runId,
      actorId: options.actorId,
      type: "resource.acquired",
      data: {
        resourceKey: claim.resourceKey,
        source: "fifo_handoff",
        leaseExpiresAt,
      },
      createdAt: options.now,
    });
    return {
      ...claim,
      status: "held",
      acquiredAt: options.now,
      leaseExpiresAt,
      updatedAt: options.now,
    };
  }
  return undefined;
}

export async function releaseRunResourceClaims(
  ctx: MutationCtx,
  options: {
    runId: Id<"runs">;
    actorId: Id<"actors">;
    now: number;
    reason?: "run_finished" | "owner_inactive";
  },
) {
  const active = (
    await Promise.all(
      (["waiting", "held"] as const).map((status) =>
        ctx.db
          .query("resourceClaims")
          .withIndex("by_run_status", (query) =>
            query.eq("runId", options.runId).eq("status", status),
          )
          .collect(),
      ),
    )
  ).flat();
  const resources = new Map<string, Id<"projects">>();
  for (const claim of active) {
    resources.set(claim.resourceKey, claim.projectId);
    await releaseClaim(
      ctx,
      claim,
      options.actorId,
      options.now,
      options.reason ?? "run_finished",
    );
  }
  for (const [resourceKey, projectId] of resources) {
    await promoteResourceWaiter(ctx, {
      projectId,
      resourceKey,
      actorId: options.actorId,
      now: options.now,
    });
  }
  return active.length;
}

export async function releaseResourceClaim(
  ctx: MutationCtx,
  options: {
    claim: Doc<"resourceClaims">;
    actorId: Id<"actors">;
    now: number;
    reason: NonNullable<ResourceReleaseReason>;
  },
) {
  await releaseClaim(ctx, options.claim, options.actorId, options.now, options.reason);
  return await promoteResourceWaiter(ctx, {
    projectId: options.claim.projectId,
    resourceKey: options.claim.resourceKey,
    actorId: options.actorId,
    now: options.now,
  });
}
