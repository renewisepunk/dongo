import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internalQuery, query } from "../../_generated/server";
import { agentContextValidator } from "../../lib/validators";
import {
  requireHumanProject,
  resolveAgentPrincipal,
} from "../../lib/authz";
import { requireString } from "../../lib/errors";
import {
  commentSummaryForHuman,
  intakeSummaryForHuman,
  workSummaryForHuman,
} from "../human/summary";
import { workByIdentifier } from "../work/identifiers";
import { intakeForAgent } from "../agent/privacy";

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
    const principal = await requireHumanProject(ctx, args.projectId, {
      allowArchived: true,
    });
    const term = requireString(args.term, "term", 200);
    const identifierMatch = await workByIdentifier(
      ctx,
      principal.project!,
      term,
    );
    if (identifierMatch) {
      return {
        page: [workSummaryForHuman(identifierMatch, principal.project!)],
        isDone: true,
        continueCursor: "",
      };
    }
    const page = await ctx.db
      .query("workItems")
      .withSearchIndex("search_title", (q) =>
        q.search("title", term).eq("projectId", args.projectId),
      )
      .paginate(args.paginationOpts);
    return {
      ...page,
      page: page.page.map((work) =>
        workSummaryForHuman(work, principal.project!),
      ),
    };
  },
});

export const intakesForHuman = query({
  args: humanArgs,
  handler: async (ctx, args) => {
    await requireHumanProject(ctx, args.projectId, { allowArchived: true });
    const term = requireString(args.term, "term", 200);
    const page = await ctx.db
      .query("intakes")
      .withSearchIndex("search_text", (q) =>
        q.search("text", term).eq("projectId", args.projectId),
      )
      .paginate(args.paginationOpts);
    return {
      ...page,
      page: await Promise.all(page.page.map(async (intake) => {
        const firstAttachment = (await ctx.db
          .query("attachments")
          .withIndex("by_intake", (q) => q.eq("intakeId", intake._id))
          .take(20))
          .find((attachment) => attachment.status === "available");
        return intakeSummaryForHuman(intake, firstAttachment);
      })),
    };
  },
});

export const commentsForHuman = query({
  args: humanArgs,
  handler: async (ctx, args) => {
    const principal = await requireHumanProject(ctx, args.projectId, {
      allowArchived: true,
    });
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
          comment: commentSummaryForHuman(comment),
          work: await ctx.db
            .get(comment.workItemId)
            .then((work) =>
              work ? workSummaryForHuman(work, principal.project!) : null,
            ),
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
    const identifierMatch = await workByIdentifier(ctx, principal.project, term);
    if (identifierMatch) {
      return {
        page: [workSummaryForHuman(identifierMatch, principal.project)],
        isDone: true,
        continueCursor: "",
      };
    }
    const page = await ctx.db
      .query("workItems")
      .withSearchIndex("search_title", (q) =>
        q.search("title", term).eq("projectId", principal.project._id),
      )
      .paginate(args.paginationOpts);
    return {
      ...page,
      page: page.page.map((work) =>
        workSummaryForHuman(work, principal.project),
      ),
    };
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
    const page = await ctx.db
      .query("intakes")
      .withSearchIndex("search_text", (q) =>
        q.search("text", term).eq("projectId", principal.project._id),
      )
      .paginate(args.paginationOpts);
    return { ...page, page: page.page.map(intakeForAgent) };
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
