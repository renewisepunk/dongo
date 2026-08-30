import { mutation, query } from "../../_generated/server";
import { authSubject, requireCurrentProfile } from "../../lib/authz";
import { optionalString, requireString } from "../../lib/errors";

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
    const name = requireString(
      identity.name?.trim() || identity.email?.trim() || "Dongo user",
      "name",
      240,
    );
    const email = optionalString(identity.email, "email", 320);
    const avatarUrl = optionalString(identity.pictureUrl, "avatarUrl", 2_048);
    if (existing) {
      await ctx.db.patch(existing._id, { name, email, avatarUrl, updatedAt: now });
      return { profileId: existing._id, created: false };
    }
    const profileId = await ctx.db.insert("humanProfiles", {
      authSubject: subject,
      email,
      name,
      avatarUrl,
      createdAt: now,
      updatedAt: now,
    });
    return { profileId, created: true };
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
