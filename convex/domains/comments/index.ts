import { v } from "convex/values";
import { internalMutation, mutation } from "../../_generated/server";
import { agentContextValidator, MAX_BODY_LENGTH } from "../../lib/validators";
import {
  assertSameProject,
  requireHumanProject,
  resolveAgentPrincipal,
} from "../../lib/authz";
import { appendEvent } from "../../lib/events";
import { fail, requireString } from "../../lib/errors";
import { runIdempotent } from "../../lib/idempotency";

export const createForHuman = mutation({
  args: {
    workItemId: v.id("workItems"),
    body: v.string(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const work = await ctx.db.get(args.workItemId);
    if (!work) fail("not_found", "Work item not found");
    const principal = await requireHumanProject(ctx, work.projectId);
    const now = Date.now();
    return await runIdempotent(
      ctx,
      {
        organizationId: work.organizationId,
        projectId: work.projectId,
        principalKey: principal.principalKey,
        operation: "comment.create",
        key: args.idempotencyKey,
        payload: { workItemId: work._id, body: args.body },
        now,
      },
      async () => {
        const commentId = await ctx.db.insert("comments", {
          organizationId: work.organizationId,
          projectId: work.projectId,
          workItemId: work._id,
          actorId: principal.actor._id,
          body: requireString(args.body, "body", MAX_BODY_LENGTH),
          createdAt: now,
        });
        await appendEvent(ctx, {
          organizationId: work.organizationId,
          projectId: work.projectId,
          workItemId: work._id,
          actorId: principal.actor._id,
          type: "comment.created",
          data: { commentId },
          createdAt: now,
        });
        return { commentId };
      },
    );
  },
});

export const createForAgent = internalMutation({
  args: {
    authorization: agentContextValidator,
    workItemId: v.id("workItems"),
    body: v.string(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:write",
    );
    const work = await ctx.db.get(args.workItemId);
    if (!work) fail("not_found", "Work item not found");
    assertSameProject(work, principal.project);
    const now = Date.now();
    return await runIdempotent(
      ctx,
      {
        organizationId: work.organizationId,
        projectId: work.projectId,
        principalKey: principal.principalKey,
        operation: "comment.create",
        key: args.idempotencyKey,
        payload: { workItemId: work._id, body: args.body },
        now,
      },
      async () => {
        const commentId = await ctx.db.insert("comments", {
          organizationId: work.organizationId,
          projectId: work.projectId,
          workItemId: work._id,
          actorId: principal.actor._id,
          body: requireString(args.body, "body", MAX_BODY_LENGTH),
          createdAt: now,
        });
        await appendEvent(ctx, {
          organizationId: work.organizationId,
          projectId: work.projectId,
          workItemId: work._id,
          actorId: principal.actor._id,
          type: "comment.created",
          data: { commentId },
          requestId: principal.requestId,
          createdAt: now,
        });
        return { commentId };
      },
    );
  },
});
