import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { initializeOrganizationWorkItemCount } from "./lib/workUsage";

export const removeExpiredIdempotencyKeys = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("idempotencyKeys")
      .withIndex("by_expires_at", (q) => q.lte("expiresAt", now))
      .take(Math.max(1, Math.min(args.limit ?? 200, 500)));
    const remaining = Math.max(0, Math.min(args.limit ?? 200, 500) - expired.length);
    const expiredPlatformAdmin = remaining === 0
      ? []
      : await ctx.db
          .query("platformAdminMutationKeys")
          .withIndex("by_expires_at", (q) => q.lte("expiresAt", now))
          .take(remaining);
    for (const record of expired) await ctx.db.delete(record._id);
    for (const record of expiredPlatformAdmin) await ctx.db.delete(record._id);
    return { removed: expired.length + expiredPlatformAdmin.length };
  },
});

export const backfillNextOrganizationWorkItemCount = internalMutation({
  args: {},
  handler: async (ctx) => {
    const organization = await ctx.db
      .query("organizations")
      .withIndex("by_work_item_count_state", (q) =>
        q.eq("workItemCountState", undefined),
      )
      .first();
    if (!organization) return { complete: true as const };
    const updated = await initializeOrganizationWorkItemCount(ctx, organization);
    return {
      complete: false as const,
      organizationId: updated._id,
      count: updated.createdWorkItemCount ?? 0,
      state: updated.workItemCountState,
    };
  },
});
