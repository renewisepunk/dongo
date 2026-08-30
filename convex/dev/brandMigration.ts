import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

const legacyCliLabel = ["Don", "go CLI"].join("");
const currentCliLabel = "dongo CLI";

export const lowercaseLegacyCliLabels = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(100, Math.trunc(args.limit ?? 50)));
    const page = await ctx.db.query("installations").paginate({
      cursor: args.cursor ?? null,
      numItems: limit,
    });
    let installationsUpdated = 0;
    let actorsUpdated = 0;
    for (const installation of page.page) {
      if (installation.kind !== "cli" || installation.label !== legacyCliLabel) {
        continue;
      }
      await ctx.db.patch(installation._id, {
        label: currentCliLabel,
        updatedAt: Date.now(),
      });
      installationsUpdated += 1;
      const actor = await ctx.db.get(installation.actorId);
      if (
        actor?.type === "agent" &&
        actor.agentType === "cli" &&
        actor.name === legacyCliLabel
      ) {
        await ctx.db.patch(actor._id, { name: currentCliLabel });
        actorsUpdated += 1;
      }
    }
    return {
      installationsUpdated,
      actorsUpdated,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});
