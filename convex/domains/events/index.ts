import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internalQuery, query } from "../../_generated/server";
import { agentContextValidator } from "../../lib/validators";
import {
  requireHumanProject,
  resolveAgentPrincipal,
} from "../../lib/authz";

export const listForHuman = query({
  args: {
    projectId: v.id("projects"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireHumanProject(ctx, args.projectId, { allowArchived: true });
    return await ctx.db
      .query("events")
      .withIndex("by_project_created", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const listForAgent = internalQuery({
  args: {
    authorization: agentContextValidator,
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:read",
    );
    return await ctx.db
      .query("events")
      .withIndex("by_project_created", (q) =>
        q.eq("projectId", principal.project._id),
      )
      .order("desc")
      .paginate(args.paginationOpts);
  },
});
