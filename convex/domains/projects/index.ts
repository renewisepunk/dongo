import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import {
  requireCurrentProfile,
  requireHumanActor,
  requireHumanProject,
  requireMembership,
  requireOwner,
} from "../../lib/authz";
import { appendEvent } from "../../lib/events";
import { fail, optionalString, requireString } from "../../lib/errors";

function normalizeSlug(value: string): string {
  const slug = value.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) {
    fail("validation", "slug must contain lowercase letters, numbers, and hyphens");
  }
  return slug;
}

function normalizePrefix(value: string): string {
  const prefix = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{1,7}$/.test(prefix)) {
    fail("validation", "identifierPrefix must be 2-8 uppercase letters or numbers");
  }
  return prefix;
}

export const createPersonalOrganization = mutation({
  args: { name: v.string(), slug: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireCurrentProfile(ctx);
    const existingMembership = await ctx.db
      .query("memberships")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .first();
    if (existingMembership) {
      return { organizationId: existingMembership.organizationId, created: false };
    }
    const name = requireString(args.name, "name", 240);
    const slug = normalizeSlug(args.slug);
    if (
      await ctx.db
        .query("organizations")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .unique()
    ) {
      fail("validation", "Organization slug is already in use");
    }
    const now = Date.now();
    const organizationId = await ctx.db.insert("organizations", {
      name,
      slug,
      createdByProfileId: profile._id,
      plan: "free",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("memberships", {
      organizationId,
      profileId: profile._id,
      role: "owner",
      createdAt: now,
    });
    const actorId = await ctx.db.insert("actors", {
      organizationId,
      type: "human",
      name: profile.name,
      avatarUrl: profile.avatarUrl,
      profileId: profile._id,
      createdAt: now,
      lastSeenAt: now,
    });
    await ctx.db.insert("actors", {
      organizationId,
      type: "system",
      name: "Dongo",
      createdAt: now,
    });
    await appendEvent(ctx, {
      organizationId,
      actorId,
      type: "organization.created",
      data: { slug },
      createdAt: now,
    });
    return { organizationId, created: true };
  },
});

export const createProject = mutation({
  args: {
    organizationId: v.id("organizations"),
    name: v.string(),
    slug: v.string(),
    identifierPrefix: v.string(),
    repositoryUrl: v.optional(v.string()),
    executionMode: v.union(v.literal("manual"), v.literal("autonomous")),
  },
  handler: async (ctx, args) => {
    const profile = await requireCurrentProfile(ctx);
    const membership = await requireMembership(ctx, args.organizationId, profile._id);
    requireOwner(membership);
    const organization = await ctx.db.get(args.organizationId);
    if (!organization) fail("not_found", "Organization not found");
    const name = requireString(args.name, "name", 240);
    const slug = normalizeSlug(args.slug);
    const identifierPrefix = normalizePrefix(args.identifierPrefix);
    const repositoryUrl = optionalString(
      args.repositoryUrl,
      "repositoryUrl",
      2_048,
    );
    const existingProject = await ctx.db
      .query("projects")
      .withIndex("by_organization_slug", (q) =>
        q.eq("organizationId", args.organizationId).eq("slug", slug),
      )
      .unique();
    if (existingProject) {
      if (
        existingProject.name !== name ||
        existingProject.identifierPrefix !== identifierPrefix ||
        existingProject.repositoryUrl !== repositoryUrl ||
        existingProject.executionMode !== args.executionMode ||
        existingProject.archivedAt !== undefined
      ) {
        fail("validation", "Project slug is already in use");
      }
      return {
        projectId: existingProject._id,
        publicRef: existingProject.publicRef,
        created: false,
      };
    }
    const activeProjects = await ctx.db
      .query("projects")
      .withIndex("by_organization_archived", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("archivedAt", undefined),
      )
      .take(1);
    if (organization.plan === "free" && activeProjects.length >= 1) {
      fail("forbidden", "The free plan allows one active project");
    }
    if (
      await ctx.db
        .query("projects")
        .withIndex("by_organization_prefix", (q) =>
          q
            .eq("organizationId", args.organizationId)
            .eq("identifierPrefix", identifierPrefix),
        )
        .unique()
    ) {
      fail("validation", "Project identifier prefix is already in use");
    }
    const now = Date.now();
    const publicRef = `${String(args.organizationId).slice(-8)}-${slug}`;
    const projectId = await ctx.db.insert("projects", {
      organizationId: args.organizationId,
      name,
      slug,
      publicRef,
      repositoryUrl,
      identifierPrefix,
      nextWorkNumber: 1,
      executionMode: args.executionMode,
      createdAt: now,
      updatedAt: now,
    });
    const actor = await requireHumanActor(ctx, args.organizationId, profile._id);
    await appendEvent(ctx, {
      organizationId: args.organizationId,
      projectId,
      actorId: actor._id,
      type: "project.created",
      data: { identifierPrefix, slug },
      createdAt: now,
    });
    return { projectId, publicRef, created: true };
  },
});

export const provisioningInfo = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const principal = await requireHumanProject(ctx, args.projectId, {
      owner: true,
      allowArchived: true,
    });
    return {
      projectRef: principal.project!.publicRef,
      projectName: principal.project!.name,
    };
  },
});

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireCurrentProfile(ctx);
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .take(100);
    return await Promise.all(
      memberships.map(async (membership) => ({
        membership,
        organization: await ctx.db.get(membership.organizationId),
        projects: await ctx.db
          .query("projects")
          .withIndex("by_organization", (q) =>
            q.eq("organizationId", membership.organizationId),
          )
          .take(100),
      })),
    );
  },
});

export const archiveProject = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const principal = await requireHumanProject(ctx, args.projectId, {
      owner: true,
      allowArchived: true,
    });
    if (principal.project!.archivedAt !== undefined) return { archived: true };
    const now = Date.now();
    await ctx.db.patch(args.projectId, { archivedAt: now, updatedAt: now });
    const installations = await ctx.db
      .query("installations")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", args.projectId).eq("status", "active"),
      )
      .collect();
    for (const installation of installations) {
      await ctx.db.patch(installation._id, {
        status: "revoked",
        revokedAt: now,
        updatedAt: now,
      });
    }
    await appendEvent(ctx, {
      organizationId: principal.project!.organizationId,
      projectId: args.projectId,
      actorId: principal.actor._id,
      type: "project.archived",
      createdAt: now,
    });
    return { archived: true };
  },
});
