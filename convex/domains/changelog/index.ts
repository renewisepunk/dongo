import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import { requireHumanProject } from "../../lib/authz";
import { appendEvent } from "../../lib/events";
import { assertExpectedRevision, fail, requireString } from "../../lib/errors";
import { runIdempotent } from "../../lib/idempotency";
import { displayWorkIdentifier } from "../work/identifiers";

const MAX_TITLE_LENGTH = 240;
const MAX_SUMMARY_LENGTH = 2_000;
const MAX_PUBLISHABLE_ROWS = 50;
const MAX_PUBLISHED_ROWS = 100;

function publishedEntryDto(entry: Doc<"changelogEntries">) {
  return {
    entryId: entry._id,
    title: entry.title,
    summary: entry.summary,
    publishedAt: entry.publishedAt,
  };
}

// Owner-only. Lists completed Work so an owner can choose what to publish.
// Nothing here is public; publishing is a separate, explicit step.
export const publishableWork = query({
  args: { projectId: v.id("projects"), cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const principal = await requireHumanProject(ctx, args.projectId, { owner: true });
    const completed = await ctx.db
      .query("workItems")
      .withIndex("by_project_state_updated", (q) =>
        q.eq("projectId", args.projectId).eq("state", "done"),
      )
      .order("desc")
      .paginate({ cursor: args.cursor ?? null, numItems: MAX_PUBLISHABLE_ROWS });
    return {
      rows: await Promise.all(completed.page.map(async (item) => {
        const entry = await ctx.db.query("changelogEntries")
          .withIndex("by_project_work", (q) => q.eq("projectId", args.projectId).eq("workItemId", item._id))
          .unique();
        return {
          workItemId: item._id,
          revision: item.changelogRevision ?? 0,
          identifier: displayWorkIdentifier(principal.project!, item),
          title: item.title,
          completedAt: item.completedAt,
          published: entry
            ? {
              entryId: entry._id,
              title: entry.title,
              summary: entry.summary,
              publishedAt: entry.publishedAt,
            }
            : undefined,
        };
      })),
      truncated: !completed.isDone,
      cursor: completed.isDone ? undefined : completed.continueCursor,
    };
  },
});

// Owner-only. The owner authors the wording; Work text is never copied
// out automatically, so nothing reaches the public page unreviewed.
export const publishEntry = mutation({
  args: {
    projectId: v.id("projects"),
    workItemId: v.id("workItems"),
    title: v.string(),
    summary: v.string(),
    expectedRevision: v.number(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await requireHumanProject(ctx, args.projectId, {
      owner: true,
    });
    const title = requireString(args.title, "title", MAX_TITLE_LENGTH);
    const summary = requireString(args.summary, "summary", MAX_SUMMARY_LENGTH);
    const now = Date.now();
    return await runIdempotent(ctx, {
      organizationId: principal.project!.organizationId,
      projectId: args.projectId,
      principalKey: principal.principalKey,
      operation: "changelog.publish",
      key: args.idempotencyKey,
      payload: args,
      now,
    }, async () => {
    const workItem = await ctx.db.get(args.workItemId);
    if (!workItem || workItem.projectId !== args.projectId) {
      fail("not_found", "Work not found in this project");
    }
    if (workItem!.state !== "done") {
      fail("invalid_transition", "Only completed Work can be published");
    }
    assertExpectedRevision(workItem!.changelogRevision ?? 0, args.expectedRevision);
    const revision = args.expectedRevision + 1;
    await ctx.db.patch(workItem!._id, { changelogRevision: revision });
    const existing = await ctx.db
      .query("changelogEntries")
      .withIndex("by_project_work", (q) =>
        q.eq("projectId", args.projectId).eq("workItemId", args.workItemId),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { title, summary, updatedAt: now });
      await appendEvent(ctx, {
        organizationId: principal.project!.organizationId,
        projectId: args.projectId,
        workItemId: args.workItemId,
        actorId: principal.actor._id,
        type: "changelog.entry_updated",
        createdAt: now,
      });
      return { entryId: existing._id, publishedAt: existing.publishedAt, revision };
    }
    const entryId = await ctx.db.insert("changelogEntries", {
      projectId: args.projectId,
      workItemId: args.workItemId,
      title,
      summary,
      publishedAt: now,
      publishedByProfileId: principal.profile._id,
      createdAt: now,
      updatedAt: now,
    });
    await appendEvent(ctx, {
      organizationId: principal.project!.organizationId,
      projectId: args.projectId,
      workItemId: args.workItemId,
      actorId: principal.actor._id,
      type: "changelog.entry_published",
      createdAt: now,
    });
    return { entryId, publishedAt: now, revision };
    });
  },
});

// Owner-only. Removing an entry takes it off the public page immediately.
export const unpublishEntry = mutation({
  args: {
    projectId: v.id("projects"),
    entryId: v.id("changelogEntries"),
    expectedRevision: v.number(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await requireHumanProject(ctx, args.projectId, {
      owner: true,
    });
    const now = Date.now();
    return await runIdempotent(ctx, {
      organizationId: principal.project!.organizationId,
      projectId: args.projectId,
      principalKey: principal.principalKey,
      operation: "changelog.unpublish",
      key: args.idempotencyKey,
      payload: args,
      now,
    }, async () => {
    const entry = await ctx.db.get(args.entryId);
    if (!entry || entry.projectId !== args.projectId) {
      fail("not_found", "Changelog entry not found in this project");
    }
    const workItem = await ctx.db.get(entry!.workItemId);
    if (!workItem || workItem.projectId !== args.projectId) fail("not_found", "Work not found in this project");
    assertExpectedRevision(workItem.changelogRevision ?? 0, args.expectedRevision);
    const revision = args.expectedRevision + 1;
    await ctx.db.patch(workItem._id, { changelogRevision: revision });
    await ctx.db.delete(args.entryId);
    await appendEvent(ctx, {
      organizationId: principal.project!.organizationId,
      projectId: args.projectId,
      workItemId: entry!.workItemId,
      actorId: principal.actor._id,
      type: "changelog.entry_unpublished",
      createdAt: now,
    });
    return { entryId: args.entryId, revision };
    });
  },
});

// Public. Returns only what an owner explicitly published, and only the
// owner-authored title and summary; no Work state, identifiers, or text.
export const publishedEntries = query({
  args: { publicRef: v.string() },
  handler: async (ctx, args) => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_public_ref", (q) => q.eq("publicRef", args.publicRef))
      .unique();
    if (!project || project.archivedAt !== undefined) {
      return { entries: [] };
    }
    const entries = await ctx.db
      .query("changelogEntries")
      .withIndex("by_project_published", (q) => q.eq("projectId", project._id))
      .order("desc")
      .take(MAX_PUBLISHED_ROWS);
    return { entries: entries.map(publishedEntryDto) };
  },
});
