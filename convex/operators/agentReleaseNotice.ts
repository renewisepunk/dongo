import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { fail } from "../lib/errors";

const releaseIdPattern = /^[a-z0-9][a-z0-9._-]{0,79}$/u;

function validateMarker(releaseId: string, releaseSequence: number): void {
  if (
    !releaseIdPattern.test(releaseId) ||
    !Number.isSafeInteger(releaseSequence) ||
    releaseSequence <= 0
  ) {
    fail("validation", "Agent release notice marker is invalid");
  }
}

export const inspect = internalQuery({
  args: {},
  handler: async (ctx) => {
    const active = await ctx.db
      .query("agentReleaseNoticeChannels")
      .withIndex("by_channel", (query) => query.eq("channel", "stable"))
      .unique();
    return active === null
      ? { active: false as const }
      : {
          active: true as const,
          releaseId: active.activeReleaseId,
          releaseSequence: active.activeReleaseSequence,
          activatedAt: active.activatedAt,
        };
  },
});

export const activate = internalMutation({
  args: {
    releaseId: v.string(),
    releaseSequence: v.number(),
  },
  handler: async (ctx, args) => {
    validateMarker(args.releaseId, args.releaseSequence);
    const active = await ctx.db
      .query("agentReleaseNoticeChannels")
      .withIndex("by_channel", (query) => query.eq("channel", "stable"))
      .unique();
    if (active !== null) {
      if (args.releaseSequence < active.activeReleaseSequence) {
        fail("revision_conflict", "Agent release notice activation cannot move backward");
      }
      if (args.releaseSequence === active.activeReleaseSequence) {
        if (args.releaseId !== active.activeReleaseId) {
          fail("revision_conflict", "Agent release notice sequence is already activated with another id");
        }
        return {
          activated: false,
          releaseId: active.activeReleaseId,
          releaseSequence: active.activeReleaseSequence,
          activatedAt: active.activatedAt,
        };
      }
    }
    const activatedAt = Date.now();
    if (active === null) {
      await ctx.db.insert("agentReleaseNoticeChannels", {
        channel: "stable",
        activeReleaseId: args.releaseId,
        activeReleaseSequence: args.releaseSequence,
        activatedAt,
      });
    } else {
      await ctx.db.patch(active._id, {
        activeReleaseId: args.releaseId,
        activeReleaseSequence: args.releaseSequence,
        activatedAt,
      });
    }
    return {
      activated: true,
      releaseId: args.releaseId,
      releaseSequence: args.releaseSequence,
      activatedAt,
    };
  },
});
