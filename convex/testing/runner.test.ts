import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import type { Id } from "../_generated/dataModel";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { modules } from "../test.setup";

const gatewaySecret = "test-gateway-secret-with-at-least-32-characters";

beforeEach(() => {
  process.env.DONGO_ENABLE_DEV_BOOTSTRAP = "true";
  process.env.DONGO_INTERNAL_GATEWAY_SECRET = gatewaySecret;
});

afterEach(() => {
  delete process.env.DONGO_RUNNER_QUEUE_ENABLED;
});

describe("local runner delivery", () => {
  it("fails closed when runner queue creation is disabled", async () => {
    const fixture = await runnerFixture();
    const token = runnerToken("q", "s");
    await register(fixture, token, "Paused Mac");
    const work = await fixture.human.mutation(api.domains.work.index.createForHuman, {
      projectId: fixture.projectId,
      title: "Do not queue this work",
      kind: "task",
      idempotencyKey: "runner-work-disabled",
    });
    process.env.DONGO_RUNNER_QUEUE_ENABLED = "false";

    await expect(fixture.human.mutation(api.domains.runner.index.enqueue, {
      projectId: fixture.projectId,
      workItemId: work.workItemId,
      harness: "codex",
      idempotencyKey: "runner-enqueue-disabled",
    })).rejects.toThrow(/temporarily unavailable/u);
  });

  it("exposes registration through the signed transport without echoing its secret", async () => {
    const fixture = await runnerFixture();
    const token = runnerToken("k", "m");
    const response = await callAgent(fixture.root, fixture.authorization, "runner_register", {
      idempotencyKey: "runner-register-signed",
      token,
      label: "Signed Mac",
      platform: "darwin",
      version: "0.1.0",
      harnesses: ["codex"],
      approvalMode: "ask",
    });
    const payload = await response.json();
    expect(response.status, JSON.stringify(payload)).toBe(200);
    const serialized = JSON.stringify(payload);
    expect(serialized).toContain('"status":"active"');
    expect(serialized).not.toContain(token);
  });

  it("registers a hashed subordinate credential and enforces cancellation", async () => {
    const fixture = await runnerFixture();
    const token = runnerToken("a", "b");
    const registration = await fixture.root.mutation(
      internal.domains.runner.index.register,
      {
        authorization: fixture.authorization,
        token,
        label: "Studio Mac",
        platform: "darwin",
        version: "0.1.0",
        harnesses: ["codex"],
        approvalMode: "ask",
      },
    );
    const stored = await fixture.root.run(async (ctx) =>
      await ctx.db.get(registration.id as Id<"runnerRegistrations">));
    expect(stored?.tokenHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(stored)).not.toContain(token);

    const work = await fixture.human.mutation(api.domains.work.index.createForHuman, {
      projectId: fixture.projectId,
      title: "Implement the queued change",
      description: "Use the existing dongo work contract.",
      kind: "task",
      idempotencyKey: "runner-work-1",
    });
    const queued = await fixture.human.mutation(api.domains.runner.index.enqueue, {
      projectId: fixture.projectId,
      workItemId: work.workItemId,
      harness: "codex",
      idempotencyKey: "runner-enqueue-1",
    });
    expect(queued).toMatchObject({ state: "queued", revision: 1 });

    const delivery = await fixture.root.mutation(internal.domains.runner.index.reserve, {
      authorization: fixture.authorization,
      registrationId: registration.id,
      token,
      waitSeconds: 20,
      platform: "darwin",
      version: "0.1.0",
      harnesses: ["codex"],
      approvalMode: "ask",
    });
    expect(delivery.job).toMatchObject({
      id: queued.id,
      workIdentifier: expect.stringMatching(/^[a-z]{4}\d{3}$/u),
      state: "delivered",
      revision: 2,
    });

    const starting = await fixture.root.mutation(internal.domains.runner.index.updateJob, {
      authorization: fixture.authorization,
      registrationId: registration.id,
      token,
      jobId: queued.id,
      expectedRevision: 2,
      state: "starting",
      idempotencyKey: "runner-starting-1",
      sessionReferencePresent: false,
    });
    const running = await fixture.root.mutation(internal.domains.runner.index.updateJob, {
      authorization: fixture.authorization,
      registrationId: registration.id,
      token,
      jobId: queued.id,
      expectedRevision: starting.revision,
      state: "running",
      idempotencyKey: "runner-running-1",
      sessionReferencePresent: true,
    });
    await expect(fixture.root.mutation(internal.domains.runner.index.updateJob, {
      authorization: fixture.authorization,
      registrationId: registration.id,
      token,
      jobId: queued.id,
      expectedRevision: running.revision,
      state: "running",
      idempotencyKey: "runner-unsafe-status",
      safeCode: "raw_secret_output",
      safeSummary: "\u001b[31mprivate output",
    })).rejects.toThrow(/safeCode|plain single-line/u);
    await expect(fixture.root.mutation(internal.domains.runner.index.updateJob, {
      authorization: fixture.authorization,
      registrationId: registration.id,
      token,
      jobId: queued.id,
      expectedRevision: running.revision,
      state: "running",
      idempotencyKey: "runner-unsafe-summary",
      safeCode: "work_completed",
      safeSummary: "\u001b[31mprivate output",
    })).rejects.toThrow(/plain single-line/u);
    const cancellation = await fixture.human.mutation(api.domains.runner.index.cancel, {
      projectId: fixture.projectId,
      jobId: queued.id,
      expectedRevision: running.revision,
      idempotencyKey: "runner-cancel-1",
    });
    expect(cancellation.state).toBe("cancel_requested");
    await expect(fixture.root.mutation(internal.domains.runner.index.updateJob, {
      authorization: fixture.authorization,
      registrationId: registration.id,
      token,
      jobId: queued.id,
      expectedRevision: cancellation.revision,
      state: "completed",
      idempotencyKey: "runner-complete-after-cancel",
    })).rejects.toThrow(/Cancellation|cannot move/u);
    const cancelled = await fixture.root.mutation(internal.domains.runner.index.updateJob, {
      authorization: fixture.authorization,
      registrationId: registration.id,
      token,
      jobId: queued.id,
      expectedRevision: cancellation.revision,
      state: "cancelled",
      idempotencyKey: "runner-cancelled-1",
      safeCode: "user_cancelled",
    });
    expect(cancelled).toMatchObject({ state: "cancelled", safeCode: "user_cancelled" });
  });

  it("replays an unacknowledged delivery to another registered machine", async () => {
    const fixture = await runnerFixture();
    const first = await register(fixture, runnerToken("c", "d"), "First Mac");
    const secondToken = runnerToken("e", "f");
    const second = await register(fixture, secondToken, "Second Mac");
    const work = await fixture.human.mutation(api.domains.work.index.createForHuman, {
      projectId: fixture.projectId,
      title: "Recover a delivery",
      kind: "task",
      idempotencyKey: "runner-work-recovery",
    });
    const queued = await fixture.human.mutation(api.domains.runner.index.enqueue, {
      projectId: fixture.projectId,
      workItemId: work.workItemId,
      harness: "codex",
      idempotencyKey: "runner-enqueue-recovery",
    });
    await fixture.root.mutation(internal.domains.runner.index.reserve, waitArgs(
      fixture.authorization,
      first.id,
      runnerToken("c", "d"),
    ));
    await fixture.root.run(async (ctx) => {
      await ctx.db.patch(queued.id as Id<"runnerJobs">, { reservationExpiresAt: 1 });
    });
    const replay = await fixture.root.mutation(
      internal.domains.runner.index.reserve,
      waitArgs(fixture.authorization, second.id, secondToken),
    );
    expect(replay.job).toMatchObject({
      id: queued.id,
      registrationId: second.id,
      state: "delivered",
      revision: 4,
    });
  });

  it("rotates idempotently and revokes a runner credential", async () => {
    const fixture = await runnerFixture();
    const original = runnerToken("g", "h");
    const replacement = runnerToken("i", "j");
    const registration = await register(fixture, original, "Rotating Mac");
    const rotated = await fixture.root.mutation(internal.domains.runner.index.rotate, {
      authorization: fixture.authorization,
      registrationId: registration.id,
      token: original,
      replacementToken: replacement,
    });
    expect(rotated.id).toBe(registration.id);
    const retry = await fixture.root.mutation(internal.domains.runner.index.rotate, {
      authorization: fixture.authorization,
      registrationId: registration.id,
      token: original,
      replacementToken: replacement,
    });
    expect(retry.id).toBe(registration.id);
    await expect(fixture.root.mutation(
      internal.domains.runner.index.reserve,
      waitArgs(fixture.authorization, registration.id, original),
    )).rejects.toThrow(/not active/u);
    const revoked = await fixture.root.mutation(internal.domains.runner.index.revoke, {
      authorization: fixture.authorization,
      registrationId: registration.id,
      token: replacement,
    });
    expect(revoked.status).toBe("revoked");
    const revokeRetry = await fixture.root.mutation(internal.domains.runner.index.revoke, {
      authorization: fixture.authorization,
      registrationId: registration.id,
      token: replacement,
    });
    expect(revokeRetry.status).toBe("revoked");
    await expect(fixture.root.mutation(
      internal.domains.runner.index.reserve,
      waitArgs(fixture.authorization, registration.id, replacement),
    )).rejects.toThrow(/not active/u);
  });

  it("opts an exact automatic runner into new Inbox Intake and queues autonomous Work separately", async () => {
    const fixture = await runnerFixture();
    const selectedToken = runnerToken("u", "v");
    const otherToken = runnerToken("w", "x");
    const selected = await register(fixture, selectedToken, "Selected Mac", "automatic");
    const other = await register(fixture, otherToken, "Other Mac", "automatic");

    const beforeOptIn = await fixture.human.mutation(api.domains.intake.index.create, {
      projectId: fixture.projectId,
      text: "This Intake predates the opt-in.",
      attachmentIds: [],
      idempotencyKey: "runner-intake-before-opt-in",
    });
    const configured = await fixture.human.mutation(
      api.domains.runner.index.configureAutomaticIntake,
      {
        projectId: fixture.projectId,
        expectedRevision: 0,
        registrationId: selected.id,
        harness: "codex",
        idempotencyKey: "runner-auto-intake-enable",
      },
    );
    expect(configured).toMatchObject({
      enabled: true,
      revision: 1,
      registrationId: selected.id,
      harness: "codex",
    });

    const created = await fixture.human.mutation(api.domains.intake.index.create, {
      projectId: fixture.projectId,
      text: "Triage and create focused Work.",
      attachmentIds: [],
      idempotencyKey: "runner-intake-after-opt-in",
    });
    const snapshot = await fixture.human.query(api.domains.runner.index.listForHuman, {
      projectId: fixture.projectId,
    });
    expect(snapshot.automaticIntake).toMatchObject({ enabled: true, revision: 1 });
    expect(snapshot.jobs).toHaveLength(1);
    expect(snapshot.jobs[0]).toMatchObject({
      kind: "intake",
      intakeId: created.intakeId,
      targetRegistrationId: selected.id,
      harness: "codex",
      state: "queued",
    });
    expect(snapshot.jobs[0]).not.toHaveProperty("workItemId");
    expect(snapshot.jobs[0]).not.toHaveProperty("workIdentifier");
    expect(snapshot.jobs[0]?.intakeId).not.toBe(beforeOptIn.intakeId);

    const unavailableElsewhere = await fixture.root.mutation(
      internal.domains.runner.index.reserve,
      waitArgs(fixture.authorization, other.id, otherToken, "automatic"),
    );
    expect(unavailableElsewhere.job).toBeUndefined();
    const delivery = await fixture.root.mutation(
      internal.domains.runner.index.reserve,
      waitArgs(fixture.authorization, selected.id, selectedToken, "automatic"),
    );
    expect(delivery.job).toMatchObject({
      kind: "intake",
      intakeId: created.intakeId,
      registrationId: selected.id,
      state: "delivered",
    });

    await fixture.root.run(async (ctx) => {
      await ctx.db.patch(fixture.projectId, { executionMode: "autonomous" });
    });
    const claimed = await fixture.root.mutation(internal.domains.intake.index.claim, {
      authorization: fixture.authorization,
      intakeId: created.intakeId,
      expectedRevision: created.revision,
      idempotencyKey: "runner-intake-claim",
    });
    const triaged = await fixture.root.mutation(internal.domains.intake.index.completeTriage, {
      authorization: fixture.authorization,
      intakeId: created.intakeId,
      expectedRevision: claimed.revision,
      create: [{ title: "Implement the focused request", kind: "task" }],
      link: [],
      dismiss: false,
      idempotencyKey: "runner-intake-triage",
    });
    const afterTriage = await fixture.human.query(api.domains.runner.index.listForHuman, {
      projectId: fixture.projectId,
    });
    expect(afterTriage.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "work",
        workItemId: triaged.workItemIds[0],
        targetRegistrationId: selected.id,
        harness: "codex",
        state: "queued",
      }),
    ]));

    await fixture.human.mutation(api.domains.runner.index.revokeForHuman, {
      projectId: fixture.projectId,
      registrationId: selected.id,
    });
    const disabled = await fixture.human.query(api.domains.runner.index.listForHuman, {
      projectId: fixture.projectId,
    });
    expect(disabled.automaticIntake).toEqual({ enabled: false, revision: 2 });
    expect(disabled.jobs.find((job) => job.kind === "work")).toMatchObject({ state: "cancelled" });
    expect(disabled.jobs.find((job) => job.kind === "intake")).toMatchObject({ state: "cancel_requested" });
  });

  it("requires local automatic approval before an owner can enable automatic Inbox processing", async () => {
    const fixture = await runnerFixture();
    const registration = await register(fixture, runnerToken("y", "z"), "Approval Mac");
    await expect(fixture.human.mutation(
      api.domains.runner.index.configureAutomaticIntake,
      {
        projectId: fixture.projectId,
        expectedRevision: 0,
        registrationId: registration.id,
        harness: "codex",
        idempotencyKey: "runner-auto-intake-reject-ask",
      },
    )).rejects.toThrow(/automatic approval/u);
  });

  it("rejects a stale execution lease and records a bounded failure", async () => {
    const fixture = await runnerFixture();
    const token = runnerToken("n", "p");
    const registration = await register(fixture, token, "Lease Mac");
    const work = await fixture.human.mutation(api.domains.work.index.createForHuman, {
      projectId: fixture.projectId,
      title: "Lease-bound work",
      kind: "task",
      idempotencyKey: "runner-work-lease",
    });
    const queued = await fixture.human.mutation(api.domains.runner.index.enqueue, {
      projectId: fixture.projectId,
      workItemId: work.workItemId,
      harness: "codex",
      idempotencyKey: "runner-enqueue-lease",
    });
    await fixture.root.mutation(
      internal.domains.runner.index.reserve,
      waitArgs(fixture.authorization, registration.id, token),
    );
    const starting = await fixture.root.mutation(internal.domains.runner.index.updateJob, {
      authorization: fixture.authorization,
      registrationId: registration.id,
      token,
      jobId: queued.id,
      expectedRevision: 2,
      state: "starting",
      idempotencyKey: "runner-start-lease",
    });
    await fixture.root.run(async (ctx) => {
      await ctx.db.patch(queued.id as Id<"runnerJobs">, { leaseExpiresAt: 1 });
    });
    await expect(fixture.root.mutation(internal.domains.runner.index.updateJob, {
      authorization: fixture.authorization,
      registrationId: registration.id,
      token,
      jobId: queued.id,
      expectedRevision: starting.revision,
      state: "running",
      idempotencyKey: "runner-running-stale-lease",
    })).rejects.toThrow(/lease expired/u);
    await fixture.root.mutation(
      internal.domains.runner.index.reserve,
      waitArgs(fixture.authorization, registration.id, token),
    );
    const stored = await fixture.root.run(async (ctx) =>
      await ctx.db.get(queued.id as Id<"runnerJobs">));
    expect(stored).toMatchObject({ state: "failed", safeCode: "runner_lease_expired" });
  });
});

function runnerToken(prefix: string, secret: string) {
  return `dng_run_${prefix.repeat(11)}_${secret.repeat(43)}`;
}

function waitArgs(
  authorization: Authorization,
  registrationId: string,
  token: string,
  approvalMode: "ask" | "automatic" = "ask",
) {
  return {
    authorization,
    registrationId: registrationId as Id<"runnerRegistrations">,
    token,
    waitSeconds: 0,
    platform: "darwin" as const,
    version: "0.1.0",
    harnesses: ["codex" as const],
    approvalMode,
  };
}

async function register(
  fixture: Awaited<ReturnType<typeof runnerFixture>>,
  token: string,
  label: string,
  approvalMode: "ask" | "automatic" = "ask",
) {
  return await fixture.root.mutation(internal.domains.runner.index.register, {
    authorization: fixture.authorization,
    token,
    label,
    platform: "darwin",
    version: "0.1.0",
    harnesses: ["codex"],
    approvalMode,
  });
}

type Authorization = Awaited<ReturnType<typeof runnerFixture>>["authorization"];

async function runnerFixture() {
  const key = `runner-${crypto.randomUUID()}`;
  const root = convexTest(schema, modules);
  const seeded = await root.mutation(internal.dev.bootstrap.createWalkingSkeleton, {
    key,
    organizationSlug: `org-${crypto.randomUUID()}`,
    projectSlug: `project-${crypto.randomUUID()}`,
  });
  const authorization = await root.run(async (ctx) => {
    const installation = await ctx.db.get(seeded.installationId!);
    const project = await ctx.db.get(seeded.projectId!);
    if (!installation || !project || !seeded.profileId) throw new Error("fixture missing");
    const issuer = "https://auth.example.test";
    const bindingId = await ctx.db.insert("oauthBindings", {
      organizationId: installation.organizationId,
      projectId: project._id,
      installationId: installation._id,
      providerIssuer: issuer,
      providerGrantId: `grant-${key}`,
      subject: `subject-${key}`,
      clientId: installation.clientId,
      resource: installation.resource,
      scopes: installation.scopes,
      status: "active",
      authorizedByProfileId: seeded.profileId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.patch(installation._id, { kind: "cli" });
    return {
      requestId: crypto.randomUUID(),
      installationId: installation._id,
      actorId: installation.actorId,
      organizationId: installation.organizationId,
      projectId: project._id,
      projectRef: project.publicRef,
      oauthBindingId: bindingId,
      issuer,
      clientId: installation.clientId,
      resource: installation.resource,
      scopes: installation.scopes,
    };
  });
  const human = root.withIdentity({
    tokenIdentifier: `development:${key}`,
    subject: `development:${key}`,
    issuer: "https://human.example.test",
  });
  return { root, human, authorization, projectId: seeded.projectId! };
}

async function callAgent(
  root: ReturnType<typeof convexTest>,
  authorization: Authorization,
  operation: string,
  input: Record<string, unknown>,
) {
  const path = "/internal/agent/v1/execute";
  const { oauthBindingId, ...wireAuthorization } = authorization;
  const body = JSON.stringify({
    version: 1,
    operation,
    input,
    context: {
      ...wireAuthorization,
      grantId: oauthBindingId,
      requestId: crypto.randomUUID(),
    },
  });
  const timestamp = Date.now();
  const nonce = crypto.randomUUID();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  const bodyHash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const canonical = `${timestamp}\n${nonce}\nPOST\n${path}\n${bodyHash}`;
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
  const encoded = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
  return await root.fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-dongo-key-id": "v1",
      "x-dongo-timestamp": String(timestamp),
      "x-dongo-nonce": nonce,
      "x-dongo-signature": encoded,
    },
    body,
  });
}
