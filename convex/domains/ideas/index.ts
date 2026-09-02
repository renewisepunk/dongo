import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { requireHumanProject } from "../../lib/authz";
import { appendEvent } from "../../lib/events";
import { fail, optionalString, requireString } from "../../lib/errors";
import { runIdempotent } from "../../lib/idempotency";
import { MAX_BODY_LENGTH } from "../../lib/validators";
import { attachmentSummary } from "../attachments/summary";
import { actorSummaryForHumanWithInstallation } from "../human/summary";
import { enqueueAutomaticIntake } from "../runner/index";

const ideaStateValidator = v.union(
  v.literal("open"),
  v.literal("archived"),
  v.literal("promoted"),
);
const ideaFilterValidator = v.union(ideaStateValidator, v.literal("all"));
const MAX_TITLE_LENGTH = 240;
const MAX_IDEA_ATTACHMENTS = 20;
const MAX_IDEA_LINKS = 100;
const MAX_IDEA_LINK_LENGTH = 2_048;
const POSITION_STEP = 1_024;

function normalizedLinks(values: string[] | undefined): string[] | undefined {
  if (values === undefined) return undefined;
  if (values.length > MAX_IDEA_LINKS) {
    fail("validation", `An Idea may include at most ${MAX_IDEA_LINKS} links`);
  }
  const links = values.map((value, index) => {
    const raw = requireString(value, `links[${index}]`, MAX_IDEA_LINK_LENGTH);
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      fail("validation", `links[${index}] must be a valid URL`);
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      fail("validation", `links[${index}] must use HTTP or HTTPS`);
    }
    return parsed.toString();
  });
  return [...new Set(links)];
}

function sameStrings(
  left: string[] | undefined,
  right: string[] | undefined,
): boolean {
  return (left ?? []).length === (right ?? []).length &&
    (left ?? []).every((value, index) => value === (right ?? [])[index]);
}

function assertPosition(position: number): number {
  if (!Number.isSafeInteger(position) || position < 0) {
    fail("validation", "position must be a non-negative safe integer");
  }
  return position;
}

function assertRevision(idea: Doc<"ideas">, expectedRevision: number): void {
  if (idea.revision !== expectedRevision) {
    fail("revision_conflict", "The Idea changed since it was read", {
      entityType: "idea",
      ideaId: idea._id,
      expectedRevision,
      currentRevision: idea.revision,
    });
  }
}

async function availableIdeaAttachments(
  ctx: Pick<QueryCtx, "db">,
  ideaId: Id<"ideas">,
) {
  return (await ctx.db
    .query("attachments")
    .withIndex("by_idea", (q) => q.eq("ideaId", ideaId))
    .take(MAX_IDEA_ATTACHMENTS + 1))
    .filter((attachment) => attachment.status === "available");
}

async function ideaSummaryForHuman(
  ctx: Pick<QueryCtx, "db">,
  idea: Doc<"ideas">,
) {
  const [attachments, createdByActor, updatedByActor] = await Promise.all([
    availableIdeaAttachments(ctx, idea._id),
    ctx.db.get(idea.createdByActorId),
    ctx.db.get(idea.updatedByActorId),
  ]);
  if (!createdByActor || !updatedByActor) {
    fail("internal", "Idea attribution is missing");
  }
  return {
    _id: idea._id,
    projectId: idea.projectId,
    title: idea.title,
    text: idea.text,
    context: idea.context,
    links: idea.links,
    state: idea.state,
    position: idea.position,
    revision: idea.revision,
    createdBy: await actorSummaryForHumanWithInstallation(ctx, createdByActor),
    updatedBy: await actorSummaryForHumanWithInstallation(ctx, updatedByActor),
    attachmentCount: attachments.length,
    archivedAt: idea.archivedAt,
    promotedAt: idea.promotedAt,
    promotedIntakeId: idea.promotedIntakeId,
    createdAt: idea.createdAt,
    updatedAt: idea.updatedAt,
  };
}

async function assertAvailableAttachments(
  ctx: MutationCtx,
  args: {
    attachmentIds: Id<"attachments">[];
    organizationId: Id<"organizations">;
    projectId: Id<"projects">;
    profileId: Id<"humanProfiles">;
  },
) {
  const attachments = [];
  for (const attachmentId of args.attachmentIds) {
    const attachment = await ctx.db.get(attachmentId);
    if (
      !attachment ||
      attachment.organizationId !== args.organizationId ||
      attachment.projectId !== args.projectId ||
      attachment.createdByProfileId !== args.profileId ||
      attachment.status !== "available" ||
      attachment.ideaId !== undefined ||
      attachment.intakeId !== undefined ||
      attachment.workItemId !== undefined
    ) {
      fail("not_found", "Attachment is not available for this Idea");
    }
    attachments.push(attachment);
  }
  return attachments;
}

export const listForHuman = query({
  args: {
    projectId: v.id("projects"),
    state: v.optional(ideaFilterValidator),
  },
  handler: async (ctx, args) => {
    await requireHumanProject(ctx, args.projectId, { allowArchived: true });
    const state = args.state ?? "open";
    const ideas = state === "all"
      ? await ctx.db
        .query("ideas")
        .withIndex("by_project_created", (q) => q.eq("projectId", args.projectId))
        .take(500)
      : await ctx.db
        .query("ideas")
        .withIndex("by_project_state_position", (q) =>
          q.eq("projectId", args.projectId).eq("state", state),
        )
        .take(500);
    ideas.sort((left, right) =>
      left.position - right.position || left.createdAt - right.createdAt,
    );
    return await Promise.all(ideas.map((idea) => ideaSummaryForHuman(ctx, idea)));
  },
});

export const getForHuman = query({
  args: { ideaId: v.id("ideas") },
  handler: async (ctx, args) => {
    const idea = await ctx.db.get(args.ideaId);
    if (!idea) fail("not_found", "Idea not found");
    await requireHumanProject(ctx, idea.projectId, { allowArchived: true });
    const attachments = await availableIdeaAttachments(ctx, idea._id);
    return {
      idea: await ideaSummaryForHuman(ctx, idea),
      attachments: attachments.map(attachmentSummary),
    };
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    title: v.string(),
    text: v.optional(v.string()),
    context: v.optional(v.string()),
    links: v.optional(v.array(v.string())),
    attachmentIds: v.optional(v.array(v.id("attachments"))),
    position: v.optional(v.number()),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await requireHumanProject(ctx, args.projectId);
    const title = requireString(args.title, "title", MAX_TITLE_LENGTH);
    const text = optionalString(args.text, "text", MAX_BODY_LENGTH);
    const context = optionalString(args.context, "context", MAX_BODY_LENGTH);
    const links = normalizedLinks(args.links);
    const attachmentIds = [...new Set(args.attachmentIds ?? [])];
    if (attachmentIds.length > MAX_IDEA_ATTACHMENTS) {
      fail("validation", `An Idea may include at most ${MAX_IDEA_ATTACHMENTS} attachments`);
    }
    const now = Date.now();
    return await runIdempotent(ctx, {
      organizationId: principal.project!.organizationId,
      projectId: args.projectId,
      principalKey: principal.principalKey,
      operation: "idea.create",
      key: args.idempotencyKey,
      payload: { title, text, context, links, attachmentIds, position: args.position },
      now,
    }, async () => {
      const attachments = await assertAvailableAttachments(ctx, {
        attachmentIds,
        organizationId: principal.project!.organizationId,
        projectId: args.projectId,
        profileId: principal.profile._id,
      });
      const lastOpen = await ctx.db
        .query("ideas")
        .withIndex("by_project_state_position", (q) =>
          q.eq("projectId", args.projectId).eq("state", "open"),
        )
        .order("desc")
        .first();
      const position = args.position === undefined
        ? (lastOpen?.position ?? 0) + POSITION_STEP
        : assertPosition(args.position);
      const ideaId = await ctx.db.insert("ideas", {
        organizationId: principal.project!.organizationId,
        projectId: args.projectId,
        title,
        text,
        context,
        links,
        state: "open",
        position,
        revision: 1,
        createdByProfileId: principal.profile._id,
        createdByActorId: principal.actor._id,
        updatedByActorId: principal.actor._id,
        createdAt: now,
        updatedAt: now,
      });
      for (const attachment of attachments) {
        await ctx.db.patch(attachment._id, { ideaId });
      }
      await appendEvent(ctx, {
        organizationId: principal.project!.organizationId,
        projectId: args.projectId,
        ideaId,
        actorId: principal.actor._id,
        type: "idea.created",
        data: { attachmentCount: attachments.length },
        createdAt: now,
      });
      return { ideaId, revision: 1, position, createdAt: now };
    });
  },
});

export const update = mutation({
  args: {
    ideaId: v.id("ideas"),
    expectedRevision: v.number(),
    title: v.optional(v.string()),
    text: v.optional(v.string()),
    context: v.optional(v.string()),
    links: v.optional(v.array(v.string())),
    addAttachmentIds: v.optional(v.array(v.id("attachments"))),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const idea = await ctx.db.get(args.ideaId);
    if (!idea) fail("not_found", "Idea not found");
    const principal = await requireHumanProject(ctx, idea.projectId);
    if (
      args.title === undefined && args.text === undefined &&
      args.context === undefined && args.links === undefined &&
      args.addAttachmentIds === undefined
    ) {
      fail("validation", "At least one Idea change is required");
    }
    const title = args.title === undefined
      ? idea.title
      : requireString(args.title, "title", MAX_TITLE_LENGTH);
    const text = args.text === undefined
      ? idea.text
      : optionalString(args.text, "text", MAX_BODY_LENGTH);
    const context = args.context === undefined
      ? idea.context
      : optionalString(args.context, "context", MAX_BODY_LENGTH);
    const links = args.links === undefined ? idea.links : normalizedLinks(args.links);
    const addAttachmentIds = [...new Set(args.addAttachmentIds ?? [])];
    const now = Date.now();
    return await runIdempotent(ctx, {
      organizationId: idea.organizationId,
      projectId: idea.projectId,
      principalKey: principal.principalKey,
      operation: "idea.update",
      key: args.idempotencyKey,
      payload: {
        ideaId: idea._id,
        expectedRevision: args.expectedRevision,
        title: args.title,
        text: args.text,
        context: args.context,
        links: args.links,
        addAttachmentIds,
      },
      now,
    }, async () => {
      assertRevision(idea, args.expectedRevision);
      if (idea.state !== "open") {
        fail("invalid_transition", "Only open Ideas may be edited");
      }
      const existingAttachments = await availableIdeaAttachments(ctx, idea._id);
      const existingIds = new Set(existingAttachments.map((item) => item._id));
      const additions = await assertAvailableAttachments(ctx, {
        attachmentIds: addAttachmentIds.filter((id) => !existingIds.has(id)),
        organizationId: idea.organizationId,
        projectId: idea.projectId,
        profileId: principal.profile._id,
      });
      if (existingAttachments.length + additions.length > MAX_IDEA_ATTACHMENTS) {
        fail("validation", `An Idea may include at most ${MAX_IDEA_ATTACHMENTS} attachments`);
      }
      const changedFields = [
        ...(title !== idea.title ? ["title"] : []),
        ...(text !== idea.text ? ["text"] : []),
        ...(context !== idea.context ? ["context"] : []),
        ...(!sameStrings(links, idea.links) ? ["links"] : []),
        ...(additions.length > 0 ? ["attachments"] : []),
      ];
      if (changedFields.length === 0) {
        return {
          ideaId: idea._id,
          revision: idea.revision,
          updatedAt: idea.updatedAt,
          addedAttachmentIds: [],
        };
      }
      const revision = idea.revision + 1;
      await ctx.db.patch(idea._id, {
        title,
        text,
        context,
        links,
        revision,
        updatedByActorId: principal.actor._id,
        updatedAt: now,
      });
      for (const attachment of additions) {
        await ctx.db.patch(attachment._id, { ideaId: idea._id });
      }
      await appendEvent(ctx, {
        organizationId: idea.organizationId,
        projectId: idea.projectId,
        ideaId: idea._id,
        actorId: principal.actor._id,
        type: "idea.updated",
        data: { changedFields, addedAttachmentCount: additions.length },
        createdAt: now,
      });
      return {
        ideaId: idea._id,
        revision,
        updatedAt: now,
        addedAttachmentIds: additions.map((item) => item._id),
      };
    });
  },
});

export const reorder = mutation({
  args: {
    projectId: v.id("projects"),
    orderedIdeaIds: v.array(v.id("ideas")),
    expectedRevisions: v.array(v.object({
      ideaId: v.id("ideas"),
      revision: v.number(),
    })),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await requireHumanProject(ctx, args.projectId);
    const now = Date.now();
    return await runIdempotent(ctx, {
      organizationId: principal.project!.organizationId,
      projectId: args.projectId,
      principalKey: principal.principalKey,
      operation: "idea.reorder",
      key: args.idempotencyKey,
      payload: {
        orderedIdeaIds: args.orderedIdeaIds,
        expectedRevisions: args.expectedRevisions,
      },
      now,
    }, async () => {
      const openIdeas = await ctx.db
        .query("ideas")
        .withIndex("by_project_state_position", (q) =>
          q.eq("projectId", args.projectId).eq("state", "open"),
        )
        .collect();
      const orderedIds = new Set(args.orderedIdeaIds);
      if (
        orderedIds.size !== args.orderedIdeaIds.length ||
        openIdeas.length !== args.orderedIdeaIds.length ||
        openIdeas.some((idea) => !orderedIds.has(idea._id))
      ) {
        fail("revision_conflict", "The open Ideas changed while they were reordered", {
          currentCount: openIdeas.length,
        });
      }
      const expected = new Map(
        args.expectedRevisions.map((item) => [item.ideaId, item.revision]),
      );
      if (expected.size !== openIdeas.length) {
        fail("validation", "expectedRevisions must include every open Idea once");
      }
      const byId = new Map(openIdeas.map((idea) => [idea._id, idea]));
      const results = [];
      for (const [index, ideaId] of args.orderedIdeaIds.entries()) {
        const idea = byId.get(ideaId)!;
        const expectedRevision = expected.get(ideaId);
        if (expectedRevision === undefined) {
          fail("validation", "expectedRevisions must include every open Idea once");
        }
        assertRevision(idea, expectedRevision);
        const position = (index + 1) * POSITION_STEP;
        const revision = idea.revision + 1;
        await ctx.db.patch(idea._id, {
          position,
          revision,
          updatedByActorId: principal.actor._id,
          updatedAt: now,
        });
        results.push({ ideaId: idea._id, revision, position });
      }
      await appendEvent(ctx, {
        organizationId: principal.project!.organizationId,
        projectId: args.projectId,
        actorId: principal.actor._id,
        type: "ideas.reordered",
        data: { ideaIds: args.orderedIdeaIds },
        createdAt: now,
      });
      return { ideas: results };
    });
  },
});

async function transitionIdea(
  ctx: MutationCtx,
  args: {
    ideaId: Id<"ideas">;
    expectedRevision: number;
    idempotencyKey: string;
    targetState: "archived" | "open";
  },
) {
  const idea = await ctx.db.get(args.ideaId);
  if (!idea) fail("not_found", "Idea not found");
  const principal = await requireHumanProject(ctx, idea.projectId);
  const operation = args.targetState === "archived" ? "idea.archive" : "idea.restore";
  const now = Date.now();
  return await runIdempotent(ctx, {
    organizationId: idea.organizationId,
    projectId: idea.projectId,
    principalKey: principal.principalKey,
    operation,
    key: args.idempotencyKey,
    payload: { ideaId: idea._id, expectedRevision: args.expectedRevision },
    now,
  }, async () => {
    assertRevision(idea, args.expectedRevision);
    const requiredState = args.targetState === "archived" ? "open" : "archived";
    if (idea.state !== requiredState) {
      fail(
        "invalid_transition",
        args.targetState === "archived"
          ? "Only open Ideas may be archived"
          : "Only archived Ideas may be restored",
      );
    }
    const revision = idea.revision + 1;
    await ctx.db.patch(idea._id, {
      state: args.targetState,
      archivedAt: args.targetState === "archived" ? now : undefined,
      revision,
      updatedByActorId: principal.actor._id,
      updatedAt: now,
    });
    await appendEvent(ctx, {
      organizationId: idea.organizationId,
      projectId: idea.projectId,
      ideaId: idea._id,
      actorId: principal.actor._id,
      type: args.targetState === "archived" ? "idea.archived" : "idea.restored",
      createdAt: now,
    });
    return { ideaId: idea._id, revision, state: args.targetState, updatedAt: now };
  });
}

export const archive = mutation({
  args: {
    ideaId: v.id("ideas"),
    expectedRevision: v.number(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => transitionIdea(ctx, { ...args, targetState: "archived" }),
});

export const restore = mutation({
  args: {
    ideaId: v.id("ideas"),
    expectedRevision: v.number(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => transitionIdea(ctx, { ...args, targetState: "open" }),
});

export const promote = mutation({
  args: {
    ideaId: v.id("ideas"),
    expectedRevision: v.number(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const idea = await ctx.db.get(args.ideaId);
    if (!idea) fail("not_found", "Idea not found");
    const principal = await requireHumanProject(ctx, idea.projectId);
    const now = Date.now();
    return await runIdempotent(ctx, {
      organizationId: idea.organizationId,
      projectId: idea.projectId,
      principalKey: principal.principalKey,
      operation: "idea.promote",
      key: args.idempotencyKey,
      payload: { ideaId: idea._id, expectedRevision: args.expectedRevision },
      now,
    }, async () => {
      if (idea.state === "promoted" && idea.promotedIntakeId !== undefined) {
        return {
          ideaId: idea._id,
          intakeId: idea.promotedIntakeId,
          revision: idea.revision,
          created: false,
        };
      }
      assertRevision(idea, args.expectedRevision);
      if (idea.state !== "open") {
        fail("invalid_transition", "Only open Ideas may be promoted");
      }
      const attachments = await availableIdeaAttachments(ctx, idea._id);
      if (attachments.length > MAX_IDEA_ATTACHMENTS) {
        fail("internal", "Idea attachment limit is inconsistent");
      }
      const intakeText = idea.text ? `${idea.title}\n\n${idea.text}` : idea.title;
      const intakeId = await ctx.db.insert("intakes", {
        organizationId: idea.organizationId,
        projectId: idea.projectId,
        createdByProfileId: principal.profile._id,
        createdByActorId: principal.actor._id,
        sourceIdeaId: idea._id,
        clientRequestId: args.idempotencyKey,
        text: intakeText,
        context: idea.context,
        links: idea.links,
        status: "new",
        revision: 1,
        createdAt: now,
        updatedAt: now,
      });
      for (const attachment of attachments) {
        await ctx.db.patch(attachment._id, { intakeId });
      }
      const revision = idea.revision + 1;
      await ctx.db.patch(idea._id, {
        state: "promoted",
        promotedAt: now,
        promotedIntakeId: intakeId,
        revision,
        updatedByActorId: principal.actor._id,
        updatedAt: now,
      });
      await appendEvent(ctx, {
        organizationId: idea.organizationId,
        projectId: idea.projectId,
        intakeId,
        actorId: principal.actor._id,
        type: "intake.created",
        data: { attachmentCount: attachments.length },
        createdAt: now,
      });
      await appendEvent(ctx, {
        organizationId: idea.organizationId,
        projectId: idea.projectId,
        ideaId: idea._id,
        intakeId,
        actorId: principal.actor._id,
        type: "idea.promoted",
        data: { intakeId },
        createdAt: now,
      });
      await enqueueAutomaticIntake(ctx, {
        projectId: idea.projectId,
        intakeId,
        requestedByActorId: principal.actor._id,
        now,
      });
      return { ideaId: idea._id, intakeId, revision, created: true };
    });
  },
});
