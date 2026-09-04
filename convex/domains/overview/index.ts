import { v } from "convex/values";
import { internalQuery, query } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { agentContextValidator } from "../../lib/validators";
import {
  requireCurrentProfile,
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
const CROSS_PROJECT_ORGANIZATION_LIMIT = 20;
const CROSS_PROJECT_PROJECT_LIMIT = 24;
const CROSS_PROJECT_WORKING_CANDIDATE_LIMIT = 12;

async function crossProjectPriority(
  ctx: QueryCtx,
  project: Doc<"projects">,
  profileId: Id<"humanProfiles">,
) {
  const now = Date.now();
  const [openAttention, seenAttention, activeWorking, workingCandidates, ready, newIntake, claimedIntake] =
    await Promise.all([
      ctx.db
        .query("attentionRequests")
        .withIndex("by_project_profile_status_created", (q) =>
          q
            .eq("projectId", project._id)
            .eq("requestedFromProfileId", profileId)
            .eq("status", "open"),
        )
        .order("desc")
        .first(),
      ctx.db
        .query("attentionRequests")
        .withIndex("by_project_profile_status_created", (q) =>
          q
            .eq("projectId", project._id)
            .eq("requestedFromProfileId", profileId)
            .eq("status", "seen"),
        )
        .order("desc")
        .first(),
      ctx.db
        .query("workItems")
        .withIndex("by_project_claim_expiry", (q) =>
          q.eq("projectId", project._id).gt("claimExpiresAt", now),
        )
        .first(),
      ctx.db
        .query("workItems")
        .withIndex("by_project_state_updated", (q) =>
          q.eq("projectId", project._id).eq("state", "working"),
        )
        .order("desc")
        .take(CROSS_PROJECT_WORKING_CANDIDATE_LIMIT),
      ctx.db
        .query("workItems")
        .withIndex("by_project_state_rank", (q) =>
          q.eq("projectId", project._id).eq("state", "ready"),
        )
        .order("asc")
        .first(),
      ctx.db
        .query("intakes")
        .withIndex("by_project_status_created", (q) =>
          q.eq("projectId", project._id).eq("status", "new"),
        )
        .order("desc")
        .first(),
      ctx.db
        .query("intakes")
        .withIndex("by_project_status_created", (q) =>
          q.eq("projectId", project._id).eq("status", "claimed"),
        )
        .order("desc")
        .first(),
    ]);

  const attention = [openAttention, seenAttention]
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    .sort((left, right) => right.createdAt - left.createdAt)[0];
  if (attention) {
    const [work, intake] = await Promise.all([
      attention.workItemId ? ctx.db.get(attention.workItemId) : null,
      attention.intakeId ? ctx.db.get(attention.intakeId) : null,
    ]);
    return {
      kind: "needs_you" as const,
      title: attention.title,
      updatedAt: attention.createdAt,
      target: work && work.projectId === project._id
        ? {
            kind: "work" as const,
            id: work._id,
            identifier: workSummaryForHuman(work, project).identifier,
          }
        : intake && intake.projectId === project._id
          ? { kind: "intake" as const, id: intake._id }
          : { kind: "overview" as const },
    };
  }

  if (activeWorking?.state === "working" && activeWorking.claimedRunId !== undefined) {
    return {
      kind: "working" as const,
      title: activeWorking.title,
      updatedAt: activeWorking.updatedAt,
      target: {
        kind: "work" as const,
        id: activeWorking._id,
        identifier: workSummaryForHuman(activeWorking, project).identifier,
      },
    };
  }

  const staleWorking = workingCandidates
    .filter((work) =>
      work.claimedRunId === undefined ||
      work.claimExpiresAt === undefined ||
      work.claimExpiresAt <= now,
    )
    .sort((left, right) => left.rank - right.rank)[0];
  const nextReady = [ready, staleWorking]
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    .sort((left, right) => left.rank - right.rank || left.number - right.number)[0];
  if (nextReady) {
    return {
      kind: "ready" as const,
      title: nextReady.title,
      updatedAt: nextReady.updatedAt,
      target: {
        kind: "work" as const,
        id: nextReady._id,
        identifier: workSummaryForHuman(nextReady, project).identifier,
      },
    };
  }

  const intake = [newIntake, claimedIntake]
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    .sort((left, right) => right.createdAt - left.createdAt)[0];
  if (intake) {
    const firstAttachment = intake.text?.trim()
      ? null
      : await ctx.db
          .query("attachments")
          .withIndex("by_intake", (q) => q.eq("intakeId", intake._id))
          .filter((q) => q.eq(q.field("status"), "available"))
          .first();
    return {
      kind: "inbox" as const,
      title: intakeSummaryForHuman(intake, firstAttachment).displayLabel,
      updatedAt: intake.updatedAt,
      target: { kind: "intake" as const, id: intake._id },
    };
  }

  return null;
}

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

export const getAcrossProjectsForHuman = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireCurrentProfile(ctx);
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .take(CROSS_PROJECT_ORGANIZATION_LIMIT + 1);
    const organizations = [];
    let remainingProjects = CROSS_PROJECT_PROJECT_LIMIT;
    let truncated = memberships.length > CROSS_PROJECT_ORGANIZATION_LIMIT;

    for (const membership of memberships.slice(0, CROSS_PROJECT_ORGANIZATION_LIMIT)) {
      if (remainingProjects === 0) {
        truncated = true;
        break;
      }
      const organization = await ctx.db.get(membership.organizationId);
      if (!organization) continue;
      const projects = await ctx.db
        .query("projects")
        .withIndex("by_organization_archived", (q) =>
          q.eq("organizationId", organization._id).eq("archivedAt", undefined),
        )
        .take(remainingProjects + 1);
      if (projects.length > remainingProjects) truncated = true;
      const boundedProjects = projects.slice(0, remainingProjects);
      remainingProjects -= boundedProjects.length;
      const enabled = organization.plan === "paid";
      organizations.push({
        organization: {
          id: organization._id,
          name: organization.name,
          slug: organization.slug,
          plan: organization.plan,
        },
        membershipRole: membership.role,
        crossProjectOverview: {
          enabled,
          source: "plan" as const,
        },
        projects: await Promise.all(
          boundedProjects.map(async (project) => ({
            project: {
              id: project._id,
              name: project.name,
              slug: project.slug,
              publicRef: project.publicRef,
            },
            priority: enabled
              ? await crossProjectPriority(ctx, project, profile._id)
              : null,
          })),
        ),
      });
    }

    return {
      generatedAt: Date.now(),
      limits: {
        organizations: CROSS_PROJECT_ORGANIZATION_LIMIT,
        projects: CROSS_PROJECT_PROJECT_LIMIT,
      },
      truncated,
      organizations: organizations
        .sort((left, right) => left.organization.name.localeCompare(right.organization.name))
        .map((organization) => ({
          ...organization,
          projects: organization.projects.sort((left, right) =>
            left.project.name.localeCompare(right.project.name),
          ),
        })),
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
