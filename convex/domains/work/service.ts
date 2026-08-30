import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { assertSameProject } from "../../lib/authz";
import { appendEvent } from "../../lib/events";
import { fail, optionalString, requireString } from "../../lib/errors";
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_TITLE_LENGTH,
} from "../../lib/validators";

export type NewWorkInput = {
  title: string;
  description?: string;
  kind: "task" | "bug" | "feature" | "investigation" | "decision";
  parentId?: Id<"workItems">;
};

export async function createWorkItem(
  ctx: MutationCtx,
  options: {
    projectId: Id<"projects">;
    actorId: Id<"actors">;
    input: NewWorkInput;
    now: number;
    requestId?: string;
  },
): Promise<Id<"workItems">> {
  const project = await ctx.db.get(options.projectId);
  if (!project || project.archivedAt !== undefined) {
    fail("not_found", "Project not found");
  }
  if (options.input.parentId) {
    const parent = await ctx.db.get(options.input.parentId);
    if (!parent) fail("not_found", "Parent work item not found");
    assertSameProject(parent, project);
  }
  const actor = await ctx.db.get(options.actorId);
  if (!actor || actor.organizationId !== project.organizationId) {
    fail("forbidden", "Actor does not belong to this project");
  }
  const number = project.nextWorkNumber;
  const identifier = `${project.identifierPrefix}-${number}`;
  await ctx.db.patch(project._id, {
    nextWorkNumber: number + 1,
    updatedAt: options.now,
  });
  const workItemId = await ctx.db.insert("workItems", {
    organizationId: project.organizationId,
    projectId: project._id,
    number,
    identifier,
    title: requireString(options.input.title, "title", MAX_TITLE_LENGTH),
    description: optionalString(
      options.input.description,
      "description",
      MAX_DESCRIPTION_LENGTH,
    ),
    kind: options.input.kind,
    state: "ready",
    rank: number * 1_024,
    createdByActorId: options.actorId,
    parentId: options.input.parentId,
    revision: 1,
    createdAt: options.now,
    updatedAt: options.now,
  });
  await appendEvent(ctx, {
    organizationId: project.organizationId,
    projectId: project._id,
    workItemId,
    actorId: options.actorId,
    type: "work.created",
    data: { identifier, kind: options.input.kind },
    requestId: options.requestId,
    createdAt: options.now,
  });
  return workItemId;
}

export async function linkIntakeToWork(
  ctx: MutationCtx,
  options: {
    intakeId: Id<"intakes">;
    workItemId: Id<"workItems">;
    relation: "created" | "linked" | "duplicate";
    now: number;
  },
): Promise<void> {
  const intake = await ctx.db.get(options.intakeId);
  const work = await ctx.db.get(options.workItemId);
  if (
    !intake ||
    !work ||
    intake.organizationId !== work.organizationId ||
    intake.projectId !== work.projectId
  ) {
    fail("not_found", "Intake or work item not found");
  }
  const existing = await ctx.db
    .query("intakeWorkLinks")
    .withIndex("by_intake_work", (query) =>
      query
        .eq("intakeId", options.intakeId)
        .eq("workItemId", options.workItemId),
    )
    .unique();
  if (!existing) {
    await ctx.db.insert("intakeWorkLinks", {
      organizationId: intake.organizationId,
      projectId: intake.projectId,
      intakeId: intake._id,
      workItemId: work._id,
      relation: options.relation,
      createdAt: options.now,
    });
  }
}

export async function pauseRunForAttention(
  ctx: MutationCtx,
  options: {
    workItemId: Id<"workItems">;
    runId: Id<"runs">;
    installationId: Id<"installations">;
    now: number;
  },
): Promise<number> {
  const work = await ctx.db.get(options.workItemId);
  const run = await ctx.db.get(options.runId);
  if (
    !work ||
    !run ||
    run.workItemId !== work._id ||
    run.installationId !== options.installationId ||
    work.claimedRunId !== run._id ||
    work.claimedByInstallationId !== options.installationId ||
    run.status !== "running"
  ) {
    fail("claim_conflict", "The active Run no longer owns this WorkItem");
  }
  if (work.claimExpiresAt === undefined || work.claimExpiresAt <= options.now) {
    fail("lease_expired", "The WorkItem claim has expired");
  }
  await ctx.db.patch(run._id, {
    status: "waiting",
    lastHeartbeatAt: options.now,
  });
  await ctx.db.patch(work._id, {
    state: "ready",
    claimedByActorId: undefined,
    claimedByInstallationId: undefined,
    claimedRunId: undefined,
    claimedAt: undefined,
    claimExpiresAt: undefined,
    revision: work.revision + 1,
    updatedAt: options.now,
  });
  return work.revision + 1;
}
