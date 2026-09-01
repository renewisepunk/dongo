import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { modules } from "../test.setup";
import { IMPORTANT_EMAIL_DELAY_MS } from "../domains/notifications/service";

const identity = {
  tokenIdentifier: "https://human.example.test|notification-owner",
  subject: "notification-owner",
  issuer: "https://human.example.test",
  email: "notification-owner@example.test",
  name: "Notification Owner",
};

const dispatchSecret = "test-notification-dispatch-secret-at-least-32-characters";

beforeEach(() => {
  process.env.DONGO_NOTIFICATION_DELIVERY_URL =
    "https://dev.dongo.so/api/notifications/v1/deliver";
  process.env.DONGO_NOTIFICATION_DISPATCH_SECRET = dispatchSecret;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("notification scheduling", () => {
  it("rotates device tokens without exposing them to clients", async () => {
    const human = convexTest(schema, modules).withIdentity(identity);
    await human.mutation(api.domains.identity.index.bootstrapCurrentUser, {});
    const first = await human.mutation(
      api.domains.notifications.index.registerDevice,
      {
        platform: "ios",
        appInstallationId: "ios-installation-1",
        pushToken: "apns-token-original",
      },
    );
    const rotated = await human.mutation(
      api.domains.notifications.index.registerDevice,
      {
        platform: "ios",
        appInstallationId: "ios-installation-1",
        pushToken: "apns-token-rotated",
      },
    );
    expect(rotated).toEqual({ deviceId: first.deviceId, created: false });
    const visible = await human.query(
      api.domains.notifications.index.currentDevices,
      {},
    );
    expect(visible).toEqual([
      expect.objectContaining({
        id: first.deviceId,
        platform: "ios",
        appInstallationId: "ios-installation-1",
        enabled: true,
      }),
    ]);
    expect(JSON.stringify(visible)).not.toContain("apns-token");
    const stored = await human.run(async (ctx) =>
      await ctx.db.get(first.deviceId),
    );
    expect(stored?.pushToken).toBe("apns-token-rotated");

    await human.mutation(api.domains.notifications.index.disableDevice, {
      deviceId: first.deviceId,
    });
    const disabled = await human.run(async (ctx) =>
      await ctx.db.get(first.deviceId),
    );
    expect(disabled).toMatchObject({ enabled: false, pushToken: "" });
  });

  it("creates one immediate push per device and one delayed important email", async () => {
    const human = convexTest(schema, modules).withIdentity(identity);
    await human.mutation(api.domains.identity.index.bootstrapCurrentUser, {});
    const device = await human.mutation(
      api.domains.notifications.index.registerDevice,
      {
        platform: "android",
        appInstallationId: "android-installation-1",
        pushToken: "fcm-registration-token",
      },
    );
    const seeded = await seedAttention(human, "important");
    const before = Date.now();
    await expect(
      human.mutation(internal.domains.notifications.index.enqueueForAttention, {
        attentionRequestId: seeded.attentionRequestId,
      }),
    ).resolves.toEqual({ push: 1, email: 1 });
    await expect(
      human.mutation(internal.domains.notifications.index.enqueueForAttention, {
        attentionRequestId: seeded.attentionRequestId,
      }),
    ).resolves.toEqual({ push: 0, email: 0 });

    const outbox = await human.run(async (ctx) =>
      await ctx.db
        .query("notificationOutbox")
        .withIndex("by_attention", (query) =>
          query.eq("attentionRequestId", seeded.attentionRequestId),
        )
        .collect(),
    );
    expect(outbox).toHaveLength(2);
    const push = outbox.find((delivery) => delivery.channel === "push");
    const email = outbox.find((delivery) => delivery.channel === "email");
    expect(push).toMatchObject({
      deviceId: device.deviceId,
      status: "pending",
      attemptCount: 0,
    });
    expect(push!.availableAt).toBeLessThan(before + 5_000);
    expect(email).toMatchObject({ status: "pending", attemptCount: 0 });
    expect(email!.availableAt).toBeGreaterThanOrEqual(
      before + IMPORTANT_EMAIL_DELAY_MS,
    );
  });

  it("does not schedule email for normal Attention", async () => {
    const human = convexTest(schema, modules).withIdentity(identity);
    await human.mutation(api.domains.identity.index.bootstrapCurrentUser, {});
    const seeded = await seedAttention(human, "normal");
    await expect(
      human.mutation(internal.domains.notifications.index.enqueueForAttention, {
        attentionRequestId: seeded.attentionRequestId,
      }),
    ).resolves.toEqual({ push: 0, email: 0 });
  });

  it("claims an important email only after the full escalation delay", async () => {
    const human = convexTest(schema, modules).withIdentity(identity);
    await human.mutation(api.domains.identity.index.bootstrapCurrentUser, {});
    const seeded = await seedAttention(human, "important");
    await human.mutation(
      internal.domains.notifications.index.enqueueForAttention,
      { attentionRequestId: seeded.attentionRequestId },
    );
    const delivery = await human.run(async (ctx) =>
      await ctx.db
        .query("notificationOutbox")
        .withIndex("by_attention", (query) =>
          query.eq("attentionRequestId", seeded.attentionRequestId),
        )
        .unique(),
    );
    expect(delivery?.channel).toBe("email");
    await expect(
      human.mutation(internal.domains.notifications.dispatcher.claimDue, {
        limit: 1,
        now: delivery!.availableAt - 1,
      }),
    ).resolves.toEqual([]);
    const claimed = await human.mutation(
      internal.domains.notifications.dispatcher.claimDue,
      { limit: 1, now: delivery!.availableAt },
    );
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.request).toMatchObject({
      channel: "email",
      email: identity.email,
      attentionKind: "decision",
      workIdentifier: "proj001",
    });
  });

  it("claims due deliveries atomically and ignores stale completion attempts", async () => {
    const human = convexTest(schema, modules).withIdentity(identity);
    await human.mutation(api.domains.identity.index.bootstrapCurrentUser, {});
    await human.mutation(api.domains.notifications.index.registerDevice, {
      platform: "android",
      appInstallationId: "android-installation-claim",
      pushToken: "fcm-claim-token",
    });
    const seeded = await seedAttention(human, "normal");
    await human.mutation(
      internal.domains.notifications.index.enqueueForAttention,
      { attentionRequestId: seeded.attentionRequestId },
    );
    const claimed = await human.mutation(
      internal.domains.notifications.dispatcher.claimDue,
      { limit: 25, now: Date.now() + 1_000 },
    );
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.request).toMatchObject({
      channel: "push",
      platform: "android",
      attentionRequestId: seeded.attentionRequestId,
    });
    expect(JSON.stringify(claimed[0]?.request)).not.toContain(
      "Choose a release path",
    );
    await expect(
      human.mutation(
        internal.domains.notifications.dispatcher.completeDelivery,
        {
          outboxId: claimed[0]!.outboxId,
          attemptId: crypto.randomUUID(),
          providerMessageId: "stale-message",
        },
      ),
    ).resolves.toEqual({ applied: false });
    await expect(
      human.mutation(
        internal.domains.notifications.dispatcher.completeDelivery,
        {
          outboxId: claimed[0]!.outboxId,
          attemptId: claimed[0]!.attemptId,
          providerMessageId: "fcm-message-1",
        },
      ),
    ).resolves.toEqual({ applied: true });
    const delivered = await human.run(async (ctx) =>
      await ctx.db.get(claimed[0]!.outboxId),
    );
    expect(delivered).toMatchObject({
      status: "delivered",
      attemptCount: 1,
      providerMessageId: "fcm-message-1",
    });
  });

  it("retries transient failures and scrubs provider-invalid device tokens", async () => {
    const human = convexTest(schema, modules).withIdentity(identity);
    await human.mutation(api.domains.identity.index.bootstrapCurrentUser, {});
    const device = await human.mutation(
      api.domains.notifications.index.registerDevice,
      {
        platform: "ios",
        appInstallationId: "ios-installation-failure",
        pushToken: "apns-invalid-token",
      },
    );
    const seeded = await seedAttention(human, "normal");
    await human.mutation(
      internal.domains.notifications.index.enqueueForAttention,
      { attentionRequestId: seeded.attentionRequestId },
    );
    const first = await human.mutation(
      internal.domains.notifications.dispatcher.claimDue,
      { limit: 1, now: Date.now() + 1_000 },
    );
    const retryAt = Date.now() + 2_000;
    await expect(
      human.mutation(internal.domains.notifications.dispatcher.recordFailure, {
        outboxId: first[0]!.outboxId,
        attemptId: first[0]!.attemptId,
        errorCode: "provider temporarily unavailable",
        retryable: true,
        disableDevice: false,
        now: retryAt,
      }),
    ).resolves.toEqual({ applied: true, status: "pending" });
    const second = await human.mutation(
      internal.domains.notifications.dispatcher.claimDue,
      { limit: 1, now: retryAt + 31_000 },
    );
    expect(second).toHaveLength(1);
    await expect(
      human.mutation(internal.domains.notifications.dispatcher.recordFailure, {
        outboxId: second[0]!.outboxId,
        attemptId: second[0]!.attemptId,
        errorCode: "apns_device_invalid",
        retryable: false,
        disableDevice: true,
      }),
    ).resolves.toEqual({ applied: true, status: "failed" });
    const state = await human.run(async (ctx) => ({
      delivery: await ctx.db.get(second[0]!.outboxId),
      device: await ctx.db.get(device.deviceId),
    }));
    expect(state.delivery).toMatchObject({
      status: "failed",
      attemptCount: 2,
      lastErrorCode: "apns_device_invalid",
    });
    expect(state.device).toMatchObject({ enabled: false, pushToken: "" });
  });

  it("cancels delayed email as soon as Attention resolves", async () => {
    const human = convexTest(schema, modules).withIdentity(identity);
    await human.mutation(api.domains.identity.index.bootstrapCurrentUser, {});
    const seeded = await seedAttention(human, "important");
    await human.mutation(
      internal.domains.notifications.index.enqueueForAttention,
      { attentionRequestId: seeded.attentionRequestId },
    );
    await human.mutation(api.domains.attention.index.respond, {
      attentionRequestId: seeded.attentionRequestId,
      body: "Proceed with the safe rollout.",
      idempotencyKey: crypto.randomUUID(),
    });
    const deliveries = await human.run(async (ctx) =>
      await ctx.db
        .query("notificationOutbox")
        .withIndex("by_attention", (query) =>
          query.eq("attentionRequestId", seeded.attentionRequestId),
        )
        .collect(),
    );
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      channel: "email",
      status: "cancelled",
      lastErrorCode: "attention_resolved",
    });
  });

  it("dispatches a due record through the signed Worker contract", async () => {
    const human = convexTest(schema, modules).withIdentity(identity);
    await human.mutation(api.domains.identity.index.bootstrapCurrentUser, {});
    await human.mutation(api.domains.notifications.index.registerDevice, {
      platform: "android",
      appInstallationId: "android-installation-dispatch",
      pushToken: "fcm-dispatch-token",
    });
    const seeded = await seedAttention(human, "normal");
    await human.mutation(
      internal.domains.notifications.index.enqueueForAttention,
      { attentionRequestId: seeded.attentionRequestId },
    );
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const body = await request.text();
      expect(new URL(request.url).pathname).toBe(
        "/api/notifications/v1/deliver",
      );
      expect(request.headers.get("x-dongo-key-id")).toBe("v1");
      expect(request.headers.get("x-dongo-signature")).toMatch(
        /^[A-Za-z0-9_-]{43}$/,
      );
      expect(body).toContain('"channel":"push"');
      expect(body).toContain('"deepLink":"https://dev.dongo.so/app/');
      expect(body).not.toContain("deepLinkPath");
      return Response.json({
        ok: true,
        provider: "fcm",
        messageId: "projects/test/messages/1",
      });
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(
      human.action(internal.domains.notifications.dispatcher.dispatchDue, {
        limit: 25,
      }),
    ).resolves.toEqual({ claimed: 1, delivered: 1, retried: 0, failed: 0 });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

async function seedAttention(
  t: ReturnType<typeof convexTest>,
  urgency: "normal" | "important",
): Promise<{ attentionRequestId: Id<"attentionRequests"> }> {
  return await t.run(async (ctx) => {
    const profile = await ctx.db
      .query("humanProfiles")
      .withIndex("by_auth_subject", (query) =>
        query.eq("authSubject", identity.tokenIdentifier),
      )
      .unique();
    if (!profile) throw new Error("profile fixture missing");
    const now = Date.now();
    const organizationId = await ctx.db.insert("organizations", {
      name: "Notification Test",
      slug: `notification-${crypto.randomUUID()}`,
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
    const projectId = await ctx.db.insert("projects", {
      organizationId,
      name: "Notification Test",
      slug: `project-${crypto.randomUUID()}`,
      publicRef: `notification-${crypto.randomUUID()}`,
      identifierPrefix: "NOT",
      nextWorkNumber: 2,
      executionMode: "manual",
      createdAt: now,
      updatedAt: now,
    });
    const actorId = await ctx.db.insert("actors", {
      organizationId,
      type: "agent",
      name: "Notification Agent",
      agentType: "test",
      createdAt: now,
    });
    await ctx.db.insert("actors", {
      organizationId,
      type: "human",
      name: profile.name,
      profileId: profile._id,
      createdAt: now,
    });
    const workItemId = await ctx.db.insert("workItems", {
      organizationId,
      projectId,
      number: 1,
      identifier: "NOT-1",
      title: "Choose a release path",
      kind: "decision",
      state: "ready",
      rank: 1_024,
      createdByActorId: actorId,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    const attentionRequestId = await ctx.db.insert("attentionRequests", {
      organizationId,
      projectId,
      workItemId,
      requestedByActorId: actorId,
      requestedFromProfileId: profile._id,
      kind: "decision",
      title: "Choose a release path",
      urgency,
      status: "open",
      createdAt: now,
    });
    return { attentionRequestId };
  });
}
