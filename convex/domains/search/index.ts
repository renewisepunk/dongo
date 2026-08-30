import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internalQuery, query } from "../../_generated/server";
import { agentContextValidator } from "../../lib/validators";
import {
  requireHumanProject,
  resolveAgentPrincipal,
} from "../../lib/authz";
import { requireString } from "../../lib/errors";

const humanArgs = {
  projectId: v.id("projects"),
  term: v.string(),
  paginationOpts: paginationOptsValidator,
};
const agentArgs = {
  authorization: agentContextValidator,
  term: v.string(),
  paginationOpts: paginationOptsValidator,
};

export const workForHuman = query({
  args: humanArgs,
  handler: async (ctx, args) => {
    await requireHumanProject(ctx, args.projectId, { allowArchived: true });
    const term = requireString(args.term, "term", 200);
    return await ctx.db
      .query("workItems")
      .withSearchIndex("search_title", (q) =>
        q.search("title", term).eq("projectId", args.projectId),
      )
      .paginate(args.paginationOpts);
  },
});

export const intakesForHuman = query({
  args: humanArgs,
  handler: async (ctx, args) => {
    await requireHumanProject(ctx, args.projectId, { allowArchived: true });
    const term = requireString(args.term, "term", 200);
    return await ctx.db
      .query("intakes")
      .withSearchIndex("search_text", (q) =>
        q.search("text", term).eq("projectId", args.projectId),
      )
      .paginate(args.paginationOpts);
  },
});

export const commentsForHuman = query({
  args: humanArgs,
  handler: async (ctx, args) => {
    await requireHumanProject(ctx, args.projectId, { allowArchived: true });
    const term = requireString(args.term, "term", 200);
    const page = await ctx.db
      .query("comments")
      .withSearchIndex("search_body", (q) =>
        q.search("body", term).eq("projectId", args.projectId),
      )
      .paginate(args.paginationOpts);
    return {
      ...page,
      page: await Promise.all(
        page.page.map(async (comment) => ({
          comment,
          work: await ctx.db.get(comment.workItemId),
        })),
      ),
    };
  },
});

export const workForAgent = internalQuery({
  args: agentArgs,
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:read",
    );
    const term = requireString(args.term, "term", 200);
    return await ctx.db
      .query("workItems")
      .withSearchIndex("search_title", (q) =>
        q.search("title", term).eq("projectId", principal.project._id),
      )
      .paginate(args.paginationOpts);
  },
});

export const intakesForAgent = internalQuery({
  args: agentArgs,
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:read",
    );
    const term = requireString(args.term, "term", 200);
    return await ctx.db
      .query("intakes")
      .withSearchIndex("search_text", (q) =>
        q.search("text", term).eq("projectId", principal.project._id),
      )
      .paginate(args.paginationOpts);
  },
});

export const commentsForAgent = internalQuery({
  args: agentArgs,
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:read",
    );
    const term = requireString(args.term, "term", 200);
    return await ctx.db
      .query("comments")
      .withSearchIndex("search_body", (q) =>
        q.search("body", term).eq("projectId", principal.project._id),
      )
      .paginate(args.paginationOpts);
  },
});
