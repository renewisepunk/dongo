import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "../../_generated/server";
import { agentContextValidator } from "../../lib/validators";
import {
  assertSameProject,
  requireHumanProject,
  resolveAgentPrincipal,
} from "../../lib/authz";
import { fail, requireString } from "../../lib/errors";
import { runIdempotent } from "../../lib/idempotency";
import {
  MAX_ATTACHMENT_BYTES,
  organizationStorageLimit,
} from "../../lib/plans";
import { attachmentSummary } from "./summary";

const RESERVATION_TTL_MS = 60 * 60 * 1_000;

function assertByteSize(byteSize: number): number {
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0) {
    fail("validation", "byteSize must be a positive integer");
  }
  if (byteSize > MAX_ATTACHMENT_BYTES) {
    fail("quota_exceeded", "Individual uploads may not exceed 250 MB");
  }
  return byteSize;
}

export const reserve = mutation({
  args: {
    projectId: v.id("projects"),
    filename: v.string(),
    mimeType: v.string(),
    byteSize: v.number(),
    checksumSha256: v.optional(v.string()),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await requireHumanProject(ctx, args.projectId);
    const byteSize = assertByteSize(args.byteSize);
    const filename = requireString(args.filename, "filename", 500);
    const mimeType = requireString(args.mimeType, "mimeType", 200);
    const checksumSha256 = args.checksumSha256
      ? requireString(args.checksumSha256, "checksumSha256", 64).toLowerCase()
      : undefined;
    if (checksumSha256 && !/^[a-f0-9]{64}$/.test(checksumSha256)) {
      fail("validation", "checksumSha256 must be a 64-character hex digest");
    }
    const now = Date.now();
    return await runIdempotent(
      ctx,
      {
        organizationId: principal.project!.organizationId,
        projectId: args.projectId,
        principalKey: principal.principalKey,
        operation: "attachment.reserve",
        key: args.idempotencyKey,
        payload: { filename, mimeType, byteSize, checksumSha256 },
        now,
      },
      async () => {
        const organization = await ctx.db.get(
          principal.project!.organizationId,
        );
        if (!organization) fail("not_found", "Organization not found");
        let ledger = await ctx.db
          .query("storageLedgers")
          .withIndex("by_organization", (q) =>
            q.eq("organizationId", organization._id),
          )
          .unique();
        const limit = organizationStorageLimit(organization.plan);
        const used = (ledger?.reservedBytes ?? 0) + (ledger?.activeBytes ?? 0);
        if (used + byteSize > limit) {
          fail("quota_exceeded", "Organization media storage quota exceeded", {
            limitBytes: limit,
            usedBytes: used,
            requestedBytes: byteSize,
          });
        }
        if (!ledger) {
          const ledgerId = await ctx.db.insert("storageLedgers", {
            organizationId: organization._id,
            reservedBytes: 0,
            activeBytes: 0,
            updatedAt: now,
          });
          ledger = (await ctx.db.get(ledgerId))!;
        }
        const attachmentId = await ctx.db.insert("attachments", {
          organizationId: organization._id,
          projectId: args.projectId,
          createdByProfileId: principal.profile._id,
          filename,
          mimeType,
          byteSize,
          storageKey: "pending",
          checksumSha256,
          status: "pending",
          createdAt: now,
          expiresAt: now + RESERVATION_TTL_MS,
        });
        const storageKey = `organizations/${organization._id}/projects/${args.projectId}/attachments/${attachmentId}`;
        await ctx.db.patch(attachmentId, { storageKey });
        await ctx.db.patch(ledger._id, {
          reservedBytes: ledger.reservedBytes + byteSize,
          updatedAt: now,
        });
        return {
          attachmentId,
          storageKey,
          expiresAt: now + RESERVATION_TTL_MS,
          maximumBytes: byteSize,
        };
      },
    );
  },
});

export const finalize = internalMutation({
  args: {
    attachmentId: v.id("attachments"),
    observedByteSize: v.number(),
    observedMimeType: v.string(),
    observedChecksumSha256: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const attachment = await ctx.db.get(args.attachmentId);
    if (!attachment) fail("not_found", "Attachment not found");
    if (attachment.status === "available") {
      if (
        attachment.byteSize !== args.observedByteSize ||
        attachment.mimeType !== args.observedMimeType ||
        (attachment.checksumSha256 !== undefined &&
          attachment.checksumSha256 !== args.observedChecksumSha256)
      ) {
        fail("idempotency_conflict", "Finalized attachment metadata differs");
      }
      return { attachmentId: attachment._id, status: "available" as const };
    }
    const now = Date.now();
    if (
      attachment.status !== "pending" ||
      attachment.expiresAt === undefined ||
      attachment.expiresAt <= now
    ) {
      fail("upload_incomplete", "Upload reservation is not active");
    }
    if (
      args.observedByteSize !== attachment.byteSize ||
      args.observedMimeType !== attachment.mimeType
    ) {
      fail("upload_incomplete", "Uploaded object metadata does not match reservation");
    }
    const observedChecksumSha256 = args.observedChecksumSha256?.toLowerCase();
    if (
      attachment.checksumSha256 !== undefined &&
      attachment.checksumSha256 !== observedChecksumSha256
    ) {
      fail("upload_incomplete", "Uploaded object checksum does not match reservation");
    }
    const ledger = await ctx.db
      .query("storageLedgers")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", attachment.organizationId),
      )
      .unique();
    if (!ledger || ledger.reservedBytes < attachment.byteSize) {
      fail("upload_incomplete", "Upload quota reservation is missing");
    }
    await ctx.db.patch(attachment._id, {
      checksumSha256: observedChecksumSha256 ?? attachment.checksumSha256,
      status: "available",
      finalizedAt: now,
      expiresAt: undefined,
    });
    await ctx.db.patch(ledger._id, {
      reservedBytes: ledger.reservedBytes - attachment.byteSize,
      activeBytes: ledger.activeBytes + attachment.byteSize,
      updatedAt: now,
    });
    return { attachmentId: attachment._id, status: "available" as const };
  },
});

export const abandon = mutation({
  args: { attachmentId: v.id("attachments") },
  handler: async (ctx, args) => {
    const attachment = await ctx.db.get(args.attachmentId);
    if (!attachment) fail("not_found", "Attachment not found");
    const principal = await requireHumanProject(ctx, attachment.projectId);
    if (attachment.createdByProfileId !== principal.profile._id) {
      fail("not_found", "Attachment not found");
    }
    if (attachment.status !== "pending") {
      fail("invalid_transition", "Only pending uploads may be abandoned");
    }
    const ledger = await ctx.db
      .query("storageLedgers")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", attachment.organizationId),
      )
      .unique();
    const now = Date.now();
    if (ledger) {
      await ctx.db.patch(ledger._id, {
        reservedBytes: Math.max(0, ledger.reservedBytes - attachment.byteSize),
        updatedAt: now,
      });
    }
    await ctx.db.patch(attachment._id, { status: "deleted", expiresAt: now });
    return { attachmentId: attachment._id, storageKey: attachment.storageKey };
  },
});

export const discard = mutation({
  args: { attachmentId: v.id("attachments") },
  handler: async (ctx, args) => {
    const attachment = await ctx.db.get(args.attachmentId);
    if (!attachment) fail("not_found", "Attachment not found");
    const principal = await requireHumanProject(ctx, attachment.projectId);
    if (attachment.createdByProfileId !== principal.profile._id) {
      fail("not_found", "Attachment not found");
    }
    if (attachment.intakeId !== undefined || attachment.workItemId !== undefined) {
      fail("invalid_transition", "Attached media cannot be discarded");
    }
    if (attachment.status === "deleted") {
      return {
        attachmentId: attachment._id,
        storageKey: attachment.storageKey,
        deleted: true as const,
      };
    }
    if (attachment.status !== "pending" && attachment.status !== "available") {
      fail("invalid_transition", "Attachment cannot be discarded");
    }
    const ledger = await ctx.db
      .query("storageLedgers")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", attachment.organizationId),
      )
      .unique();
    const now = Date.now();
    if (ledger) {
      await ctx.db.patch(ledger._id, {
        reservedBytes:
          attachment.status === "pending"
            ? Math.max(0, ledger.reservedBytes - attachment.byteSize)
            : ledger.reservedBytes,
        activeBytes:
          attachment.status === "available"
            ? Math.max(0, ledger.activeBytes - attachment.byteSize)
            : ledger.activeBytes,
        updatedAt: now,
      });
    }
    await ctx.db.patch(attachment._id, {
      status: "deleted",
      expiresAt: now,
    });
    return {
      attachmentId: attachment._id,
      storageKey: attachment.storageKey,
      deleted: true as const,
    };
  },
});

export const getForHuman = query({
  args: { attachmentId: v.id("attachments") },
  handler: async (ctx, args) => {
    const attachment = await ctx.db.get(args.attachmentId);
    if (!attachment || attachment.status !== "available") {
      fail("not_found", "Attachment not found");
    }
    await requireHumanProject(ctx, attachment.projectId, { allowArchived: true });
    return attachmentSummary(attachment);
  },
});

export const getDownloadMetadataForHuman = internalQuery({
  args: { attachmentId: v.id("attachments") },
  handler: async (ctx, args) => {
    const attachment = await ctx.db.get(args.attachmentId);
    if (!attachment || attachment.status !== "available") {
      fail("not_found", "Attachment not found");
    }
    await requireHumanProject(ctx, attachment.projectId, { allowArchived: true });
    return {
      ...attachmentSummary(attachment),
      storageKey: attachment.storageKey,
    };
  },
});

export const getForAgent = internalQuery({
  args: {
    authorization: agentContextValidator,
    attachmentId: v.id("attachments"),
  },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      ["dongo:work:read", "dongo:attachments:read"],
    );
    const attachment = await ctx.db.get(args.attachmentId);
    if (!attachment || attachment.status !== "available") {
      fail("not_found", "Attachment not found");
    }
    assertSameProject(attachment, principal.project);
    return attachment;
  },
});

export const reconcileExpiredReservations = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const pending = await ctx.db
      .query("attachments")
      .withIndex("by_status_expires", (q) =>
        q.eq("status", "pending").lte("expiresAt", now),
      )
      .take(Math.max(1, Math.min(args.limit ?? 100, 200)));
    let reconciled = 0;
    for (const attachment of pending) {
      const ledger = await ctx.db
        .query("storageLedgers")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", attachment.organizationId),
        )
        .unique();
      if (ledger) {
        await ctx.db.patch(ledger._id, {
          reservedBytes: Math.max(0, ledger.reservedBytes - attachment.byteSize),
          updatedAt: now,
        });
      }
      await ctx.db.patch(attachment._id, { status: "deleted", expiresAt: now });
      reconciled += 1;
    }
    return { reconciled };
  },
});
