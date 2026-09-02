import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { MAX_TOTAL_WORK_ITEM_LIMIT_OVERRIDE } from "./plans";

export type WorkItemCountMeasurement = {
  count: number;
  state: "exact" | "at_least_limit";
};

export async function measureOrganizationWorkItems(
  ctx: Pick<QueryCtx, "db">,
  organizationId: Doc<"organizations">["_id"],
): Promise<WorkItemCountMeasurement> {
  const bounded = await ctx.db
    .query("workItems")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .take(MAX_TOTAL_WORK_ITEM_LIMIT_OVERRIDE + 1);
  return bounded.length <= MAX_TOTAL_WORK_ITEM_LIMIT_OVERRIDE
    ? { count: bounded.length, state: "exact" }
    : {
        count: MAX_TOTAL_WORK_ITEM_LIMIT_OVERRIDE,
        state: "at_least_limit",
      };
}

export async function initializeOrganizationWorkItemCount(
  ctx: Pick<MutationCtx, "db">,
  organization: Doc<"organizations">,
  now = Date.now(),
): Promise<Doc<"organizations">> {
  if (organization.workItemCountState !== undefined) return organization;
  const measurement = await measureOrganizationWorkItems(ctx, organization._id);
  await ctx.db.patch(organization._id, {
    createdWorkItemCount: measurement.count,
    workItemCountState: measurement.state,
    usageTrackingStartedAt: organization.usageTrackingStartedAt ?? now,
    updatedAt: now,
  });
  return (await ctx.db.get(organization._id))!;
}
