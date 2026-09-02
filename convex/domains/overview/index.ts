import { v } from "convex/values";
import { internalQuery, query } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { agentContextValidator } from "../../lib/validators";
import {
  requireHumanProject,
  resolveAgentPrincipal,
} from "../../lib/authz";
import { attachmentSummary } from "../attachments/summary";
import { intakeForAgent } from "../agent/privacy";
import {
  actorSummaryForHumanWithInstallation,
  attentionSummaryForHuman,
  intakeSummaryForHuman,
  runSummaryForHuman,
  workSummaryForHuman,
} from "../human/summary";

const OVERVIEW_SECTION_LIMIT = 50;

async function enrichWorking(ctx: QueryCtx, work: Doc<"workItems">) {
  const [run, actor] = await Promise.all([
    work.claimedRunId ? ctx.db.get(work.claimedRunId) : null,
    work.claimedByActorId ? ctx.db.get(work.claimedByActorId) : null,
  ]);
  return { work, run, actor };
}

export async function buildOverview(
  ctx: QueryCtx,
  project: Doc<"projects">,
  profileId?: Id<"humanProfiles">,
) {
  const now = Date.now();
  const attentionBatches = profileId
    ? await Promise.all(
        (["open", "seen"] as const).map((status) =>
          ctx.db
            .query("attentionRequests")
            .withIndex("by_project_profile_status_created", (q) =>
              q
                .eq("projectId", project._id)
                .eq("requestedFromProfileId", profileId)
                .eq("status", status),
            )
            .order("desc")
            .take(OVERVIEW_SECTION_LIMIT),
        ),
      )
    : await Promise.all(
        (["open", "seen"] as const).map((status) =>
          ctx.db
            .query("attentionRequests")
            .withIndex("by_project_status_created", (q) =>
              q.eq("projectId", project._id).eq("status", status),
            )
            .order("desc")
            .take(OVERVIEW_SECTION_LIMIT),
        ),
      );
  const attention = attentionBatches
    .flat()
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, OVERVIEW_SECTION_LIMIT);
  const attentionWorkIds = new Set(
    attention.flatMap((item) => item.workItemId ? [item.workItemId] : []),
  );

  const [workingCandidates, readyItems, newIntakes, claimedIntakes, cancelledItems, doneItems] =
    await Promise.all([
      ctx.db
        .query("workItems")
        .withIndex("by_project_state_updated", (q) =>
          q.eq("projectId", project._id).eq("state", "working"),
        )
        .order("desc")
        .take(OVERVIEW_SECTION_LIMIT * 2),
      ctx.db
        .query("workItems")
        .withIndex("by_project_state_rank", (q) =>
          q.eq("projectId", project._id).eq("state", "ready"),
        )
        .order("asc")
        .take(OVERVIEW_SECTION_LIMIT * 2),
      ctx.db
        .query("intakes")
        .withIndex("by_project_status_created", (q) =>
          q.eq("projectId", project._id).eq("status", "new"),
        )
        .order("desc")
        .take(OVERVIEW_SECTION_LIMIT),
      ctx.db
        .query("intakes")
        .withIndex("by_project_status_created", (q) =>
          q.eq("projectId", project._id).eq("status", "claimed"),
        )
        .order("desc")
        .take(OVERVIEW_SECTION_LIMIT),
      ctx.db
        .query("workItems")
        .withIndex("by_project_state_updated", (q) =>
          q.eq("projectId", project._id).eq("state", "cancelled"),
        )
        .order("desc")
        .take(OVERVIEW_SECTION_LIMIT),
      ctx.db
        .query("workItems")
        .withIndex("by_project_state_updated", (q) =>
          q.eq("projectId", project._id).eq("state", "done"),
        )
        .order("desc")
        .take(OVERVIEW_SECTION_LIMIT),
    ]);

  const activeWorking = workingCandidates.filter(
    (work) =>
      work.claimedRunId !== undefined &&
      work.claimExpiresAt !== undefined &&
      work.claimExpiresAt > now,
  );
  const staleWorking = workingCandidates.filter(
    (work) =>
      work.claimedRunId === undefined ||
      work.claimExpiresAt === undefined ||
      work.claimExpiresAt <= now,
  );
  const working = await Promise.all(
    activeWorking
      .filter((work) => !attentionWorkIds.has(work._id))
      .slice(0, OVERVIEW_SECTION_LIMIT)
      .map((work) => enrichWorking(ctx, work)),
  );
  const ready = [...readyItems, ...staleWorking]
    .filter((work) => !attentionWorkIds.has(work._id))
    .sort((left, right) => left.rank - right.rank || left.number - right.number)
    .slice(0, OVERVIEW_SECTION_LIMIT)
    .map((work) => ({
      work,
      effectiveState: "ready" as const,
      staleClaim: work.state === "working",
    }));
  const inboxCandidates = [...newIntakes, ...claimedIntakes]
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, OVERVIEW_SECTION_LIMIT);
  const inbox = await Promise.all(
    inboxCandidates.map(async (intake) => ({
      intake,
      staleClaim:
        intake.status === "claimed" &&
        (intake.claimExpiresAt === undefined || intake.claimExpiresAt <= now),
      attachments: await ctx.db
        .query("attachments")
        .withIndex("by_intake", (q) => q.eq("intakeId", intake._id))
        .take(20)
        .then((attachments) => attachments
          .filter((attachment) => attachment.status === "available")
          .map(attachmentSummary)),
    })),
  );
  const needsYou = await Promise.all(
    attention.map(async (request) => {
      const [work, actor] = await Promise.all([
        request.workItemId ? ctx.db.get(request.workItemId) : null,
        ctx.db.get(request.requestedByActorId),
      ]);
      return { request, work, actor };
    }),
  );
  return {
    project,
    generatedAt: now,
    needsYou,
    working,
    ready,
    inbox,
    recentlyDone: [...doneItems, ...cancelledItems]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, OVERVIEW_SECTION_LIMIT),
  };
}

export const getForHuman = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const principal = await requireHumanProject(ctx, args.projectId, {
      allowArchived: true,
    });
    const snapshot = await buildOverview(
      ctx,
      principal.project!,
      principal.profile._id,
    );
    const [needsYou, working] = await Promise.all([
      Promise.all(snapshot.needsYou.map(async ({ request, work, actor }) => ({
        request: attentionSummaryForHuman(request),
        work: work ? workSummaryForHuman(work, snapshot.project) : null,
        actor: actor
          ? await actorSummaryForHumanWithInstallation(ctx, actor)
          : null,
      }))),
      Promise.all(snapshot.working.map(async ({ work, run, actor }) => ({
        work: workSummaryForHuman(work, snapshot.project),
        run: run ? runSummaryForHuman(run) : null,
        actor: actor
          ? await actorSummaryForHumanWithInstallation(ctx, actor)
          : null,
      }))),
    ]);
    return {
      project: {
        _id: snapshot.project._id,
        name: snapshot.project.name,
        publicRef: snapshot.project.publicRef,
      },
      generatedAt: snapshot.generatedAt,
      needsYou,
      working,
      ready: snapshot.ready.map(({ work, effectiveState, staleClaim }) => ({
        work: workSummaryForHuman(work, snapshot.project),
        effectiveState,
        staleClaim,
      })),
      inbox: snapshot.inbox.map(({ intake, attachments, staleClaim }) => ({
        intake: intakeSummaryForHuman(intake, attachments[0]),
        attachments,
        staleClaim,
      })),
      recentlyDone: snapshot.recentlyDone.map((work) =>
        workSummaryForHuman(work, snapshot.project),
      ),
    };
  },
});

export const getForAgent = internalQuery({
  args: { authorization: agentContextValidator },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:read",
    );
    const snapshot = await buildOverview(ctx, principal.project);
    return {
      ...snapshot,
      inbox: snapshot.inbox.map(({ intake, ...item }) => ({
        ...item,
        intake: intakeForAgent(intake),
      })),
    };
  },
});
