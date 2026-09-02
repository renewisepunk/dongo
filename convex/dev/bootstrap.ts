import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { fail } from "../lib/errors";
import { derivedCompactIdentifierPrefix } from "../domains/work/identifiers";

export const createWalkingSkeleton = internalMutation({
  args: {
    key: v.string(),
    organizationSlug: v.string(),
    projectSlug: v.string(),
  },
  handler: async (ctx, args) => {
    if (process.env.DONGO_ENABLE_DEV_BOOTSTRAP !== "true") {
      fail("development_bootstrap_disabled", "Development bootstrap is disabled");
    }
    const authSubject = `development:${args.key}`;
    const existing = await ctx.db
      .query("humanProfiles")
      .withIndex("by_auth_subject", (q) => q.eq("authSubject", authSubject))
      .unique();
    if (existing) {
      const memberships = await ctx.db
        .query("memberships")
        .withIndex("by_profile", (q) => q.eq("profileId", existing._id))
        .collect();
      const projects = memberships.length
        ? await ctx.db
            .query("projects")
            .withIndex("by_organization", (q) =>
              q.eq("organizationId", memberships[0].organizationId),
            )
            .collect()
        : [];
      const installation = projects.length
        ? await ctx.db
            .query("installations")
            .withIndex("by_project_client", (q) =>
              q.eq("projectId", projects[0]._id).eq("clientId", "dongo-development"),
            )
            .first()
        : null;
      return {
        profileId: existing._id,
        organizationId: memberships[0]?.organizationId,
        projectId: projects[0]?._id,
        installationId: installation?._id,
        projectRef: projects[0]?.publicRef,
        projectName: projects[0]?.name,
        created: false,
      };
    }
    const now = Date.now();
    const profileId = await ctx.db.insert("humanProfiles", {
      authSubject,
      name: "dongo developer",
      email: `${args.key}@development.invalid`,
      createdAt: now,
      updatedAt: now,
    });
    const organizationId = await ctx.db.insert("organizations", {
      name: "dongo development",
      slug: args.organizationSlug,
      createdByProfileId: profileId,
      plan: "free",
      createdWorkItemCount: 0,
      workItemCountState: "exact",
      closedWorkItemCount: 0,
      usageTrackingStartedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("memberships", {
      organizationId,
      profileId,
      role: "owner",
      createdAt: now,
    });
    await ctx.db.insert("actors", {
      organizationId,
      type: "human",
      name: "dongo developer",
      profileId,
      createdAt: now,
      lastSeenAt: now,
    });
    await ctx.db.insert("actors", {
      organizationId,
      type: "system",
      name: "dongo",
      createdAt: now,
    });
    const publicRef = `${String(organizationId).slice(-8)}-${args.projectSlug}`;
    const projectId = await ctx.db.insert("projects", {
      organizationId,
      name: "dongo development",
      slug: args.projectSlug,
      publicRef,
      identifierPrefix: "DON",
      compactIdentifierPrefix: derivedCompactIdentifierPrefix({
        slug: args.projectSlug,
        identifierPrefix: "DON",
      }),
      nextWorkNumber: 1,
      executionMode: "manual",
      createdAt: now,
      updatedAt: now,
    });
    const actorId = await ctx.db.insert("actors", {
      organizationId,
      type: "agent",
      name: "Development agent",
      agentType: "development",
      createdAt: now,
      lastSeenAt: now,
    });
    const installationId = await ctx.db.insert("installations", {
      organizationId,
      projectId,
      actorId,
      kind: "development",
      status: "active",
      clientId: "dongo-development",
      label: "Development agent",
      resource: "development://dongo-agent-api",
      scopes: [
        "dongo:work:read",
        "dongo:work:write",
        "dongo:attachments:read",
      ],
      authorizedByProfileId: profileId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(actorId, { installationId });
    return {
      profileId,
      organizationId,
      projectId,
      installationId,
      projectRef: publicRef,
      projectName: "dongo development",
      created: true,
    };
  },
});
