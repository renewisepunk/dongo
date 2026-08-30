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
import { internalQuery } from "../_generated/server";
import {
  agentContextValidator,
} from "../lib/validators";
import {
  assertSameProject,
  resolveAgentPrincipal,
} from "../lib/authz";
import { fail } from "../lib/errors";
import { buildOverview } from "../domains/overview/index";

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
  return {
    id: id<"actors">(actor._id),
    kind:
      actor.type === "human"
        ? "human"
        : installation?.kind === "service"
          ? "service"
          : "installation",
    displayName: actor.name,
    agentType: actor.agentType,
    machineLabel: installation?.machineLabel,
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
    repositoryUrl: validUrl(project.repositoryUrl),
    executionMode: project.executionMode,
    archivedAt: project.archivedAt,
  };
}

async function attentionDto(
  ctx: QueryCtx,
  request: Doc<"attentionRequests">,
): Promise<Attention> {
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
  };
}

async function intakeDto(
  ctx: QueryCtx,
  intake: Doc<"intakes">,
): Promise<Intake> {
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
    state: intake.status === "new" ? "waiting" : intake.status,
    revision: intake.revision,
    createdBy: await actorSummaryById(ctx, intake.createdByActorId),
    claimedBy,
    claimExpiresAt: intake.claimExpiresAt,
    attachmentIds: attachments.map((attachment) =>
      id<"attachments">(attachment._id),
    ),
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
  const [links, artifacts, comments, openRequests, seenRequests, runs] =
    await Promise.all([
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
  const activeRunDoc =
    (work.claimedRunId
      ? runs.find((run) => run._id === work.claimedRunId)
      : undefined) ?? runs.find((run) => run.status === "waiting");
  const terminalRun = runs.find((run) =>
    ["completed", "failed", "cancelled"].includes(run.status),
  );
  const request = [...openRequests, ...seenRequests].sort(
    (left, right) => right.createdAt - left.createdAt,
  )[0];
  return {
    id: id<"workItems">(work._id),
    projectId: id<"projects">(work.projectId),
    identifier: work.identifier,
    sequence: work.number,
    title: work.title,
    goal: work.description ?? "",
    outcome: terminalRun?.summary,
    state: work.state,
    orderKey: String(work.rank),
    revision: work.revision,
    sourceIntakeIds: links.map((link) => id<"intakes">(link.intakeId)),
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
    const work = await ctx.db
      .query("workItems")
      .withIndex("by_project_identifier", (q) =>
        q
          .eq("projectId", principal.project._id)
          .eq("identifier", args.identifier),
      )
      .unique();
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

export const sessionStart = internalQuery({
  args: { authorization: agentContextValidator },
  handler: async (ctx, args): Promise<SessionStart> => {
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
    const resolved = await ctx.db
      .query("attentionRequests")
      .withIndex("by_requester_resolved", (q) =>
        q
          .eq("requestedByActorId", principal.actor._id)
          .gt("resolvedAt", cursor?.lastAcknowledgedAt ?? 0),
      )
      .order("asc")
      .take(100);
    return {
      project: await projectSummary(ctx, principal.project),
      installation: await actorSummary(ctx, principal.actor),
      overview: await overviewDto(ctx, principal.project),
      newlyResolvedAttention: await Promise.all(
        resolved.map((request) => attentionDto(ctx, request)),
      ),
      instructions: {
        executionMode: principal.project.executionMode,
        maxNewWorkItemsPerSession: 1,
        wakeUpSemantics: "next_pull",
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
