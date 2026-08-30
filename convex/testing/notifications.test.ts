import { describe, expect, it } from "vitest";
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
