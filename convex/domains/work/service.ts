import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { assertSameProject } from "../../lib/authz";
import { appendEvent } from "../../lib/events";
import { fail, optionalString, requireString } from "../../lib/errors";
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_TITLE_LENGTH,
} from "../../lib/validators";
import {
  canonicalWorkIdentifier,
  compactIdentifierPrefix,
  legacyWorkIdentifiers,
  MAX_WORK_SEQUENCE,
} from "./identifiers";
import {
  totalWorkItemLimit,
  workCapacitySource,
} from "../../lib/plans";
import { measureOrganizationWorkItems } from "../../lib/workUsage";

export type NewWorkInput = {
  title: string;
  description?: string;
  context?: string;
  links?: string[];
  kind: "task" | "bug" | "feature" | "investigation" | "decision";
  parentId?: Id<"workItems">;
};

async function accountableProfileId(
  ctx: Pick<MutationCtx, "db">,
  actorId: Id<"actors">,
): Promise<Id<"humanProfiles"> | undefined> {
  const actor = await ctx.db.get(actorId);
  if (!actor) return undefined;
  if (actor.type === "human") return actor.profileId;
  if (!actor.installationId) return undefined;
  const installation = await ctx.db.get(actor.installationId);
  return installation?.organizationId === actor.organizationId
    ? installation.authorizedByProfileId
    : undefined;
}

async function incrementProfileUsage(
  ctx: Pick<MutationCtx, "db">,
  actorId: Id<"actors">,
  field: "createdWorkItemCount" | "closedWorkItemCount",
  now: number,
): Promise<void> {
  const profileId = await accountableProfileId(ctx, actorId);
  if (!profileId) return;
  const profile = await ctx.db.get(profileId);
  if (!profile) return;
  await ctx.db.patch(profile._id, {
    [field]: (profile[field] ?? 0) + 1,
    usageTrackingStartedAt: profile.usageTrackingStartedAt ?? now,
    updatedAt: now,
  });
}

export async function recordClosedWorkItem(
  ctx: Pick<MutationCtx, "db">,
  organizationId: Id<"organizations">,
  actorId: Id<"actors">,
  now: number,
): Promise<void> {
  const organization = await ctx.db.get(organizationId);
  if (!organization) fail("not_found", "Organization not found");
  await ctx.db.patch(organization._id, {
    closedWorkItemCount: (organization.closedWorkItemCount ?? 0) + 1,
    usageTrackingStartedAt: organization.usageTrackingStartedAt ?? now,
    updatedAt: now,
  });
  await incrementProfileUsage(ctx, actorId, "closedWorkItemCount", now);
}

const MAX_WORK_LINKS = 100;
const MAX_WORK_LINK_LENGTH = 2_048;
export const MAX_CHILD_WORK_ITEMS = 100;

function normalizedWorkLinks(values: string[] | undefined): string[] | undefined {
  if (values === undefined) return undefined;
  if (values.length > MAX_WORK_LINKS) {
    fail("validation", `Work may include at most ${MAX_WORK_LINKS} links`);
  }
  const links = values.map((value, index) => {
    const raw = requireString(value, `links[${index}]`, MAX_WORK_LINK_LENGTH);
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      fail("validation", `links[${index}] must be a valid URL`);
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      fail("validation", `links[${index}] must use HTTP or HTTPS`);
    }
    return parsed.toString();
  });
  return [...new Set(links)];
}

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
  const organization = await ctx.db.get(project.organizationId);
  if (!organization) fail("not_found", "Organization not found");
  const workLimit = totalWorkItemLimit(
    organization.plan,
    organization.totalWorkItemLimitOverride,
  );
  let existingWorkItemCount = organization.workItemCountState
    ? organization.createdWorkItemCount
    : undefined;
  let workItemCountState = organization.workItemCountState;
  if (workLimit !== undefined) {
    if (existingWorkItemCount === undefined) {
      const measurement = await measureOrganizationWorkItems(ctx, organization._id);
      existingWorkItemCount = measurement.count;
      workItemCountState = measurement.state;
    }
    if (existingWorkItemCount >= workLimit) {
      fail(
        "plan_limit",
        `This organization has reached its ${workLimit}-Work-item allowance. Review plan options or ask a dongo operator to adjust the limit.`,
        {
          resource: "total_work_items",
          plan: organization.plan,
          source: workCapacitySource(organization.totalWorkItemLimitOverride),
          totalWorkItemCount: existingWorkItemCount,
          limit: workLimit,
          remaining: 0,
          retryable: false,
          actions: ["upgrade", "contact_operator"],
        },
      );
    }
  }
  if (options.input.parentId) {
    const parent = await ctx.db.get(options.input.parentId);
    if (!parent) fail("not_found", "Parent work item not found");
    assertSameProject(parent, project);
    if (parent.parentId) {
      fail("validation", "A child WorkItem cannot have children");
    }
    if (parent.state === "done" || parent.state === "cancelled") {
      fail("validation", "Closed Work cannot receive new children");
    }
    const children = await ctx.db
      .query("workItems")
      .withIndex("by_parent", (query) => query.eq("parentId", parent._id))
      .take(MAX_CHILD_WORK_ITEMS);
    if (children.length >= MAX_CHILD_WORK_ITEMS) {
      fail(
        "quota_exceeded",
        `A WorkItem may have at most ${MAX_CHILD_WORK_ITEMS} children`,
        { maxChildren: MAX_CHILD_WORK_ITEMS },
      );
    }
  }
  const actor = await ctx.db.get(options.actorId);
  if (!actor || actor.organizationId !== project.organizationId) {
    fail("forbidden", "Actor does not belong to this project");
  }
  const number = project.nextWorkNumber;
  if (!Number.isSafeInteger(number) || number < 1) {
    fail("identifier_conflict", "The project work sequence is invalid", {
      nextSequence: number,
    });
  }
  if (number > MAX_WORK_SEQUENCE) {
    fail(
      "identifier_exhausted",
      "This project has used all 999 work identifiers",
      {
        maxSequence: MAX_WORK_SEQUENCE,
        nextSequence: number,
        action: "use_another_project",
      },
    );
  }
  const identifier = canonicalWorkIdentifier(project, number);
  const [numberCollision, identifierCollision] = await Promise.all([
    ctx.db
      .query("workItems")
      .withIndex("by_project_number", (q) =>
        q.eq("projectId", project._id).eq("number", number),
      )
      .unique(),
    ctx.db
      .query("workItems")
      .withIndex("by_project_identifier", (q) =>
        q.eq("projectId", project._id).eq("identifier", identifier),
      )
      .unique(),
  ]);
  if (numberCollision || identifierCollision) {
    fail("identifier_conflict", "The next work identifier is already in use", {
      identifier,
      sequence: number,
    });
  }
  const legacyIdentifiers = legacyWorkIdentifiers(project, {
    identifier,
    number,
  });
  await ctx.db.patch(project._id, {
    compactIdentifierPrefix: compactIdentifierPrefix(project),
    nextWorkNumber: number + 1,
    updatedAt: options.now,
  });
  await ctx.db.patch(organization._id, {
    ...(workItemCountState
      ? {
          createdWorkItemCount: workItemCountState === "exact"
            ? (existingWorkItemCount ?? 0) + 1
            : existingWorkItemCount,
          workItemCountState,
        }
      : {}),
    usageTrackingStartedAt: organization.usageTrackingStartedAt ?? options.now,
    updatedAt: options.now,
  });
  await incrementProfileUsage(
    ctx,
    options.actorId,
    "createdWorkItemCount",
    options.now,
  );
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
    context: optionalString(
      options.input.context,
      "context",
      MAX_DESCRIPTION_LENGTH,
    ),
    links: normalizedWorkLinks(options.input.links),
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
    data: {
      identifier,
      legacyIdentifiers,
      kind: options.input.kind,
      parentId: options.input.parentId ?? null,
    },
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
