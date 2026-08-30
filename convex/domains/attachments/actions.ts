import { v } from "convex/values";
import { action } from "../../_generated/server";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { fail } from "../../lib/errors";

const UPLOAD_PATH = "/api/files/upload";

export const reserveUpload = action({
  args: {
    projectId: v.id("projects"),
    filename: v.string(),
    mimeType: v.string(),
    byteSize: v.number(),
    checksumSha256: v.optional(v.string()),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args): Promise<{
    attachmentId: Id<"attachments">;
    storageKey: string;
    expiresAt: number;
    maximumBytes: number;
    uploadUrl: string;
    method: "PUT";
    requiredHeaders: Record<string, string>;
  }> => {
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
    const reservation = await ctx.runMutation(
      api.domains.attachments.index.reserve,
      args,
    );
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
      uploadUrl: url.toString(),
      method: "PUT",
      requiredHeaders,
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
