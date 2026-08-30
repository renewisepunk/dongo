import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "../../_generated/server";
import {
  agentContextValidator,
  MAX_BODY_LENGTH,
  workKindValidator,
} from "../../lib/validators";
import {
  assertSameProject,
  requireHumanProject,
  requireSystemActor,
  resolveAgentPrincipal,
} from "../../lib/authz";
import { appendEvent } from "../../lib/events";
import { fail, optionalString } from "../../lib/errors";
import { runIdempotent } from "../../lib/idempotency";
import { isLeaseActive, newLease } from "../../lib/leases";
import { createWorkItem, linkIntakeToWork } from "../work/service";

const newWorkValidator = v.object({
  title: v.string(),
  description: v.optional(v.string()),
  kind: workKindValidator,
  parentId: v.optional(v.id("workItems")),
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    text: v.optional(v.string()),
    attachmentIds: v.array(v.id("attachments")),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await requireHumanProject(ctx, args.projectId);
    const text = optionalString(args.text, "text", MAX_BODY_LENGTH);
    if (!text && args.attachmentIds.length === 0) {
      fail("validation", "Intake requires text or an attachment");
    }
    if (args.attachmentIds.length > 20) {
      fail("validation", "An Intake may include at most 20 attachments");
    }
    const now = Date.now();
    return await runIdempotent(
      ctx,
      {
        organizationId: principal.project!.organizationId,
        projectId: args.projectId,
        principalKey: principal.principalKey,
        operation: "intake.create",
        key: args.idempotencyKey,
        payload: { text, attachmentIds: args.attachmentIds },
        now,
      },
      async () => {
        const attachments = [];
        for (const attachmentId of [...new Set(args.attachmentIds)]) {
          const attachment = await ctx.db.get(attachmentId);
          if (
            !attachment ||
            attachment.projectId !== args.projectId ||
            attachment.organizationId !== principal.project!.organizationId ||
            attachment.createdByProfileId !== principal.profile._id ||
            attachment.status !== "available" ||
            attachment.intakeId !== undefined ||
            attachment.workItemId !== undefined
          ) {
            fail("not_found", "Attachment is not available for this Intake");
          }
          attachments.push(attachment);
        }
        const intakeId = await ctx.db.insert("intakes", {
          organizationId: principal.project!.organizationId,
          projectId: args.projectId,
          createdByProfileId: principal.profile._id,
          createdByActorId: principal.actor._id,
          text,
          status: "new",
          revision: 1,
          createdAt: now,
          updatedAt: now,
        });
        for (const attachment of attachments) {
          await ctx.db.patch(attachment._id, { intakeId });
        }
        await appendEvent(ctx, {
          organizationId: principal.project!.organizationId,
          projectId: args.projectId,
          intakeId,
          actorId: principal.actor._id,
          type: "intake.created",
          data: { attachmentCount: attachments.length },
          createdAt: now,
        });
        return { intakeId, revision: 1 };
      },
    );
  },
});

export const getForHuman = query({
  args: { intakeId: v.id("intakes") },
  handler: async (ctx, args) => {
    const intake = await ctx.db.get(args.intakeId);
    if (!intake) fail("not_found", "Intake not found");
    await requireHumanProject(ctx, intake.projectId, { allowArchived: true });
    const attachments = await ctx.db
      .query("attachments")
      .withIndex("by_intake", (q) => q.eq("intakeId", intake._id))
      .take(100);
    const links = await ctx.db
      .query("intakeWorkLinks")
      .withIndex("by_intake", (q) => q.eq("intakeId", intake._id))
      .take(100);
    return { intake, attachments, links };
  },
});

export const getForAgent = internalQuery({
  args: { authorization: agentContextValidator, intakeId: v.id("intakes") },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:read",
    );
    const intake = await ctx.db.get(args.intakeId);
    if (!intake) fail("not_found", "Intake not found");
    assertSameProject(intake, principal.project);
    const attachments = await ctx.db
      .query("attachments")
      .withIndex("by_intake", (q) => q.eq("intakeId", intake._id))
      .take(100);
    const links = await ctx.db
      .query("intakeWorkLinks")
      .withIndex("by_intake", (q) => q.eq("intakeId", intake._id))
      .take(100);
    return { intake, attachments, links };
  },
});

export const claim = internalMutation({
  args: {
    authorization: agentContextValidator,
    intakeId: v.id("intakes"),
    expectedRevision: v.number(),
    leaseSeconds: v.optional(v.number()),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:write",
    );
    const intake = await ctx.db.get(args.intakeId);
    if (!intake) fail("not_found", "Intake not found");
    assertSameProject(intake, principal.project);
    const now = Date.now();
    return await runIdempotent(
      ctx,
      {
        organizationId: intake.organizationId,
        projectId: intake.projectId,
        principalKey: principal.principalKey,
        operation: "intake.claim",
        key: args.idempotencyKey,
        payload: {
          intakeId: args.intakeId,
          expectedRevision: args.expectedRevision,
          leaseSeconds: args.leaseSeconds,
        },
        now,
      },
      async () => {
        if (intake.revision !== args.expectedRevision) {
          fail("revision_conflict", "The Intake changed since it was read", {
            expectedRevision: args.expectedRevision,
            currentRevision: intake.revision,
          });
        }
        if (intake.status === "processed" || intake.status === "dismissed") {
          fail("invalid_transition", "Intake is already closed");
        }
        if (
          intake.status === "claimed" &&
          isLeaseActive(intake.claimExpiresAt, now) &&
          intake.claimedByInstallationId !== principal.installation._id
        ) {
          fail("claim_conflict", "Intake is claimed by another installation", {
            claimExpiresAt: intake.claimExpiresAt ?? null,
          });
        }
        const lease = newLease(now, args.leaseSeconds);
        await ctx.db.patch(intake._id, {
          status: "claimed",
          claimedByActorId: principal.actor._id,
          claimedByInstallationId: principal.installation._id,
          ...lease,
          revision: intake.revision + 1,
          updatedAt: now,
        });
        await appendEvent(ctx, {
          organizationId: intake.organizationId,
          projectId: intake.projectId,
          intakeId: intake._id,
          actorId: principal.actor._id,
          type: "intake.claimed",
          data: { claimExpiresAt: lease.claimExpiresAt },
          requestId: principal.requestId,
          createdAt: now,
        });
        return { intakeId: intake._id, revision: intake.revision + 1, ...lease };
      },
    );
  },
});

export const renewClaim = internalMutation({
  args: {
    authorization: agentContextValidator,
    intakeId: v.id("intakes"),
    expectedRevision: v.number(),
    leaseSeconds: v.optional(v.number()),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:write",
    );
    const intake = await ctx.db.get(args.intakeId);
    if (!intake) fail("not_found", "Intake not found");
    assertSameProject(intake, principal.project);
    const now = Date.now();
    return await runIdempotent(
      ctx,
      {
        organizationId: intake.organizationId,
        projectId: intake.projectId,
        principalKey: principal.principalKey,
        operation: "intake.renew_claim",
        key: args.idempotencyKey,
        payload: {
          intakeId: intake._id,
          expectedRevision: args.expectedRevision,
          leaseSeconds: args.leaseSeconds,
        },
        now,
      },
      async () => {
        if (
          intake.revision !== args.expectedRevision ||
          intake.status !== "claimed" ||
          intake.claimedByInstallationId !== principal.installation._id
        ) {
          fail(
            "claim_conflict",
            "Intake claim no longer belongs to this installation",
          );
        }
        if (!isLeaseActive(intake.claimExpiresAt, now)) {
          fail("lease_expired", "Intake claim has expired");
        }
        const lease = newLease(now, args.leaseSeconds);
        await ctx.db.patch(intake._id, {
          ...lease,
          revision: intake.revision + 1,
          updatedAt: now,
        });
        await appendEvent(ctx, {
          organizationId: intake.organizationId,
          projectId: intake.projectId,
          intakeId: intake._id,
          actorId: principal.actor._id,
          type: "intake.claim_renewed",
          data: { claimExpiresAt: lease.claimExpiresAt },
          requestId: principal.requestId,
          createdAt: now,
        });
        return { revision: intake.revision + 1, ...lease };
      },
    );
  },
});

export const completeTriage = internalMutation({
  args: {
    authorization: agentContextValidator,
    intakeId: v.id("intakes"),
    expectedRevision: v.number(),
    create: v.array(newWorkValidator),
    link: v.array(v.id("workItems")),
    duplicateOf: v.optional(v.id("workItems")),
    dismiss: v.boolean(),
    explanation: v.optional(v.string()),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:write",
    );
    const intake = await ctx.db.get(args.intakeId);
    if (!intake) fail("not_found", "Intake not found");
    assertSameProject(intake, principal.project);
    const now = Date.now();
    const explanation = optionalString(
      args.explanation,
      "explanation",
      MAX_BODY_LENGTH,
    );
    return await runIdempotent(
      ctx,
      {
        organizationId: intake.organizationId,
        projectId: intake.projectId,
        principalKey: principal.principalKey,
        operation: "intake.complete_triage",
        key: args.idempotencyKey,
        payload: {
          intakeId: args.intakeId,
          expectedRevision: args.expectedRevision,
          create: args.create,
          link: args.link,
          duplicateOf: args.duplicateOf,
          dismiss: args.dismiss,
          explanation,
        },
        now,
      },
      async () => {
        if (
          intake.status !== "claimed" ||
          intake.revision !== args.expectedRevision ||
          intake.claimedByInstallationId !== principal.installation._id
        ) {
          fail("claim_conflict", "Intake claim no longer belongs to this installation");
        }
        if (!isLeaseActive(intake.claimExpiresAt, now)) {
          fail("lease_expired", "Intake claim has expired");
        }
        if (
          !args.dismiss &&
          args.create.length === 0 &&
          args.link.length === 0 &&
          !args.duplicateOf
        ) {
          fail("validation", "Triage must create, link, duplicate, or dismiss");
        }
        const workItemIds = [];
        for (const input of args.create) {
          const workItemId = await createWorkItem(ctx, {
            projectId: intake.projectId,
            actorId: principal.actor._id,
            input,
            now,
          });
          await linkIntakeToWork(ctx, {
            intakeId: intake._id,
            workItemId,
            relation: "created",
            now,
          });
          workItemIds.push(workItemId);
        }
        for (const workItemId of [...new Set(args.link)]) {
          const work = await ctx.db.get(workItemId);
          if (!work) fail("not_found", "Work item not found");
          assertSameProject(work, principal.project);
          await linkIntakeToWork(ctx, {
            intakeId: intake._id,
            workItemId,
            relation: "linked",
            now,
          });
          workItemIds.push(workItemId);
        }
        if (args.duplicateOf) {
          const duplicate = await ctx.db.get(args.duplicateOf);
          if (!duplicate) fail("not_found", "Duplicate work item not found");
          assertSameProject(duplicate, principal.project);
          await linkIntakeToWork(ctx, {
            intakeId: intake._id,
            workItemId: duplicate._id,
            relation: "duplicate",
            now,
          });
          workItemIds.push(duplicate._id);
        }
        const status = args.dismiss ? "dismissed" : "processed";
        await ctx.db.patch(intake._id, {
          status,
          claimedByActorId: undefined,
          claimedByInstallationId: undefined,
          claimedAt: undefined,
          claimExpiresAt: undefined,
          processedAt: now,
          revision: intake.revision + 1,
          updatedAt: now,
        });
        await appendEvent(ctx, {
          organizationId: intake.organizationId,
          projectId: intake.projectId,
          intakeId: intake._id,
          actorId: principal.actor._id,
          type: args.dismiss ? "intake.dismissed" : "intake.processed",
          data: { workItemIds, explanation },
          requestId: principal.requestId,
          createdAt: now,
        });
        return { intakeId: intake._id, status, workItemIds, revision: intake.revision + 1 };
      },
    );
  },
});

export const reconcileExpiredClaims = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("intakes")
      .withIndex("by_claim_expiry", (q) =>
        q.gt("claimExpiresAt", 0).lte("claimExpiresAt", now),
      )
      .take(Math.max(1, Math.min(args.limit ?? 100, 200)));
    for (const intake of expired) {
      if (intake.status !== "claimed") continue;
      await ctx.db.patch(intake._id, {
        status: "new",
        claimedByActorId: undefined,
        claimedByInstallationId: undefined,
        claimedAt: undefined,
        claimExpiresAt: undefined,
        revision: intake.revision + 1,
        updatedAt: now,
      });
      const systemActor = await requireSystemActor(ctx, intake.organizationId);
      await appendEvent(ctx, {
        organizationId: intake.organizationId,
        projectId: intake.projectId,
        intakeId: intake._id,
        actorId: systemActor._id,
        type: "intake.claim_expired",
        data: {},
        createdAt: now,
      });
    }
    return { reconciled: expired.length };
  },
});
