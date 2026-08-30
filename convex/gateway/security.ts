import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { fail, requireString } from "../lib/errors";

const NONCE_TTL_MS = 2 * 60 * 1_000;

export const consumeNonce = internalMutation({
  args: {
    keyId: v.string(),
    nonce: v.string(),
    requestId: v.string(),
    requestDigest: v.string(),
  },
  handler: async (ctx, args) => {
    const keyId = requireString(args.keyId, "keyId", 64);
    const nonce = requireString(args.nonce, "nonce", 128);
    const requestId = requireString(args.requestId, "requestId", 200);
    const requestDigest = requireString(
      args.requestDigest,
      "requestDigest",
      64,
    );
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        nonce,
      )
    ) {
      fail("unauthorized", "Gateway nonce is invalid");
    }
    const existing = await ctx.db
      .query("gatewayNonces")
      .withIndex("by_key_nonce", (q) =>
        q.eq("keyId", keyId).eq("nonce", nonce),
      )
      .unique();
    if (existing) fail("unauthorized", "Gateway request was already consumed");
    const now = Date.now();
    await ctx.db.insert("gatewayNonces", {
      keyId,
      nonce,
      requestId,
      requestDigest,
      createdAt: now,
      expiresAt: now + NONCE_TTL_MS,
    });
    return { consumed: true };
  },
});

export const removeExpiredNonces = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const expired = await ctx.db
      .query("gatewayNonces")
      .withIndex("by_expires_at", (q) => q.lte("expiresAt", Date.now()))
      .take(Math.max(1, Math.min(args.limit ?? 500, 1_000)));
    for (const nonce of expired) await ctx.db.delete(nonce._id);
    return { removed: expired.length };
  },
});
