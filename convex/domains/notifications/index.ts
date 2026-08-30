import { v } from "convex/values";
import { internalMutation, mutation, query } from "../../_generated/server";
import { requireCurrentProfile } from "../../lib/authz";
import { fail, requireString } from "../../lib/errors";
import { enqueueAttentionNotifications } from "./service";

const MAX_PUSH_TOKEN_LENGTH = 4_096;
const APP_INSTALLATION_ID_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;

export const registerDevice = mutation({
  args: {
    platform: v.union(v.literal("ios"), v.literal("android")),
    appInstallationId: v.string(),
    pushToken: v.string(),
  },
  handler: async (ctx, args) => {
    const profile = await requireCurrentProfile(ctx);
    const appInstallationId = requireString(
      args.appInstallationId,
      "appInstallationId",
      200,
    );
    if (!APP_INSTALLATION_ID_PATTERN.test(appInstallationId)) {
      fail("validation", "appInstallationId has an invalid format");
    }
    const pushToken = requireString(
      args.pushToken,
      "pushToken",
      MAX_PUSH_TOKEN_LENGTH,
    );
    const pushTokenHash = await sha256Hex(pushToken);
    const now = Date.now();
    const tokenOwner = await ctx.db
      .query("devices")
      .withIndex("by_push_token_hash", (query) =>
        query.eq("pushTokenHash", pushTokenHash),
      )
      .unique();
    const installation = await ctx.db
      .query("devices")
      .withIndex("by_profile_installation", (query) =>
        query
          .eq("profileId", profile._id)
          .eq("appInstallationId", appInstallationId),
      )
      .unique();
    if (tokenOwner && tokenOwner._id !== installation?._id) {
      await ctx.db.patch(tokenOwner._id, {
        pushToken: "",
        pushTokenHash: `retired:${tokenOwner._id}:${now}`,
        enabled: false,
        updatedAt: now,
        disabledAt: now,
      });
    }
    if (installation) {
      await ctx.db.patch(installation._id, {
        platform: args.platform,
        pushToken,
        pushTokenHash,
        enabled: true,
        updatedAt: now,
        lastSeenAt: now,
        disabledAt: undefined,
      });
      return { deviceId: installation._id, created: false };
    }
    const deviceId = await ctx.db.insert("devices", {
      profileId: profile._id,
      platform: args.platform,
      appInstallationId,
      pushToken,
      pushTokenHash,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    });
    return { deviceId, created: true };
  },
});

export const disableDevice = mutation({
  args: { deviceId: v.id("devices") },
  handler: async (ctx, args) => {
    const profile = await requireCurrentProfile(ctx);
    const device = await ctx.db.get(args.deviceId);
    if (!device || device.profileId !== profile._id) {
      fail("not_found", "Device not found");
    }
    if (!device.enabled) return { deviceId: device._id, enabled: false };
    const now = Date.now();
    await ctx.db.patch(device._id, {
      pushToken: "",
      pushTokenHash: `retired:${device._id}:${now}`,
      enabled: false,
      updatedAt: now,
      disabledAt: now,
    });
    return { deviceId: device._id, enabled: false };
  },
});

export const currentDevices = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireCurrentProfile(ctx);
    const devices = await ctx.db
      .query("devices")
      .withIndex("by_profile_enabled", (query) =>
        query.eq("profileId", profile._id),
      )
      .take(100);
    return devices.map((device) => ({
      id: device._id,
      platform: device.platform,
      appInstallationId: device.appInstallationId,
      enabled: device.enabled,
      createdAt: device.createdAt,
      lastSeenAt: device.lastSeenAt,
    }));
  },
});

export const enqueueForAttention = internalMutation({
  args: { attentionRequestId: v.id("attentionRequests") },
  handler: async (ctx, args) =>
    await enqueueAttentionNotifications(ctx, {
      attentionRequestId: args.attentionRequestId,
      now: Date.now(),
    }),
});

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
