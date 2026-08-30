import { beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import type { Id } from "../_generated/dataModel";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { modules } from "../test.setup";

const gatewaySecret = "test-gateway-secret-with-at-least-32-characters";
const gatewayPath = "/internal/agent/v1/execute";

type AgentContext = {
  requestId: string;
  installationId: Id<"installations">;
  actorId: Id<"actors">;
  organizationId: Id<"organizations">;
  projectId: Id<"projects">;
  projectRef: string;
  clientId: string;
  resource: string;
  scopes: string[];
};

beforeEach(() => {
  process.env.DONGO_ENABLE_DEV_BOOTSTRAP = "true";
  process.env.DONGO_INTERNAL_GATEWAY_SECRET = gatewaySecret;
});

describe("agent lifecycle reliability", () => {
  it("replays terminal and Attention mutations after a lost response", async () => {
    const t = convexTest(schema, modules);
    const seedKey = `lifecycle-${crypto.randomUUID()}`;
    const context = await seededContext(t, seedKey);

    const attentionWork = await successfulData(t, context, "create_work", {
      title: "Decide the migration path",
      goal: "Ask before changing durable state.",
      idempotencyKey: "create-attention-work",
    });
    const startedAttentionWork = await successfulData(t, context, "start_work", {
      workItemId: attentionWork.id,
      expectedRevision: attentionWork.revision,
      externalSessionId: "session-attention",
      idempotencyKey: "start-attention-work",
    });
    const attentionInput = {
      workItemId: attentionWork.id,
      expectedRevision: startedAttentionWork.revision,
      kind: "decision",
      title: "Choose the migration mode",
      body: "Should existing records be migrated eagerly?",
      important: true,
      options: ["Eager", "Lazy"],
      idempotencyKey: "attention-lost-response",
    };
    const firstAttention = await successfulData(
      t,
      context,
      "request_attention",
      attentionInput,
    );
    const retriedAttention = await successfulData(
      t,
      context,
      "request_attention",
      attentionInput,
    );
    expect(retriedAttention.id).toBe(firstAttention.id);
    const attentionCount = await t.run(async (ctx) =>
      (await ctx.db
        .query("attentionRequests")
        .withIndex("by_work_status", (q) =>
          q.eq("workItemId", attentionWork.id as Id<"workItems">),
        )
        .collect()).length,
    );
    expect(attentionCount).toBe(1);
    const waitingWork = await successfulData(t, context, "get_work", {
      workItemId: attentionWork.id,
    });
    expect(waitingWork).toMatchObject({
      state: "ready",
      activeRun: { state: "waiting_for_human" },
    });
    const prematureRestart = await callAgent(t, context, "start_work", {
      workItemId: attentionWork.id,
      expectedRevision: waitingWork.revision,
      externalSessionId: "session-before-human-response",
      idempotencyKey: "premature-restart",
    });
    expect(prematureRestart.response.status).toBe(400);
    expect(prematureRestart.payload).toMatchObject({
      ok: false,
      error: { code: "validation" },
    });
    const human = t.withIdentity({
      tokenIdentifier: `development:${seedKey}`,
      subject: seedKey,
      issuer: "development",
      email: `${seedKey}@development.invalid`,
      name: "Dongo developer",
    });
    const responseInput = {
      attentionRequestId: firstAttention.id as Id<"attentionRequests">,
      body: "Use the lazy migration and preserve rollback.",
      selectedOption: "Lazy",
      idempotencyKey: "human-attention-response",
    };
    const firstResponse = await human.mutation(
      api.domains.attention.index.respond,
      responseInput,
    );
    const retriedResponse = await human.mutation(
      api.domains.attention.index.respond,
      responseInput,
    );
    expect(retriedResponse.commentId).toBe(firstResponse.commentId);
    const session = await successfulData(t, context, "session_start", {
      externalSessionId: "session-after-human-response",
    });
    expect(session.newlyResolvedAttention).toContainEqual(
      expect.objectContaining({
        id: firstAttention.id,
        resolution: {
          kind: "responded",
          body: "Use the lazy migration and preserve rollback.",
          selectedOption: "Lazy",
        },
      }),
    );
    const resumed = await successfulData(t, context, "start_work", {
      workItemId: attentionWork.id,
      expectedRevision: waitingWork.revision,
      externalSessionId: "session-after-human-response",
      idempotencyKey: "restart-after-response",
    });
    expect(resumed).toMatchObject({ state: "working" });

    const finishWork = await successfulData(t, context, "create_work", {
      title: "Finish exactly once",
      goal: "Preserve one artifact when the response is lost.",
      idempotencyKey: "create-finish-work",
    });
    const startedFinishWork = await successfulData(t, context, "start_work", {
      workItemId: finishWork.id,
      expectedRevision: finishWork.revision,
      externalSessionId: "session-finish",
      idempotencyKey: "start-finish-work",
    });
    const finishInput = {
      workItemId: finishWork.id,
      expectedRevision: startedFinishWork.revision,
      outcome: "The durable change is complete.",
      artifacts: [{
        kind: "pull_request",
        label: "PR 42",
        url: "https://github.com/example/dongo/pull/42",
      }],
      idempotencyKey: "finish-lost-response",
    };
    const firstFinish = await successfulData(
      t,
      context,
      "finish_work",
      finishInput,
    );
    const retriedFinish = await successfulData(
      t,
      context,
      "finish_work",
      finishInput,
    );
    expect(retriedFinish).toMatchObject({
      id: firstFinish.id,
      state: "done",
      outcome: "The durable change is complete.",
    });
    expect(retriedFinish.artifacts).toHaveLength(1);
    const persisted = await t.run(async (ctx) => ({
      artifacts: await ctx.db
        .query("artifacts")
        .withIndex("by_work_created", (q) =>
          q.eq("workItemId", finishWork.id as Id<"workItems">),
        )
        .collect(),
      events: (await ctx.db
        .query("events")
        .withIndex("by_work_created", (q) =>
          q.eq("workItemId", finishWork.id as Id<"workItems">),
        )
        .collect()).filter((event) => event.type === "work.completed"),
    }));
    expect(persisted.artifacts).toHaveLength(1);
    expect(persisted.events).toHaveLength(1);

    const conflict = await callAgent(t, context, "finish_work", {
      ...finishInput,
      outcome: "A different result must not overwrite the first.",
    });
    expect(conflict.response.status).toBe(409);
    expect(conflict.payload).toMatchObject({
      ok: false,
      error: { code: "idempotency_conflict" },
    });
  });

  it("allows exactly one installation to claim the same Work item", async () => {
    const t = convexTest(schema, modules);
    const first = await seededContext(t);
    const second = await t.run(async (ctx): Promise<AgentContext> => {
      const now = Date.now();
      const actorId = await ctx.db.insert("actors", {
        organizationId: first.organizationId,
        type: "agent",
        name: "Competing development agent",
        agentType: "development",
        createdAt: now,
      });
      const installationId = await ctx.db.insert("installations", {
        organizationId: first.organizationId,
        projectId: first.projectId,
        actorId,
        kind: "development",
        status: "active",
        clientId: "dongo-development-competitor",
        label: "Competing development agent",
        resource: "development://dongo-agent-api",
        scopes: ["dongo:work:read", "dongo:work:write"],
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(actorId, { installationId });
      return {
        ...first,
        requestId: crypto.randomUUID(),
        actorId,
        installationId,
        clientId: "dongo-development-competitor",
        scopes: ["dongo:work:read", "dongo:work:write"],
      };
    });
    const work = await successfulData(t, first, "create_work", {
      title: "Only one agent may start",
      goal: "Prove the atomic claim boundary.",
      idempotencyKey: "create-collision-work",
    });

    const [left, right] = await Promise.all([
      callAgent(t, first, "start_work", {
        workItemId: work.id,
        expectedRevision: work.revision,
        externalSessionId: "collision-left",
        idempotencyKey: "collision-left",
      }),
      callAgent(t, second, "start_work", {
        workItemId: work.id,
        expectedRevision: work.revision,
        externalSessionId: "collision-right",
        idempotencyKey: "collision-right",
      }),
    ]);
    expect([left.response.status, right.response.status].sort()).toEqual([200, 409]);
    const winner = left.response.status === 200 ? left.payload : right.payload;
    const loser = left.response.status === 409 ? left.payload : right.payload;
    expect(winner).toMatchObject({ ok: true, data: { state: "working" } });
    expect(loser).toMatchObject({
      ok: false,
      error: { code: expect.stringMatching(/claim_conflict|revision_conflict/) },
    });
    const runs = await t.run(async (ctx) =>
      await ctx.db
        .query("runs")
        .withIndex("by_work_started", (q) =>
          q.eq("workItemId", work.id as Id<"workItems">),
        )
        .collect(),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("running");
  });

  it("presents expired claims truthfully and reclaims with the observed revision", async () => {
    const t = convexTest(schema, modules);
    const seedKey = `expiry-${crypto.randomUUID()}`;
    const context = await seededContext(t, seedKey);
    const human = t.withIdentity({
      tokenIdentifier: `development:${seedKey}`,
      subject: seedKey,
      issuer: "development",
      email: `${seedKey}@development.invalid`,
      name: "Dongo developer",
    });
    const intake = await human.mutation(api.domains.intake.index.create, {
      projectId: context.projectId,
      text: "This Intake lease should be reclaimable.",
      attachmentIds: [],
      idempotencyKey: "expiry-intake-create",
    });
    const claimedIntake = await successfulData(t, context, "claim_intake", {
      intakeId: intake.intakeId,
      expectedRevision: intake.revision,
      leaseSeconds: 30,
      idempotencyKey: "expiry-intake-claim",
    });
    const work = await successfulData(t, context, "create_work", {
      title: "Reclaim expired work",
      goal: "A stale Run must not look active.",
      idempotencyKey: "expiry-work-create",
    });
    const started = await successfulData(t, context, "start_work", {
      workItemId: work.id,
      expectedRevision: work.revision,
      externalSessionId: "expiry-original-run",
      leaseSeconds: 30,
      idempotencyKey: "expiry-work-start",
    });
    const originalRunId = started.activeRun.id as Id<"runs">;
    await t.run(async (ctx) => {
      const expiredAt = Date.now() - 1;
      await ctx.db.patch(intake.intakeId, { claimExpiresAt: expiredAt });
      await ctx.db.patch(work.id as Id<"workItems">, { claimExpiresAt: expiredAt });
    });

    const overview = await successfulData(t, context, "get_overview", {});
    const staleIntake = overview.inbox.find(
      (candidate: any) => candidate.id === intake.intakeId,
    );
    expect(staleIntake).toMatchObject({ state: "waiting" });
    expect(staleIntake.claimedBy).toBeUndefined();
    expect(staleIntake.claimExpiresAt).toBeUndefined();
    const staleWork = overview.ready.find(
      (candidate: any) => candidate.id === work.id,
    );
    expect(staleWork).toMatchObject({ state: "ready" });
    expect(staleWork.activeRun).toBeUndefined();

    const reclaimedIntake = await successfulData(t, context, "claim_intake", {
      intakeId: intake.intakeId,
      expectedRevision: claimedIntake.revision,
      leaseSeconds: 30,
      idempotencyKey: "expiry-intake-reclaim",
    });
    expect(reclaimedIntake).toMatchObject({ state: "claimed" });
    const reclaimedWork = await successfulData(t, context, "start_work", {
      workItemId: work.id,
      expectedRevision: started.revision,
      externalSessionId: "expiry-reclaimed-run",
      leaseSeconds: 30,
      idempotencyKey: "expiry-work-reclaim",
    });
    expect(reclaimedWork).toMatchObject({ state: "working" });
    expect(reclaimedWork.activeRun.id).not.toBe(originalRunId);
    const originalRun = await t.run(async (ctx) => await ctx.db.get(originalRunId));
    expect(originalRun).toMatchObject({
      status: "failed",
      failureCode: "lease_expired",
    });
  });
});

async function seededContext(
  t: ReturnType<typeof convexTest>,
  key = `lifecycle-${crypto.randomUUID()}`,
): Promise<AgentContext> {
  const seeded = await t.mutation(internal.dev.bootstrap.createWalkingSkeleton, {
    key,
    organizationSlug: `org-${crypto.randomUUID()}`,
    projectSlug: `project-${crypto.randomUUID()}`,
  });
  return await t.run(async (ctx) => {
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
      clientId: installation.clientId,
      resource: installation.resource,
      scopes: installation.scopes,
    };
  });
}

async function successfulData(
  t: ReturnType<typeof convexTest>,
  context: AgentContext,
  operation: string,
  input: Record<string, unknown>,
): Promise<any> {
  const result = await callAgent(t, context, operation, input);
  expect(result.response.status).toBe(200);
  expect(result.payload).toMatchObject({ ok: true });
  return (result.payload as { data: any }).data;
}

async function callAgent(
  t: ReturnType<typeof convexTest>,
  context: AgentContext,
  operation: string,
  input: Record<string, unknown>,
) {
  const body = JSON.stringify({
    version: 1,
    operation,
    input,
    context: { ...context, requestId: crypto.randomUUID() },
  });
  const response = await t.fetch(gatewayPath, await signedRequest(body));
  return { response, payload: await response.json() };
}

async function signedRequest(body: string): Promise<RequestInit> {
  const timestamp = Date.now();
  const nonce = crypto.randomUUID();
  const bodyHash = await sha256Hex(new TextEncoder().encode(body));
  const canonical = `${timestamp}\n${nonce}\nPOST\n${gatewayPath}\n${bodyHash}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(gatewaySecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(canonical),
  );
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-dongo-key-id": "v1",
      "x-dongo-timestamp": String(timestamp),
      "x-dongo-nonce": nonce,
      "x-dongo-signature": base64Url(new Uint8Array(signature)),
    },
    body,
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
