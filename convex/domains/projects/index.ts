import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "../../_generated/server";
import {
  requireCurrentProfile,
  requireHumanActor,
  requireHumanProject,
  requireMembership,
  requireOwner,
} from "../../lib/authz";
import { appendEvent } from "../../lib/events";
import { fail, optionalString, requireString } from "../../lib/errors";
import { MAX_ATTACHMENT_BYTES, organizationStorageLimit } from "../../lib/plans";

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

function normalizeRepositoryUrl(value: string | undefined): string | undefined {
  const normalized = optionalString(value, "repositoryUrl", 2_048);
  if (!normalized) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    fail("validation", "repositoryUrl must be an absolute HTTP or HTTPS URL");
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username ||
    parsed.password
  ) {
    fail("validation", "repositoryUrl must be a credential-free HTTP or HTTPS URL");
  }
  return parsed.toString();
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
      name: "dongo",
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

export const createProject = internalMutation({
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
    const repositoryUrl = normalizeRepositoryUrl(args.repositoryUrl);
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

export const provisioningInfo = internalQuery({
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
      memberships.map(async (membership) => {
        const [organization, projects] = await Promise.all([
          ctx.db.get(membership.organizationId),
          ctx.db
          .query("projects")
          .withIndex("by_organization", (q) =>
            q.eq("organizationId", membership.organizationId),
          )
          .take(100),
        ]);
        return {
          membership: {
            organizationId: membership.organizationId,
            role: membership.role,
          },
          organization: organization
            ? {
                _id: organization._id,
                name: organization.name,
                slug: organization.slug,
                plan: organization.plan,
              }
            : null,
          projects: projects.map((project) => ({
            _id: project._id,
            publicRef: project.publicRef,
            name: project.name,
            slug: project.slug,
            repositoryUrl: project.repositoryUrl,
            identifierPrefix: project.identifierPrefix,
            executionMode: project.executionMode,
            archivedAt: project.archivedAt,
          })),
        };
      }),
    );
  },
});

export const administration = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const principal = await requireHumanProject(ctx, args.projectId, {
      allowArchived: true,
    });
    const project = principal.project!;
    const organization = await ctx.db.get(project.organizationId);
    if (!organization) fail("not_found", "Organization or project not found");
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", organization._id),
      )
      .take(100);
    const members = (await Promise.all(
      memberships.map(async (membership) => ({
        membership,
        profile: await ctx.db.get(membership.profileId),
      })),
    )).flatMap(({ membership, profile }) =>
      profile
        ? [{
            membershipId: membership._id,
            profileId: profile._id,
            name: profile.name,
            email: profile.email,
            avatarUrl: profile.avatarUrl,
            role: membership.role,
            joinedAt: membership.createdAt,
            current: profile._id === principal.profile._id,
          }]
        : [],
    );
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", organization._id),
      )
      .take(100);
    const ledger = await ctx.db
      .query("storageLedgers")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", organization._id),
      )
      .unique();
    return {
      project: {
        name: project.name,
        slug: project.slug,
        repositoryUrl: project.repositoryUrl,
        identifierPrefix: project.identifierPrefix,
        executionMode: project.executionMode,
        archivedAt: project.archivedAt,
      },
      organization: {
        name: organization.name,
        slug: organization.slug,
        plan: organization.plan,
      },
      membershipRole: principal.membership.role,
      members,
      activeProjectCount: projects.filter(
        (candidate) => candidate.archivedAt === undefined,
      ).length,
      storage: {
        activeBytes: ledger?.activeBytes ?? 0,
        reservedBytes: ledger?.reservedBytes ?? 0,
        limitBytes: organizationStorageLimit(organization.plan),
        maximumAttachmentBytes: MAX_ATTACHMENT_BYTES,
      },
    };
  },
});

export const updateProject = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    repositoryUrl: v.optional(v.string()),
    executionMode: v.union(v.literal("manual"), v.literal("autonomous")),
  },
  handler: async (ctx, args) => {
    const principal = await requireHumanProject(ctx, args.projectId, {
      owner: true,
      allowArchived: true,
    });
    const name = requireString(args.name, "name", 240);
    const repositoryUrl = normalizeRepositoryUrl(args.repositoryUrl);
    const project = principal.project!;
    if (
      project.name === name &&
      project.repositoryUrl === repositoryUrl &&
      project.executionMode === args.executionMode
    ) {
      return { name, repositoryUrl, executionMode: args.executionMode };
    }
    const now = Date.now();
    await ctx.db.patch(project._id, {
      name,
      repositoryUrl,
      executionMode: args.executionMode,
      updatedAt: now,
    });
    await appendEvent(ctx, {
      organizationId: project.organizationId,
      projectId: project._id,
      actorId: principal.actor._id,
      type: "project.updated",
      data: { name, repositoryUrl: repositoryUrl ?? null, executionMode: args.executionMode },
      createdAt: now,
    });
    return { name, repositoryUrl, executionMode: args.executionMode };
  },
});

export const updateOrganization = mutation({
  args: { projectId: v.id("projects"), name: v.string() },
  handler: async (ctx, args) => {
    const principal = await requireHumanProject(ctx, args.projectId, {
      owner: true,
      allowArchived: true,
    });
    const organization = await ctx.db.get(principal.project!.organizationId);
    if (!organization) fail("not_found", "Organization or project not found");
    const name = requireString(args.name, "name", 240);
    if (organization.name === name) return { name };
    const now = Date.now();
    await ctx.db.patch(organization._id, { name, updatedAt: now });
    await appendEvent(ctx, {
      organizationId: organization._id,
      projectId: principal.project!._id,
      actorId: principal.actor._id,
      type: "organization.updated",
      data: { name },
      createdAt: now,
    });
    return { name };
  },
});

export const addMember = mutation({
  args: { projectId: v.id("projects"), email: v.string() },
  handler: async (ctx, args) => {
    const principal = await requireHumanProject(ctx, args.projectId, {
      owner: true,
      allowArchived: true,
    });
    const email = requireString(args.email, "email", 320).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
      fail("validation", "Enter a valid member email address");
    }
    const profiles = await ctx.db
      .query("humanProfiles")
      .withIndex("by_email", (query) => query.eq("email", email))
      .take(2);
    if (profiles.length !== 1) {
      fail("not_found", "No unique dongo account exists for that email");
    }
    const profile = profiles[0]!;
    const organizationId = principal.project!.organizationId;
    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_organization_profile", (query) =>
        query.eq("organizationId", organizationId).eq("profileId", profile._id),
      )
      .unique();
    if (existing) {
      return {
        membershipId: existing._id,
        created: false,
        role: existing.role,
      };
    }
    const now = Date.now();
    const membershipId = await ctx.db.insert("memberships", {
      organizationId,
      profileId: profile._id,
      role: "member",
      createdAt: now,
    });
    const actor = await ctx.db
      .query("actors")
      .withIndex("by_organization_profile", (query) =>
        query.eq("organizationId", organizationId).eq("profileId", profile._id),
      )
      .unique();
    if (!actor) {
      await ctx.db.insert("actors", {
        organizationId,
        type: "human",
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        profileId: profile._id,
        createdAt: now,
      });
    } else if (actor.type !== "human") {
      fail("unauthorized", "Member actor mapping is invalid");
    }
    await appendEvent(ctx, {
      organizationId,
      projectId: principal.project!._id,
      actorId: principal.actor._id,
      type: "membership.added",
      data: { profileId: profile._id, role: "member" },
      createdAt: now,
    });
    return { membershipId, created: true, role: "member" as const };
  },
});

export const removeMember = mutation({
  args: {
    projectId: v.id("projects"),
    membershipId: v.id("memberships"),
  },
  handler: async (ctx, args) => {
    const principal = await requireHumanProject(ctx, args.projectId, {
      owner: true,
      allowArchived: true,
    });
    const membership = await ctx.db.get(args.membershipId);
    if (
      !membership ||
      membership.organizationId !== principal.project!.organizationId
    ) {
      fail("not_found", "Organization member not found");
    }
    if (membership.role === "owner") {
      fail("forbidden", "The organization owner cannot be removed");
    }
    const now = Date.now();
    const installations = await ctx.db
      .query("installations")
      .withIndex("by_organization_authorizer", (query) =>
        query
          .eq("organizationId", membership.organizationId)
          .eq("authorizedByProfileId", membership.profileId),
      )
      .collect();
    for (const installation of installations) {
      if (installation.status !== "revoked") {
        await ctx.db.patch(installation._id, {
          status: "revoked",
          revokedAt: now,
          updatedAt: now,
        });
      }
      const binding = await ctx.db
        .query("oauthBindings")
        .withIndex("by_installation", (query) =>
          query.eq("installationId", installation._id),
        )
        .unique();
      if (binding?.status === "active") {
        await ctx.db.patch(binding._id, {
          status: "revoked",
          revokedAt: now,
          updatedAt: now,
        });
      }
    }
    await ctx.db.delete(membership._id);
    await appendEvent(ctx, {
      organizationId: membership.organizationId,
      projectId: principal.project!._id,
      actorId: principal.actor._id,
      type: "membership.removed",
      data: {
        profileId: membership.profileId,
        revokedInstallationCount: installations.length,
      },
      createdAt: now,
    });
    return {
      removed: true as const,
      revokedInstallationCount: installations.length,
    };
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

export const unarchiveProject = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const principal = await requireHumanProject(ctx, args.projectId, {
      owner: true,
      allowArchived: true,
    });
    const project = principal.project!;
    if (project.archivedAt === undefined) return { unarchived: true as const };
    const organization = await ctx.db.get(project.organizationId);
    if (!organization) fail("not_found", "Organization or project not found");
    if (organization.plan === "free") {
      const active = await ctx.db
        .query("projects")
        .withIndex("by_organization_archived", (q) =>
          q.eq("organizationId", organization._id).eq("archivedAt", undefined),
        )
        .take(1);
      if (active.length > 0) {
        fail("forbidden", "Archive the active project before restoring this one");
      }
    }
    const now = Date.now();
    await ctx.db.patch(project._id, { archivedAt: undefined, updatedAt: now });
    await appendEvent(ctx, {
      organizationId: project.organizationId,
      projectId: project._id,
      actorId: principal.actor._id,
      type: "project.unarchived",
      createdAt: now,
    });
    return { unarchived: true as const };
  },
});
