import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { requireSystemActor } from "./authz";
import { appendEvent } from "./events";
import { fail } from "./errors";
import { activeProjectLimit, totalWorkItemLimit } from "./plans";

export type AllowanceOverrideUpdate = {
  activeProjectLimitOverride?: number;
  totalWorkItemLimitOverride?: number;
  expectedProjectCapacityRevision?: number;
  expectedWorkCapacityRevision?: number;
  reason: string;
  requestId: string;
  operatorProfileId?: Id<"humanProfiles">;
  targetProfileId?: Id<"humanProfiles">;
  activeProjectCount?: number;
  totalWorkItemCount?: number;
};

export async function updateOrganizationAllowanceOverrides(
  ctx: MutationCtx,
  organization: Doc<"organizations">,
  update: AllowanceOverrideUpdate,
): Promise<{ organization: Doc<"organizations">; changed: boolean }> {
  const changesProjects = update.expectedProjectCapacityRevision !== undefined;
  const changesWork = update.expectedWorkCapacityRevision !== undefined;
  if (!changesProjects && !changesWork) {
    fail("validation", "At least one allowance revision is required");
  }
  const projectRevision = organization.projectCapacityRevision ?? 0;
  const workRevision = organization.workCapacityRevision ?? 0;
  const projectChanged = changesProjects &&
    organization.activeProjectLimitOverride !== update.activeProjectLimitOverride;
  const workChanged = changesWork &&
    organization.totalWorkItemLimitOverride !== update.totalWorkItemLimitOverride;
  if (projectChanged) {
    const expectedRevision = update.expectedProjectCapacityRevision;
    if (expectedRevision === undefined) {
      fail("validation", "Project capacity revision is required");
    }
    if (expectedRevision !== projectRevision) {
      fail("revision_conflict", "Project capacity changed; inspect it before retrying", {
        expectedRevision,
        currentRevision: projectRevision,
        resource: "active_projects",
      });
    }
  }
  if (workChanged) {
    const expectedRevision = update.expectedWorkCapacityRevision;
    if (expectedRevision === undefined) {
      fail("validation", "Work capacity revision is required");
    }
    if (expectedRevision !== workRevision) {
      fail("revision_conflict", "Work capacity changed; inspect it before retrying", {
        expectedRevision,
        currentRevision: workRevision,
        resource: "total_work_items",
      });
    }
  }
  if (!projectChanged && !workChanged) {
    return { organization, changed: false };
  }
  const now = Date.now();
  await ctx.db.patch(organization._id, {
    ...(projectChanged
      ? {
          activeProjectLimitOverride: update.activeProjectLimitOverride,
          projectCapacityRevision: projectRevision + 1,
        }
      : {}),
    ...(workChanged
      ? {
          totalWorkItemLimitOverride: update.totalWorkItemLimitOverride,
          workCapacityRevision: workRevision + 1,
        }
      : {}),
    updatedAt: now,
  });
  const systemActor = await requireSystemActor(ctx, organization._id);
  await appendEvent(ctx, {
    organizationId: organization._id,
    actorId: systemActor._id,
    type: "organization.allowances_changed",
    data: {
      operator: update.operatorProfileId ? "super_admin" : "deployment",
      ...(update.operatorProfileId
        ? { operatorProfileId: update.operatorProfileId }
        : {}),
      ...(update.targetProfileId ? { targetProfileId: update.targetProfileId } : {}),
      reason: update.reason,
      before: {
        activeProjectLimit: activeProjectLimit(
          organization.plan,
          organization.activeProjectLimitOverride,
        ),
        totalWorkItemLimit: totalWorkItemLimit(
          organization.plan,
          organization.totalWorkItemLimitOverride,
        ),
      },
      after: {
        activeProjectLimit: activeProjectLimit(
          organization.plan,
          projectChanged
            ? update.activeProjectLimitOverride
            : organization.activeProjectLimitOverride,
        ),
        totalWorkItemLimit: totalWorkItemLimit(
          organization.plan,
          workChanged
            ? update.totalWorkItemLimitOverride
            : organization.totalWorkItemLimitOverride,
        ),
      },
      ...(update.activeProjectCount === undefined
        ? {}
        : { activeProjectCount: update.activeProjectCount }),
      ...(update.totalWorkItemCount === undefined
        ? {}
        : { totalWorkItemCount: update.totalWorkItemCount }),
    },
    requestId: update.requestId,
    createdAt: now,
  });
  return { organization: (await ctx.db.get(organization._id))!, changed: true };
}
