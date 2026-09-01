import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import type { Id } from "../_generated/dataModel";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { modules } from "../test.setup";

beforeEach(() => {
  process.env.DONGO_ENABLE_DEV_BOOTSTRAP = "true";
});

afterEach(() => {
  delete process.env.DONGO_ENABLE_DEV_BOOTSTRAP;
});

type TestContext = {
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

async function fixture() {
  const t = convexTest(schema, modules);
  const key = `concurrency-${crypto.randomUUID()}`;
  const seeded = await t.mutation(internal.dev.bootstrap.createWalkingSkeleton, {
    key,
    organizationSlug: `org-${crypto.randomUUID()}`,
    projectSlug: `project-${crypto.randomUUID()}`,
  });
  const context = await t.run(async (ctx): Promise<TestContext> => {
    const installation = await ctx.db.get(seeded.installationId!);
    const project = await ctx.db.get(seeded.projectId!);
    if (!installation || !project) throw new Error("fixture missing");
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
  const human = t.withIdentity({
    tokenIdentifier: `development:${key}`,
    subject: key,
    issuer: "development",
    email: `${key}@development.invalid`,
    name: "dongo developer",
  });
  return { t, context, human, profileId: seeded.profileId! };
}

async function createWork(
  t: ReturnType<typeof convexTest>,
  context: TestContext,
  key: string,
) {
  const created = await t.mutation(internal.domains.work.index.createForAgent, {
    authorization: context,
    title: `Parallel ${key}`,
    description: `Exercise ${key}`,
    kind: "task",
    idempotencyKey: `create-${key}`,
  });
  return await t.query(internal.gateway.readModels.getWork, {
    authorization: context,
    workItemId: created.workItemId,
  });
}

async function startSession(
  t: ReturnType<typeof convexTest>,
  context: TestContext,
  externalSessionId: string,
  capabilities?: {
    parallelExecution?: "supported" | "unsupported";
    worktreeIsolation?: "supported" | "unsupported";
  },
) {
  return await t.mutation(internal.gateway.readModels.sessionStart, {
    authorization: { ...context, externalSessionId },
    hostCapabilities: capabilities,
  });
}

describe("parallel execution safety", () => {
  it("keeps legacy and unsupported hosts serial while requiring safe existing Runs", async () => {
    const { t, context } = await fixture();
    await t.run((ctx) => ctx.db.patch(context.projectId, {
      parallelExecutionEnabled: true,
      maxConcurrentRuns: 4,
    }));
    const first = await createWork(t, context, "unsafe-first");
    const second = await createWork(t, context, "safe-second");

    await t.mutation(internal.domains.work.index.start, {
      authorization: { ...context, externalSessionId: "legacy-session" },
      workItemId: first.id as Id<"workItems">,
      expectedRevision: first.revision,
      idempotencyKey: "start-legacy-serial",
    });
    await startSession(t, context, "safe-session", {
      parallelExecution: "supported",
      worktreeIsolation: "supported",
    });
    await expect(t.mutation(internal.domains.work.index.start, {
      authorization: { ...context, externalSessionId: "safe-session" },
      workItemId: second.id as Id<"workItems">,
      expectedRevision: second.revision,
      workspace: { kind: "worktree", worktreeName: "safe-second", branch: "feature/safe" },
      idempotencyKey: "unsafe-existing-overlap",
    })).rejects.toMatchObject({
      data: {
        code: "parallel_execution_unavailable",
        details: { reason: "existing_run_not_isolated" },
      },
    });
  });

  it("enforces distinct sessions and the configured capacity after idempotent replay", async () => {
    const { t, context, human } = await fixture();
    await t.run((ctx) => ctx.db.patch(context.projectId, {
      parallelExecutionEnabled: true,
      maxConcurrentRuns: 2,
    }));
    const [first, second, third] = await Promise.all([
      createWork(t, context, "capacity-first"),
      createWork(t, context, "capacity-second"),
      createWork(t, context, "capacity-third"),
    ]);
    for (const sessionId of ["parallel-a", "parallel-b", "parallel-c"]) {
      await startSession(t, context, sessionId, {
        parallelExecution: "supported",
        worktreeIsolation: "supported",
      });
    }
    const firstInput = {
      authorization: { ...context, externalSessionId: "parallel-a" },
      workItemId: first.id as Id<"workItems">,
      expectedRevision: first.revision,
      workspace: { kind: "worktree" as const, worktreeName: "parallel-a", branch: "work/a" },
      idempotencyKey: "start-parallel-a",
    };
    await t.mutation(internal.domains.work.index.start, firstInput);
    const secondInput = {
      authorization: { ...context, externalSessionId: "parallel-b" },
      workItemId: second.id as Id<"workItems">,
      expectedRevision: second.revision,
      workspace: { kind: "worktree" as const, worktreeName: "parallel-b", branch: "work/b" },
      idempotencyKey: "start-parallel-b",
    };
    const startedSecond = await t.mutation(
      internal.domains.work.index.start,
      secondInput,
    );
    await expect(t.mutation(internal.domains.work.index.start, {
      ...firstInput,
      workItemId: third.id as Id<"workItems">,
      expectedRevision: third.revision,
      idempotencyKey: "same-session-other-work",
    })).rejects.toMatchObject({ data: { code: "session_work_limit" } });
    await expect(t.mutation(internal.domains.work.index.start, {
      authorization: { ...context, externalSessionId: "parallel-c" },
      workItemId: third.id as Id<"workItems">,
      expectedRevision: third.revision,
      workspace: { kind: "worktree", worktreeName: "parallel-c" },
      idempotencyKey: "capacity-rejected",
    })).rejects.toMatchObject({
      data: {
        code: "concurrency_limit",
        details: { activeRuns: 2, maxConcurrentRuns: 2, retryable: false },
      },
    });
    await expect(t.mutation(
      internal.domains.work.index.start,
      secondInput,
    )).resolves.toEqual(startedSecond);

    const snapshot = await human.query(
      api.domains.work.index.concurrencyForHuman,
      { projectId: context.projectId },
    );
    expect(snapshot).toMatchObject({
      policy: {
        enabled: true,
        maxConcurrentRuns: 2,
        requiresIsolatedWorkspaces: true,
      },
      capacity: { activeRuns: 2, maxConcurrentRuns: 2, remaining: 0 },
    });
    expect(snapshot.runs).toHaveLength(2);
    expect(snapshot.runs[0]).toMatchObject({
      state: "running",
      lease: { status: expect.stringMatching(/healthy|expiring/) },
      hostCapabilities: {
        parallelExecution: "supported",
        worktreeIsolation: "supported",
      },
      workspace: { kind: "worktree" },
    });
  });

  it.each([
    {
      name: "an unsupported host",
      capabilities: {
        parallelExecution: "unsupported" as const,
        worktreeIsolation: "supported" as const,
      },
      workspace: { kind: "worktree" as const, worktreeName: "second" },
      reason: "host_unsupported",
    },
    {
      name: "an undisclosed host",
      capabilities: undefined,
      workspace: { kind: "worktree" as const, worktreeName: "second" },
      reason: "host_undisclosed",
    },
    {
      name: "a shared checkout",
      capabilities: {
        parallelExecution: "supported" as const,
        worktreeIsolation: "supported" as const,
      },
      workspace: { kind: "shared_checkout" as const },
      reason: "isolated_workspace_required",
    },
  ])("keeps $name serial", async ({ capabilities, workspace, reason }) => {
    const { t, context } = await fixture();
    await t.run((ctx) => ctx.db.patch(context.projectId, {
      parallelExecutionEnabled: true,
      maxConcurrentRuns: 4,
    }));
    const first = await createWork(t, context, `safe-first-${reason}`);
    const second = await createWork(t, context, `serial-second-${reason}`);
    await startSession(t, context, `first-${reason}`, {
      parallelExecution: "supported",
      worktreeIsolation: "supported",
    });
    await t.mutation(internal.domains.work.index.start, {
      authorization: { ...context, externalSessionId: `first-${reason}` },
      workItemId: first.id as Id<"workItems">,
      expectedRevision: first.revision,
      workspace: { kind: "worktree", worktreeName: `first-${reason}` },
      idempotencyKey: `start-first-${reason}`,
    });
    await startSession(t, context, `second-${reason}`, capabilities);
    await expect(t.mutation(internal.domains.work.index.start, {
      authorization: { ...context, externalSessionId: `second-${reason}` },
      workItemId: second.id as Id<"workItems">,
      expectedRevision: second.revision,
      workspace,
      idempotencyKey: `reject-second-${reason}`,
    })).rejects.toMatchObject({
      data: {
        code: "parallel_execution_unavailable",
        details: { reason },
      },
    });
  });

  it("enforces the project opt-in atomically", async () => {
    const { t, context } = await fixture();
    const first = await createWork(t, context, "single-first");
    const second = await createWork(t, context, "single-second");
    await t.mutation(internal.domains.work.index.start, {
      authorization: { ...context, externalSessionId: "single-first" },
      workItemId: first.id as Id<"workItems">,
      expectedRevision: first.revision,
      idempotencyKey: "single-first",
    });
    await startSession(t, context, "single-second", {
      parallelExecution: "supported",
      worktreeIsolation: "supported",
    });
    await expect(t.mutation(internal.domains.work.index.start, {
      authorization: { ...context, externalSessionId: "single-second" },
      workItemId: second.id as Id<"workItems">,
      expectedRevision: second.revision,
      workspace: { kind: "worktree", worktreeName: "single-second" },
      idempotencyKey: "single-second",
    })).rejects.toMatchObject({
      data: {
        code: "parallel_execution_unavailable",
        details: { reason: "project_disabled" },
      },
    });
  });

  it("rejects shared, absolute-path, and URL workspace disclosures", async () => {
    const { t, context } = await fixture();
    const work = await createWork(t, context, "privacy");
    await expect(t.mutation(internal.domains.work.index.start, {
      authorization: { ...context, externalSessionId: "privacy-path" },
      workItemId: work.id as Id<"workItems">,
      expectedRevision: work.revision,
      workspace: { kind: "worktree", worktreeName: "/Users/person/project" },
      idempotencyKey: "privacy-path",
    })).rejects.toMatchObject({ data: { code: "validation" } });
    await expect(t.mutation(internal.domains.work.index.start, {
      authorization: { ...context, externalSessionId: "privacy-url" },
      workItemId: work.id as Id<"workItems">,
      expectedRevision: work.revision,
      workspace: { kind: "worktree", branch: "https://example.com/private" },
      idempotencyKey: "privacy-url",
    })).rejects.toMatchObject({ data: { code: "validation" } });
  });

  it("shows only waiting Runs with unresolved Attention", async () => {
    const { t, context, human, profileId } = await fixture();
    const work = await createWork(t, context, "waiting-ledger");
    const ids = await t.run(async (ctx) => {
      const now = Date.now();
      const runId = await ctx.db.insert("runs", {
        organizationId: context.organizationId,
        projectId: context.projectId,
        workItemId: work.id as Id<"workItems">,
        actorId: context.actorId,
        installationId: context.installationId,
        status: "waiting",
        externalSessionId: "waiting-session",
        startedAt: now - 1_000,
        lastHeartbeatAt: now,
      });
      const attentionId = await ctx.db.insert("attentionRequests", {
        organizationId: context.organizationId,
        projectId: context.projectId,
        workItemId: work.id as Id<"workItems">,
        runId,
        requestedByActorId: context.actorId,
        requestedFromProfileId: profileId,
        kind: "question",
        title: "Still waiting?",
        urgency: "normal",
        status: "open",
        createdAt: now,
      });
      return { runId, attentionId };
    });
    const waiting = await human.query(api.domains.work.index.concurrencyForHuman, {
      projectId: context.projectId,
    });
    expect(waiting.runs).toContainEqual(expect.objectContaining({
      id: ids.runId,
      state: "waiting",
      lease: { status: "released", expiresAt: undefined },
    }));
    await t.run((ctx) => ctx.db.patch(ids.attentionId, {
      status: "resolved",
      resolvedAt: Date.now(),
    }));
    const resolved = await human.query(api.domains.work.index.concurrencyForHuman, {
      projectId: context.projectId,
    });
    expect(resolved.runs.map((run) => run.id)).not.toContain(ids.runId);
  });
});
