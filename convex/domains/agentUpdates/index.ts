import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "../../_generated/server";
import type { MutationCtx } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import {
  requireHumanProject,
  resolveAgentPrincipal,
} from "../../lib/authz";
import { appendEvent } from "../../lib/events";
import { fail } from "../../lib/errors";
import { runIdempotent } from "../../lib/idempotency";
import {
  agentContextValidator,
  urgencyValidator,
} from "../../lib/validators";
import { normalizedActorIdentity } from "../human/summary";

const RECENT_PULL_WINDOW_MS = 90_000;
const MAX_WAIT_SECONDS = 20;

function signalDto(signal: Doc<"agentUpdateSignals">) {
  return {
    id: signal._id,
    version: signal.version,
    kind: signal.kind,
    intakeId: signal.intakeId,
    priority: signal.priority,
    createdAt: signal.createdAt,
  };
}

async function deliveryCounts(
  ctx: MutationCtx,
  projectId: Doc<"projects">["_id"],
  now: number,
) {
  const installations = await ctx.db
    .query("installations")
    .withIndex("by_project_status", (q) =>
      q.eq("projectId", projectId).eq("status", "active"),
    )
    .take(100);
  const presence = await ctx.db
    .query("agentUpdatePresence")
    .withIndex("by_project_updated", (q) => q.eq("projectId", projectId))
    .take(100);
  const byInstallation = new Map(
    presence.map((entry) => [entry.installationId, entry]),
  );
  let waitingInstallations = 0;
  let recentlyActiveInstallations = 0;
  let stoppedInstallations = 0;
  for (const installation of installations) {
    const entry = byInstallation.get(installation._id);
    if (entry?.waitingUntil !== undefined && entry.waitingUntil > now) {
      waitingInstallations += 1;
    } else if (
      entry?.lastPulledAt !== undefined
      && entry.lastPulledAt >= now - RECENT_PULL_WINDOW_MS
    ) {
      recentlyActiveInstallations += 1;
    } else {
      stoppedInstallations += 1;
    }
  }
  return {
    mechanism: "bounded_pull" as const,
    waitingInstallations,
    recentlyActiveInstallations,
    stoppedInstallations,
    stoppedAgentsRestarted: false as const,
  };
}

export const nudgeForIntake = mutation({
  args: {
    projectId: v.id("projects"),
    intakeId: v.id("intakes"),
    priority: urgencyValidator,
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await requireHumanProject(ctx, args.projectId);
    const intake = await ctx.db.get(args.intakeId);
    if (!intake || intake.projectId !== args.projectId) {
      fail("not_found", "Intake not found");
    }
    const now = Date.now();
    return await runIdempotent(
      ctx,
      {
        organizationId: principal.project!.organizationId,
        projectId: args.projectId,
        principalKey: principal.principalKey,
        operation: "agent_updates.nudge_intake",
        key: args.idempotencyKey,
        payload: {
          intakeId: args.intakeId,
          priority: args.priority,
        },
        now,
      },
      async () => {
        if (intake.status !== "new") {
          fail("invalid_transition", "Only waiting Inbox Intake can notify agents");
        }
        const version = (principal.project!.agentUpdateVersion ?? 0) + 1;
        const signalId = await ctx.db.insert("agentUpdateSignals", {
          organizationId: principal.project!.organizationId,
          projectId: args.projectId,
          version,
          kind: "intake_available",
          intakeId: args.intakeId,
          priority: args.priority,
          createdByActorId: principal.actor._id,
          createdAt: now,
        });
        await ctx.db.patch(args.projectId, {
          agentUpdateVersion: version,
          updatedAt: now,
        });
        await appendEvent(ctx, {
          organizationId: principal.project!.organizationId,
          projectId: args.projectId,
          intakeId: args.intakeId,
          actorId: principal.actor._id,
          type: "agent_updates.intake_nudged",
          data: { priority: args.priority, version },
          createdAt: now,
        });
        return {
          signal: {
            id: signalId,
            version,
            kind: "intake_available" as const,
            intakeId: args.intakeId,
            priority: args.priority,
            createdAt: now,
          },
          delivery: await deliveryCounts(ctx, args.projectId, now),
        };
      },
    );
  },
});

export const presence = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireHumanProject(ctx, args.projectId, { allowArchived: true });
    const now = Date.now();
    const installations = await ctx.db
      .query("installations")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", args.projectId).eq("status", "active"),
      )
      .take(100);
    const rows = await Promise.all(installations.map(async (installation) => {
      const [entry, actor] = await Promise.all([
        ctx.db.query("agentUpdatePresence")
          .withIndex("by_installation", (q) =>
            q.eq("installationId", installation._id),
          )
          .unique(),
        ctx.db.get(installation.actorId),
      ]);
      const waiting = entry?.waitingUntil !== undefined && entry.waitingUntil > now;
      const recent = entry?.lastPulledAt !== undefined
        && entry.lastPulledAt >= now - RECENT_PULL_WINDOW_MS;
      const identity = normalizedActorIdentity(
        actor ?? { type: "agent", name: "", agentType: undefined },
        installation,
      );
      return {
        installationId: installation._id,
        actor: {
          id: installation.actorId,
          displayName: identity.displayName,
          agentType: identity.agentType,
          transport: identity.transport ?? installation.kind,
          transportLabel: identity.transportLabel,
          machineLabel: identity.machineLabel,
        },
        capability: entry
          ? "get_updates" as const
          : "unknown" as const,
        state: waiting
          ? "waiting" as const
          : recent
            ? "recently_active" as const
            : "stopped" as const,
        delivery: waiting
          ? "bounded_wait" as const
          : recent
            ? "next_pull" as const
            : "offline" as const,
        lastPulledAt: entry?.lastPulledAt,
        waitingUntil: waiting ? entry.waitingUntil : undefined,
      };
    }));
    return {
      serverTime: now,
      installations: rows,
      truth: { stoppedAgentsRestarted: false as const },
    };
  },
});

export const beginPull = internalMutation({
  args: {
    authorization: agentContextValidator,
    waitSeconds: v.number(),
  },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:read",
    );
    if (
      !Number.isInteger(args.waitSeconds)
      || args.waitSeconds < 0
      || args.waitSeconds > MAX_WAIT_SECONDS
    ) {
      fail("validation", "waitSeconds must be an integer from 0 to 20");
    }
    const now = Date.now();
    const existing = await ctx.db
      .query("agentUpdatePresence")
      .withIndex("by_installation", (q) =>
        q.eq("installationId", principal.installation._id),
      )
      .unique();
    const existingWaitActive = existing?.waitingUntil !== undefined
      && existing.waitingUntil > now;
    const value = {
      organizationId: principal.project.organizationId,
      projectId: principal.project._id,
      installationId: principal.installation._id,
      actorId: principal.actor._id,
      capability: "get_updates" as const,
      lastPulledAt: now,
      waitingUntil: args.waitSeconds > 0
        ? now + args.waitSeconds * 1_000
        : existingWaitActive
          ? existing.waitingUntil
          : undefined,
      waitRequestId: args.waitSeconds > 0
        ? args.authorization.requestId
        : existingWaitActive
          ? existing.waitRequestId
          : undefined,
      updatedAt: now,
    };
    if (existing) await ctx.db.patch(existing._id, value);
    else await ctx.db.insert("agentUpdatePresence", value);
    await ctx.db.patch(principal.installation._id, {
      lastUsedAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(principal.actor._id, { lastSeenAt: now });
    return { startedAt: now };
  },
});

export const read = internalQuery({
  args: {
    authorization: agentContextValidator,
    cursor: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:read",
    );
    const currentVersion = principal.project.agentUpdateVersion ?? 0;
    const cursor = args.cursor ?? 0;
    if (
      !Number.isInteger(cursor)
      || cursor < 0
      || cursor > currentVersion
    ) {
      fail("validation", "cursor is not valid for this project");
    }
    const signals = await ctx.db
      .query("agentUpdateSignals")
      .withIndex("by_project_version", (q) =>
        q.eq("projectId", principal.project._id).gt("version", cursor),
      )
      .order("asc")
      .take(101);
    const page = signals.slice(0, 100);
    return {
      cursor: page.at(-1)?.version ?? cursor,
      updates: page.map(signalDto),
      hasMore: signals.length > page.length,
      serverTime: Date.now(),
    };
  },
});

export const finishPull = internalMutation({
  args: { authorization: agentContextValidator },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:read",
    );
    const existing = await ctx.db
      .query("agentUpdatePresence")
      .withIndex("by_installation", (q) =>
        q.eq("installationId", principal.installation._id),
      )
      .unique();
    if (
      existing
      && existing.waitRequestId === args.authorization.requestId
    ) {
      const now = Date.now();
      await ctx.db.patch(existing._id, {
        lastPulledAt: now,
        waitingUntil: undefined,
        waitRequestId: undefined,
        updatedAt: now,
      });
    }
    return { finished: true as const };
  },
});
