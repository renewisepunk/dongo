import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import schema from "../schema";
import { modules } from "../test.setup";

beforeEach(() => {
  process.env.DONGO_ENABLE_DEV_BOOTSTRAP = "true";
});

afterEach(() => {
  delete process.env.DONGO_ENABLE_DEV_BOOTSTRAP;
});

type AgentContext = {
  requestId: string;
  installationId: Id<"installations">;
  actorId: Id<"actors">;
  organizationId: Id<"organizations">;
  projectId: Id<"projects">;
  projectRef: string;
  resource: string;
  clientId: string;
  scopes: string[];
  externalSessionId?: string;
};

async function seedProject(
  t: ReturnType<typeof convexTest>,
  suffix: string,
): Promise<AgentContext> {
  const key = `resources-${suffix}-${crypto.randomUUID()}`;
  const seeded = await t.mutation(internal.dev.bootstrap.createWalkingSkeleton, {
    key,
    organizationSlug: `org-${key}`,
    projectSlug: `project-${key}`,
  });
  const context = await t.run(async (ctx) => {
    const installation = await ctx.db.get(seeded.installationId!);
    const project = await ctx.db.get(seeded.projectId!);
    if (!installation || !project) throw new Error("fixture missing");
    await ctx.db.patch(project._id, {
      parallelExecutionEnabled: true,
      maxConcurrentRuns: 6,
    });
    return {
      requestId: crypto.randomUUID(),
      installationId: installation._id,
      actorId: installation.actorId,
      organizationId: installation.organizationId,
      projectId: project._id,
      projectRef: project.publicRef,
      resource: installation.resource,
      clientId: installation.clientId,
      scopes: installation.scopes,
    };
  });
  return context;
}

async function startWork(
  t: ReturnType<typeof convexTest>,
  context: AgentContext,
  suffix: string,
) {
  const externalSessionId = `resource-session-${suffix}`;
  const authorization = { ...context, externalSessionId };
  await t.mutation(internal.gateway.readModels.sessionStart, {
    authorization,
    hostCapabilities: {
      parallelExecution: "supported",
      worktreeIsolation: "supported",
    },
  });
  const created = await t.mutation(internal.domains.work.index.createForAgent, {
    authorization,
    title: `Resource work ${suffix}`,
    description: `Exercise resource claim ${suffix}`,
    kind: "task",
    idempotencyKey: `create-${suffix}`,
  });
  const createdWork = await t.run(async (ctx) => await ctx.db.get(created.workItemId));
  if (!createdWork) throw new Error("created work missing");
  const started = await t.mutation(internal.domains.work.index.start, {
    authorization,
    workItemId: created.workItemId,
    expectedRevision: createdWork.revision,
    workspace: {
      kind: "worktree",
      worktreeName: `resource-${suffix}`,
      branch: `test/resource-${suffix}`,
    },
    idempotencyKey: `start-${suffix}`,
  });
  return {
    authorization,
    workItemId: created.workItemId,
    runId: started.runId,
    revision: started.revision,
  };
}

function acquireArgs(
  active: Awaited<ReturnType<typeof startWork>>,
  expectedRevision: number,
  resourceKey: string,
  idempotencyKey: string,
) {
  return {
    authorization: active.authorization,
    workItemId: active.workItemId,
    runId: active.runId,
    expectedRevision,
    resourceKey,
    resourceLabel: "Shared live browser",
    leaseSeconds: 120,
    idempotencyKey,
  };
}

describe("shared resource leases", () => {
  it("grants one holder, reports FIFO waits, and hands off without serializing Runs", async () => {
    const t = convexTest(schema, modules);
    const context = await seedProject(t, "fifo");
    const first = await startWork(t, context, "fifo-first");
    const second = await startWork(t, context, "fifo-second");
    const third = await startWork(t, context, "fifo-third");
    const key = "browser:shared-debug-port";

    const firstClaim = await t.mutation(
      internal.domains.resources.index.acquire,
      acquireArgs(first, first.revision, key, "acquire-first"),
    );
    const secondInput = acquireArgs(second, second.revision, key, "acquire-second");
    const secondClaim = await t.mutation(
      internal.domains.resources.index.acquire,
      secondInput,
    );
    const thirdClaim = await t.mutation(
      internal.domains.resources.index.acquire,
      acquireArgs(third, third.revision, key, "acquire-third"),
    );

    expect(firstClaim).toMatchObject({ state: "held" });
    expect(firstClaim).not.toHaveProperty("queuePosition");
    expect(secondClaim).toMatchObject({
      state: "waiting",
      queuePosition: 1,
      holderWorkIdentifier: expect.stringMatching(/^[a-z]{4}[0-9]{3}$/u),
    });
    expect(thirdClaim).toMatchObject({ state: "waiting", queuePosition: 2 });

    const runsBeforeRelease = await t.run(async (ctx) => ({
      first: await ctx.db.get(first.runId),
      second: await ctx.db.get(second.runId),
      third: await ctx.db.get(third.runId),
    }));
    expect(runsBeforeRelease.first?.status).toBe("running");
    expect(runsBeforeRelease.second).toMatchObject({
      status: "running",
      activityKind: "waiting_for_resource",
      activityLabel: "Waiting for Shared live browser",
    });
    expect(runsBeforeRelease.third?.status).toBe("running");

    const secondWaitingRenewed = await t.mutation(
      internal.domains.resources.index.acquire,
      acquireArgs(second, secondClaim.workRevision, key, "renew-second-wait"),
    );
    expect(secondWaitingRenewed).toMatchObject({
      state: "waiting",
      queuePosition: 1,
    });

    const released = await t.mutation(internal.domains.resources.index.release, {
      authorization: first.authorization,
      workItemId: first.workItemId,
      runId: first.runId,
      expectedRevision: firstClaim.workRevision,
      resourceKey: key,
      idempotencyKey: "release-first",
    });
    expect(released).toMatchObject({ state: "released" });

    const secondRenewed = await t.mutation(
      internal.domains.resources.index.acquire,
      acquireArgs(second, secondWaitingRenewed.workRevision, key, "renew-second"),
    );
    const thirdRenewed = await t.mutation(
      internal.domains.resources.index.acquire,
      acquireArgs(third, thirdClaim.workRevision, key, "renew-third"),
    );
    expect(secondRenewed).toMatchObject({ state: "held" });
    expect(secondRenewed).not.toHaveProperty("queuePosition");
    expect(thirdRenewed).toMatchObject({ state: "waiting", queuePosition: 1 });
  });

  it("replays duplicate delivery without advancing revision or duplicating claims", async () => {
    const t = convexTest(schema, modules);
    const context = await seedProject(t, "duplicate");
    const active = await startWork(t, context, "duplicate");
    const input = acquireArgs(
      active,
      active.revision,
      "conversation:provider-test-thread",
      "stable-acquire",
    );

    const first = await t.mutation(internal.domains.resources.index.acquire, input);
    const replay = await t.mutation(internal.domains.resources.index.acquire, input);
    expect(replay).toEqual(first);

    const snapshot = await t.run(async (ctx) => {
      const work = await ctx.db.get(active.workItemId);
      const claims = await ctx.db
        .query("resourceClaims")
        .withIndex("by_run_resource", (query) =>
          query
            .eq("runId", active.runId)
            .eq("resourceKey", input.resourceKey),
        )
        .collect();
      return { work, claims };
    });
    expect(snapshot.work?.revision).toBe(first.workRevision);
    expect(snapshot.claims).toHaveLength(1);
    expect(snapshot.claims[0]?.status).toBe("held");
  });

  it("expires a stale holder and automatically promotes the oldest eligible waiter", async () => {
    const t = convexTest(schema, modules);
    const context = await seedProject(t, "expiry");
    const first = await startWork(t, context, "expiry-first");
    const second = await startWork(t, context, "expiry-second");
    const key = "sender:acceptance-phone";
    const firstClaim = await t.mutation(
      internal.domains.resources.index.acquire,
      acquireArgs(first, first.revision, key, "expiry-first-acquire"),
    );
    await t.mutation(
      internal.domains.resources.index.acquire,
      acquireArgs(second, second.revision, key, "expiry-second-acquire"),
    );
    await t.run(async (ctx) => {
      const held = await ctx.db
        .query("resourceClaims")
        .withIndex("by_run_status", (query) =>
          query.eq("runId", first.runId).eq("status", "held"),
        )
        .unique();
      if (!held) throw new Error("held claim missing");
      await ctx.db.patch(held._id, { leaseExpiresAt: Date.now() - 1 });
    });

    await expect(t.mutation(
      internal.domains.resources.index.reconcileExpiredClaims,
      { limit: 10 },
    )).resolves.toEqual({ reconciled: 1 });

    const claims = await t.run(async (ctx) => ({
      first: await ctx.db
        .query("resourceClaims")
        .withIndex("by_run_resource", (query) =>
          query.eq("runId", first.runId).eq("resourceKey", key),
        )
        .unique(),
      second: await ctx.db
        .query("resourceClaims")
        .withIndex("by_run_resource", (query) =>
          query.eq("runId", second.runId).eq("resourceKey", key),
        )
        .unique(),
    }));
    expect(claims.first).toMatchObject({
      status: "released",
      releaseReason: "lease_expired",
    });
    expect(claims.first?.releasedAt).toBeGreaterThanOrEqual(firstClaim.acquiredAt!);
    expect(claims.second).toMatchObject({ status: "held" });
  });

  it("recovers an agent crash by releasing the stale Run before reclaim", async () => {
    const t = convexTest(schema, modules);
    const context = await seedProject(t, "crash");
    const first = await startWork(t, context, "crash-first");
    const second = await startWork(t, context, "crash-second");
    const key = "browser:crash-recovery";
    const firstClaim = await t.mutation(
      internal.domains.resources.index.acquire,
      acquireArgs(first, first.revision, key, "crash-first-acquire"),
    );
    await t.mutation(
      internal.domains.resources.index.acquire,
      acquireArgs(second, second.revision, key, "crash-second-acquire"),
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(first.workItemId, { claimExpiresAt: Date.now() - 1 });
    });

    const recoverySession = "resource-session-crash-recovery";
    const recoveryAuthorization = { ...context, externalSessionId: recoverySession };
    await t.mutation(internal.gateway.readModels.sessionStart, {
      authorization: recoveryAuthorization,
      hostCapabilities: {
        parallelExecution: "supported",
        worktreeIsolation: "supported",
      },
    });
    const reclaimed = await t.mutation(internal.domains.work.index.start, {
      authorization: recoveryAuthorization,
      workItemId: first.workItemId,
      expectedRevision: firstClaim.workRevision,
      workspace: {
        kind: "worktree",
        worktreeName: "resource-crash-recovery",
        branch: "test/resource-crash-recovery",
      },
      idempotencyKey: "start-crash-recovery",
    });

    const recovered = await t.run(async (ctx) => ({
      oldRun: await ctx.db.get(first.runId),
      newRun: await ctx.db.get(reclaimed.runId),
      oldClaim: await ctx.db
        .query("resourceClaims")
        .withIndex("by_run_resource", (query) =>
          query.eq("runId", first.runId).eq("resourceKey", key),
        )
        .unique(),
      nextClaim: await ctx.db
        .query("resourceClaims")
        .withIndex("by_run_resource", (query) =>
          query.eq("runId", second.runId).eq("resourceKey", key),
        )
        .unique(),
    }));
    expect(recovered.oldRun).toMatchObject({
      status: "failed",
      failureCode: "lease_expired",
    });
    expect(recovered.newRun).toMatchObject({ status: "running" });
    expect(recovered.oldClaim).toMatchObject({
      status: "released",
      releaseReason: "owner_inactive",
    });
    expect(recovered.nextClaim).toMatchObject({ status: "held" });
  });

  it("releases claims on Run termination and keeps unrelated resources parallel", async () => {
    const t = convexTest(schema, modules);
    const context = await seedProject(t, "finish");
    const first = await startWork(t, context, "finish-first");
    const second = await startWork(t, context, "finish-second");
    const sharedKey = "deployment:development";
    const firstShared = await t.mutation(
      internal.domains.resources.index.acquire,
      acquireArgs(first, first.revision, sharedKey, "finish-first-shared"),
    );
    const secondShared = await t.mutation(
      internal.domains.resources.index.acquire,
      acquireArgs(second, second.revision, sharedKey, "finish-second-shared"),
    );
    const secondIndependent = await t.mutation(
      internal.domains.resources.index.acquire,
      acquireArgs(
        second,
        secondShared.workRevision,
        "browser:independent-profile",
        "finish-second-independent",
      ),
    );
    expect(secondShared.state).toBe("waiting");
    expect(secondIndependent.state).toBe("held");

    await t.mutation(internal.domains.work.index.finish, {
      authorization: first.authorization,
      workItemId: first.workItemId,
      runId: first.runId,
      expectedRevision: firstShared.workRevision,
      result: "completed",
      summary: "Shared resource cleanup verified",
      idempotencyKey: "finish-first-run",
    });

    const after = await t.run(async (ctx) => ({
      first: await ctx.db
        .query("resourceClaims")
        .withIndex("by_run_resource", (query) =>
          query.eq("runId", first.runId).eq("resourceKey", sharedKey),
        )
        .unique(),
      secondShared: await ctx.db
        .query("resourceClaims")
        .withIndex("by_run_resource", (query) =>
          query.eq("runId", second.runId).eq("resourceKey", sharedKey),
        )
        .unique(),
      secondIndependent: await ctx.db
        .query("resourceClaims")
        .withIndex("by_run_resource", (query) =>
          query
            .eq("runId", second.runId)
            .eq("resourceKey", "browser:independent-profile"),
        )
        .unique(),
    }));
    expect(after.first).toMatchObject({ status: "released", releaseReason: "run_finished" });
    expect(after.secondShared).toMatchObject({ status: "held" });
    expect(after.secondIndependent).toMatchObject({ status: "held" });
  });

  it("scopes identical resource keys to their project and rejects unsafe labels", async () => {
    const t = convexTest(schema, modules);
    const firstProject = await seedProject(t, "scope-first");
    const secondProject = await seedProject(t, "scope-second");
    const first = await startWork(t, firstProject, "scope-first");
    const second = await startWork(t, secondProject, "scope-second");
    const key = "browser:acceptance";

    await expect(t.mutation(
      internal.domains.resources.index.acquire,
      acquireArgs(first, first.revision, key, "scope-first-acquire"),
    )).resolves.toMatchObject({ state: "held" });
    await expect(t.mutation(
      internal.domains.resources.index.acquire,
      acquireArgs(second, second.revision, key, "scope-second-acquire"),
    )).resolves.toMatchObject({ state: "held" });
    await expect(t.mutation(internal.domains.resources.index.acquire, {
      ...acquireArgs(first, first.revision + 1, "browser:unsafe", "unsafe-label"),
      resourceLabel: "Shared browser\nsecret detail",
    })).rejects.toMatchObject({ data: { code: "validation" } });
  });
});
