import { v } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "../../_generated/server";
import { requireHumanProject, resolveAgentPrincipal } from "../../lib/authz";
import { appendEvent } from "../../lib/events";
import { fail, optionalString, requireString } from "../../lib/errors";
import { runIdempotent } from "../../lib/idempotency";
import { agentContextValidator } from "../../lib/validators";
import {
  hashRunnerCredentialToken,
  runnerCredentialTokenPrefix,
  verifyRunnerCredentialToken,
} from "./credentialSecurity";

const harnessValidator = v.union(v.literal("codex"), v.literal("claude"));
const platformValidator = v.union(v.literal("darwin"), v.literal("linux"));
const approvalModeValidator = v.union(v.literal("ask"), v.literal("automatic"));
const stateValidator = v.union(
  v.literal("queued"),
  v.literal("delivered"),
  v.literal("awaiting_local_approval"),
  v.literal("starting"),
  v.literal("running"),
  v.literal("blocked"),
  v.literal("cancel_requested"),
  v.literal("cancelled"),
  v.literal("failed"),
  v.literal("completed"),
  v.literal("expired"),
);

type RunnerState = Doc<"runnerJobs">["state"];
type AgentAuthorization = Parameters<typeof resolveAgentPrincipal>[1];

const JOB_TTL_MS = 24 * 60 * 60 * 1_000;
const DELIVERY_RESERVATION_MS = 60_000;
const DEFAULT_LEASE_MS = 90_000;
const MAX_LEASE_SECONDS = 3_600;
const RUNNER_SAFE_CODES = new Set([
  "approval_expired",
  "attention_required",
  "cancelled",
  "cancelled_before_start",
  "claude_failed",
  "codex_failed",
  "delivery_expired",
  "dirty_repository",
  "harness_failed",
  "harness_changed",
  "harness_unavailable",
  "queue_expired",
  "runner_lease_expired",
  "runner_restarted",
  "runner_revoked",
  "user_cancelled",
  "work_completed",
  "work_not_completed",
]);
const TERMINAL_STATES = new Set<RunnerState>([
  "cancelled",
  "failed",
  "completed",
  "expired",
]);
const ACTIVE_STATES = new Set<RunnerState>([
  "delivered",
  "awaiting_local_approval",
  "starting",
  "running",
  "blocked",
  "cancel_requested",
]);
const TRANSITIONS: Record<RunnerState, ReadonlySet<RunnerState>> = {
  queued: new Set(["delivered", "cancelled", "expired"]),
  delivered: new Set([
    "awaiting_local_approval",
    "starting",
    "cancel_requested",
    "cancelled",
    "failed",
    "expired",
  ]),
  awaiting_local_approval: new Set([
    "starting",
    "cancel_requested",
    "cancelled",
    "failed",
    "expired",
  ]),
  starting: new Set(["running", "blocked", "cancel_requested", "cancelled", "failed"]),
  running: new Set(["running", "blocked", "cancel_requested", "cancelled", "failed", "completed"]),
  blocked: new Set(["running", "cancel_requested", "cancelled", "failed"]),
  cancel_requested: new Set(["cancelled", "failed"]),
  cancelled: new Set(),
  failed: new Set(),
  completed: new Set(),
  expired: new Set(),
};

function runnerSafeCode(value: string | undefined): string | undefined {
  const code = optionalString(value, "safeCode", 80);
  if (code !== undefined && !RUNNER_SAFE_CODES.has(code)) {
    fail("validation", "safeCode is not a supported runner status code");
  }
  return code;
}

function runnerSafeText(
  value: string | undefined,
  field: "safeMessage" | "safeSummary",
  maxLength: number,
): string | undefined {
  const text = optionalString(value, field, maxLength);
  if (text !== undefined && /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(text)) {
    fail("validation", `${field} must be plain single-line text`);
  }
  return text;
}

function normalizedHarnesses(values: Array<"codex" | "claude">) {
  return [...new Set(values)].sort() as Array<"claude" | "codex">;
}

function registrationDto(registration: Doc<"runnerRegistrations">) {
  return {
    id: registration._id,
    projectId: registration.projectId,
    installationId: registration.installationId,
    label: registration.label,
    platform: registration.platform,
    version: registration.version,
    harnesses: registration.harnesses,
    approvalMode: registration.approvalMode,
    status: registration.status,
    lastSeenAt: registration.lastSeenAt,
    waitingUntil: registration.waitingUntil,
    createdAt: registration.createdAt,
    updatedAt: registration.updatedAt,
    revokedAt: registration.revokedAt,
  };
}

async function jobDto(
  ctx: Pick<QueryCtx, "db">,
  job: Doc<"runnerJobs">,
) {
  const work = await ctx.db.get(job.workItemId);
  if (!work || work.projectId !== job.projectId) {
    fail("not_found", "Runner job Work item not found");
  }
  return {
    id: job._id,
    projectId: job.projectId,
    workItemId: job.workItemId,
    workIdentifier: work.identifier,
    harness: job.harness,
    state: job.state,
    revision: job.revision,
    registrationId: job.registrationId,
    safeCode: job.safeCode,
    safeMessage: job.safeMessage,
    safeSummary: job.safeSummary,
    sessionReferencePresent: job.sessionReferencePresent,
    requestedAt: job.requestedAt,
    expiresAt: job.expiresAt,
    deliveredAt: job.deliveredAt,
    reservationExpiresAt: job.reservationExpiresAt,
    leaseExpiresAt: job.leaseExpiresAt,
    cancellationRequestedAt: job.cancellationRequestedAt,
    terminalAt: job.terminalAt,
    updatedAt: job.updatedAt,
  };
}

async function requireRegistration(
  ctx: Pick<QueryCtx, "db">,
  args: {
    authorization: AgentAuthorization;
    registrationId: Id<"runnerRegistrations">;
    token: string;
    scope: "dongo:work:read" | "dongo:work:write";
  },
) {
  const principal = await resolveAgentPrincipal(ctx, args.authorization, args.scope);
  if (principal.installation.kind !== "cli" && principal.installation.kind !== "mcp") {
    fail("unauthorized", "Runner registration requires an interactive agent grant");
  }
  const registration = await ctx.db.get(args.registrationId);
  if (
    !registration ||
    registration.status !== "active" ||
    registration.projectId !== principal.project._id ||
    registration.organizationId !== principal.project.organizationId ||
    registration.installationId !== principal.installation._id ||
    registration.actorId !== principal.actor._id ||
    !(await verifyRunnerCredentialToken(args.token, registration.tokenHash))
  ) {
    fail("unauthorized", "Runner registration is not active");
  }
  return { principal, registration };
}

async function appendJobEvent(
  ctx: MutationCtx,
  job: Doc<"runnerJobs">,
  actorId: Id<"actors">,
  state: RunnerState,
  now: number,
  safeCode?: string,
  safeMessage?: string,
) {
  await ctx.db.insert("runnerJobEvents", {
    organizationId: job.organizationId,
    projectId: job.projectId,
    jobId: job._id,
    registrationId: job.registrationId,
    actorId,
    sequence: job.revision + 1,
    state,
    safeCode,
    safeMessage,
    createdAt: now,
  });
}

async function cancelRegistrationJobs(
  ctx: MutationCtx,
  registration: Doc<"runnerRegistrations">,
  actorId: Id<"actors">,
  now: number,
) {
  const jobs = await ctx.db.query("runnerJobs")
    .withIndex("by_registration_state_updated", (q) =>
      q.eq("registrationId", registration._id))
    .take(100);
  for (const job of jobs) {
    if (!ACTIVE_STATES.has(job.state) || job.state === "cancel_requested") continue;
    await ctx.db.patch(job._id, {
      state: "cancel_requested",
      revision: job.revision + 1,
      cancellationRequestedAt: now,
      updatedAt: now,
    });
    await appendJobEvent(ctx, job, actorId, "cancel_requested", now, "runner_revoked");
  }
}

export const register = internalMutation({
  args: {
    authorization: agentContextValidator,
    token: v.string(),
    label: v.string(),
    platform: platformValidator,
    version: v.string(),
    harnesses: v.array(harnessValidator),
    approvalMode: approvalModeValidator,
  },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(ctx, args.authorization, "dongo:work:write");
    if (principal.installation.kind !== "cli" && principal.installation.kind !== "mcp") {
      fail("unauthorized", "Runner registration requires an interactive agent grant");
    }
    const tokenPrefix = runnerCredentialTokenPrefix(args.token);
    if (!tokenPrefix) fail("validation", "Runner credential format is invalid");
    const tokenHash = await hashRunnerCredentialToken(args.token);
    const existing = await ctx.db.query("runnerRegistrations")
      .withIndex("by_token_prefix", (q) => q.eq("tokenPrefix", tokenPrefix))
      .unique();
    if (existing) {
      if (
        existing.installationId === principal.installation._id &&
        existing.status === "active" &&
        await verifyRunnerCredentialToken(args.token, existing.tokenHash)
      ) return registrationDto(existing);
      fail("idempotency_conflict", "Runner credential prefix is already registered");
    }
    const harnesses = normalizedHarnesses(args.harnesses);
    if (harnesses.length === 0) fail("validation", "At least one runner harness is required");
    const now = Date.now();
    const registrationId = await ctx.db.insert("runnerRegistrations", {
      organizationId: principal.project.organizationId,
      projectId: principal.project._id,
      installationId: principal.installation._id,
      actorId: principal.actor._id,
      tokenPrefix,
      tokenHash,
      label: requireString(args.label, "label", 120),
      platform: args.platform,
      version: requireString(args.version, "version", 64),
      harnesses,
      approvalMode: args.approvalMode,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const registration = await ctx.db.get(registrationId);
    if (!registration) fail("internal", "Runner registration was not created");
    await appendEvent(ctx, {
      organizationId: principal.project.organizationId,
      projectId: principal.project._id,
      actorId: principal.actor._id,
      type: "runner.registration_created",
      data: { registrationId, platform: args.platform, harnesses, approvalMode: args.approvalMode },
      requestId: principal.requestId,
      createdAt: now,
    });
    return registrationDto(registration);
  },
});

export const rotate = internalMutation({
  args: {
    authorization: agentContextValidator,
    registrationId: v.id("runnerRegistrations"),
    token: v.string(),
    replacementToken: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(ctx, args.authorization, "dongo:work:write");
    const registration = await ctx.db.get(args.registrationId);
    if (
      !registration ||
      registration.status !== "active" ||
      registration.projectId !== principal.project._id ||
      registration.installationId !== principal.installation._id
    ) fail("unauthorized", "Runner registration is not active");
    const now = Date.now();
    const currentToken = await verifyRunnerCredentialToken(args.token, registration.tokenHash);
    const previousToken = registration.previousTokenHash !== undefined &&
      (registration.previousTokenValidUntil ?? 0) > now &&
      await verifyRunnerCredentialToken(args.token, registration.previousTokenHash);
    if (!currentToken && !previousToken) fail("unauthorized", "Runner registration is not active");
    const replacementPrefix = runnerCredentialTokenPrefix(args.replacementToken);
    if (!replacementPrefix) fail("validation", "Replacement runner credential format is invalid");
    if (previousToken && registration.tokenPrefix === replacementPrefix &&
      await verifyRunnerCredentialToken(args.replacementToken, registration.tokenHash)) {
      return registrationDto(registration);
    }
    if (replacementPrefix === registration.tokenPrefix) {
      fail("validation", "Replacement runner credential must be new");
    }
    const collision = await ctx.db.query("runnerRegistrations")
      .withIndex("by_token_prefix", (q) => q.eq("tokenPrefix", replacementPrefix))
      .unique();
    if (collision) fail("idempotency_conflict", "Replacement runner credential prefix is already registered");
    const replacementHash = await hashRunnerCredentialToken(args.replacementToken);
    await ctx.db.patch(registration._id, {
      tokenPrefix: replacementPrefix,
      tokenHash: replacementHash,
      previousTokenHash: registration.tokenHash,
      previousTokenValidUntil: now + 5 * 60_000,
      updatedAt: now,
    });
    await appendEvent(ctx, {
      organizationId: registration.organizationId,
      projectId: registration.projectId,
      actorId: principal.actor._id,
      type: "runner.registration_rotated",
      data: { registrationId: registration._id },
      requestId: principal.requestId,
      createdAt: now,
    });
    return registrationDto({ ...registration, tokenPrefix: replacementPrefix, tokenHash: replacementHash, previousTokenHash: registration.tokenHash, previousTokenValidUntil: now + 5 * 60_000, updatedAt: now });
  },
});

export const revoke = internalMutation({
  args: {
    authorization: agentContextValidator,
    registrationId: v.id("runnerRegistrations"),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(ctx, args.authorization, "dongo:work:write");
    const registration = await ctx.db.get(args.registrationId);
    if (
      !registration ||
      registration.projectId !== principal.project._id ||
      registration.installationId !== principal.installation._id ||
      !(await verifyRunnerCredentialToken(args.token, registration.tokenHash))
    ) fail("unauthorized", "Runner registration is not active");
    if (registration.status === "revoked") return registrationDto(registration);
    const now = Date.now();
    await ctx.db.patch(registration._id, {
      status: "revoked",
      waitingUntil: undefined,
      revokedAt: now,
      updatedAt: now,
    });
    await cancelRegistrationJobs(ctx, registration, principal.actor._id, now);
    await appendEvent(ctx, {
      organizationId: registration.organizationId,
      projectId: registration.projectId,
      actorId: principal.actor._id,
      type: "runner.registration_revoked",
      data: { registrationId: registration._id },
      requestId: principal.requestId,
      createdAt: now,
    });
    return registrationDto({ ...registration, status: "revoked", waitingUntil: undefined, revokedAt: now, updatedAt: now });
  },
});

export const reserve = internalMutation({
  args: {
    authorization: agentContextValidator,
    registrationId: v.id("runnerRegistrations"),
    token: v.string(),
    waitSeconds: v.number(),
    platform: platformValidator,
    version: v.string(),
    harnesses: v.array(harnessValidator),
    approvalMode: approvalModeValidator,
  },
  handler: async (ctx, args) => {
    const { principal, registration } = await requireRegistration(ctx, {
      ...args,
      scope: "dongo:work:write",
    });
    const now = Date.now();
    const harnesses = normalizedHarnesses(args.harnesses);
    if (harnesses.length === 0) fail("validation", "At least one runner harness is required");
    await ctx.db.patch(registration._id, {
      platform: args.platform,
      version: requireString(args.version, "version", 64),
      harnesses,
      approvalMode: args.approvalMode,
      lastSeenAt: now,
      waitingUntil: args.waitSeconds > 0 ? now + args.waitSeconds * 1_000 : undefined,
      updatedAt: now,
    });

    const expiredDeliveries = await ctx.db.query("runnerJobs")
      .withIndex("by_project_state_requested", (q) =>
        q.eq("projectId", principal.project._id).eq("state", "delivered"),
      )
      .take(100);
    for (const stale of expiredDeliveries) {
      if ((stale.reservationExpiresAt ?? 0) >= now) continue;
      await ctx.db.patch(stale._id, {
        state: "queued",
        revision: stale.revision + 1,
        registrationId: undefined,
        deliveredAt: undefined,
        reservationExpiresAt: undefined,
        updatedAt: now,
      });
      await appendJobEvent(ctx, stale, principal.actor._id, "queued", now, "delivery_expired");
    }

    const assigned = await ctx.db.query("runnerJobs")
      .withIndex("by_registration_state_updated", (q) =>
        q.eq("registrationId", registration._id),
      )
      .take(20);
    for (const stale of assigned) {
      const leaseExpired = ["starting", "running", "blocked"].includes(stale.state) &&
        (stale.leaseExpiresAt ?? 0) < now;
      const approvalExpired = stale.state === "awaiting_local_approval" && stale.expiresAt <= now;
      if (!leaseExpired && !approvalExpired) continue;
      const state: RunnerState = approvalExpired ? "expired" : "failed";
      await ctx.db.patch(stale._id, {
        state,
        revision: stale.revision + 1,
        safeCode: approvalExpired ? "approval_expired" : "runner_lease_expired",
        terminalAt: now,
        leaseExpiresAt: undefined,
        updatedAt: now,
      });
      await appendJobEvent(
        ctx,
        stale,
        principal.actor._id,
        state,
        now,
        approvalExpired ? "approval_expired" : "runner_lease_expired",
      );
    }
    const refreshedAssigned = await ctx.db.query("runnerJobs")
      .withIndex("by_registration_state_updated", (q) =>
        q.eq("registrationId", registration._id),
      )
      .take(20);
    const active = refreshedAssigned.find((job) => ACTIVE_STATES.has(job.state));
    if (active) return { registration: registrationDto({ ...registration, platform: args.platform, version: args.version.trim(), harnesses, approvalMode: args.approvalMode, lastSeenAt: now, waitingUntil: args.waitSeconds > 0 ? now + args.waitSeconds * 1_000 : undefined, updatedAt: now }), job: await jobDto(ctx, active) };

    const queued = await ctx.db.query("runnerJobs")
      .withIndex("by_project_state_requested", (q) =>
        q.eq("projectId", principal.project._id).eq("state", "queued"),
      )
      .take(100);
    for (const candidate of queued) {
      if (candidate.expiresAt <= now) {
        await ctx.db.patch(candidate._id, { state: "expired", revision: candidate.revision + 1, terminalAt: now, updatedAt: now });
        await appendJobEvent(ctx, candidate, principal.actor._id, "expired", now, "queue_expired");
        continue;
      }
      if (!harnesses.includes(candidate.harness)) continue;
      await ctx.db.patch(candidate._id, {
        state: "delivered",
        revision: candidate.revision + 1,
        registrationId: registration._id,
        deliveredAt: now,
        reservationExpiresAt: now + DELIVERY_RESERVATION_MS,
        updatedAt: now,
      });
      await appendJobEvent(ctx, { ...candidate, registrationId: registration._id }, principal.actor._id, "delivered", now);
      const delivered = await ctx.db.get(candidate._id);
      if (!delivered) fail("internal", "Runner job disappeared during delivery");
      return { registration: registrationDto({ ...registration, platform: args.platform, version: args.version.trim(), harnesses, approvalMode: args.approvalMode, lastSeenAt: now, waitingUntil: args.waitSeconds > 0 ? now + args.waitSeconds * 1_000 : undefined, updatedAt: now }), job: await jobDto(ctx, delivered) };
    }
    return { registration: registrationDto({ ...registration, platform: args.platform, version: args.version.trim(), harnesses, approvalMode: args.approvalMode, lastSeenAt: now, waitingUntil: args.waitSeconds > 0 ? now + args.waitSeconds * 1_000 : undefined, updatedAt: now }) };
  },
});

export const finishWait = internalMutation({
  args: {
    authorization: agentContextValidator,
    registrationId: v.id("runnerRegistrations"),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const { registration } = await requireRegistration(ctx, { ...args, scope: "dongo:work:write" });
    const now = Date.now();
    await ctx.db.patch(registration._id, { waitingUntil: undefined, lastSeenAt: now, updatedAt: now });
  },
});

export const updateJob = internalMutation({
  args: {
    authorization: agentContextValidator,
    registrationId: v.id("runnerRegistrations"),
    token: v.string(),
    jobId: v.id("runnerJobs"),
    expectedRevision: v.number(),
    state: stateValidator,
    leaseSeconds: v.optional(v.number()),
    safeCode: v.optional(v.string()),
    safeMessage: v.optional(v.string()),
    safeSummary: v.optional(v.string()),
    sessionReferencePresent: v.optional(v.boolean()),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const { principal, registration } = await requireRegistration(ctx, { ...args, scope: "dongo:work:write" });
    const job = await ctx.db.get(args.jobId);
    if (!job || job.projectId !== registration.projectId || job.registrationId !== registration._id) {
      fail("not_found", "Runner job not found");
    }
    const safeCode = runnerSafeCode(args.safeCode);
    const safeMessage = runnerSafeText(args.safeMessage, "safeMessage", 500);
    const safeSummary = runnerSafeText(args.safeSummary, "safeSummary", 2_000);
    const leaseSeconds = args.leaseSeconds ?? DEFAULT_LEASE_MS / 1_000;
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > MAX_LEASE_SECONDS) {
      fail("validation", `leaseSeconds must be between 30 and ${MAX_LEASE_SECONDS}`);
    }
    const now = Date.now();
    return await runIdempotent(ctx, {
      organizationId: registration.organizationId,
      projectId: registration.projectId,
      principalKey: `runner:${registration._id}`,
      operation: "runner.update_job",
      key: args.idempotencyKey,
      payload: { jobId: job._id, expectedRevision: args.expectedRevision, state: args.state, leaseSeconds, safeCode, safeMessage, safeSummary, sessionReferencePresent: args.sessionReferencePresent },
      now,
    }, async () => {
      if (job.revision !== args.expectedRevision) {
        fail("revision_conflict", "Runner job changed since it was read", { expectedRevision: args.expectedRevision, currentRevision: job.revision });
      }
      if (
        (job.state === "delivered" && (job.reservationExpiresAt ?? 0) < now) ||
        (["starting", "running", "blocked"].includes(job.state) &&
          (job.leaseExpiresAt ?? 0) < now) ||
        (job.state === "awaiting_local_approval" && job.expiresAt <= now)
      ) {
        fail("lease_expired", "Runner job lease expired; stop local execution and refetch");
      }
      if (!TRANSITIONS[job.state].has(args.state)) {
        fail("invalid_transition", `Runner job cannot move from ${job.state} to ${args.state}`);
      }
      if (job.state === "cancel_requested" && args.state !== "cancelled" && args.state !== "failed") {
        fail("invalid_transition", "Cancellation must be handled before further execution");
      }
      const terminal = TERMINAL_STATES.has(args.state);
      const revision = job.revision + 1;
      await ctx.db.patch(job._id, {
        state: args.state,
        revision,
        safeCode,
        safeMessage,
        safeSummary: safeSummary ?? job.safeSummary,
        sessionReferencePresent: args.sessionReferencePresent ?? job.sessionReferencePresent,
        reservationExpiresAt: undefined,
        leaseExpiresAt: terminal || args.state === "awaiting_local_approval" ? undefined : now + leaseSeconds * 1_000,
        terminalAt: terminal ? now : undefined,
        updatedAt: now,
      });
      await appendJobEvent(ctx, job, principal.actor._id, args.state, now, safeCode, safeMessage);
      await appendEvent(ctx, {
        organizationId: job.organizationId,
        projectId: job.projectId,
        workItemId: job.workItemId,
        actorId: principal.actor._id,
        type: `runner.job_${args.state}`,
        data: { jobId: job._id, registrationId: registration._id, revision, safeCode },
        requestId: principal.requestId,
        createdAt: now,
      });
      const updated = await ctx.db.get(job._id);
      if (!updated) fail("internal", "Runner job disappeared during update");
      return await jobDto(ctx, updated);
    });
  },
});

export const getJob = internalQuery({
  args: {
    authorization: agentContextValidator,
    registrationId: v.id("runnerRegistrations"),
    token: v.string(),
    jobId: v.id("runnerJobs"),
  },
  handler: async (ctx, args) => {
    const { registration } = await requireRegistration(ctx, { ...args, scope: "dongo:work:read" });
    const job = await ctx.db.get(args.jobId);
    if (!job || job.projectId !== registration.projectId || job.registrationId !== registration._id) {
      fail("not_found", "Runner job not found");
    }
    return await jobDto(ctx, job);
  },
});

export const listForHuman = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireHumanProject(ctx, args.projectId, { allowArchived: true });
    const [registrations, jobs] = await Promise.all([
      ctx.db.query("runnerRegistrations").withIndex("by_project_status", (q) => q.eq("projectId", args.projectId)).take(100),
      ctx.db.query("runnerJobs").withIndex("by_project_requested", (q) => q.eq("projectId", args.projectId)).order("desc").take(200),
    ]);
    return {
      registrations: registrations.map(registrationDto),
      jobs: await Promise.all(jobs.map((job) => jobDto(ctx, job))),
      serverTime: Date.now(),
    };
  },
});

export const enqueue = mutation({
  args: {
    projectId: v.id("projects"),
    workItemId: v.id("workItems"),
    harness: harnessValidator,
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await requireHumanProject(ctx, args.projectId);
    const work = await ctx.db.get(args.workItemId);
    if (!work || work.projectId !== args.projectId) fail("not_found", "Work item not found");
    const now = Date.now();
    return await runIdempotent(ctx, {
      organizationId: principal.project!.organizationId,
      projectId: args.projectId,
      principalKey: principal.principalKey,
      operation: "runner.enqueue",
      key: args.idempotencyKey,
      payload: { workItemId: args.workItemId, harness: args.harness },
      now,
    }, async () => {
      if (work.state !== "ready") fail("invalid_transition", "Only Ready work can be queued for a runner");
      const existing = await ctx.db.query("runnerJobs")
        .withIndex("by_project_work_requested", (q) => q.eq("projectId", args.projectId).eq("workItemId", args.workItemId))
        .take(100);
      if (existing.some((job) => !TERMINAL_STATES.has(job.state))) {
        fail("claim_conflict", "This Work item already has an active runner job");
      }
      const registrations = await ctx.db.query("runnerRegistrations")
        .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId).eq("status", "active"))
        .take(100);
      if (!registrations.some((registration) => registration.harnesses.includes(args.harness))) {
        fail("invalid_transition", `No active ${args.harness} runner is registered for this project`);
      }
      const jobId = await ctx.db.insert("runnerJobs", {
        organizationId: principal.project!.organizationId,
        projectId: args.projectId,
        workItemId: args.workItemId,
        requestedByActorId: principal.actor._id,
        harness: args.harness,
        state: "queued",
        revision: 1,
        requestedAt: now,
        expiresAt: now + JOB_TTL_MS,
        updatedAt: now,
      });
      const job = await ctx.db.get(jobId);
      if (!job) fail("internal", "Runner job was not created");
      await ctx.db.insert("runnerJobEvents", {
        organizationId: job.organizationId,
        projectId: job.projectId,
        jobId,
        actorId: principal.actor._id,
        sequence: 1,
        state: "queued",
        createdAt: now,
      });
      await appendEvent(ctx, {
        organizationId: job.organizationId,
        projectId: job.projectId,
        workItemId: job.workItemId,
        actorId: principal.actor._id,
        type: "runner.job_queued",
        data: { jobId, harness: args.harness },
        createdAt: now,
      });
      return await jobDto(ctx, job);
    });
  },
});

export const cancel = mutation({
  args: {
    projectId: v.id("projects"),
    jobId: v.id("runnerJobs"),
    expectedRevision: v.number(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await requireHumanProject(ctx, args.projectId);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.projectId !== args.projectId) fail("not_found", "Runner job not found");
    const now = Date.now();
    return await runIdempotent(ctx, {
      organizationId: principal.project!.organizationId,
      projectId: args.projectId,
      principalKey: principal.principalKey,
      operation: "runner.cancel",
      key: args.idempotencyKey,
      payload: { jobId: args.jobId, expectedRevision: args.expectedRevision },
      now,
    }, async () => {
      if (job.revision !== args.expectedRevision) fail("revision_conflict", "Runner job changed since it was read", { expectedRevision: args.expectedRevision, currentRevision: job.revision });
      if (TERMINAL_STATES.has(job.state)) fail("invalid_transition", "Runner job is already finished");
      const state: RunnerState = job.state === "queued" ? "cancelled" : "cancel_requested";
      const revision = job.revision + 1;
      await ctx.db.patch(job._id, {
        state,
        revision,
        cancellationRequestedAt: now,
        terminalAt: state === "cancelled" ? now : undefined,
        updatedAt: now,
      });
      await appendJobEvent(ctx, job, principal.actor._id, state, now, "user_cancelled");
      const updated = await ctx.db.get(job._id);
      if (!updated) fail("internal", "Runner job disappeared during cancellation");
      return await jobDto(ctx, updated);
    });
  },
});

export const revokeForHuman = mutation({
  args: { projectId: v.id("projects"), registrationId: v.id("runnerRegistrations") },
  handler: async (ctx, args) => {
    const principal = await requireHumanProject(ctx, args.projectId, { owner: true });
    const registration = await ctx.db.get(args.registrationId);
    if (!registration || registration.projectId !== args.projectId) fail("not_found", "Runner registration not found");
    if (registration.status === "revoked") return registrationDto(registration);
    const now = Date.now();
    await ctx.db.patch(registration._id, { status: "revoked", waitingUntil: undefined, revokedAt: now, updatedAt: now });
    await cancelRegistrationJobs(ctx, registration, principal.actor._id, now);
    await appendEvent(ctx, {
      organizationId: registration.organizationId,
      projectId: registration.projectId,
      actorId: principal.actor._id,
      type: "runner.registration_revoked",
      data: { registrationId: registration._id },
      createdAt: now,
    });
    return registrationDto({ ...registration, status: "revoked", waitingUntil: undefined, revokedAt: now, updatedAt: now });
  },
});
