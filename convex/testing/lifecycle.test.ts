import { beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import type { Id } from "../_generated/dataModel";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { modules } from "../test.setup";

const gatewaySecret = "test-gateway-secret-with-at-least-32-characters";
const gatewayPath = "/internal/agent/v1/execute";

type AgentContext = {
  requestId: string;
  installationId: Id<"installations">;
  actorId: Id<"actors">;
  organizationId: Id<"organizations">;
  projectId: Id<"projects">;
  projectRef: string;
  clientId: string;
  resource: string;
  scopes: string[];
};

beforeEach(() => {
  process.env.DONGO_ENABLE_DEV_BOOTSTRAP = "true";
  process.env.DONGO_INTERNAL_GATEWAY_SECRET = gatewaySecret;
  process.env.DONGO_ATTACHMENT_URL_SIGNING_SECRET = gatewaySecret;
  process.env.DONGO_ATTACHMENT_DOWNLOAD_BASE_URL =
    "https://dev.dongo.so/api/files/download";
});

describe("agent lifecycle reliability", () => {
  it("delivers idempotent Inbox nudges through a truthful cursor and waiter presence", async () => {
    const t = convexTest(schema, modules);
    const key = `updates-${crypto.randomUUID()}`;
    const context = await seededContext(t, key);
    const human = t.withIdentity({
      tokenIdentifier: `development:${key}`,
      subject: key,
      issuer: "https://human.example.test",
      name: "dongo developer",
    });
    const intake = await human.mutation(api.domains.intake.index.create, {
      projectId: context.projectId,
      text: "A new Inbox item needs an active agent.",
      attachmentIds: [],
      idempotencyKey: "create-intake-for-update",
    });

    const baseline = await successfulData(t, context, "get_updates", {
      waitSeconds: 0,
    });
    expect(baseline).toMatchObject({
      cursor: 0,
      updates: [],
      hasMore: false,
      wait: { status: "not_requested", requestedSeconds: 0 },
      delivery: {
        mechanism: "bounded_pull",
        stoppedAgentsRestarted: false,
      },
    });

    const waitAuthorization = { ...context, requestId: crypto.randomUUID() };
    await t.mutation(internal.domains.agentUpdates.index.beginPull, {
      authorization: waitAuthorization,
      waitSeconds: 20,
    });
    const waiting = await human.query(
      api.domains.agentUpdates.index.presence,
      { projectId: context.projectId },
    );
    expect(waiting.installations).toEqual([
      expect.objectContaining({
        installationId: context.installationId,
        capability: "get_updates",
        state: "waiting",
        delivery: "bounded_wait",
      }),
    ]);

    const input = {
      projectId: context.projectId,
      intakeId: intake.intakeId,
      priority: "important" as const,
      idempotencyKey: "nudge-intake-once",
    };
    const nudged = await human.mutation(
      api.domains.agentUpdates.index.nudgeForIntake,
      input,
    );
    await t.run((ctx) => ctx.db.patch(intake.intakeId, {
      status: "processed",
      updatedAt: Date.now(),
    }));
    const replay = await human.mutation(
      api.domains.agentUpdates.index.nudgeForIntake,
      input,
    );
    expect(replay).toEqual(nudged);
    expect(nudged).toMatchObject({
      signal: {
        version: 1,
        kind: "intake_available",
        intakeId: intake.intakeId,
        priority: "important",
      },
      delivery: {
        waitingInstallations: 1,
        recentlyActiveInstallations: 0,
        stoppedInstallations: 0,
        stoppedAgentsRestarted: false,
      },
    });

    await t.mutation(internal.domains.agentUpdates.index.finishPull, {
      authorization: waitAuthorization,
    });
    const updates = await successfulData(t, context, "get_updates", {
      cursor: baseline.cursor,
      waitSeconds: 0,
    });
    expect(updates).toMatchObject({
      cursor: 1,
      hasMore: false,
      updates: [{
        version: 1,
        kind: "intake_available",
        intakeId: intake.intakeId,
        priority: "important",
      }],
      wait: { status: "updates_available" },
    });
    const recent = await human.query(
      api.domains.agentUpdates.index.presence,
      { projectId: context.projectId },
    );
    expect(recent.installations[0]).toMatchObject({
      state: "recently_active",
      delivery: "next_pull",
    });

    const timedOut = await successfulData(t, context, "get_updates", {
      cursor: updates.cursor,
      waitSeconds: 1,
    });
    expect(timedOut).toMatchObject({
      cursor: updates.cursor,
      updates: [],
      hasMore: false,
      wait: {
        status: "timed_out",
        requestedSeconds: 1,
      },
    });
    expect(timedOut.wait.elapsedMilliseconds).toBeGreaterThanOrEqual(1_000);
    expect(timedOut.wait.elapsedMilliseconds).toBeLessThan(3_000);
  });

  it("creates multiple planned Work items with durable context, links, and an initial comment", async () => {
    const t = convexTest(schema, modules);
    const context = await seededContext(t, `work-context-${crypto.randomUUID()}`);
    const createInput = {
      title: "Plan the compatibility migration",
      goal: "Preserve old consumers while the new contract rolls out.",
      context: "The legacy field remains available for one compatibility cycle.",
      links: [
        "https://example.com/design",
        "https://example.com/migration?phase=1",
      ],
      initialComment: "Start by inventorying existing clients.",
      idempotencyKey: "create-work-with-context",
    };

    const first = await successfulData(t, context, "create_work", createInput);
    const replayed = await successfulData(t, context, "create_work", createInput);
    expect(replayed).toEqual(first);
    expect(first).toMatchObject({
      title: createInput.title,
      goal: createInput.goal,
      context: createInput.context,
      links: createInput.links,
      conversation: [
        expect.objectContaining({ body: createInput.initialComment }),
      ],
    });

    const second = await successfulData(t, context, "create_work", {
      title: "Plan the dependent client rollout",
      goal: "Create a separate plan without starting it.",
      idempotencyKey: "create-second-planned-work",
    });
    expect(second.id).not.toBe(first.id);

    const persisted = await t.run(async (ctx) => ({
      workCount: (await ctx.db
        .query("workItems")
        .withIndex("by_project_state_rank", (q) =>
          q.eq("projectId", context.projectId).eq("state", "ready"),
        )
        .collect()).length,
      firstComments: (await ctx.db
        .query("comments")
        .withIndex("by_work_created", (q) =>
          q.eq("workItemId", first.id as Id<"workItems">),
        )
        .collect()).length,
    }));
    expect(persisted).toEqual({ workCount: 2, firstComments: 1 });

    const session = await successfulData(t, context, "session_start", {
      externalSessionId: "planning-session",
    });
    expect(session.instructions).toEqual({
      executionMode: "manual",
      maxStartedWorkItemsPerSession: 1,
      maxNewWorkItemsPerSession: 1,
      wakeUpSemantics: "next_pull",
      parallelExecution: {
        policy: {
          enabled: false,
          maxConcurrentRuns: 1,
          requiresIsolatedWorkspaces: true,
        },
        hostCapabilities: {
          parallelExecution: "undisclosed",
          worktreeIsolation: "undisclosed",
        },
        mode: "serial",
        reason: "project_disabled",
      },
    });
    const verifiedInstallation = await t.run((ctx) =>
      ctx.db.get(context.installationId),
    );
    expect(verifiedInstallation?.lastUsedAt).toEqual(expect.any(Number));
  });

  it("keeps Work hierarchy direct, project-scoped, bounded, and visible", async () => {
    const t = convexTest(schema, modules);
    const context = await seededContext(t, `work-hierarchy-${crypto.randomUUID()}`);
    const parent = await successfulData(t, context, "create_work", {
      title: "Ship the larger capability",
      goal: "Coordinate direct child Work without recursive nesting.",
      idempotencyKey: "create-hierarchy-parent",
    });
    const childInput = {
      title: "Implement the first slice",
      goal: "Deliver one independently executable part.",
      parentWorkItemId: parent.id,
      idempotencyKey: "create-hierarchy-child",
    };
    const child = await successfulData(t, context, "create_work", childInput);
    expect(child).toMatchObject({
      parentWorkItem: {
        id: parent.id,
        identifier: parent.identifier,
        title: parent.title,
        state: "ready",
      },
      childWorkItems: [],
    });
    expect(await successfulData(t, context, "create_work", childInput)).toEqual(child);

    const refreshedParent = await successfulData(t, context, "get_work", {
      workItemId: parent.id,
    });
    expect(refreshedParent.childWorkItems).toEqual([{
      id: child.id,
      identifier: child.identifier,
      title: child.title,
      state: "ready",
    }]);

    const startedChild = await successfulData(t, context, "start_work", {
      workItemId: child.id,
      expectedRevision: child.revision,
      externalSessionId: "finish-child-session",
      idempotencyKey: "start-hierarchy-child",
    });
    await successfulData(t, context, "finish_work", {
      workItemId: child.id,
      expectedRevision: startedChild.revision,
      outcome: "The child completed without changing the parent lifecycle.",
      idempotencyKey: "finish-hierarchy-child",
    });
    const parentAfterChild = await successfulData(t, context, "get_work", {
      workItemId: parent.id,
    });
    expect(parentAfterChild.state).toBe("ready");
    expect(parentAfterChild.childWorkItems[0]?.state).toBe("done");

    const nested = await callAgent(t, context, "create_work", {
      title: "Nested child",
      goal: "This third level must be rejected.",
      parentWorkItemId: child.id,
      idempotencyKey: "reject-nested-child",
    });
    expect(nested.payload).toMatchObject({
      ok: false,
      error: { code: "validation", retryable: false },
    });

    const foreignContext = await seededContext(
      t,
      `foreign-work-hierarchy-${crypto.randomUUID()}`,
    );
    const foreignParent = await successfulData(t, foreignContext, "create_work", {
      title: "Foreign parent",
      goal: "Remain invisible outside its project.",
      idempotencyKey: "create-foreign-parent",
    });
    const crossProject = await callAgent(t, context, "create_work", {
      title: "Cross-project child",
      goal: "This relationship must fail closed.",
      parentWorkItemId: foreignParent.id,
      idempotencyKey: "reject-cross-project-child",
    });
    expect(crossProject.payload).toMatchObject({
      ok: false,
      error: { code: "not_found", retryable: false },
    });

    const closedParent = await successfulData(t, context, "create_work", {
      title: "Closed parent",
      goal: "Reject new children after completion.",
      idempotencyKey: "create-closed-parent",
    });
    const started = await successfulData(t, context, "start_work", {
      workItemId: closedParent.id,
      expectedRevision: closedParent.revision,
      externalSessionId: "close-parent-session",
      idempotencyKey: "start-closed-parent",
    });
    await successfulData(t, context, "finish_work", {
      workItemId: closedParent.id,
      expectedRevision: started.revision,
      outcome: "Closed before another child was added.",
      idempotencyKey: "finish-closed-parent",
    });
    const closed = await callAgent(t, context, "create_work", {
      title: "Late child",
      goal: "This child must not be created.",
      parentWorkItemId: closedParent.id,
      idempotencyKey: "reject-closed-parent-child",
    });
    expect(closed.payload).toMatchObject({
      ok: false,
      error: { code: "validation", retryable: false },
    });

    await t.run(async (ctx) => {
      const storedParent = await ctx.db.get(parent.id as Id<"workItems">);
      if (!storedParent) throw new Error("hierarchy parent missing");
      for (let index = 1; index < 100; index += 1) {
        await ctx.db.insert("workItems", {
          organizationId: storedParent.organizationId,
          projectId: storedParent.projectId,
          number: 100 + index,
          identifier: `bulk${index.toString().padStart(3, "0")}`,
          title: `Bounded child ${index}`,
          kind: "task",
          state: "ready",
          rank: index,
          createdByActorId: storedParent.createdByActorId,
          parentId: storedParent._id,
          revision: 1,
          createdAt: index,
          updatedAt: index,
        });
      }
    });
    const overLimit = await callAgent(t, context, "create_work", {
      title: "Child 101",
      goal: "The bounded relationship must reject this child.",
      parentWorkItemId: parent.id,
      idempotencyKey: "reject-child-over-limit",
    });
    expect(overLimit.payload).toMatchObject({
      ok: false,
      error: {
        code: "quota_exceeded",
        retryable: false,
        details: { maxChildren: 100 },
      },
    });
  });

  it("returns a stable already-resolved Attention conflict while replaying the original success", async () => {
    const t = convexTest(schema, modules);
    const context = await seededContext(t, `attention-resolved-${crypto.randomUUID()}`);
    const work = await successfulData(t, context, "create_work", {
      title: "Resolve a redundant question",
      goal: "Prove exact idempotent resolution behavior.",
      idempotencyKey: "create-resolved-attention-work",
    });
    const started = await successfulData(t, context, "start_work", {
      workItemId: work.id,
      expectedRevision: work.revision,
      externalSessionId: "resolve-attention-session",
      idempotencyKey: "start-resolved-attention-work",
    });
    const attention = await successfulData(t, context, "request_attention", {
      workItemId: work.id,
      expectedRevision: started.revision,
      kind: "question",
      title: "Is this still needed?",
      body: "The implementation no longer depends on this answer.",
      idempotencyKey: "request-resolved-attention",
    });
    const resolutionInput = {
      attentionId: attention.id,
      resolveWithoutResponse: true,
      idempotencyKey: "resolve-attention-once",
    };

    const resolved = await successfulData(
      t,
      context,
      "resolve_attention",
      resolutionInput,
    );
    const replayed = await successfulData(
      t,
      context,
      "resolve_attention",
      resolutionInput,
    );
    expect(replayed).toEqual(resolved);

    const duplicate = await callAgent(t, context, "resolve_attention", {
      ...resolutionInput,
      idempotencyKey: "resolve-attention-again",
    });
    expect(duplicate.response.status).toBe(409);
    expect(duplicate.payload).toMatchObject({
      ok: false,
      error: {
        code: "already_resolved",
        message: "Attention already resolved.",
        retryable: false,
      },
    });
  });

  it("keeps owner Attention durable without a Work Run and returns the response on a later session", async () => {
    const t = convexTest(schema, modules);
    const seedKey = `owner-attention-${crypto.randomUUID()}`;
    const context = await seededContext(t, seedKey);
    const human = t.withIdentity({
      tokenIdentifier: `development:${seedKey}`,
      subject: seedKey,
      issuer: "development",
      email: `${seedKey}@development.invalid`,
      name: "dongo developer",
    });
    await human.mutation(api.domains.notifications.index.registerDevice, {
      platform: "android",
      appInstallationId: "owner-attention-device",
      pushToken: "owner-attention-push-token",
    });
    const intake = await human.mutation(api.domains.intake.index.create, {
      projectId: context.projectId,
      text: "Clarify the requested release boundary.",
      attachmentIds: [],
      idempotencyKey: "owner-attention-intake",
    });
    const input = {
      intakeId: intake.intakeId,
      kind: "decision",
      title: "Choose the release boundary",
      body: "Should this include the adjacent service?",
      options: ["Current project", "Include adjacent service"],
      important: true,
      idempotencyKey: "request-owner-attention-once",
    };

    const attention = await successfulData(
      t,
      context,
      "request_owner_attention",
      input,
    );
    const replay = await successfulData(
      t,
      context,
      "request_owner_attention",
      input,
    );
    expect(replay).toEqual(attention);
    expect(attention).toMatchObject({
      intakeId: intake.intakeId,
      kind: "decision",
      title: "Choose the release boundary",
    });
    expect(attention.workItemId).toBeUndefined();

    const scheduled = await t.run(async (ctx) =>
      await ctx.db
        .query("notificationOutbox")
        .withIndex("by_attention", (query) =>
          query.eq("attentionRequestId", attention.id as Id<"attentionRequests">),
        )
        .collect(),
    );
    expect(scheduled).toHaveLength(2);
    expect(scheduled.map((delivery) => delivery.channel).sort()).toEqual([
      "email",
      "push",
    ]);

    const overview = await human.query(api.domains.overview.index.getForHuman, {
      projectId: context.projectId,
    });
    expect(overview.needsYou).toContainEqual(
      expect.objectContaining({
        request: expect.objectContaining({ _id: attention.id, intakeId: intake.intakeId }),
        work: null,
      }),
    );
    expect(await t.run((ctx) => ctx.db.query("runs").collect())).toEqual([]);

    const response = await human.mutation(api.domains.attention.index.respond, {
      attentionRequestId: attention.id as Id<"attentionRequests">,
      body: "Keep the release inside the current project.",
      selectedOption: "Current project",
      idempotencyKey: "respond-owner-attention",
    });
    expect(response).toMatchObject({ status: "resolved" });
    expect(response.commentId).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.query("comments").collect())).toEqual([]);
    const cancelled = await t.run(async (ctx) =>
      await ctx.db
        .query("notificationOutbox")
        .withIndex("by_attention", (query) =>
          query.eq("attentionRequestId", attention.id as Id<"attentionRequests">),
        )
        .collect(),
    );
    expect(cancelled.every((delivery) => delivery.status === "cancelled")).toBe(true);

    const resolved = await successfulData(t, context, "get_attention", {
      attentionId: attention.id,
    });
    expect(resolved.resolution).toEqual({
      kind: "responded",
      body: "Keep the release inside the current project.",
      selectedOption: "Current project",
    });
    const laterSession = await successfulData(t, context, "session_start", {
      externalSessionId: "owner-attention-later-session",
    });
    expect(laterSession.newlyResolvedAttention).toContainEqual(
      expect.objectContaining({
        id: attention.id,
        resolution: expect.objectContaining({
          body: "Keep the release inside the current project.",
        }),
      }),
    );
  });

  it("exposes finalized human comment attachments to the authorized agent", async () => {
    const t = convexTest(schema, modules);
    const seedKey = `comment-attachment-${crypto.randomUUID()}`;
    const context = await seededContext(t, seedKey);
    const human = t.withIdentity({
      tokenIdentifier: `development:${seedKey}`,
      subject: seedKey,
      issuer: "development",
      email: `${seedKey}@development.invalid`,
      name: "dongo developer",
    });
    const work = await successfulData(t, context, "create_work", {
      title: "Review pasted evidence",
      goal: "Make the screenshot available in the conversation.",
      idempotencyKey: "comment-attachment-work",
    });
    const { attachmentId, pendingAttachmentId, foreignAttachmentId } = await t.run(async (ctx) => {
      const profile = await ctx.db
        .query("humanProfiles")
        .withIndex("by_auth_subject", (q) =>
          q.eq("authSubject", `development:${seedKey}`),
        )
        .unique();
      if (!profile) throw new Error("human profile fixture missing");
      const now = Date.now();
      const attachmentId = await ctx.db.insert("attachments", {
        organizationId: context.organizationId,
        projectId: context.projectId,
        createdByProfileId: profile._id,
        filename: "pasted-review.png",
        mimeType: "image/png",
        byteSize: 27,
        storageKey: `comment-attachments/${crypto.randomUUID()}`,
        status: "available",
        createdAt: now,
        finalizedAt: now,
      });
      const pendingAttachmentId = await ctx.db.insert("attachments", {
        organizationId: context.organizationId,
        projectId: context.projectId,
        createdByProfileId: profile._id,
        filename: "still-uploading.png",
        mimeType: "image/png",
        byteSize: 12,
        storageKey: `comment-attachments/${crypto.randomUUID()}`,
        status: "pending",
        createdAt: now,
        expiresAt: now + 60_000,
      });
      const foreignProfileId = await ctx.db.insert("humanProfiles", {
        authSubject: `development:foreign-${seedKey}`,
        name: "Foreign uploader",
        createdAt: now,
        updatedAt: now,
      });
      const foreignAttachmentId = await ctx.db.insert("attachments", {
        organizationId: context.organizationId,
        projectId: context.projectId,
        createdByProfileId: foreignProfileId,
        filename: "foreign.png",
        mimeType: "image/png",
        byteSize: 9,
        storageKey: `comment-attachments/${crypto.randomUUID()}`,
        status: "available",
        createdAt: now,
        finalizedAt: now,
      });
      return { attachmentId, pendingAttachmentId, foreignAttachmentId };
    });

    await expect(human.mutation(
      api.domains.comments.index.createForHuman,
      {
        workItemId: work.id as Id<"workItems">,
        attachmentIds: [pendingAttachmentId],
        idempotencyKey: "comment-attachment-pending",
      },
    )).rejects.toThrow("Comment attachment is not available");
    await expect(human.mutation(
      api.domains.comments.index.createForHuman,
      {
        workItemId: work.id as Id<"workItems">,
        attachmentIds: [foreignAttachmentId],
        idempotencyKey: "comment-attachment-foreign",
      },
    )).rejects.toThrow("Attachment not found");

    const created = await human.mutation(
      api.domains.comments.index.createForHuman,
      {
        workItemId: work.id as Id<"workItems">,
        attachmentIds: [attachmentId],
        idempotencyKey: "comment-attachment-create",
      },
    );
    const replayed = await human.mutation(
      api.domains.comments.index.createForHuman,
      {
        workItemId: work.id as Id<"workItems">,
        attachmentIds: [attachmentId],
        idempotencyKey: "comment-attachment-create",
      },
    );
    expect(replayed.commentId).toBe(created.commentId);

    const observed = await successfulData(t, context, "get_work", {
      workItemId: work.id,
    });
    expect(observed.conversation).toContainEqual(
      expect.objectContaining({
        id: created.commentId,
        body: "",
        attachmentIds: [attachmentId],
      }),
    );
    const attachmentAccess = await successfulData(t, context, "get_attachment", {
      attachmentId,
    });
    expect(attachmentAccess).toMatchObject({
      attachmentId,
      filename: "pasted-review.png",
      contentType: "image/png",
      byteSize: 27,
    });
    expect(new URL(attachmentAccess.downloadUrl).pathname).toBe(
      `/api/files/download/${attachmentId}`,
    );
    await expect(
      human.mutation(internal.domains.attachments.index.discard, { attachmentId }),
    ).rejects.toThrow("Attached media cannot be discarded");
  });

  it("replays terminal and Attention mutations after a lost response", async () => {
    const t = convexTest(schema, modules);
    const seedKey = `lifecycle-${crypto.randomUUID()}`;
    const context = await seededContext(t, seedKey);

    const attentionWork = await successfulData(t, context, "create_work", {
      title: "Decide the migration path",
      goal: "Ask before changing durable state.",
      idempotencyKey: "create-attention-work",
    });
    const startedAttentionWork = await successfulData(t, context, "start_work", {
      workItemId: attentionWork.id,
      expectedRevision: attentionWork.revision,
      externalSessionId: "session-attention",
      idempotencyKey: "start-attention-work",
    });
    const attentionInput = {
      workItemId: attentionWork.id,
      expectedRevision: startedAttentionWork.revision,
      kind: "decision",
      title: "Choose the migration mode",
      body: "Should existing records be migrated eagerly?",
      important: true,
      options: ["Eager", "Lazy"],
      idempotencyKey: "attention-lost-response",
    };
    const firstAttention = await successfulData(
      t,
      context,
      "request_attention",
      attentionInput,
    );
    const retriedAttention = await successfulData(
      t,
      context,
      "request_attention",
      attentionInput,
    );
    expect(retriedAttention.id).toBe(firstAttention.id);
    const attentionCount = await t.run(async (ctx) =>
      (await ctx.db
        .query("attentionRequests")
        .withIndex("by_work_status", (q) =>
          q.eq("workItemId", attentionWork.id as Id<"workItems">),
        )
        .collect()).length,
    );
    expect(attentionCount).toBe(1);
    const waitingWork = await successfulData(t, context, "get_work", {
      workItemId: attentionWork.id,
    });
    expect(waitingWork).toMatchObject({
      state: "ready",
      activeRun: { state: "waiting_for_human" },
    });
    const prematureRestart = await callAgent(t, context, "start_work", {
      workItemId: attentionWork.id,
      expectedRevision: waitingWork.revision,
      externalSessionId: "session-before-human-response",
      idempotencyKey: "premature-restart",
    });
    expect(prematureRestart.response.status).toBe(400);
    expect(prematureRestart.payload).toMatchObject({
      ok: false,
      error: { code: "validation" },
    });
    const human = t.withIdentity({
      tokenIdentifier: `development:${seedKey}`,
      subject: seedKey,
      issuer: "development",
      email: `${seedKey}@development.invalid`,
      name: "dongo developer",
    });
    const responseInput = {
      attentionRequestId: firstAttention.id as Id<"attentionRequests">,
      body: "Use the lazy migration and preserve rollback.",
      selectedOption: "Lazy",
      idempotencyKey: "human-attention-response",
    };
    const firstResponse = await human.mutation(
      api.domains.attention.index.respond,
      responseInput,
    );
    const retriedResponse = await human.mutation(
      api.domains.attention.index.respond,
      responseInput,
    );
    expect(retriedResponse.commentId).toBe(firstResponse.commentId);
    const session = await successfulData(t, context, "session_start", {
      externalSessionId: "session-after-human-response",
    });
    expect(session.newlyResolvedAttention).toContainEqual(
      expect.objectContaining({
        id: firstAttention.id,
        resolution: {
          kind: "responded",
          body: "Use the lazy migration and preserve rollback.",
          selectedOption: "Lazy",
        },
      }),
    );
    const readyAfterResponse = await successfulData(t, context, "get_work", {
      workItemId: attentionWork.id,
    });
    expect(readyAfterResponse).toMatchObject({ state: "ready" });
    expect(readyAfterResponse.activeRun).toBeUndefined();
    const resumed = await successfulData(t, context, "start_work", {
      workItemId: attentionWork.id,
      expectedRevision: waitingWork.revision,
      externalSessionId: "session-after-human-response",
      idempotencyKey: "restart-after-response",
    });
    expect(resumed).toMatchObject({ state: "working" });
    expect(resumed.activeRun).toMatchObject({
      state: "running",
      externalSessionId: "session-after-human-response",
    });
    const finishedAfterResponse = await successfulData(
      t,
      context,
      "finish_work",
      {
        workItemId: attentionWork.id,
        expectedRevision: resumed.revision,
        outcome: "The human response was applied on the next pull.",
        idempotencyKey: "finish-after-response",
      },
    );
    expect(finishedAfterResponse).toMatchObject({
      state: "done",
      outcome: "The human response was applied on the next pull.",
    });
    expect(finishedAfterResponse.activeRun).toBeUndefined();

    const finishWork = await successfulData(t, context, "create_work", {
      title: "Finish exactly once",
      goal: "Preserve one artifact when the response is lost.",
      idempotencyKey: "create-finish-work",
    });
    const startedFinishWork = await successfulData(t, context, "start_work", {
      workItemId: finishWork.id,
      expectedRevision: finishWork.revision,
      externalSessionId: "session-finish",
      idempotencyKey: "start-finish-work",
    });
    const finishInput = {
      workItemId: finishWork.id,
      expectedRevision: startedFinishWork.revision,
      outcome: "The durable change is complete.",
      artifacts: [{
        kind: "pull_request",
        label: "PR 42",
        url: "https://github.com/example/dongo/pull/42",
      }],
      idempotencyKey: "finish-lost-response",
    };
    const firstFinish = await successfulData(
      t,
      context,
      "finish_work",
      finishInput,
    );
    const retriedFinish = await successfulData(
      t,
      context,
      "finish_work",
      finishInput,
    );
    expect(retriedFinish).toMatchObject({
      id: firstFinish.id,
      state: "done",
      outcome: "The durable change is complete.",
    });
    expect(retriedFinish.artifacts).toHaveLength(1);
    const persisted = await t.run(async (ctx) => ({
      artifacts: await ctx.db
        .query("artifacts")
        .withIndex("by_work_created", (q) =>
          q.eq("workItemId", finishWork.id as Id<"workItems">),
        )
        .collect(),
      events: (await ctx.db
        .query("events")
        .withIndex("by_work_created", (q) =>
          q.eq("workItemId", finishWork.id as Id<"workItems">),
        )
        .collect()).filter((event) => event.type === "work.completed"),
    }));
    expect(persisted.artifacts).toHaveLength(1);
    expect(persisted.events).toHaveLength(1);

    const conflict = await callAgent(t, context, "finish_work", {
      ...finishInput,
      outcome: "A different result must not overwrite the first.",
    });
    expect(conflict.response.status).toBe(409);
    expect(conflict.payload).toMatchObject({
      ok: false,
      error: { code: "idempotency_conflict" },
    });
  });

  it("allows exactly one installation to claim the same Work item", async () => {
    const t = convexTest(schema, modules);
    const first = await seededContext(t);
    const second = await t.run(async (ctx): Promise<AgentContext> => {
      const now = Date.now();
      const actorId = await ctx.db.insert("actors", {
        organizationId: first.organizationId,
        type: "agent",
        name: "Competing development agent",
        agentType: "development",
        createdAt: now,
      });
      const installationId = await ctx.db.insert("installations", {
        organizationId: first.organizationId,
        projectId: first.projectId,
        actorId,
        kind: "development",
        status: "active",
        clientId: "dongo-development-competitor",
        label: "Competing development agent",
        resource: "development://dongo-agent-api",
        scopes: ["dongo:work:read", "dongo:work:write"],
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(actorId, { installationId });
      return {
        ...first,
        requestId: crypto.randomUUID(),
        actorId,
        installationId,
        clientId: "dongo-development-competitor",
        scopes: ["dongo:work:read", "dongo:work:write"],
      };
    });
    const work = await successfulData(t, first, "create_work", {
      title: "Only one agent may start",
      goal: "Prove the atomic claim boundary.",
      idempotencyKey: "create-collision-work",
    });

    const [left, right] = await Promise.all([
      callAgent(t, first, "start_work", {
        workItemId: work.id,
        expectedRevision: work.revision,
        externalSessionId: "collision-left",
        idempotencyKey: "collision-left",
      }),
      callAgent(t, second, "start_work", {
        workItemId: work.id,
        expectedRevision: work.revision,
        externalSessionId: "collision-right",
        idempotencyKey: "collision-right",
      }),
    ]);
    expect([left.response.status, right.response.status].sort()).toEqual([200, 409]);
    const winner = left.response.status === 200 ? left.payload : right.payload;
    const loser = left.response.status === 409 ? left.payload : right.payload;
    expect(winner).toMatchObject({ ok: true, data: { state: "working" } });
    expect(loser).toMatchObject({
      ok: false,
      error: { code: expect.stringMatching(/claim_conflict|revision_conflict/) },
    });
    const runs = await t.run(async (ctx) =>
      await ctx.db
        .query("runs")
        .withIndex("by_work_started", (q) =>
          q.eq("workItemId", work.id as Id<"workItems">),
        )
        .collect(),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("running");
  });

  it("presents expired claims truthfully and reclaims with the observed revision", async () => {
    const t = convexTest(schema, modules);
    const seedKey = `expiry-${crypto.randomUUID()}`;
    const context = await seededContext(t, seedKey);
    const human = t.withIdentity({
      tokenIdentifier: `development:${seedKey}`,
      subject: seedKey,
      issuer: "development",
      email: `${seedKey}@development.invalid`,
      name: "dongo developer",
    });
    const intake = await human.mutation(api.domains.intake.index.create, {
      projectId: context.projectId,
      text: "This Intake lease should be reclaimable.",
      attachmentIds: [],
      idempotencyKey: "expiry-intake-create",
    });
    const claimedIntake = await successfulData(t, context, "claim_intake", {
      intakeId: intake.intakeId,
      expectedRevision: intake.revision,
      leaseSeconds: 30,
      idempotencyKey: "expiry-intake-claim",
    });
    const work = await successfulData(t, context, "create_work", {
      title: "Reclaim expired work",
      goal: "A stale Run must not look active.",
      idempotencyKey: "expiry-work-create",
    });
    const started = await successfulData(t, context, "start_work", {
      workItemId: work.id,
      expectedRevision: work.revision,
      externalSessionId: "expiry-original-run",
      leaseSeconds: 30,
      idempotencyKey: "expiry-work-start",
    });
    const originalRunId = started.activeRun.id as Id<"runs">;
    await t.run(async (ctx) => {
      const expiredAt = Date.now() - 1;
      await ctx.db.patch(intake.intakeId, { claimExpiresAt: expiredAt });
      await ctx.db.patch(work.id as Id<"workItems">, { claimExpiresAt: expiredAt });
    });

    const overview = await successfulData(t, context, "get_overview", {});
    const staleIntake = overview.inbox.find(
      (candidate: any) => candidate.id === intake.intakeId,
    );
    expect(staleIntake).toMatchObject({ state: "waiting" });
    expect(staleIntake.claimedBy).toBeUndefined();
    expect(staleIntake.claimExpiresAt).toBeUndefined();
    const staleWork = overview.ready.find(
      (candidate: any) => candidate.id === work.id,
    );
    expect(staleWork).toMatchObject({ state: "ready" });
    expect(staleWork.activeRun).toBeUndefined();

    const reclaimedIntake = await successfulData(t, context, "claim_intake", {
      intakeId: intake.intakeId,
      expectedRevision: claimedIntake.revision,
      leaseSeconds: 30,
      idempotencyKey: "expiry-intake-reclaim",
    });
    expect(reclaimedIntake).toMatchObject({ state: "claimed" });
    const reclaimedWork = await successfulData(t, context, "start_work", {
      workItemId: work.id,
      expectedRevision: started.revision,
      externalSessionId: "expiry-reclaimed-run",
      leaseSeconds: 30,
      idempotencyKey: "expiry-work-reclaim",
    });
    expect(reclaimedWork).toMatchObject({ state: "working" });
    expect(reclaimedWork.activeRun.id).not.toBe(originalRunId);
    const originalRun = await t.run(async (ctx) => await ctx.db.get(originalRunId));
    expect(originalRun).toMatchObject({
      status: "failed",
      failureCode: "lease_expired",
    });
  });
});

async function seededContext(
  t: ReturnType<typeof convexTest>,
  key = `lifecycle-${crypto.randomUUID()}`,
): Promise<AgentContext> {
  const seeded = await t.mutation(internal.dev.bootstrap.createWalkingSkeleton, {
    key,
    organizationSlug: `org-${crypto.randomUUID()}`,
    projectSlug: `project-${crypto.randomUUID()}`,
  });
  return await t.run(async (ctx) => {
    const installation = await ctx.db.get(seeded.installationId!);
    const project = await ctx.db.get(seeded.projectId!);
    if (!installation || !project) throw new Error("fixture missing");
    return {
      requestId: crypto.randomUUID(),
      installationId: installation._id,
      actorId: installation.actorId,
      organizationId: installation.organizationId,
      projectId: project._id,
      projectRef: project.publicRef,
      clientId: installation.clientId,
      resource: installation.resource,
      scopes: installation.scopes,
    };
  });
}

async function successfulData(
  t: ReturnType<typeof convexTest>,
  context: AgentContext,
  operation: string,
  input: Record<string, unknown>,
): Promise<any> {
  const result = await callAgent(t, context, operation, input);
  expect(result.response.status).toBe(200);
  expect(result.payload).toMatchObject({ ok: true });
  return (result.payload as { data: any }).data;
}

async function callAgent(
  t: ReturnType<typeof convexTest>,
  context: AgentContext,
  operation: string,
  input: Record<string, unknown>,
) {
  const body = JSON.stringify({
    version: 1,
    operation,
    input,
    context: { ...context, requestId: crypto.randomUUID() },
  });
  const response = await t.fetch(gatewayPath, await signedRequest(body));
  return { response, payload: await response.json() };
}

async function signedRequest(body: string): Promise<RequestInit> {
  const timestamp = Date.now();
  const nonce = crypto.randomUUID();
  const bodyHash = await sha256Hex(new TextEncoder().encode(body));
  const canonical = `${timestamp}\n${nonce}\nPOST\n${gatewayPath}\n${bodyHash}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(gatewaySecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(canonical),
  );
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-dongo-key-id": "v1",
      "x-dongo-timestamp": String(timestamp),
      "x-dongo-nonce": nonce,
      "x-dongo-signature": base64Url(new Uint8Array(signature)),
    },
    body,
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
