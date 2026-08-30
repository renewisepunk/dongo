import { v } from "convex/values";
import { action } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { fail } from "../../lib/errors";

const UPLOAD_PATH = "/api/files/upload";
const MULTIPART_PATH = "/api/files/multipart";
const DISCARD_TTL_MS = 60 * 1_000;
const DOWNLOAD_TTL_MS = 5 * 60 * 1_000;
const SINGLE_UPLOAD_MAX_BYTES = 32 * 1_024 * 1_024;
const MULTIPART_PART_BYTES = 8 * 1_024 * 1_024;

export const reserveUpload = action({
  args: {
    projectId: v.id("projects"),
    filename: v.string(),
    mimeType: v.string(),
    byteSize: v.number(),
    checksumSha256: v.optional(v.string()),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args): Promise<
    | {
        transport: "single";
        attachmentId: Id<"attachments">;
        storageKey: string;
        expiresAt: number;
        maximumBytes: number;
        uploadUrl: string;
        method: "PUT";
        requiredHeaders: Record<string, string>;
      }
    | {
        transport: "multipart";
        attachmentId: Id<"attachments">;
        storageKey: string;
        expiresAt: number;
        maximumBytes: number;
        createUrl: string;
        method: "POST";
        partSize: number;
        partCount: number;
      }
  > => {
    const baseUrl = process.env.DONGO_ATTACHMENT_UPLOAD_BASE_URL;
    const secret = process.env.DONGO_ATTACHMENT_URL_SIGNING_SECRET;
    if (!baseUrl || !secret || secret.length < 32) {
      fail("internal", "Attachment upload signing is not configured", {
        retryable: true,
      });
    }
    let url: URL;
    try {
      const configured = new URL(baseUrl);
      if (configured.protocol !== "https:" || configured.pathname !== UPLOAD_PATH) {
        fail("internal", "Attachment upload origin is invalid");
      }
      url = new URL(`${configured.origin}${UPLOAD_PATH}`);
    } catch {
      fail("internal", "Attachment upload origin is invalid");
    }
    if (
      args.byteSize > SINGLE_UPLOAD_MAX_BYTES &&
      args.checksumSha256 !== undefined
    ) {
      fail(
        "validation",
        "Checksummed uploads larger than 32 MB are not supported",
      );
    }
    const reservation = await ctx.runMutation(
      api.domains.attachments.index.reserve,
      args,
    );
    if (reservation.maximumBytes > SINGLE_UPLOAD_MAX_BYTES) {
      url.pathname = `${MULTIPART_PATH}/${encodeURIComponent(reservation.attachmentId)}`;
      const partSize = MULTIPART_PART_BYTES;
      const partCount = Math.ceil(reservation.maximumBytes / partSize);
      const key = base64UrlEncode(
        new TextEncoder().encode(reservation.storageKey),
      );
      const mime = base64UrlEncode(new TextEncoder().encode(args.mimeType.trim()));
      const signature = await hmacBase64Url(
        secret,
        [
          "MULTIPART_CREATE",
          reservation.attachmentId,
          reservation.storageKey,
          String(reservation.expiresAt),
          String(reservation.maximumBytes),
          args.mimeType.trim(),
          String(partSize),
          String(partCount),
        ].join("\n"),
      );
      url.searchParams.set("expires", String(reservation.expiresAt));
      url.searchParams.set("key", key);
      url.searchParams.set("maxBytes", String(reservation.maximumBytes));
      url.searchParams.set("mime", mime);
      url.searchParams.set("partSize", String(partSize));
      url.searchParams.set("partCount", String(partCount));
      url.searchParams.set("signature", signature);
      return {
        ...reservation,
        transport: "multipart",
        createUrl: url.toString(),
        method: "POST",
        partSize,
        partCount,
      };
    }
    url.pathname = `${UPLOAD_PATH}/${encodeURIComponent(reservation.attachmentId)}`;
    const key = base64UrlEncode(
      new TextEncoder().encode(reservation.storageKey),
    );
    const mime = base64UrlEncode(new TextEncoder().encode(args.mimeType.trim()));
    const checksum = args.checksumSha256?.trim().toLowerCase() ?? "";
    const signature = await hmacBase64Url(
      secret,
      [
        "PUT",
        reservation.attachmentId,
        reservation.storageKey,
        String(reservation.expiresAt),
        String(reservation.maximumBytes),
        args.mimeType.trim(),
        checksum,
      ].join("\n"),
    );
    url.searchParams.set("expires", String(reservation.expiresAt));
    url.searchParams.set("key", key);
    url.searchParams.set("maxBytes", String(reservation.maximumBytes));
    url.searchParams.set("mime", mime);
    if (checksum) url.searchParams.set("checksum", checksum);
    url.searchParams.set("signature", signature);

    const requiredHeaders: Record<string, string> = {
      "content-type": args.mimeType.trim(),
    };
    if (checksum) requiredHeaders["x-dongo-content-sha256"] = checksum;
    return {
      ...reservation,
      transport: "single",
      uploadUrl: url.toString(),
      method: "PUT",
      requiredHeaders,
    };
  },
});

export const discardUpload = action({
  args: { attachmentId: v.id("attachments") },
  handler: async (ctx, args): Promise<{
    attachmentId: Id<"attachments">;
    deleted: true;
  }> => {
    const baseUrl = process.env.DONGO_ATTACHMENT_UPLOAD_BASE_URL;
    const secret = process.env.DONGO_ATTACHMENT_URL_SIGNING_SECRET;
    if (!baseUrl || !secret || secret.length < 32) {
      fail("internal", "Attachment cleanup is not configured", {
        retryable: true,
      });
    }
    let configured: URL;
    try {
      configured = new URL(baseUrl);
      if (configured.protocol !== "https:" || configured.pathname !== UPLOAD_PATH) {
        fail("internal", "Attachment cleanup origin is invalid");
      }
    } catch {
      fail("internal", "Attachment cleanup origin is invalid");
    }
    const discarded = await ctx.runMutation(
      api.domains.attachments.index.discard,
      args,
    );
    const expiresAt = Date.now() + DISCARD_TTL_MS;
    const url = new URL(
      `${configured.origin}${UPLOAD_PATH}/${encodeURIComponent(discarded.attachmentId)}`,
    );
    const key = base64UrlEncode(new TextEncoder().encode(discarded.storageKey));
    const signature = await hmacBase64Url(
      secret,
      [
        "DELETE",
        discarded.attachmentId,
        discarded.storageKey,
        String(expiresAt),
      ].join("\n"),
    );
    url.searchParams.set("expires", String(expiresAt));
    url.searchParams.set("key", key);
    url.searchParams.set("signature", signature);
    const response = await fetch(url, {
      method: "DELETE",
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      fail("internal", "Attachment cleanup is temporarily unavailable", {
        retryable: true,
      });
    }
    return { attachmentId: discarded.attachmentId, deleted: true };
  },
});

export const downloadForHuman = action({
  args: { attachmentId: v.id("attachments") },
  handler: async (ctx, args): Promise<{
    attachmentId: Id<"attachments">;
    filename: string;
    contentType: string;
    byteSize: number;
    downloadUrl: string;
    expiresAt: number;
  }> => {
    const attachment = await ctx.runQuery(
      internal.domains.attachments.index.getDownloadMetadataForHuman,
      { attachmentId: args.attachmentId },
    );
    const baseUrl = process.env.DONGO_ATTACHMENT_DOWNLOAD_BASE_URL;
    const secret = process.env.DONGO_ATTACHMENT_URL_SIGNING_SECRET;
    if (!baseUrl || !secret || secret.length < 32) {
      fail("internal", "Attachment download signing is not configured", {
        retryable: true,
      });
    }
    let url: URL;
    try {
      const configured = new URL(baseUrl);
      if (
        configured.protocol !== "https:" ||
        configured.username !== "" ||
        configured.password !== "" ||
        configured.pathname.replace(/\/$/u, "") !== "/api/files/download" ||
        configured.search !== "" ||
        configured.hash !== ""
      ) {
        fail("internal", "Attachment download origin is invalid");
      }
      url = new URL(
        `/api/files/download/${encodeURIComponent(attachment._id)}`,
        configured.origin,
      );
    } catch {
      fail("internal", "Attachment download origin is invalid");
    }
    const expiresAt = Date.now() + DOWNLOAD_TTL_MS;
    const key = base64UrlEncode(
      new TextEncoder().encode(attachment.storageKey),
    );
    const signature = await hmacBase64Url(
      secret,
      `${attachment._id}\n${attachment.storageKey}\n${expiresAt}`,
    );
    url.searchParams.set("expires", String(expiresAt));
    url.searchParams.set("key", key);
    url.searchParams.set("signature", signature);
    return {
      attachmentId: attachment._id,
      filename: attachment.filename,
      contentType: attachment.mimeType,
      byteSize: attachment.byteSize,
      downloadUrl: url.toString(),
      expiresAt,
    };
  },
});

async function hmacBase64Url(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
  );
  return base64UrlEncode(signature);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
