import { v } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";
import { internalAction, internalMutation } from "../../_generated/server";
import { IMPORTANT_EMAIL_DELAY_MS } from "./service";

const DELIVERY_PATH = "/api/notifications/v1/deliver";
const DELIVERY_LEASE_MS = 2 * 60 * 1_000;
const MAX_ATTEMPTS = 6;
const MAX_RESPONSE_BYTES = 16 * 1_024;

type PushRequest = {
  version: 1;
  deliveryId: string;
  idempotencyKey: string;
  channel: "push";
  platform: "ios" | "android";
  pushToken: string;
  attentionRequestId: string;
  workItemId: string;
  projectId: string;
  deepLinkPath: string;
};

type EmailRequest = {
  version: 1;
  deliveryId: string;
  idempotencyKey: string;
  channel: "email";
  email: string;
  attentionRequestId: string;
  workItemId: string;
  projectId: string;
  deepLinkPath: string;
  projectName: string;
  workIdentifier: string;
  workTitle: string;
  attentionKind: "review" | "decision" | "question" | "blocked";
  attentionTitle: string;
};

type ClaimedDelivery = {
  outboxId: Id<"notificationOutbox">;
  attemptId: string;
  request: PushRequest | EmailRequest;
};

type WorkerResult =
  | { ok: true; messageId: string }
  | {
      ok: false;
      errorCode: string;
      retryable: boolean;
      disableDevice: boolean;
    };

export const claimDue = internalMutation({
  args: { limit: v.number(), now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<ClaimedDelivery[]> => {
    const now = args.now ?? Date.now();
    const limit = Math.max(1, Math.min(Math.floor(args.limit), 25));
    const pending = await ctx.db
      .query("notificationOutbox")
      .withIndex("by_status_available", (query) =>
        query.eq("status", "pending").lte("availableAt", now),
      )
      .take(limit);
    const remaining = limit - pending.length;
    const abandoned =
      remaining > 0
        ? await ctx.db
            .query("notificationOutbox")
            .withIndex("by_status_available", (query) =>
              query.eq("status", "delivering").lte("availableAt", now),
            )
            .take(remaining)
        : [];
    const claimed: ClaimedDelivery[] = [];
    for (const delivery of [...pending, ...abandoned]) {
      const attention = await ctx.db.get(delivery.attentionRequestId);
      if (!attention || attention.status === "resolved") {
        await ctx.db.patch(delivery._id, {
          status: "cancelled",
          cancelledAt: now,
          deliveryAttemptId: undefined,
          lastErrorCode: "attention_resolved",
        });
        continue;
      }
      if (!delivery.channel || !delivery.dedupeKey) {
        await ctx.db.patch(delivery._id, {
          status: "failed",
          failedAt: now,
          deliveryAttemptId: undefined,
          lastErrorCode: "legacy_delivery_record",
        });
        continue;
      }
      if (delivery.channel === "email" && attention.urgency !== "important") {
        await ctx.db.patch(delivery._id, {
          status: "cancelled",
          cancelledAt: now,
          deliveryAttemptId: undefined,
          lastErrorCode: "email_escalation_not_applicable",
        });
        continue;
      }
      if (
        delivery.channel === "email" &&
        now < attention.createdAt + IMPORTANT_EMAIL_DELAY_MS
      ) {
        await ctx.db.patch(delivery._id, {
          status: "pending",
          availableAt: attention.createdAt + IMPORTANT_EMAIL_DELAY_MS,
          deliveryAttemptId: undefined,
          lastErrorCode: undefined,
        });
        continue;
      }
      if (delivery.attemptCount >= MAX_ATTEMPTS) {
        await ctx.db.patch(delivery._id, {
          status: "failed",
          failedAt: now,
          deliveryAttemptId: undefined,
          lastErrorCode: delivery.lastErrorCode ?? "attempts_exhausted",
        });
        continue;
      }
      const project = await ctx.db.get(delivery.projectId);
      const work = await ctx.db.get(attention.workItemId);
      const profile = await ctx.db.get(delivery.recipientProfileId);
      if (
        !project ||
        !work ||
        !profile ||
        project.organizationId !== delivery.organizationId ||
        work.projectId !== project._id ||
        attention.projectId !== project._id ||
        attention.requestedFromProfileId !== profile._id
      ) {
        await ctx.db.patch(delivery._id, {
          status: "failed",
          failedAt: now,
          deliveryAttemptId: undefined,
          lastErrorCode: "delivery_context_invalid",
        });
        continue;
      }
      const organization = await ctx.db.get(project.organizationId);
      if (!organization) {
        await ctx.db.patch(delivery._id, {
          status: "failed",
          failedAt: now,
          deliveryAttemptId: undefined,
          lastErrorCode: "delivery_context_invalid",
        });
        continue;
      }
      const attemptId = crypto.randomUUID();
      let request: PushRequest | EmailRequest;
      const deepLinkPath = `/app/${encodeURIComponent(organization.slug)}/${encodeURIComponent(project.slug)}?work=${encodeURIComponent(work._id)}`;
      if (delivery.channel === "push") {
        const device = delivery.deviceId
          ? await ctx.db.get(delivery.deviceId)
          : null;
        if (
          !device ||
          !device.enabled ||
          device.profileId !== profile._id ||
          device.pushToken.length === 0
        ) {
          await ctx.db.patch(delivery._id, {
            status: "cancelled",
            cancelledAt: now,
            deliveryAttemptId: undefined,
            lastErrorCode: "device_unavailable",
          });
          continue;
        }
        request = {
          version: 1,
          deliveryId: delivery._id,
          idempotencyKey: delivery.dedupeKey,
          channel: "push",
          platform: device.platform,
          pushToken: device.pushToken,
          attentionRequestId: attention._id,
          workItemId: work._id,
          projectId: project._id,
          deepLinkPath,
        };
      } else {
        if (!profile.email) {
          await ctx.db.patch(delivery._id, {
            status: "failed",
            failedAt: now,
            deliveryAttemptId: undefined,
            lastErrorCode: "recipient_email_unavailable",
          });
          continue;
        }
        request = {
          version: 1,
          deliveryId: delivery._id,
          idempotencyKey: delivery.dedupeKey,
          channel: "email",
          email: profile.email,
          attentionRequestId: attention._id,
          workItemId: work._id,
          projectId: project._id,
          deepLinkPath,
          projectName: project.name,
          workIdentifier: work.identifier,
          workTitle: work.title,
          attentionKind: attention.kind,
          attentionTitle: attention.title,
        };
      }
      await ctx.db.patch(delivery._id, {
        status: "delivering",
        attemptCount: delivery.attemptCount + 1,
        availableAt: now + DELIVERY_LEASE_MS,
        deliveryAttemptId: attemptId,
        lastErrorCode: undefined,
      });
      claimed.push({ outboxId: delivery._id, attemptId, request });
    }
    return claimed;
  },
});

export const completeDelivery = internalMutation({
  args: {
    outboxId: v.id("notificationOutbox"),
    attemptId: v.string(),
    providerMessageId: v.string(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.outboxId);
    if (
      !delivery ||
      delivery.status !== "delivering" ||
      delivery.deliveryAttemptId !== args.attemptId
    ) {
      return { applied: false };
    }
    await ctx.db.patch(delivery._id, {
      status: "delivered",
      deliveredAt: args.now ?? Date.now(),
      deliveryAttemptId: undefined,
      providerMessageId: args.providerMessageId.slice(0, 500),
      lastErrorCode: undefined,
    });
    return { applied: true };
  },
});

export const recordFailure = internalMutation({
  args: {
    outboxId: v.id("notificationOutbox"),
    attemptId: v.string(),
    errorCode: v.string(),
    retryable: v.boolean(),
    disableDevice: v.boolean(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.outboxId);
    if (
      !delivery ||
      delivery.status !== "delivering" ||
      delivery.deliveryAttemptId !== args.attemptId
    ) {
      return { applied: false, status: delivery?.status ?? "missing" };
    }
    const now = args.now ?? Date.now();
    const errorCode = safeErrorCode(args.errorCode);
    if (args.disableDevice && delivery.deviceId) {
      const device = await ctx.db.get(delivery.deviceId);
      if (device) {
        await ctx.db.patch(device._id, {
          pushToken: "",
          pushTokenHash: `retired:${device._id}:${now}`,
          enabled: false,
          updatedAt: now,
          disabledAt: now,
        });
      }
    }
    if (args.retryable && delivery.attemptCount < MAX_ATTEMPTS) {
      const backoff = Math.min(
        60 * 60 * 1_000,
        30_000 * 2 ** Math.max(0, delivery.attemptCount - 1),
      );
      await ctx.db.patch(delivery._id, {
        status: "pending",
        availableAt: now + backoff,
        deliveryAttemptId: undefined,
        lastErrorCode: errorCode,
      });
      return { applied: true, status: "pending" as const };
    }
    await ctx.db.patch(delivery._id, {
      status: "failed",
      failedAt: now,
      deliveryAttemptId: undefined,
      lastErrorCode: errorCode,
    });
    return { applied: true, status: "failed" as const };
  },
});

export const dispatchDue = internalAction({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{
    claimed: number;
    delivered: number;
    retried: number;
    failed: number;
  }> => {
    const endpoint = notificationEndpoint();
    const secret = process.env.DONGO_NOTIFICATION_DISPATCH_SECRET;
    if (!secret || new TextEncoder().encode(secret).byteLength < 32) {
      throw new Error("Notification dispatch signing is not configured");
    }
    const claimed: ClaimedDelivery[] = await ctx.runMutation(
      internal.domains.notifications.dispatcher.claimDue,
      { limit: args.limit ?? 25 },
    );
    let delivered = 0;
    let retried = 0;
    let failed = 0;
    for (const delivery of claimed) {
      const result = await sendToWorker({
        endpoint,
        secret,
        request: delivery.request,
      });
      if (result.ok) {
        const completion: { applied: boolean } = await ctx.runMutation(
          internal.domains.notifications.dispatcher.completeDelivery,
          {
            outboxId: delivery.outboxId,
            attemptId: delivery.attemptId,
            providerMessageId: result.messageId,
          },
        );
        if (completion.applied) delivered += 1;
        continue;
      }
      const recorded: { applied: boolean; status: string } = await ctx.runMutation(
        internal.domains.notifications.dispatcher.recordFailure,
        {
          outboxId: delivery.outboxId,
          attemptId: delivery.attemptId,
          errorCode: result.errorCode,
          retryable: result.retryable,
          disableDevice: result.disableDevice,
        },
      );
      if (recorded.applied && recorded.status === "pending") retried += 1;
      if (recorded.applied && recorded.status === "failed") failed += 1;
    }
    return { claimed: claimed.length, delivered, retried, failed };
  },
});

function notificationEndpoint(): URL {
  const value = process.env.DONGO_NOTIFICATION_DELIVERY_URL;
  if (!value) throw new Error("Notification delivery endpoint is not configured");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Notification delivery endpoint is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.pathname !== DELIVERY_PATH ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    (url.hostname !== "dev.dongo.so" && url.hostname !== "dongo.so")
  ) {
    throw new Error("Notification delivery endpoint is not trusted");
  }
  return url;
}

async function sendToWorker(input: {
  endpoint: URL;
  secret: string;
  request: PushRequest | EmailRequest;
}): Promise<WorkerResult> {
  const body = JSON.stringify({
    ...input.request,
    deepLink: new URL(input.request.deepLinkPath, input.endpoint.origin).toString(),
    deepLinkPath: undefined,
  });
  const timestamp = String(Date.now());
  const nonce = crypto.randomUUID();
  const signature = await signNotificationRequest({
    secret: input.secret,
    timestamp,
    nonce,
    method: "POST",
    pathname: input.endpoint.pathname,
    body: new TextEncoder().encode(body),
  });
  let response: Response;
  try {
    response = await fetch(input.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-dongo-key-id": "v1",
        "x-dongo-timestamp": timestamp,
        "x-dongo-nonce": nonce,
        "x-dongo-signature": signature,
      },
      body,
    });
  } catch {
    return {
      ok: false,
      errorCode: "notification_worker_unavailable",
      retryable: true,
      disableDevice: false,
    };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(
      new TextDecoder().decode(await readBoundedResponse(response)),
    );
  } catch {
    return {
      ok: false,
      errorCode: "notification_worker_invalid_response",
      retryable: response.status === 429 || response.status >= 500,
      disableDevice: false,
    };
  }
  if (
    response.ok &&
    payload &&
    typeof payload === "object" &&
    (payload as { ok?: unknown }).ok === true &&
    typeof (payload as { messageId?: unknown }).messageId === "string"
  ) {
    return {
      ok: true,
      messageId: (payload as { messageId: string }).messageId.slice(0, 500),
    };
  }
  const error =
    payload && typeof payload === "object" && "error" in payload
      ? (payload as { error?: unknown }).error
      : undefined;
  const record = error && typeof error === "object" ? error : undefined;
  return {
    ok: false,
    errorCode:
      record && typeof (record as { code?: unknown }).code === "string"
        ? safeErrorCode((record as { code: string }).code)
        : "notification_worker_rejected",
    retryable:
      record && typeof (record as { retryable?: unknown }).retryable === "boolean"
        ? (record as { retryable: boolean }).retryable
        : response.status === 429 || response.status >= 500,
    disableDevice:
      record !== undefined &&
      (record as { disableDevice?: unknown }).disableDevice === true,
  };
}

export async function signNotificationRequest(input: {
  secret: string;
  timestamp: string;
  nonce: string;
  method: string;
  pathname: string;
  body: Uint8Array;
}): Promise<string> {
  const ownedBody = new Uint8Array(input.body.byteLength);
  ownedBody.set(input.body);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", ownedBody.buffer),
  );
  const bodyHash = [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const canonical = [
    input.timestamp,
    input.nonce,
    input.method.toUpperCase(),
    input.pathname,
    bodyHash,
  ].join("\n");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(input.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonical)),
  );
  let binary = "";
  for (const byte of signature) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function readBoundedResponse(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new Error("notification response too large");
  }
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel("notification response exceeded limit");
      throw new Error("notification response too large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function safeErrorCode(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]/g, "_");
  return normalized.slice(0, 100) || "notification_delivery_failed";
}
