import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";

export const IMPORTANT_EMAIL_DELAY_MS = 60 * 60 * 1_000;

export async function enqueueAttentionNotifications(
  ctx: MutationCtx,
  options: {
    attentionRequestId: Id<"attentionRequests">;
    now: number;
  },
): Promise<{ push: number; email: number }> {
  const attention = await ctx.db.get(options.attentionRequestId);
  if (!attention || attention.status === "resolved") {
    return { push: 0, email: 0 };
  }
  const devices = await ctx.db
    .query("devices")
    .withIndex("by_profile_enabled", (query) =>
      query.eq("profileId", attention.requestedFromProfileId).eq("enabled", true),
    )
    .take(50);
  let push = 0;
  for (const device of devices) {
    const dedupeKey = `attention:${attention._id}:push:${device._id}`;
    const existing = await ctx.db
      .query("notificationOutbox")
      .withIndex("by_dedupe", (query) => query.eq("dedupeKey", dedupeKey))
      .unique();
    if (existing) continue;
    await ctx.db.insert("notificationOutbox", {
      organizationId: attention.organizationId,
      projectId: attention.projectId,
      attentionRequestId: attention._id,
      recipientProfileId: attention.requestedFromProfileId,
      eventType: "attention.requested",
      channel: "push",
      deviceId: device._id,
      dedupeKey,
      status: "pending",
      attemptCount: 0,
      availableAt: options.now,
      createdAt: options.now,
    });
    push += 1;
  }
  if (attention.urgency !== "important") return { push, email: 0 };

  const dedupeKey = `attention:${attention._id}:email`;
  const existing = await ctx.db
    .query("notificationOutbox")
    .withIndex("by_dedupe", (query) => query.eq("dedupeKey", dedupeKey))
    .unique();
  if (existing) return { push, email: 0 };
  await ctx.db.insert("notificationOutbox", {
    organizationId: attention.organizationId,
    projectId: attention.projectId,
    attentionRequestId: attention._id,
    recipientProfileId: attention.requestedFromProfileId,
    eventType: "attention.requested",
    channel: "email",
    dedupeKey,
    status: "pending",
    attemptCount: 0,
    availableAt: options.now + IMPORTANT_EMAIL_DELAY_MS,
    createdAt: options.now,
  });
  return { push, email: 1 };
}

export async function cancelOutstandingNotifications(
  ctx: MutationCtx,
  options: {
    attentionRequestId: Id<"attentionRequests">;
    now: number;
  },
): Promise<number> {
  const deliveries = await ctx.db
    .query("notificationOutbox")
    .withIndex("by_attention", (query) =>
      query.eq("attentionRequestId", options.attentionRequestId),
    )
    .collect();
  let cancelled = 0;
  for (const delivery of deliveries) {
    if (delivery.status !== "pending" && delivery.status !== "delivering") {
      continue;
    }
    await ctx.db.patch(delivery._id, {
      status: "cancelled",
      cancelledAt: options.now,
      deliveryAttemptId: undefined,
      lastErrorCode: "attention_resolved",
    });
    cancelled += 1;
  }
  return cancelled;
}
