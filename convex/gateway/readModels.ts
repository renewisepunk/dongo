import { v } from "convex/values";
import type {
  ActorSummary,
  Attention,
  Intake,
  Overview,
  ProjectSummary,
  Run,
  SessionStart,
  SyncSnapshot,
  WorkItem,
} from "@dongo/contracts";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { internalMutation, internalQuery } from "../_generated/server";
import {
  agentContextValidator,
} from "../lib/validators";
import {
  assertSameProject,
  resolveAgentPrincipal,
} from "../lib/authz";
import { fail } from "../lib/errors";
import { buildOverview } from "../domains/overview/index";
import { normalizedActorIdentity } from "../domains/human/summary";
import {
  compactIdentifierPrefix,
  displayWorkIdentifier,
  legacyWorkIdentifiers,
  workByIdentifier,
} from "../domains/work/identifiers";
import {
  capabilityState,
  hostCapabilitiesValidator,
  parallelExecutionPolicy,
} from "../domains/work/concurrency";
import { MAX_CHILD_WORK_ITEMS } from "../domains/work/service";

function id<T extends string>(value: string): string & { readonly __table: T } {
  return value as string & { readonly __table: T };
}

function validUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).toString();
  } catch {
    return undefined;
  }
}

async function actorSummary(
  ctx: QueryCtx,
  actor: Doc<"actors">,
): Promise<ActorSummary> {
  const installation = actor.installationId
    ? await ctx.db.get(actor.installationId)
    : null;
  const identity = normalizedActorIdentity(actor, installation);
  return {
    id: id<"actors">(actor._id),
    kind:
      actor.type === "human"
        ? "human"
        : installation?.kind === "service"
          ? "service"
          : "installation",
    displayName: identity.displayName,
    agentType: identity.agentType,
    transport: identity.transport,
    transportLabel: identity.transportLabel,
    machineLabel: identity.machineLabel,
  };
}

async function actorSummaryById(
  ctx: QueryCtx,
  actorId: Id<"actors">,
): Promise<ActorSummary> {
  const actor = await ctx.db.get(actorId);
  if (!actor) fail("internal", "Actor mapping is missing");
  return await actorSummary(ctx, actor);
}

async function projectSummary(
  ctx: QueryCtx,
  project: Doc<"projects">,
): Promise<ProjectSummary> {
  const organization = await ctx.db.get(project.organizationId);
  if (!organization) fail("internal", "Organization mapping is missing");
  return {
    id: id<"projects">(project._id),
    publicRef: project.publicRef,
    organizationId: id<"organizations">(project.organizationId),
    organizationSlug: organization.slug,
    name: project.name,
    slug: project.slug,
    identifierPrefix: project.identifierPrefix,
    compactIdentifierPrefix: compactIdentifierPrefix(project),
    repositoryUrl: validUrl(project.repositoryUrl),
    executionMode: project.executionMode,
    parallelExecution: parallelExecutionPolicy(project),
    archivedAt: project.archivedAt,
  };
}

async function attentionDto(
  ctx: QueryCtx,
  request: Doc<"attentionRequests">,
): Promise<Attention> {
  const response = request.resolutionCommentId
    ? await ctx.db.get(request.resolutionCommentId)
    : null;
  return {
    id: id<"attentionRequests">(request._id),
    workItemId: id<"workItems">(request.workItemId),
    kind: request.kind,
    title: request.title,
    body: request.body ?? "",
    important: request.urgency === "important",
    options: request.options,
    requestedBy: await actorSummaryById(ctx, request.requestedByActorId),
    requestedAt: request.createdAt,
    resolvedAt: request.resolvedAt,
    resolvedBy: request.resolvedByActorId
      ? await actorSummaryById(ctx, request.resolvedByActorId)
      : undefined,
    resolutionCommentId: request.resolutionCommentId
      ? id<"comments">(request.resolutionCommentId)
      : undefined,
    resolution: request.resolutionKind
      ? {
          kind: request.resolutionKind,
          body: response?.body,
          selectedOption: request.selectedOption,
        }
      : undefined,
  };
}

async function intakeDto(
  ctx: QueryCtx,
  intake: Doc<"intakes">,
): Promise<Intake> {
  const claimActive =
    intake.status === "claimed" &&
    intake.claimExpiresAt !== undefined &&
    intake.claimExpiresAt > Date.now();
  const [attachments, links, claimedBy] = await Promise.all([
    ctx.db
      .query("attachments")
      .withIndex("by_intake", (q) => q.eq("intakeId", intake._id))
      .take(20),
    ctx.db
      .query("intakeWorkLinks")
      .withIndex("by_intake", (q) => q.eq("intakeId", intake._id))
      .take(500),
    intake.claimedByActorId
      ? actorSummaryById(ctx, intake.claimedByActorId)
      : undefined,
  ]);
  return {
    id: id<"intakes">(intake._id),
    projectId: id<"projects">(intake.projectId),
    text: intake.text ?? "",
    context: intake.context,
    links: intake.links,
    state:
      intake.status === "new" || (intake.status === "claimed" && !claimActive)
        ? "waiting"
        : intake.status,
    revision: intake.revision,
    createdBy: await actorSummaryById(ctx, intake.createdByActorId),
    claimedBy: claimActive ? claimedBy : undefined,
    claimExpiresAt: claimActive ? intake.claimExpiresAt : undefined,
    attachmentIds: attachments
      .filter((attachment) => attachment.status === "available")
      .map((attachment) => id<"attachments">(attachment._id)),
    linkedWorkItemIds: links.map((link) => id<"workItems">(link.workItemId)),
    createdAt: intake.createdAt,
    updatedAt: intake.updatedAt,
  };
}

function runState(run: Doc<"runs">): Run["state"] {
  if (run.status === "running") return "running";
  if (run.status === "waiting") return "waiting_for_human";
  if (run.status === "completed") return "finished";
  if (run.status === "failed") return "failed";
  return "abandoned";
}

async function runDto(
  ctx: QueryCtx,
  run: Doc<"runs">,
  work: Doc<"workItems">,
): Promise<Run> {
  return {
    id: id<"runs">(run._id),
    workItemId: id<"workItems">(run.workItemId),
    installationActor: await actorSummaryById(ctx, run.actorId),
    externalSessionId: run.externalSessionId || `run-${run._id}`,
    state: runState(run),
    hostCapabilities: {
      parallelExecution: capabilityState(run.parallelExecutionCapability),
      worktreeIsolation: capabilityState(run.worktreeIsolationCapability),
    },
    workspace: {
      kind: run.workspaceKind ?? "undisclosed",
      worktreeName: run.worktreeName,
      branch: run.branch,
    },
    latestUpdate: run.summary,
    startedAt: run.startedAt,
    activeUntil:
      work.claimedRunId === run._id && work.claimExpiresAt
        ? work.claimExpiresAt
        : undefined,
    finishedAt: run.finishedAt,
  };
}

async function workDto(
  ctx: QueryCtx,
  work: Doc<"workItems">,
): Promise<WorkItem> {
  const [
    project,
    parentWork,
    childWork,
    links,
    artifacts,
    comments,
    openRequests,
    seenRequests,
    runs,
  ] =
    await Promise.all([
      ctx.db.get(work.projectId),
      work.parentId ? ctx.db.get(work.parentId) : null,
      ctx.db
        .query("workItems")
        .withIndex("by_parent", (q) => q.eq("parentId", work._id))
        .take(MAX_CHILD_WORK_ITEMS),
      ctx.db
        .query("intakeWorkLinks")
        .withIndex("by_work", (q) => q.eq("workItemId", work._id))
        .take(500),
      ctx.db
        .query("artifacts")
        .withIndex("by_work_created", (q) => q.eq("workItemId", work._id))
        .order("asc")
        .take(500),
      ctx.db
        .query("comments")
        .withIndex("by_work_created", (q) => q.eq("workItemId", work._id))
        .order("asc")
        .take(500),
      ctx.db
        .query("attentionRequests")
        .withIndex("by_work_status", (q) =>
          q.eq("workItemId", work._id).eq("status", "open"),
        )
        .order("desc")
        .take(1),
      ctx.db
        .query("attentionRequests")
        .withIndex("by_work_status", (q) =>
          q.eq("workItemId", work._id).eq("status", "seen"),
        )
        .order("desc")
        .take(1),
      ctx.db
        .query("runs")
        .withIndex("by_work_started", (q) => q.eq("workItemId", work._id))
        .order("desc")
        .take(25),
    ]);
  if (!project) fail("internal", "Work project mapping is missing");
  const relationship = (related: Doc<"workItems">) => ({
    id: id<"workItems">(related._id),
    identifier: displayWorkIdentifier(project, related),
    title: related.title,
    state: related.state,
  });
  const claimActive =
    work.claimedRunId !== undefined &&
    work.claimExpiresAt !== undefined &&
    work.claimExpiresAt > Date.now();
  const request = [...openRequests, ...seenRequests].sort(
    (left, right) => right.createdAt - left.createdAt,
  )[0];
  const activeRunDoc =
    (claimActive && work.claimedRunId
      ? runs.find((run) => run._id === work.claimedRunId)
      : undefined) ??
    (request?.runId
      ? runs.find(
          (run) => run._id === request.runId && run.status === "waiting",
        )
      : undefined);
  const terminalRun = runs.find((run) =>
    ["completed", "failed", "cancelled"].includes(run.status),
  );
  return {
    id: id<"workItems">(work._id),
    projectId: id<"projects">(work.projectId),
    identifier: displayWorkIdentifier(project, work),
    legacyIdentifiers: legacyWorkIdentifiers(project, work),
    sequence: work.number,
    title: work.title,
    goal: work.description ?? "",
    context: work.context,
    links: work.links,
    outcome: terminalRun?.summary,
    state: work.state === "working" && !claimActive ? "ready" : work.state,
    orderKey: String(work.rank),
    revision: work.revision,
    sourceIntakeIds: links.map((link) => id<"intakes">(link.intakeId)),
    parentWorkItem:
      parentWork && parentWork.projectId === work.projectId
        ? relationship(parentWork)
        : undefined,
    childWorkItems: childWork
      .filter((child) => child.projectId === work.projectId)
      .sort((left, right) => left.rank - right.rank)
      .map(relationship),
    activeRun: activeRunDoc
      ? await runDto(ctx, activeRunDoc, work)
      : undefined,
    openAttention: request ? await attentionDto(ctx, request) : undefined,
    artifacts: artifacts.map((artifact) => {
      const metadata = artifact.metadata as
        | { repositoryPath?: unknown }
        | undefined;
      const repositoryPath =
        typeof metadata?.repositoryPath === "string"
          ? metadata.repositoryPath
          : undefined;
      return {
        id: id<"artifacts">(artifact._id),
        kind: artifact.type,
        label: artifact.title,
        url: validUrl(artifact.url),
        repositoryPath,
        createdAt: artifact.createdAt,
      };
    }),
    conversation: await Promise.all(
      comments.map(async (comment) => ({
        id: id<"comments">(comment._id),
        actor: await actorSummaryById(ctx, comment.actorId),
        body: comment.body,
        attachmentIds: (comment.attachmentIds ?? []).map((attachmentId) =>
          id<"attachments">(attachmentId),
        ),
        createdAt: comment.createdAt,
      })),
    ),
    createdAt: work.createdAt,
    updatedAt: work.updatedAt,
    completedAt: work.completedAt,
  };
}

async function requireAgentWork(
  ctx: QueryCtx,
  authorization: Parameters<typeof resolveAgentPrincipal>[1],
  workItemId: Id<"workItems">,
) {
  const principal = await resolveAgentPrincipal(
    ctx,
    authorization,
    "dongo:work:read",
  );
  const work = await ctx.db.get(workItemId);
  if (!work) fail("not_found", "Work item not found");
  assertSameProject(work, principal.project);
  return { principal, work };
}

export const getWork = internalQuery({
  args: {
    authorization: agentContextValidator,
    workItemId: v.id("workItems"),
  },
  handler: async (ctx, args) => {
    const { work } = await requireAgentWork(
      ctx,
      args.authorization,
      args.workItemId,
    );
    return await workDto(ctx, work);
  },
});

export const getWorkByIdentifier = internalQuery({
  args: { authorization: agentContextValidator, identifier: v.string() },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:read",
    );
    const work = await workByIdentifier(ctx, principal.project, args.identifier);
    if (!work) fail("not_found", "Work item not found");
    return await workDto(ctx, work);
  },
});

export const activeRun = internalQuery({
  args: {
    authorization: agentContextValidator,
    workItemId: v.id("workItems"),
  },
  handler: async (ctx, args) => {
    const { principal, work } = await requireAgentWork(
      ctx,
      args.authorization,
      args.workItemId,
    );
    if (
      !work.claimedRunId ||
      work.claimedByInstallationId !== principal.installation._id ||
      !work.claimExpiresAt ||
      work.claimExpiresAt <= Date.now()
    ) {
      fail("claim_conflict", "Installation has no active Run for this work");
    }
    const run = await ctx.db.get(work.claimedRunId);
    if (!run || run.status !== "running") {
      fail("claim_conflict", "Installation has no active Run for this work");
    }
    return { runId: run._id };
  },
});

export const mutationRun = internalQuery({
  args: {
    authorization: agentContextValidator,
    workItemId: v.id("workItems"),
    operation: v.union(
      v.literal("work.update"),
      v.literal("work.renew_claim"),
      v.literal("work.finish"),
      v.literal("attention.request"),
    ),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const { principal, work } = await requireAgentWork(
      ctx,
      args.authorization,
      args.workItemId,
    );
    if (
      work.claimedRunId &&
      work.claimedByInstallationId === principal.installation._id
    ) {
      const current = await ctx.db.get(work.claimedRunId);
      if (
        current &&
        current.installationId === principal.installation._id &&
        current.status === "running"
      ) {
        return { runId: current._id };
      }
    }
    const cached = await ctx.db
      .query("idempotencyKeys")
      .withIndex("by_scope_operation_key", (q) =>
        q
          .eq("projectId", principal.project._id)
          .eq("principalKey", principal.principalKey)
          .eq("operation", args.operation)
          .eq("key", args.idempotencyKey),
      )
      .unique();
    if (cached && cached.expiresAt > Date.now()) {
      let payload: unknown;
      try {
        payload = JSON.parse(cached.canonicalPayload);
      } catch {
        fail("internal", "Cached mutation context is invalid");
      }
      const record = payload as { workItemId?: unknown; runId?: unknown };
      if (
        record.workItemId === work._id &&
        typeof record.runId === "string"
      ) {
        const run = await ctx.db.get(record.runId as Id<"runs">);
        if (
          run &&
          run.workItemId === work._id &&
          run.installationId === principal.installation._id
        ) {
          return { runId: run._id };
        }
      }
    }
    fail("claim_conflict", "Installation has no active Run for this work");
  },
});

export const getIntake = internalQuery({
  args: {
    authorization: agentContextValidator,
    intakeId: v.id("intakes"),
  },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:read",
    );
    const intake = await ctx.db.get(args.intakeId);
    if (!intake) fail("not_found", "Intake not found");
    assertSameProject(intake, principal.project);
    return await intakeDto(ctx, intake);
  },
});

export const getAttention = internalQuery({
  args: {
    authorization: agentContextValidator,
    attentionRequestId: v.id("attentionRequests"),
  },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:read",
    );
    const request = await ctx.db.get(args.attentionRequestId);
    if (!request) fail("not_found", "Attention request not found");
    assertSameProject(request, principal.project);
    return await attentionDto(ctx, request);
  },
});

async function overviewDto(
  ctx: QueryCtx,
  project: Doc<"projects">,
): Promise<Overview> {
  const raw = await buildOverview(ctx, project);
  return {
    project: await projectSummary(ctx, project),
    needsYou: await Promise.all(
      raw.needsYou
        .map(({ work }) => work)
        .filter((work): work is Doc<"workItems"> => work !== null)
        .map((work) => workDto(ctx, work)),
    ),
    working: await Promise.all(
      raw.working.map(({ work }) => workDto(ctx, work)),
    ),
    ready: await Promise.all(raw.ready.map(({ work }) => workDto(ctx, work))),
    inbox: await Promise.all(raw.inbox.map(({ intake }) => intakeDto(ctx, intake))),
    recentlyDone: await Promise.all(
      raw.recentlyDone.map((work) => workDto(ctx, work)),
    ),
    serverTime: raw.generatedAt,
  };
}

export const getOverview = internalQuery({
  args: { authorization: agentContextValidator },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:read",
    );
    return await overviewDto(ctx, principal.project);
  },
});

export const sessionStart = internalMutation({
  args: {
    authorization: agentContextValidator,
    hostCapabilities: v.optional(hostCapabilitiesValidator),
  },
  handler: async (ctx, args): Promise<SessionStart> => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:read",
    );
    const verifiedAt = Date.now();
    await ctx.db.patch(principal.installation._id, {
      lastUsedAt: verifiedAt,
      updatedAt: verifiedAt,
    });
    await ctx.db.patch(principal.actor._id, { lastSeenAt: verifiedAt });
    const externalSessionId = args.authorization.externalSessionId;
    if (!externalSessionId) fail("validation", "externalSessionId is required");
    const existingSession = await ctx.db
      .query("agentSessions")
      .withIndex("by_installation_session", (q) =>
        q
          .eq("installationId", principal.installation._id)
          .eq("externalSessionId", externalSessionId),
      )
      .unique();
    const sessionFields = {
      parallelExecutionCapability: args.hostCapabilities?.parallelExecution,
      worktreeIsolationCapability: args.hostCapabilities?.worktreeIsolation,
      updatedAt: verifiedAt,
    };
    if (existingSession) {
      await ctx.db.patch(existingSession._id, sessionFields);
    } else {
      await ctx.db.insert("agentSessions", {
        organizationId: principal.project.organizationId,
        projectId: principal.project._id,
        installationId: principal.installation._id,
        actorId: principal.actor._id,
        externalSessionId,
        ...sessionFields,
        createdAt: verifiedAt,
      });
    }
    const cursor = await ctx.db
      .query("agentSyncCursors")
      .withIndex("by_installation", (q) =>
        q.eq("installationId", principal.installation._id),
      )
      .unique();
    const resolved = await ctx.db
      .query("attentionRequests")
      .withIndex("by_requester_resolved", (q) =>
        q
          .eq("requestedByActorId", principal.actor._id)
          .gt("resolvedAt", cursor?.lastAcknowledgedAt ?? 0),
      )
      .order("asc")
      .take(100);
    const policy = parallelExecutionPolicy(principal.project);
    const hostCapabilities = {
      parallelExecution: capabilityState(args.hostCapabilities?.parallelExecution),
      worktreeIsolation: capabilityState(args.hostCapabilities?.worktreeIsolation),
    };
    const reason = !policy.enabled
      ? "project_disabled" as const
      : Object.values(hostCapabilities).includes("unsupported")
        ? "host_unsupported" as const
        : Object.values(hostCapabilities).includes("undisclosed")
          ? "host_undisclosed" as const
          : "parallel_available" as const;
    return {
      project: await projectSummary(ctx, principal.project),
      installation: await actorSummary(ctx, principal.actor),
      overview: await overviewDto(ctx, principal.project),
      newlyResolvedAttention: await Promise.all(
        resolved.map((request) => attentionDto(ctx, request)),
      ),
      instructions: {
        executionMode: principal.project.executionMode,
        maxStartedWorkItemsPerSession: 1,
        maxNewWorkItemsPerSession: 1,
        wakeUpSemantics: "next_pull",
        parallelExecution: {
          policy,
          hostCapabilities,
          mode: reason === "parallel_available" ? "parallel" : "serial",
          reason,
        },
      },
    };
  },
});

export const syncSnapshot = internalQuery({
  args: { authorization: agentContextValidator },
  handler: async (ctx, args): Promise<SyncSnapshot> => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:read",
    );
    const workItems = await ctx.db
      .query("workItems")
      .withIndex("by_project_state_rank", (q) =>
        q.eq("projectId", principal.project._id),
      )
      .take(500);
    return {
      version: 1,
      generatedAt: Date.now(),
      project: await projectSummary(ctx, principal.project),
      workItems: await Promise.all(workItems.map((work) => workDto(ctx, work))),
    };
  },
});
