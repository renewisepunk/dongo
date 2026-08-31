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

const MAX_COMMENT_ATTACHMENTS = 20;

function commentBody(body: string | undefined, attachmentCount: number): string {
  const normalized = body?.trim() ?? "";
  if (!normalized && attachmentCount === 0) {
    fail("validation", "A comment requires text or an attachment");
  }
  return normalized ? requireString(normalized, "body", MAX_BODY_LENGTH) : "";
}

export const createForHuman = mutation({
  args: {
    workItemId: v.id("workItems"),
    body: v.optional(v.string()),
    attachmentIds: v.optional(v.array(v.id("attachments"))),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const work = await ctx.db.get(args.workItemId);
    if (!work) fail("not_found", "Work item not found");
    const principal = await requireHumanProject(ctx, work.projectId);
    const attachmentIds = [...new Set(args.attachmentIds ?? [])];
    if (attachmentIds.length > MAX_COMMENT_ATTACHMENTS) {
      fail("validation", `A comment may include at most ${MAX_COMMENT_ATTACHMENTS} attachments`);
    }
    const body = commentBody(args.body, attachmentIds.length);
    const now = Date.now();
    return await runIdempotent(
      ctx,
      {
        organizationId: work.organizationId,
        projectId: work.projectId,
        principalKey: principal.principalKey,
        operation: "comment.create",
        key: args.idempotencyKey,
        payload: { workItemId: work._id, body, attachmentIds },
        now,
      },
      async () => {
        const attachments = await Promise.all(
          attachmentIds.map(async (attachmentId) => {
            const attachment = await ctx.db.get(attachmentId);
            if (
              !attachment ||
              attachment.projectId !== work.projectId ||
              attachment.organizationId !== work.organizationId ||
              attachment.createdByProfileId !== principal.profile._id
            ) {
              fail("not_found", "Attachment not found");
            }
            if (attachment.status !== "available") {
              fail("upload_incomplete", "Comment attachment is not available");
            }
            if (attachment.intakeId !== undefined || attachment.workItemId !== undefined) {
              fail("invalid_transition", "Attachment is already in use");
            }
            return attachment;
          }),
        );
        const commentId = await ctx.db.insert("comments", {
          organizationId: work.organizationId,
          projectId: work.projectId,
          workItemId: work._id,
          actorId: principal.actor._id,
          body,
          attachmentIds,
          createdAt: now,
        });
        for (const attachment of attachments) {
          await ctx.db.patch(attachment._id, { workItemId: work._id });
        }
        await appendEvent(ctx, {
          organizationId: work.organizationId,
          projectId: work.projectId,
          workItemId: work._id,
          actorId: principal.actor._id,
          type: "comment.created",
          data: { commentId, attachmentIds },
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
          attachmentIds: [],
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
