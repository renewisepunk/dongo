import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import {
  agentContextValidator,
  artifactTypeValidator,
  closureReasonValidator,
  MAX_BODY_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_TITLE_LENGTH,
  workKindValidator,
} from "../../lib/validators";
import {
  assertSameProject,
  requireHumanProject,
  requireSystemActor,
  resolveAgentPrincipal,
} from "../../lib/authz";
import { appendEvent } from "../../lib/events";
import {
  assertExpectedRevision,
  fail,
  optionalString,
  requireString,
} from "../../lib/errors";
import { attachmentSummary } from "../attachments/summary";
import {
  actorSummaryForHumanWithInstallation,
  artifactSummaryForHuman,
  attentionSummaryForHuman,
  commentSummaryForHuman,
  intakeSummaryForHuman,
  runSummaryForHuman,
  workSummaryForHuman,
} from "../human/summary";
import { runIdempotent } from "../../lib/idempotency";
import { isLeaseActive, newLease } from "../../lib/leases";
import {
  createWorkItem,
  linkIntakeToWork,
  MAX_CHILD_WORK_ITEMS,
  recordClosedWorkItem,
} from "./service";
import { workByIdentifier } from "./identifiers";
import {
  capabilityState,
  normalizeWorkspace,
  parallelExecutionPolicy,
  workspaceValidator,
} from "./concurrency";
import { releaseRunResourceClaims } from "../resources/service";

const inlineArtifactValidator = v.object({
  type: artifactTypeValidator,
  title: v.string(),
  url: v.optional(v.string()),
  repositoryPath: v.optional(v.string()),
});

type InlineArtifact = {
  type:
    | "commit"
    | "pull_request"
    | "deployment"
    | "preview"
    | "url"
    | "image"
    | "file"
    | "report";
  title: string;
  url?: string;
  repositoryPath?: string;
};

async function recordInlineArtifacts(
  ctx: MutationCtx,
  work: Doc<"workItems">,
  runId: Id<"runs">,
  actorId: Id<"actors">,
  artifacts: InlineArtifact[],
  now: number,
): Promise<Array<Id<"artifacts">>> {
  if (artifacts.length > 100) {
    fail("validation", "A Work update may include at most 100 artifacts");
  }
  const artifactIds: Array<Id<"artifacts">> = [];
  for (const artifact of artifacts) {
    const title = requireString(artifact.title, "artifact.title", MAX_TITLE_LENGTH);
    const url = optionalString(artifact.url, "artifact.url", 2_048);
    if (
      ["commit", "pull_request", "deployment", "preview", "url"].includes(
        artifact.type,
      ) && !url
    ) {
      fail("validation", `${artifact.type} artifacts require a URL`);
    }
    const repositoryPath = optionalString(
      artifact.repositoryPath,
      "artifact.repositoryPath",
      2_048,
    );
    artifactIds.push(
      await ctx.db.insert("artifacts", {
        organizationId: work.organizationId,
        projectId: work.projectId,
        workItemId: work._id,
        runId,
        actorId,
        type: artifact.type,
        title,
        url,
        metadata: repositoryPath ? { repositoryPath } : undefined,
        createdAt: now,
      }),
    );
  }
  return artifactIds;
}

async function expireStaleWorkClaim(
  ctx: MutationCtx,
  work: Doc<"workItems">,
  now: number,
): Promise<Doc<"workItems">> {
  if (!work.claimedRunId || isLeaseActive(work.claimExpiresAt, now)) return work;
  const run = await ctx.db.get(work.claimedRunId);
  if (run && run.status === "running") {
    const systemActor = await requireSystemActor(ctx, work.organizationId);
    await releaseRunResourceClaims(ctx, {
      runId: run._id,
      actorId: systemActor._id,
      now,
      reason: "owner_inactive",
    });
    await ctx.db.patch(run._id, {
      status: "failed",
      failureCode: "lease_expired",
      finishedAt: now,
      lastHeartbeatAt: now,
    });
  }
  const systemActor = await requireSystemActor(ctx, work.organizationId);
  await ctx.db.patch(work._id, {
    state: "ready",
    claimedByActorId: undefined,
    claimedByInstallationId: undefined,
    claimedRunId: undefined,
    claimedAt: undefined,
    claimExpiresAt: undefined,
    revision: work.revision + 1,
    updatedAt: now,
  });
  await appendEvent(ctx, {
    organizationId: work.organizationId,
    projectId: work.projectId,
    workItemId: work._id,
    runId: run?._id,
    actorId: systemActor._id,
    type: "work.claim_expired",
    data: { previousRunId: run?._id },
    createdAt: now,
  });
  return (await ctx.db.get(work._id))!;
}

export const createForHuman = mutation({
  args: {
    projectId: v.id("projects"),
    title: v.string(),
    description: v.optional(v.string()),
    kind: workKindValidator,
    parentId: v.optional(v.id("workItems")),
    sourceIntakeIds: v.optional(v.array(v.id("intakes"))),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await requireHumanProject(ctx, args.projectId);
    const now = Date.now();
    return await runIdempotent(
      ctx,
      {
        organizationId: principal.project!.organizationId,
        projectId: args.projectId,
        principalKey: principal.principalKey,
        operation: "work.create",
        key: args.idempotencyKey,
        payload: args,
        now,
      },
      async () => {
        if ((args.sourceIntakeIds?.length ?? 0) > 500) {
          fail("validation", "Work may link at most 500 source Intakes");
        }
        const workItemId = await createWorkItem(ctx, {
          projectId: args.projectId,
          actorId: principal.actor._id,
          input: args,
          now,
        });
        for (const intakeId of [...new Set(args.sourceIntakeIds ?? [])]) {
          const intake = await ctx.db.get(intakeId);
          if (
            !intake ||
            intake.projectId !== args.projectId ||
            intake.organizationId !== principal.project!.organizationId
          ) {
            fail("not_found", "Source Intake not found");
          }
          await linkIntakeToWork(ctx, {
            intakeId,
            workItemId,
            relation: "linked",
            now,
          });
        }
        return { workItemId };
      },
    );
  },
});

export const createForAgent = internalMutation({
  args: {
    authorization: agentContextValidator,
    title: v.string(),
    description: v.optional(v.string()),
    context: v.optional(v.string()),
    links: v.optional(v.array(v.string())),
    initialComment: v.optional(v.string()),
    kind: workKindValidator,
    parentId: v.optional(v.id("workItems")),
    sourceIntakeIds: v.optional(v.array(v.id("intakes"))),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:write",
    );
    const now = Date.now();
    return await runIdempotent(
      ctx,
      {
        organizationId: principal.project.organizationId,
        projectId: principal.project._id,
        principalKey: principal.principalKey,
        operation: "work.create",
        key: args.idempotencyKey,
        payload: {
          title: args.title,
          description: args.description,
          context: args.context,
          links: args.links,
          initialComment: args.initialComment,
          kind: args.kind,
          parentId: args.parentId,
          sourceIntakeIds: args.sourceIntakeIds,
        },
        now,
      },
      async () => {
        if ((args.sourceIntakeIds?.length ?? 0) > 500) {
          fail("validation", "Work may link at most 500 source Intakes");
        }
        const workItemId = await createWorkItem(ctx, {
          projectId: principal.project._id,
          actorId: principal.actor._id,
          input: args,
          now,
          requestId: principal.requestId,
        });
        if (args.initialComment !== undefined) {
          const body = requireString(
            args.initialComment,
            "initialComment",
            MAX_BODY_LENGTH,
          );
          const commentId = await ctx.db.insert("comments", {
            organizationId: principal.project.organizationId,
            projectId: principal.project._id,
            workItemId,
            actorId: principal.actor._id,
            body,
            attachmentIds: [],
            createdAt: now,
          });
          await appendEvent(ctx, {
            organizationId: principal.project.organizationId,
            projectId: principal.project._id,
            workItemId,
            actorId: principal.actor._id,
            type: "comment.created",
            data: { commentId },
            requestId: principal.requestId,
            createdAt: now,
          });
        }
        for (const intakeId of [...new Set(args.sourceIntakeIds ?? [])]) {
          const intake = await ctx.db.get(intakeId);
          if (!intake) fail("not_found", "Source Intake not found");
          assertSameProject(intake, principal.project);
          await linkIntakeToWork(ctx, {
            intakeId,
            workItemId,
            relation: "linked",
            now,
          });
        }
        return { workItemId };
      },
    );
  },
});

async function workDetail(ctx: QueryCtx, work: Doc<"workItems">) {
  const [runs, comments, artifacts, attention, sources, parentWork, childWork] = await Promise.all([
    ctx.db
      .query("runs")
      .withIndex("by_work_started", (q) => q.eq("workItemId", work._id))
      .order("desc")
      .take(25),
    ctx.db
      .query("comments")
      .withIndex("by_work_created", (q) => q.eq("workItemId", work._id))
      .order("asc")
      .take(100),
    ctx.db
      .query("artifacts")
      .withIndex("by_work_created", (q) => q.eq("workItemId", work._id))
      .order("asc")
      .take(100),
    ctx.db
      .query("attentionRequests")
      .withIndex("by_work_status", (q) => q.eq("workItemId", work._id))
      .order("desc")
      .take(50),
    ctx.db
      .query("intakeWorkLinks")
      .withIndex("by_work", (q) => q.eq("workItemId", work._id))
      .take(50),
    work.parentId ? ctx.db.get(work.parentId) : null,
    ctx.db
      .query("workItems")
      .withIndex("by_parent", (q) => q.eq("parentId", work._id))
      .take(MAX_CHILD_WORK_ITEMS),
  ]);
  return { work, runs, comments, artifacts, attention, sources, parentWork, childWork };
}

async function workDetailForHuman(
  ctx: QueryCtx,
  work: Doc<"workItems">,
  project: Doc<"projects">,
) {
  const detail = await workDetail(ctx, work);
  const attachments = (
    await ctx.db
      .query("attachments")
      .withIndex("by_work", (q) => q.eq("workItemId", work._id))
      .take(100)
  )
    .filter((attachment) => attachment.status === "available")
    .map(attachmentSummary);
  const sourceIntakes = (
    await Promise.all(detail.sources.map(async (source) => {
      const intake = await ctx.db.get(source.intakeId);
      if (!intake || intake.projectId !== work.projectId) return null;
      const sourceAttachments = (
        await ctx.db
          .query("attachments")
          .withIndex("by_intake", (q) => q.eq("intakeId", intake._id))
          .take(100)
      )
        .filter((attachment) => attachment.status === "available")
        .map(attachmentSummary);
      return { intake, attachments: sourceAttachments };
    }))
  ).filter((source): source is NonNullable<typeof source> => source !== null);
  const actorIds = new Set<Id<"actors">>();
  for (const run of detail.runs) actorIds.add(run.actorId);
  for (const comment of detail.comments) actorIds.add(comment.actorId);
  for (const artifact of detail.artifacts) actorIds.add(artifact.actorId);
  for (const request of detail.attention) {
    actorIds.add(request.requestedByActorId);
    if (request.resolvedByActorId) actorIds.add(request.resolvedByActorId);
  }
  const actors = (
    await Promise.all([...actorIds].map((actorId) => ctx.db.get(actorId)))
  ).filter((actor): actor is Doc<"actors"> => actor !== null);
  return {
    work: workSummaryForHuman(detail.work, project),
    runs: detail.runs.map(runSummaryForHuman),
    comments: detail.comments.map(commentSummaryForHuman),
    artifacts: detail.artifacts.map(artifactSummaryForHuman),
    attention: detail.attention.map(attentionSummaryForHuman),
    actors: await Promise.all(
      actors.map((actor) => actorSummaryForHumanWithInstallation(ctx, actor)),
    ),
    attachments,
    sourceIntakes: sourceIntakes.map(({ intake, attachments: sourceAttachments }) => ({
      intake: intakeSummaryForHuman(intake, sourceAttachments[0]),
      attachments: sourceAttachments,
    })),
    parentWork:
      detail.parentWork?.projectId === work.projectId
        ? workSummaryForHuman(detail.parentWork, project)
        : undefined,
    childWork: detail.childWork
      .filter((child) => child.projectId === work.projectId)
      .sort((left, right) => left.rank - right.rank)
      .map((child) => workSummaryForHuman(child, project)),
  };
}

export const getForHuman = query({
  args: { workItemId: v.id("workItems") },
  handler: async (ctx, args) => {
    const work = await ctx.db.get(args.workItemId);
    if (!work) fail("not_found", "Work item not found");
    const principal = await requireHumanProject(ctx, work.projectId, {
      allowArchived: true,
    });
    const detail = await workDetail(ctx, work);
    return {
      work: workSummaryForHuman(detail.work, principal.project!),
      runs: detail.runs.map(runSummaryForHuman),
      comments: detail.comments.map(commentSummaryForHuman),
      artifacts: detail.artifacts.map(artifactSummaryForHuman),
      attention: detail.attention.map(attentionSummaryForHuman),
      parentWork:
        detail.parentWork?.projectId === work.projectId
          ? workSummaryForHuman(detail.parentWork, principal.project!)
          : undefined,
      childWork: detail.childWork
        .filter((child) => child.projectId === work.projectId)
        .sort((left, right) => left.rank - right.rank)
        .map((child) => workSummaryForHuman(child, principal.project!)),
    };
  },
});

export const getDetailForHuman = query({
  args: { workItemId: v.id("workItems") },
  handler: async (ctx, args) => {
    const work = await ctx.db.get(args.workItemId);
    if (!work) fail("not_found", "Work item not found");
    const principal = await requireHumanProject(ctx, work.projectId, {
      allowArchived: true,
    });
    return await workDetailForHuman(ctx, work, principal.project!);
  },
});

export const listCompletedForHuman = query({
  args: {
    projectId: v.id("projects"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const principal = await requireHumanProject(ctx, args.projectId, {
      allowArchived: true,
    });
    const page = await ctx.db
      .query("workItems")
      .withIndex("by_project_updated", (q) => q.eq("projectId", args.projectId))
      .filter((q) => q.or(
        q.eq(q.field("state"), "done"),
        q.eq(q.field("state"), "cancelled"),
      ))
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...page,
      page: page.page.map((work) =>
        workSummaryForHuman(work, principal.project!),
      ),
    };
  },
});

export const getByIdentifierForHuman = query({
  args: { projectId: v.id("projects"), identifier: v.string() },
  handler: async (ctx, args) => {
    const principal = await requireHumanProject(ctx, args.projectId, {
      allowArchived: true,
    });
    const identifier = requireString(args.identifier, "identifier", 80);
    const work = await workByIdentifier(ctx, principal.project!, identifier);
    if (!work) fail("not_found", "Work item not found");
    return await workDetailForHuman(ctx, work, principal.project!);
  },
});

export const concurrencyForHuman = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const principal = await requireHumanProject(ctx, args.projectId, {
      allowArchived: true,
    });
    const project = principal.project!;
    const serverTime = Date.now();
    const [running, waiting] = await Promise.all(
      (["running", "waiting"] as const).map((status) =>
        ctx.db
          .query("runs")
          .withIndex("by_project_status", (q) =>
            q.eq("projectId", project._id).eq("status", status),
          )
          .order("desc")
          .take(100),
      ),
    );
    const runnerJobs = await ctx.db
      .query("runnerJobs")
      .withIndex("by_project_requested", (q) => q.eq("projectId", project._id))
      .order("desc")
      .take(200);
    const latestRunnerJobByWork = new Map<Id<"workItems">, Doc<"runnerJobs">>();
    for (const job of runnerJobs) {
      if (job.workItemId && !latestRunnerJobByWork.has(job.workItemId)) {
        latestRunnerJobByWork.set(job.workItemId, job);
      }
    }
    const runs = await Promise.all(
      [...running, ...waiting]
        .sort((left, right) => right.startedAt - left.startedAt)
        .slice(0, 100)
        .map(async (run) => {
          const [work, actor] = await Promise.all([
            ctx.db.get(run.workItemId),
            ctx.db.get(run.actorId),
          ]);
          if (!work || !actor) return null;
          if (run.status === "waiting") {
            const [openAttention, seenAttention] = await Promise.all(
              (["open", "seen"] as const).map((status) =>
                ctx.db
                  .query("attentionRequests")
                  .withIndex("by_work_status", (q) =>
                    q.eq("workItemId", work._id).eq("status", status),
                  )
                  .filter((q) => q.eq(q.field("runId"), run._id))
                  .first(),
              ),
            );
            if (!openAttention && !seenAttention) return null;
          }
          const claimExpiresAt =
            work.claimedRunId === run._id ? work.claimExpiresAt : undefined;
          const runnerJob = latestRunnerJobByWork.get(work._id);
          const matchingRunnerJob =
            runnerJob &&
            run.externalSessionId === `dongo-runner-${runnerJob._id}` &&
            (runnerJob.deliveredAt ?? runnerJob.requestedAt) <= run.startedAt &&
            runnerJob.registrationId !== undefined
              ? runnerJob
              : undefined;
          const processExited = matchingRunnerJob !== undefined &&
            matchingRunnerJob.terminalAt !== undefined &&
            run.startedAt < matchingRunnerJob.terminalAt &&
            ["cancelled", "failed", "completed", "expired"].includes(
              matchingRunnerJob.state,
            );
          const activeRunnerJob = matchingRunnerJob !== undefined &&
            ["starting", "running"].includes(matchingRunnerJob.state)
              ? matchingRunnerJob
              : undefined;
          const runnerHarnessLabel = activeRunnerJob?.harness === "claude"
            ? "Claude Code"
            : activeRunnerJob?.harness === "codex"
              ? "Codex"
              : undefined;
          const activityKind = processExited
            ? "process_exited" as const
            : run.status === "waiting"
              ? "waiting_for_owner" as const
              : run.activityKind ?? "executing" as const;
          const activityLabel = processExited
            ? matchingRunnerJob.safeSummary ?? "Local process exited before completion"
            : run.status === "waiting"
              ? "Waiting for your response"
              : run.activityLabel ?? (
                run.activityKind === "verification"
                  ? "Verifying the candidate"
                  : run.activityKind === "release"
                    ? "Releasing the accepted candidate"
                    : run.activityKind === "waiting_for_resource"
                      ? "Waiting for a shared resource"
                      : run.activityKind === "paused"
                        ? "Paused locally"
                        : runnerHarnessLabel
                          ? `${runnerHarnessLabel} is working`
                          : "Agent is executing"
              );
          const leaseStatus = run.status === "waiting" || claimExpiresAt === undefined
            ? "released" as const
            : claimExpiresAt <= serverTime
              ? "expired" as const
              : claimExpiresAt - serverTime <= 5 * 60_000
                ? "expiring" as const
                : "healthy" as const;
          return {
            id: run._id,
            workItem: {
              id: work._id,
              identifier: workSummaryForHuman(work, project).identifier,
              title: work.title,
            },
            actor: await actorSummaryForHumanWithInstallation(ctx, actor),
            state: run.status,
            activity: {
              kind: activityKind,
              label: activityLabel,
              nextStep: processExited
                ? "The WorkItem is being returned to Ready for a safe retry."
                : run.activityNextStep,
              updatedAt:
                processExited
                  ? matchingRunnerJob.updatedAt
                  : run.activityUpdatedAt ?? activeRunnerJob?.updatedAt ?? run.lastHeartbeatAt,
            },
            startedAt: run.startedAt,
            lastHeartbeatAt: run.lastHeartbeatAt,
            elapsedMilliseconds: Math.max(0, serverTime - run.startedAt),
            latestProgress: run.summary ?? (runnerHarnessLabel
              ? `The local ${runnerHarnessLabel} harness is active. Detailed progress will appear after its first dongo update.`
              : undefined),
            lease: {
              status: leaseStatus,
              expiresAt: claimExpiresAt,
            },
            hostCapabilities: {
              parallelExecution: capabilityState(
                run.parallelExecutionCapability,
              ),
              worktreeIsolation: capabilityState(
                run.worktreeIsolationCapability,
              ),
            },
            workspace: {
              kind: run.workspaceKind ?? "undisclosed" as const,
              worktreeName: run.worktreeName,
              branch: run.branch,
            },
          };
        }),
    );
    const visibleRuns = runs.filter((run) => run !== null);
    const activeRuns = visibleRuns.filter(
      (run) =>
        run.state === "running" &&
        run.activity.kind !== "process_exited" &&
        (run.lease.status === "healthy" || run.lease.status === "expiring"),
    ).length;
    const policy = parallelExecutionPolicy(project);
    return {
      policy,
      capacity: {
        activeRuns,
        maxConcurrentRuns: policy.maxConcurrentRuns,
        remaining: Math.max(0, policy.maxConcurrentRuns - activeRuns),
      },
      runs: visibleRuns,
      serverTime,
    };
  },
});

export const getForAgent = internalQuery({
  args: { authorization: agentContextValidator, workItemId: v.id("workItems") },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:read",
    );
    const work = await ctx.db.get(args.workItemId);
    if (!work) fail("not_found", "Work item not found");
    assertSameProject(work, principal.project);
    return await workDetail(ctx, work);
  },
});

export const getByIdentifierForAgent = internalQuery({
  args: { authorization: agentContextValidator, identifier: v.string() },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:read",
    );
    const identifier = requireString(args.identifier, "identifier", 80);
    const work = await workByIdentifier(ctx, principal.project, identifier);
    if (!work) fail("not_found", "Work item not found");
    return await workDetail(ctx, work);
  },
});

export const start = internalMutation({
  args: {
    authorization: agentContextValidator,
    workItemId: v.id("workItems"),
    expectedRevision: v.number(),
    resumeRunId: v.optional(v.id("runs")),
    leaseSeconds: v.optional(v.number()),
    workspace: v.optional(workspaceValidator),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:write",
    );
    let work = await ctx.db.get(args.workItemId);
    if (!work) fail("not_found", "Work item not found");
    assertSameProject(work, principal.project);
    const now = Date.now();
    const revisionBeforeExpiry = work.revision;
    const expiredClaim = Boolean(
      work.claimedRunId && !isLeaseActive(work.claimExpiresAt, now),
    );
    work = await expireStaleWorkClaim(ctx, work, now);
    const workspace = normalizeWorkspace(args.workspace);
    return await runIdempotent(
      ctx,
      {
        organizationId: work.organizationId,
        projectId: work.projectId,
        principalKey: principal.principalKey,
        operation: "work.start",
        key: args.idempotencyKey,
        payload: {
          workItemId: args.workItemId,
          expectedRevision: args.expectedRevision,
          resumeRunId: args.resumeRunId,
          externalSessionId: args.authorization.externalSessionId,
          leaseSeconds: args.leaseSeconds,
          workspace,
        },
        now,
      },
      async () => {
        if (
          args.expectedRevision !== work.revision &&
          !(expiredClaim && args.expectedRevision === revisionBeforeExpiry)
        ) {
          assertExpectedRevision(work.revision, args.expectedRevision);
        }
        if (work.state === "done" || work.state === "cancelled") {
          fail("invalid_transition", "Closed work cannot be started");
        }
        const unresolvedAttention = await Promise.all(
          (["open", "seen"] as const).map((status) =>
            ctx.db
              .query("attentionRequests")
              .withIndex("by_work_status", (q) =>
                q.eq("workItemId", work._id).eq("status", status),
              )
              .first(),
          ),
        );
        if (unresolvedAttention.some(Boolean)) {
          fail(
            "invalid_transition",
            "Work with unresolved Attention cannot be started",
          );
        }
        if (work.claimedRunId && isLeaseActive(work.claimExpiresAt, now)) {
          fail("claim_conflict", "Work is claimed by another active Run", {
            claimExpiresAt: work.claimExpiresAt ?? null,
          });
        }
        const runningRuns = await ctx.db
          .query("runs")
          .withIndex("by_project_status", (q) =>
            q.eq("projectId", work.projectId).eq("status", "running"),
          )
          .take(100);
        const activeRuns: Array<Doc<"runs">> = [];
        for (const candidate of runningRuns) {
          const candidateWork = await ctx.db.get(candidate.workItemId);
          if (
            !candidateWork ||
            candidateWork.claimedRunId !== candidate._id ||
            !isLeaseActive(candidateWork.claimExpiresAt, now)
          ) {
            if (
              candidateWork?.claimedRunId === candidate._id &&
              !isLeaseActive(candidateWork.claimExpiresAt, now)
            ) {
              await expireStaleWorkClaim(ctx, candidateWork, now);
            }
            continue;
          }
          activeRuns.push(candidate);
        }
        const externalSessionId = args.authorization.externalSessionId;
        if (!externalSessionId) fail("validation", "externalSessionId is required");
        const sameSessionRun = activeRuns.find(
          (candidate) =>
            candidate.installationId === principal.installation._id &&
            candidate.externalSessionId === externalSessionId,
        );
        if (sameSessionRun) {
          fail(
            "session_work_limit",
            "This agent session already has active work",
            {
              activeWorkItemId: sameSessionRun.workItemId,
              retryable: false,
            },
          );
        }
        const policy = parallelExecutionPolicy(principal.project);
        const session = await ctx.db
          .query("agentSessions")
          .withIndex("by_installation_session", (q) =>
            q
              .eq("installationId", principal.installation._id)
              .eq("externalSessionId", externalSessionId),
          )
          .unique();
        const hostCapabilities = {
          parallelExecution: capabilityState(
            session?.parallelExecutionCapability,
          ),
          worktreeIsolation: capabilityState(
            session?.worktreeIsolationCapability,
          ),
        };
        if (activeRuns.length > 0) {
          if (!policy.enabled) {
            fail(
              "parallel_execution_unavailable",
              "Parallel work is disabled for this project",
              {
                reason: "project_disabled",
                retryable: false,
              },
            );
          }
          const unsafeExistingRun = activeRuns.find(
            (candidate) =>
              candidate.parallelExecutionCapability !== "supported" ||
              candidate.worktreeIsolationCapability !== "supported" ||
              candidate.workspaceKind !== "worktree",
          );
          if (unsafeExistingRun) {
            fail(
              "parallel_execution_unavailable",
              "Existing active work is not isolated for safe parallel execution",
              {
                reason: "existing_run_not_isolated",
                retryable: false,
              },
            );
          }
          if (activeRuns.length >= policy.maxConcurrentRuns) {
            fail(
              "concurrency_limit",
              "This project has reached its configured concurrent Run limit",
              {
                activeRuns: activeRuns.length,
                maxConcurrentRuns: policy.maxConcurrentRuns,
                retryable: false,
              },
            );
          }
          const unsupported = Object.values(hostCapabilities).includes("unsupported");
          const undisclosed = Object.values(hostCapabilities).includes("undisclosed");
          if (unsupported || undisclosed || workspace.kind !== "worktree") {
            fail(
              "parallel_execution_unavailable",
              unsupported
                ? "This host reports that isolated parallel work is unsupported"
                : undisclosed
                  ? "This host has not disclosed isolated parallel-work support"
                  : "Parallel work requires a separate worktree",
              {
                reason: unsupported
                  ? "host_unsupported"
                  : undisclosed
                    ? "host_undisclosed"
                    : "isolated_workspace_required",
                parallelExecutionCapability: hostCapabilities.parallelExecution,
                worktreeIsolationCapability: hostCapabilities.worktreeIsolation,
                workspaceKind: workspace.kind,
                retryable: false,
              },
            );
          }
        }
        let runId: Id<"runs">;
        if (args.resumeRunId) {
          const run = await ctx.db.get(args.resumeRunId);
          if (
            !run ||
            run.workItemId !== work._id ||
            run.installationId !== principal.installation._id ||
            run.status !== "waiting"
          ) {
            fail("invalid_transition", "Waiting Run cannot be resumed");
          }
          runId = run._id;
          await ctx.db.patch(run._id, {
            status: "running",
            externalSessionId:
              args.authorization.externalSessionId ?? run.externalSessionId,
            lastHeartbeatAt: now,
            parallelExecutionCapability: session?.parallelExecutionCapability,
            worktreeIsolationCapability: session?.worktreeIsolationCapability,
            workspaceKind: workspace.kind,
            worktreeName: workspace.worktreeName,
            branch: workspace.branch,
          });
        } else {
          runId = await ctx.db.insert("runs", {
            organizationId: work.organizationId,
            projectId: work.projectId,
            workItemId: work._id,
            actorId: principal.actor._id,
            installationId: principal.installation._id,
            status: "running",
            externalSessionId: args.authorization.externalSessionId,
            parallelExecutionCapability: session?.parallelExecutionCapability,
            worktreeIsolationCapability: session?.worktreeIsolationCapability,
            workspaceKind: workspace.kind,
            worktreeName: workspace.worktreeName,
            branch: workspace.branch,
            startedAt: now,
            lastHeartbeatAt: now,
          });
        }
        const lease = newLease(now, args.leaseSeconds);
        await ctx.db.patch(work._id, {
          state: "working",
          claimedByActorId: principal.actor._id,
          claimedByInstallationId: principal.installation._id,
          claimedRunId: runId,
          ...lease,
          revision: work.revision + 1,
          updatedAt: now,
        });
        await appendEvent(ctx, {
          organizationId: work.organizationId,
          projectId: work.projectId,
          workItemId: work._id,
          runId,
          actorId: principal.actor._id,
          type: args.resumeRunId ? "run.resumed" : "run.started",
          data: {
            claimExpiresAt: lease.claimExpiresAt,
            workspaceKind: workspace.kind,
            worktreeName: workspace.worktreeName ?? null,
            branch: workspace.branch ?? null,
          },
          requestId: principal.requestId,
          createdAt: now,
        });
        return { runId, revision: work.revision + 1, ...lease };
      },
    );
  },
});

export const update = internalMutation({
  args: {
    authorization: agentContextValidator,
    workItemId: v.id("workItems"),
    runId: v.id("runs"),
    expectedRevision: v.number(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    summary: v.optional(v.string()),
    activity: v.optional(v.object({
      kind: v.union(
        v.literal("executing"),
        v.literal("verification"),
        v.literal("release"),
        v.literal("waiting_for_resource"),
        v.literal("paused"),
      ),
      label: v.optional(v.string()),
      nextStep: v.optional(v.string()),
    })),
    artifact: v.optional(inlineArtifactValidator),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:write",
    );
    const work = await ctx.db.get(args.workItemId);
    const run = await ctx.db.get(args.runId);
    if (!work || !run) fail("not_found", "Work item or Run not found");
    assertSameProject(work, principal.project);
    const now = Date.now();
    return await runIdempotent(
      ctx,
      {
        organizationId: work.organizationId,
        projectId: work.projectId,
        principalKey: principal.principalKey,
        operation: "work.update",
        key: args.idempotencyKey,
        payload: {
          workItemId: args.workItemId,
          runId: args.runId,
          expectedRevision: args.expectedRevision,
          title: args.title,
          description: args.description,
          summary: args.summary,
          activity: args.activity,
          artifact: args.artifact,
        },
        now,
      },
      async () => {
        assertExpectedRevision(work.revision, args.expectedRevision);
        if (
          work.claimedRunId !== run._id ||
          work.claimedByInstallationId !== principal.installation._id ||
          run.installationId !== principal.installation._id ||
          run.status !== "running"
        ) {
          fail("claim_conflict", "The active Run no longer owns this WorkItem");
        }
        if (!isLeaseActive(work.claimExpiresAt, now)) {
          fail("lease_expired", "The WorkItem claim has expired");
        }
        if (
          args.title === undefined &&
          args.description === undefined &&
          args.summary === undefined &&
          args.activity === undefined &&
          args.artifact === undefined
        ) {
          fail("validation", "Update requires a changed field or progress summary");
        }
        const lease = newLease(now);
        await ctx.db.patch(work._id, {
          title:
            args.title === undefined
              ? work.title
              : requireString(args.title, "title", MAX_TITLE_LENGTH),
          description:
            args.description === undefined
              ? work.description
              : optionalString(args.description, "description", MAX_DESCRIPTION_LENGTH),
          claimExpiresAt: lease.claimExpiresAt,
          revision: work.revision + 1,
          updatedAt: now,
        });
        await ctx.db.patch(run._id, {
          summary:
            args.summary === undefined
              ? run.summary
              : optionalString(args.summary, "summary", MAX_DESCRIPTION_LENGTH),
          activityKind: args.activity?.kind ?? run.activityKind,
          activityLabel: args.activity === undefined
            ? run.activityLabel
            : optionalString(args.activity.label, "activity.label", 240),
          activityNextStep: args.activity === undefined
            ? run.activityNextStep
            : optionalString(args.activity.nextStep, "activity.nextStep", 500),
          activityUpdatedAt:
            args.activity !== undefined || args.summary !== undefined
              ? now
              : run.activityUpdatedAt,
          lastHeartbeatAt: now,
        });
        const artifactIds = args.artifact
          ? await recordInlineArtifacts(
              ctx,
              work,
              run._id,
              principal.actor._id,
              [args.artifact],
              now,
            )
          : [];
        await appendEvent(ctx, {
          organizationId: work.organizationId,
          projectId: work.projectId,
          workItemId: work._id,
          runId: run._id,
          actorId: principal.actor._id,
          type: "work.updated",
          data: {
            progress: args.summary !== undefined,
            artifactIds,
          },
          requestId: principal.requestId,
          createdAt: now,
        });
        return { revision: work.revision + 1, claimExpiresAt: lease.claimExpiresAt };
      },
    );
  },
});

export const renewClaim = internalMutation({
  args: {
    authorization: agentContextValidator,
    workItemId: v.id("workItems"),
    runId: v.id("runs"),
    expectedRevision: v.number(),
    leaseSeconds: v.optional(v.number()),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:write",
    );
    const work = await ctx.db.get(args.workItemId);
    const run = await ctx.db.get(args.runId);
    if (!work || !run) fail("not_found", "Work item or Run not found");
    assertSameProject(work, principal.project);
    const now = Date.now();
    return await runIdempotent(
      ctx,
      {
        organizationId: work.organizationId,
        projectId: work.projectId,
        principalKey: principal.principalKey,
        operation: "work.renew_claim",
        key: args.idempotencyKey,
        payload: {
          workItemId: work._id,
          runId: run._id,
          expectedRevision: args.expectedRevision,
          leaseSeconds: args.leaseSeconds,
        },
        now,
      },
      async () => {
        assertExpectedRevision(work.revision, args.expectedRevision);
        if (
          work.claimedRunId !== run._id ||
          work.claimedByInstallationId !== principal.installation._id ||
          run.installationId !== principal.installation._id ||
          run.status !== "running"
        ) {
          fail("claim_conflict", "The active Run no longer owns this WorkItem");
        }
        if (!isLeaseActive(work.claimExpiresAt, now)) {
          fail("lease_expired", "The WorkItem claim has expired");
        }
        const lease = newLease(now, args.leaseSeconds);
        await ctx.db.patch(work._id, {
          claimExpiresAt: lease.claimExpiresAt,
          revision: work.revision + 1,
          updatedAt: now,
        });
        await ctx.db.patch(run._id, { lastHeartbeatAt: now });
        await appendEvent(ctx, {
          organizationId: work.organizationId,
          projectId: work.projectId,
          workItemId: work._id,
          runId: run._id,
          actorId: principal.actor._id,
          type: "work.claim_renewed",
          data: { claimExpiresAt: lease.claimExpiresAt },
          requestId: principal.requestId,
          createdAt: now,
        });
        return {
          claimExpiresAt: lease.claimExpiresAt,
          revision: work.revision + 1,
        };
      },
    );
  },
});

export const wait = internalMutation({
  args: {
    authorization: agentContextValidator,
    workItemId: v.id("workItems"),
    runId: v.id("runs"),
    expectedRevision: v.number(),
    summary: v.optional(v.string()),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:write",
    );
    const work = await ctx.db.get(args.workItemId);
    const run = await ctx.db.get(args.runId);
    if (!work || !run) fail("not_found", "Work item or Run not found");
    assertSameProject(work, principal.project);
    const now = Date.now();
    return await runIdempotent(
      ctx,
      {
        organizationId: work.organizationId,
        projectId: work.projectId,
        principalKey: principal.principalKey,
        operation: "work.wait",
        key: args.idempotencyKey,
        payload: {
          workItemId: work._id,
          runId: run._id,
          expectedRevision: args.expectedRevision,
          summary: args.summary,
        },
        now,
      },
      async () => {
        assertExpectedRevision(work.revision, args.expectedRevision);
        if (
          work.claimedRunId !== run._id ||
          work.claimedByInstallationId !== principal.installation._id ||
          run.installationId !== principal.installation._id ||
          run.status !== "running"
        ) {
          fail("claim_conflict", "The active Run no longer owns this WorkItem");
        }
        if (!isLeaseActive(work.claimExpiresAt, now)) {
          fail("lease_expired", "The WorkItem claim has expired");
        }
        await releaseRunResourceClaims(ctx, {
          runId: run._id,
          actorId: principal.actor._id,
          now,
        });
        await ctx.db.patch(run._id, {
          status: "waiting",
          summary: optionalString(
            args.summary,
            "summary",
            MAX_DESCRIPTION_LENGTH,
          ),
          lastHeartbeatAt: now,
        });
        await ctx.db.patch(work._id, {
          claimedByActorId: undefined,
          claimedByInstallationId: undefined,
          claimedRunId: undefined,
          claimedAt: undefined,
          claimExpiresAt: undefined,
          revision: work.revision + 1,
          updatedAt: now,
        });
        await appendEvent(ctx, {
          organizationId: work.organizationId,
          projectId: work.projectId,
          workItemId: work._id,
          runId: run._id,
          actorId: principal.actor._id,
          type: "run.waiting",
          data: {},
          requestId: principal.requestId,
          createdAt: now,
        });
        return { runId: run._id, revision: work.revision + 1 };
      },
    );
  },
});

export const finish = internalMutation({
  args: {
    authorization: agentContextValidator,
    workItemId: v.id("workItems"),
    runId: v.id("runs"),
    expectedRevision: v.number(),
    result: v.union(
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    summary: v.optional(v.string()),
    failureCode: v.optional(v.string()),
    artifacts: v.optional(v.array(inlineArtifactValidator)),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:write",
    );
    const work = await ctx.db.get(args.workItemId);
    const run = await ctx.db.get(args.runId);
    if (!work || !run) fail("not_found", "Work item or Run not found");
    assertSameProject(work, principal.project);
    const now = Date.now();
    return await runIdempotent(
      ctx,
      {
        organizationId: work.organizationId,
        projectId: work.projectId,
        principalKey: principal.principalKey,
        operation: "work.finish",
        key: args.idempotencyKey,
        payload: {
          workItemId: args.workItemId,
          runId: args.runId,
          expectedRevision: args.expectedRevision,
          result: args.result,
          summary: args.summary,
          failureCode: args.failureCode,
          artifacts: args.artifacts,
        },
        now,
      },
      async () => {
        assertExpectedRevision(work.revision, args.expectedRevision);
        if (
          work.claimedRunId !== run._id ||
          work.claimedByInstallationId !== principal.installation._id ||
          run.installationId !== principal.installation._id ||
          run.status !== "running"
        ) {
          fail("claim_conflict", "The active Run no longer owns this WorkItem");
        }
        if (!isLeaseActive(work.claimExpiresAt, now)) {
          fail("lease_expired", "The WorkItem claim has expired");
        }
        await releaseRunResourceClaims(ctx, {
          runId: run._id,
          actorId: principal.actor._id,
          now,
        });
        const state =
          args.result === "completed"
            ? "done"
            : args.result === "cancelled"
              ? "cancelled"
              : "ready";
        await ctx.db.patch(run._id, {
          status: args.result,
          summary: optionalString(args.summary, "summary", MAX_DESCRIPTION_LENGTH),
          failureCode:
            args.result === "failed"
              ? optionalString(args.failureCode, "failureCode", 200) ?? "agent_failed"
              : undefined,
          lastHeartbeatAt: now,
          finishedAt: now,
        });
        await ctx.db.patch(work._id, {
          state,
          claimedByActorId: undefined,
          claimedByInstallationId: undefined,
          claimedRunId: undefined,
          claimedAt: undefined,
          claimExpiresAt: undefined,
          completedAt: state === "done" ? now : undefined,
          revision: work.revision + 1,
          updatedAt: now,
        });
        if (state === "done" || state === "cancelled") {
          await recordClosedWorkItem(ctx, work.organizationId, principal.actor._id, now);
        }
        const artifactIds = await recordInlineArtifacts(
          ctx,
          work,
          run._id,
          principal.actor._id,
          args.artifacts ?? [],
          now,
        );
        await appendEvent(ctx, {
          organizationId: work.organizationId,
          projectId: work.projectId,
          workItemId: work._id,
          runId: run._id,
          actorId: principal.actor._id,
          type:
            args.result === "completed"
              ? "work.completed"
              : args.result === "failed"
                ? "run.failed"
                : "work.cancelled",
          data: {
            state,
            failureCode: args.failureCode ?? null,
            artifactIds,
          },
          requestId: principal.requestId,
          createdAt: now,
        });
        return { workItemId: work._id, runId: run._id, state, revision: work.revision + 1 };
      },
    );
  },
});

export const reorder = mutation({
  args: {
    workItemId: v.id("workItems"),
    expectedRevision: v.number(),
    rank: v.number(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const work = await ctx.db.get(args.workItemId);
    if (!work) fail("not_found", "Work item not found");
    const principal = await requireHumanProject(ctx, work.projectId);
    const now = Date.now();
    return await runIdempotent(
      ctx,
      {
        organizationId: work.organizationId,
        projectId: work.projectId,
        principalKey: principal.principalKey,
        operation: "work.reorder",
        key: args.idempotencyKey,
        payload: args,
        now,
      },
      async () => {
        assertExpectedRevision(work.revision, args.expectedRevision);
        if (work.state !== "ready") {
          fail("invalid_transition", "Only Ready work may be reordered");
        }
        if (!Number.isFinite(args.rank)) fail("validation", "rank must be finite");
        await ctx.db.patch(work._id, {
          rank: args.rank,
          revision: work.revision + 1,
          updatedAt: now,
        });
        await appendEvent(ctx, {
          organizationId: work.organizationId,
          projectId: work.projectId,
          workItemId: work._id,
          actorId: principal.actor._id,
          type: "work.reordered",
          data: { rank: args.rank },
          createdAt: now,
        });
        return { revision: work.revision + 1, rank: args.rank };
      },
    );
  },
});

export const cancelForHuman = mutation({
  args: {
    workItemId: v.id("workItems"),
    expectedRevision: v.number(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const work = await ctx.db.get(args.workItemId);
    if (!work) fail("not_found", "Work item not found");
    const principal = await requireHumanProject(ctx, work.projectId);
    const now = Date.now();
    return await runIdempotent(
      ctx,
      {
        organizationId: work.organizationId,
        projectId: work.projectId,
        principalKey: principal.principalKey,
        operation: "work.cancel",
        key: args.idempotencyKey,
        payload: {
          workItemId: work._id,
          expectedRevision: args.expectedRevision,
        },
        now,
      },
      async () => {
        assertExpectedRevision(work.revision, args.expectedRevision);
        if (work.state === "done" || work.state === "cancelled") {
          fail("invalid_transition", "Work item is already closed");
        }
        if (work.claimedRunId) {
          const run = await ctx.db.get(work.claimedRunId);
          if (run && (run.status === "running" || run.status === "waiting")) {
            await releaseRunResourceClaims(ctx, {
              runId: run._id,
              actorId: principal.actor._id,
              now,
            });
            await ctx.db.patch(run._id, {
              status: "cancelled",
              failureCode: "cancelled_by_human",
              lastHeartbeatAt: now,
              finishedAt: now,
            });
          }
        }
        const openAttention = await Promise.all(
          (["open", "seen"] as const).map((status) =>
            ctx.db
              .query("attentionRequests")
              .withIndex("by_work_status", (q) =>
                q.eq("workItemId", work._id).eq("status", status),
              )
              .collect(),
          ),
        );
        for (const request of openAttention.flat()) {
          await ctx.db.patch(request._id, {
            status: "resolved",
            resolvedAt: now,
            resolvedByActorId: principal.actor._id,
            resolutionKind: "cancelled",
          });
        }
        await ctx.db.patch(work._id, {
          state: "cancelled",
          claimedByActorId: undefined,
          claimedByInstallationId: undefined,
          claimedRunId: undefined,
          claimedAt: undefined,
          claimExpiresAt: undefined,
          completedAt: undefined,
          revision: work.revision + 1,
          updatedAt: now,
        });
        await recordClosedWorkItem(ctx, work.organizationId, principal.actor._id, now);
        await appendEvent(ctx, {
          organizationId: work.organizationId,
          projectId: work.projectId,
          workItemId: work._id,
          actorId: principal.actor._id,
          type: "work.cancelled",
          data: {},
          createdAt: now,
        });
        return {
          workItemId: work._id,
          state: "cancelled" as const,
          revision: work.revision + 1,
        };
      },
    );
  },
});

export const closeForHuman = mutation({
  args: {
    workItemId: v.id("workItems"),
    expectedRevision: v.number(),
    outcome: v.union(v.literal("completed"), v.literal("cancelled")),
    reason: closureReasonValidator,
    note: v.optional(v.string()),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const work = await ctx.db.get(args.workItemId);
    if (!work) fail("not_found", "Work item not found");
    const principal = await requireHumanProject(ctx, work.projectId);
    const note = optionalString(args.note, "note", 2_000);
    if ((args.outcome === "completed") !== (args.reason === "completed")) {
      fail("validation", "Completed work must use the completed reason");
    }
    const now = Date.now();
    return await runIdempotent(ctx, {
      organizationId: work.organizationId,
      projectId: work.projectId,
      principalKey: principal.principalKey,
      operation: "work.close_for_human",
      key: args.idempotencyKey,
      payload: { workItemId: work._id, expectedRevision: args.expectedRevision, outcome: args.outcome, reason: args.reason, note },
      now,
    }, async () => {
      assertExpectedRevision(work.revision, args.expectedRevision);
      if (work.state === "done" || work.state === "cancelled") {
        fail("invalid_transition", "Work item is already closed");
      }
      if (args.outcome === "completed" && work.state !== "ready") {
        fail("invalid_transition", "Active work must be cancelled or completed by its agent");
      }
      if (work.claimedRunId) {
        const run = await ctx.db.get(work.claimedRunId);
        if (run && (run.status === "running" || run.status === "waiting")) {
          await releaseRunResourceClaims(ctx, {
            runId: run._id,
            actorId: principal.actor._id,
            now,
          });
          await ctx.db.patch(run._id, {
            status: "cancelled",
            summary: note,
            failureCode: "cancelled_by_human",
            lastHeartbeatAt: now,
            finishedAt: now,
          });
        }
      }
      const openAttention = (await Promise.all(
        (["open", "seen"] as const).map((status) => ctx.db
          .query("attentionRequests")
          .withIndex("by_work_status", (q) => q.eq("workItemId", work._id).eq("status", status))
          .collect()),
      )).flat();
      for (const request of openAttention) {
        await ctx.db.patch(request._id, {
          status: "resolved",
          resolvedAt: now,
          resolvedByActorId: principal.actor._id,
          resolutionKind: args.outcome === "cancelled" ? "cancelled" : "resolved",
        });
      }
      const runnerJobs = await ctx.db.query("runnerJobs")
        .withIndex("by_project_work_requested", (q) => q.eq("projectId", work.projectId).eq("workItemId", work._id))
        .take(100);
      for (const job of runnerJobs) {
        if (["cancelled", "failed", "completed", "expired", "cancel_requested"].includes(job.state)) continue;
        const state = job.state === "queued" ? "cancelled" as const : "cancel_requested" as const;
        await ctx.db.patch(job._id, {
          state,
          revision: job.revision + 1,
          cancellationRequestedAt: now,
          terminalAt: state === "cancelled" ? now : undefined,
          updatedAt: now,
        });
        await ctx.db.insert("runnerJobEvents", {
          organizationId: job.organizationId,
          projectId: job.projectId,
          jobId: job._id,
          registrationId: job.registrationId,
          actorId: principal.actor._id,
          sequence: job.revision + 1,
          state,
          safeCode: "user_cancelled",
          createdAt: now,
        });
      }
      const state = args.outcome === "completed" ? "done" as const : "cancelled" as const;
      await ctx.db.patch(work._id, {
        state,
        claimedByActorId: undefined,
        claimedByInstallationId: undefined,
        claimedRunId: undefined,
        claimedAt: undefined,
        claimExpiresAt: undefined,
        completedAt: state === "done" ? now : undefined,
        closureReason: args.reason,
        closureNote: note,
        closedByActorId: principal.actor._id,
        closedAt: now,
        revision: work.revision + 1,
        updatedAt: now,
      });
      await recordClosedWorkItem(ctx, work.organizationId, principal.actor._id, now);
      await appendEvent(ctx, {
        organizationId: work.organizationId,
        projectId: work.projectId,
        workItemId: work._id,
        actorId: principal.actor._id,
        type: state === "done" ? "work.completed" : "work.cancelled",
        data: { reason: args.reason, note: note ?? null, source: "human" },
        createdAt: now,
      });
      return { workItemId: work._id, state, revision: work.revision + 1 };
    });
  },
});

export const reconcileExpiredClaims = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("workItems")
      .withIndex("by_claim_expiry", (q) =>
        q.gt("claimExpiresAt", 0).lte("claimExpiresAt", now),
      )
      .take(Math.max(1, Math.min(args.limit ?? 100, 200)));
    let reconciled = 0;
    for (const work of expired) {
      if (!work.claimedRunId) continue;
      await expireStaleWorkClaim(ctx, work, now);
      reconciled += 1;
    }
    return { reconciled };
  },
});
