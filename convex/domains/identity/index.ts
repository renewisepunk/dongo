import { mutation, query } from "../../_generated/server";
import { authSubject, requireCurrentProfile } from "../../lib/authz";
import { optionalString, requireString } from "../../lib/errors";
import { INITIAL_SUPER_ADMIN_EMAIL } from "../../lib/platform";

export const bootstrapCurrentUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication is required");
    const subject = authSubject(identity);
    const existing = await ctx.db
      .query("humanProfiles")
      .withIndex("by_auth_subject", (q) => q.eq("authSubject", subject))
      .unique();
    const now = Date.now();
    const email = optionalString(identity.email, "email", 320)?.toLowerCase();
    const name = requireString(
      identity.name?.trim() || email || "dongo user",
      "name",
      240,
    );
    const avatarUrl = optionalString(identity.pictureUrl, "avatarUrl", 2_048);
    const initialPlatformRole = email === INITIAL_SUPER_ADMIN_EMAIL
      ? "super_admin" as const
      : undefined;
    if (existing) {
      const platformRole = existing.platformRole ?? initialPlatformRole;
      await ctx.db.patch(existing._id, {
        name,
        email,
        avatarUrl,
        platformRole,
        updatedAt: now,
      });
      return {
        profileId: existing._id,
        created: false,
        isSuperAdmin: platformRole === "super_admin",
      };
    }
    const profileId = await ctx.db.insert("humanProfiles", {
      authSubject: subject,
      email,
      name,
      avatarUrl,
      platformRole: initialPlatformRole,
      createdAt: now,
      updatedAt: now,
    });
    return {
      profileId,
      created: true,
      isSuperAdmin: initialPlatformRole === "super_admin",
    };
  },
});

export const current = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireCurrentProfile(ctx);
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .take(100);
    return {
      profile: {
        _id: profile._id,
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        isSuperAdmin: profile.platformRole === "super_admin",
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      },
      memberships: memberships.map((membership) => ({
        _id: membership._id,
        organizationId: membership.organizationId,
        role: membership.role,
        createdAt: membership.createdAt,
      })),
    };
  },
});
