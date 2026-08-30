import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

export const removeExpiredIdempotencyKeys = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("idempotencyKeys")
      .withIndex("by_expires_at", (q) => q.lte("expiresAt", now))
      .take(Math.max(1, Math.min(args.limit ?? 200, 500)));
    for (const record of expired) await ctx.db.delete(record._id);
    return { removed: expired.length };
  },
});
