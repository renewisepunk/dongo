const encoder = new TextEncoder();
const DOWNLOAD_PREFIX = "/api/files/download/";
const UPLOAD_PREFIX = "/api/files/upload/";
const MAX_DOWNLOAD_TTL_MS = 5 * 60 * 1_000 + 30_000;
const MAX_UPLOAD_TTL_MS = 15 * 60 * 1_000 + 30_000;
const MAX_FILE_BYTES = 250 * 1_024 * 1_024;
const STORAGE_KEY =
  /^organizations\/([A-Za-z0-9_-]{1,256})\/projects\/([A-Za-z0-9_-]{1,256})\/attachments\/([A-Za-z0-9_-]{1,256})$/u;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,256}$/u;
const CHECKSUM_SHA256 = /^[a-f0-9]{64}$/u;
const MIME_TYPE =
  /^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+(?:\s*;\s*[a-zA-Z0-9!#$&^_.+-]+=(?:[a-zA-Z0-9!#$&^_.+%*-]+|"[\x20-\x21\x23-\x7e]*"))*$/u;

export interface StoredAttachment {
  readonly body: ReadableStream<Uint8Array>;
  readonly size: number;
  readonly httpEtag: string;
  readonly contentType?: string;
  readonly filename?: string;
}

export interface StoredUpload {
  readonly size: number;
  readonly httpEtag: string;
  readonly checksumSha256?: string;
}

export interface StoreUploadOptions {
  readonly attachmentId: string;
  readonly size: number;
  readonly contentType: string;
  readonly checksumSha256?: string;
}

export interface AttachmentObjectStore {
  get(storageKey: string): Promise<StoredAttachment | null>;
  put(
    storageKey: string,
    body: ReadableStream<Uint8Array>,
    options: StoreUploadOptions,
  ): Promise<StoredUpload>;
  delete(storageKey: string): Promise<void>;
  ready(): Promise<void>;
}

export interface AttachmentFinalizeInput {
  readonly requestId: string;
  readonly attachmentId: string;
  readonly observedByteSize: number;
  readonly observedMimeType: string;
  readonly observedChecksumSha256?: string;
}

export interface AttachmentFinalizer {
  finalize(input: AttachmentFinalizeInput): Promise<void>;
}

export interface FilesWorkerOptions {
  readonly publicOrigin: URL;
  readonly allowedBrowserOrigin: string;
  readonly attachmentSigningSecret?: string;
  readonly store: AttachmentObjectStore;
  readonly finalizer?: AttachmentFinalizer;
  readonly now?: () => number;
}

export interface VerifiedDownloadLink {
  readonly attachmentId: string;
  readonly storageKey: string;
  readonly expiresAt: number;
}

export interface VerifiedUploadLink extends VerifiedDownloadLink {
  readonly maximumBytes: number;
  readonly mimeType: string;
  readonly checksumSha256?: string;
}

function json(
  body: Readonly<Record<string, unknown>>,
  status: number,
  headers?: HeadersInit,
): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });
}

function secureResponse(
  response: Response,
  request: Request,
  requestId: string,
  allowedBrowserOrigin: string,
): Response {
  const headers = new Headers(response.headers);
  headers.set("x-request-id", requestId);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("cross-origin-resource-policy", "same-origin");
  if (headers.has("cache-control") === false) {
    headers.set("cache-control", "private, no-store, max-age=0");
  }
  const origin = request.headers.get("origin");
  if (origin === allowedBrowserOrigin) {
    headers.set("access-control-allow-origin", origin);
    if (headers.get("vary")?.split(",").some((value) => value.trim() === "Origin") !== true) {
      headers.append("vary", "Origin");
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function base64UrlDecode(value: string, maxBytes: number): Uint8Array | undefined {
  if (
    value.length === 0 ||
    value.length > Math.ceil((maxBytes * 4) / 3) + 2 ||
    /^[A-Za-z0-9_-]+$/u.test(value) === false
  ) {
    return undefined;
  }
  const remainder = value.length % 4;
  if (remainder === 1) {
    return undefined;
  }
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - remainder) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    return undefined;
  }
  if (binary.length > maxBytes) {
    return undefined;
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  let canonical = "";
  for (const byte of bytes) canonical += String.fromCharCode(byte);
  canonical = btoa(canonical)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
  return canonical === value ? bytes : undefined;
}

function decodeUtf8(value: string, maxBytes: number): string | undefined {
  const bytes = base64UrlDecode(value, maxBytes);
  if (bytes === undefined) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

function validSecret(secret: string | undefined): secret is string {
  if (secret === undefined || secret.length < 32) return false;
  const byteLength = encoder.encode(secret).byteLength;
  return byteLength >= 32 && byteLength <= 4_096;
}

function strictQuery(
  url: URL,
  required: readonly string[],
  optional: readonly string[] = [],
): Readonly<Record<string, string>> | undefined {
  const allowed = new Set([...required, ...optional]);
  const entries = [...url.searchParams.entries()];
  if (
    entries.some(([name]) => allowed.has(name) === false) ||
    entries.length < required.length ||
    entries.length > required.length + optional.length
  ) return undefined;
  const result: Record<string, string> = {};
  for (const name of allowed) {
    const values = url.searchParams.getAll(name);
    if (values.length > 1 || (required.includes(name) && values.length !== 1)) {
      return undefined;
    }
    if (values.length === 1) result[name] = values[0] ?? "";
  }
  return result;
}

async function verifyHmac(
  secret: string,
  signatureValue: string,
  canonical: string,
): Promise<boolean> {
  const signature = base64UrlDecode(signatureValue, 64);
  if (signature === undefined || signature.byteLength !== 32) return false;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    cryptoKey,
    signature,
    encoder.encode(canonical),
  );
}

function validExpiry(value: string, now: number, maxTtlMs: number): number | undefined {
  if (/^\d{13}$/u.test(value) === false) return undefined;
  const expiresAt = Number(value);
  return Number.isSafeInteger(expiresAt) &&
      Number.isSafeInteger(now) &&
      expiresAt > now &&
      expiresAt - now <= maxTtlMs
    ? expiresAt
    : undefined;
}

function validateStorageKey(value: string, attachmentId: string): string | undefined {
  const storageKey = decodeUtf8(value, 2_048);
  const keyMatch = storageKey === undefined ? null : STORAGE_KEY.exec(storageKey);
  return keyMatch !== null && keyMatch[3] === attachmentId ? storageKey : undefined;
}

export async function verifyDownloadLink(
  url: URL,
  attachmentId: string,
  secret: string,
  now: number,
): Promise<VerifiedDownloadLink | undefined> {
  if (validSecret(secret) === false || IDENTIFIER.test(attachmentId) === false) {
    return undefined;
  }
  const query = strictQuery(url, ["expires", "key", "signature"]);
  if (query === undefined) return undefined;
  const expires = query.expires ?? "";
  const expiresAt = validExpiry(expires, now, MAX_DOWNLOAD_TTL_MS);
  const storageKey = validateStorageKey(query.key ?? "", attachmentId);
  if (expiresAt === undefined || storageKey === undefined) return undefined;
  const valid = await verifyHmac(
    secret,
    query.signature ?? "",
    `${attachmentId}\n${storageKey}\n${expires}`,
  );
  return valid ? Object.freeze({ attachmentId, storageKey, expiresAt }) : undefined;
}

export async function verifyUploadLink(
  url: URL,
  attachmentId: string,
  secret: string,
  now: number,
): Promise<VerifiedUploadLink | undefined> {
  if (validSecret(secret) === false || IDENTIFIER.test(attachmentId) === false) {
    return undefined;
  }
  const query = strictQuery(
    url,
    ["expires", "key", "maxBytes", "mime", "signature"],
    ["checksum"],
  );
  if (query === undefined) return undefined;
  const expires = query.expires ?? "";
  const expiresAt = validExpiry(expires, now, MAX_UPLOAD_TTL_MS);
  const storageKey = validateStorageKey(query.key ?? "", attachmentId);
  const maximumBytesText = query.maxBytes ?? "";
  const maximumBytes = /^\d{1,9}$/u.test(maximumBytesText)
    ? Number(maximumBytesText)
    : Number.NaN;
  const mimeType = decodeUtf8(query.mime ?? "", 200);
  const checksumSha256 = query.checksum;
  if (
    expiresAt === undefined ||
    storageKey === undefined ||
    Number.isSafeInteger(maximumBytes) === false ||
    maximumBytes <= 0 ||
    maximumBytes > MAX_FILE_BYTES ||
    mimeType === undefined ||
    mimeType.length === 0 ||
    mimeType.trim() !== mimeType ||
    MIME_TYPE.test(mimeType) === false ||
    (checksumSha256 !== undefined && CHECKSUM_SHA256.test(checksumSha256) === false)
  ) return undefined;
  const valid = await verifyHmac(
    secret,
    query.signature ?? "",
    [
      "PUT",
      attachmentId,
      storageKey,
      expires,
      maximumBytesText,
      mimeType,
      checksumSha256 ?? "",
    ].join("\n"),
  );
  return valid
    ? Object.freeze({
        attachmentId,
        storageKey,
        expiresAt,
        maximumBytes,
        mimeType,
        ...(checksumSha256 === undefined ? {} : { checksumSha256 }),
      })
    : undefined;
}

function routeIdentifier(pathname: string, prefix: string): string | undefined {
  if (pathname.startsWith(prefix) === false) return undefined;
  const encoded = pathname.slice(prefix.length);
  if (encoded.length === 0 || encoded.includes("/")) return undefined;
  let identifier: string;
  try {
    identifier = decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
  if (IDENTIFIER.test(identifier) === false || encodeURIComponent(identifier) !== encoded) {
    return undefined;
  }
  return identifier;
}

function safeContentType(value: string | undefined): string {
  const essence = value?.split(";", 1)[0]?.trim().toLowerCase();
  return essence !== undefined &&
    essence.length <= 200 &&
    /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(essence)
    ? essence
    : "application/octet-stream";
}

function contentDisposition(filename: string | undefined, attachmentId: string): string {
  const safeName = (filename ?? `attachment-${attachmentId}`)
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .slice(0, 500);
  const fallback = safeName
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/gu, "_")
    .replace(/^\.+/u, "")
    .slice(0, 120) || `attachment-${attachmentId}`;
  const encoded = encodeURIComponent(safeName || fallback).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function corsPreflight(
  request: Request,
  allowedBrowserOrigin: string,
  allowedMethod: "GET" | "PUT",
): Response {
  if (
    request.headers.get("origin") !== allowedBrowserOrigin ||
    request.headers.get("access-control-request-method") !== allowedMethod
  ) return json({ error: "cors_forbidden" }, 403);
  const requestedHeaders = (request.headers.get("access-control-request-headers") ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const allowedHeaders = allowedMethod === "PUT"
    ? new Set(["content-type", "x-dongo-content-sha256"])
    : new Set<string>();
  if (requestedHeaders.some((header) => allowedHeaders.has(header) === false)) {
    return json({ error: "cors_forbidden" }, 403);
  }
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": allowedBrowserOrigin,
      "access-control-allow-methods": allowedMethod,
      ...(allowedMethod === "PUT"
        ? { "access-control-allow-headers": "content-type, x-dongo-content-sha256" }
        : {}),
      "access-control-max-age": "300",
      "cache-control": "no-store",
      vary: "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
    },
  });
}

function parseContentLength(request: Request): number | undefined {
  const value = request.headers.get("content-length");
  if (value === null || /^\d{1,9}$/u.test(value) === false) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= MAX_FILE_BYTES
    ? parsed
    : undefined;
}

export function createFilesWorker(options: FilesWorkerOptions): {
  fetch(request: Request): Promise<Response>;
} {
  if (
    options.publicOrigin.protocol !== "https:" ||
    options.publicOrigin.username !== "" ||
    options.publicOrigin.password !== "" ||
    options.publicOrigin.pathname !== "/" ||
    options.publicOrigin.search !== "" ||
    options.publicOrigin.hash !== "" ||
    options.allowedBrowserOrigin !== options.publicOrigin.origin
  ) throw new Error("Files Worker public origin configuration is invalid");
  const now = options.now ?? Date.now;

  return {
    async fetch(request): Promise<Response> {
      const requestId = crypto.randomUUID();
      try {
        const url = new URL(request.url);
        if (url.origin !== options.publicOrigin.origin) {
          return secureResponse(
            json({ error: "invalid_host" }, 400),
            request,
            requestId,
            options.allowedBrowserOrigin,
          );
        }
        const requestOrigin = request.headers.get("origin");
        if (requestOrigin !== null && requestOrigin !== options.allowedBrowserOrigin) {
          return secureResponse(
            json({ error: "cors_forbidden" }, 403),
            request,
            requestId,
            options.allowedBrowserOrigin,
          );
        }

        if (url.pathname === "/api/files/healthz") {
          const response = request.method === "GET"
            ? json({
                status: "ok",
                serving: validSecret(options.attachmentSigningSecret) &&
                  options.finalizer !== undefined,
              }, 200)
            : json({ error: "method_not_allowed" }, 405, { allow: "GET" });
          return secureResponse(response, request, requestId, options.allowedBrowserOrigin);
        }
        if (url.pathname === "/api/files/readyz") {
          if (request.method !== "GET") {
            return secureResponse(
              json({ error: "method_not_allowed" }, 405, { allow: "GET" }),
              request,
              requestId,
              options.allowedBrowserOrigin,
            );
          }
          if (
            validSecret(options.attachmentSigningSecret) === false ||
            options.finalizer === undefined
          ) {
            return secureResponse(
              json({ status: "unavailable" }, 503),
              request,
              requestId,
              options.allowedBrowserOrigin,
            );
          }
          await options.store.ready();
          return secureResponse(
            json({ status: "ready" }, 200),
            request,
            requestId,
            options.allowedBrowserOrigin,
          );
        }

        const downloadId = routeIdentifier(url.pathname, DOWNLOAD_PREFIX);
        if (downloadId !== undefined) {
          if (request.method === "OPTIONS") {
            return secureResponse(
              corsPreflight(request, options.allowedBrowserOrigin, "GET"),
              request,
              requestId,
              options.allowedBrowserOrigin,
            );
          }
          if (request.method !== "GET") {
            return secureResponse(
              json({ error: "method_not_allowed" }, 405, { allow: "GET" }),
              request,
              requestId,
              options.allowedBrowserOrigin,
            );
          }
          if (validSecret(options.attachmentSigningSecret) === false) {
            return secureResponse(
              json({ error: "not_ready" }, 503, { "retry-after": "30" }),
              request,
              requestId,
              options.allowedBrowserOrigin,
            );
          }
          const verified = await verifyDownloadLink(
            url,
            downloadId,
            options.attachmentSigningSecret,
            now(),
          );
          if (verified === undefined) {
            return secureResponse(
              json({ error: "invalid_or_expired_link" }, 403),
              request,
              requestId,
              options.allowedBrowserOrigin,
            );
          }
          const object = await options.store.get(verified.storageKey);
          if (object === null) {
            return secureResponse(
              json({ error: "not_found" }, 404),
              request,
              requestId,
              options.allowedBrowserOrigin,
            );
          }
          if (
            Number.isSafeInteger(object.size) === false ||
            object.size <= 0 ||
            object.size > MAX_FILE_BYTES
          ) {
            await object.body.cancel("Stored attachment size is invalid");
            throw new Error("Stored attachment metadata is invalid");
          }
          const headers = new Headers({
            "cache-control": "private, no-store, max-age=0",
            "content-disposition": contentDisposition(object.filename, downloadId),
            "content-length": String(object.size),
            "content-security-policy": "default-src 'none'; sandbox",
            "content-type": safeContentType(object.contentType),
            etag: object.httpEtag,
            "x-download-options": "noopen",
          });
          return secureResponse(
            new Response(object.body, { status: 200, headers }),
            request,
            requestId,
            options.allowedBrowserOrigin,
          );
        }

        const uploadId = routeIdentifier(url.pathname, UPLOAD_PREFIX);
        if (uploadId !== undefined) {
          if (request.method === "OPTIONS") {
            return secureResponse(
              corsPreflight(request, options.allowedBrowserOrigin, "PUT"),
              request,
              requestId,
              options.allowedBrowserOrigin,
            );
          }
          if (request.method !== "PUT") {
            return secureResponse(
              json({ error: "method_not_allowed" }, 405, { allow: "PUT" }),
              request,
              requestId,
              options.allowedBrowserOrigin,
            );
          }
          if (
            validSecret(options.attachmentSigningSecret) === false ||
            options.finalizer === undefined
          ) {
            return secureResponse(
              json({ error: "not_ready" }, 503, { "retry-after": "30" }),
              request,
              requestId,
              options.allowedBrowserOrigin,
            );
          }
          const verified = await verifyUploadLink(
            url,
            uploadId,
            options.attachmentSigningSecret,
            now(),
          );
          if (verified === undefined) {
            return secureResponse(
              json({ error: "invalid_or_expired_link" }, 403),
              request,
              requestId,
              options.allowedBrowserOrigin,
            );
          }
          const contentLength = parseContentLength(request);
          const contentType = request.headers.get("content-type");
          const checksum = request.headers.get("x-dongo-content-sha256");
          if (
            request.body === null ||
            contentLength !== verified.maximumBytes ||
            contentType !== verified.mimeType ||
            (verified.checksumSha256 === undefined
              ? checksum !== null
              : checksum !== verified.checksumSha256)
          ) {
            return secureResponse(
              json({ error: "upload_headers_mismatch" }, 400),
              request,
              requestId,
              options.allowedBrowserOrigin,
            );
          }
          const stored = await options.store.put(verified.storageKey, request.body, {
            attachmentId: uploadId,
            size: contentLength,
            contentType,
            ...(verified.checksumSha256 === undefined
              ? {}
              : { checksumSha256: verified.checksumSha256 }),
          });
          try {
            if (stored.size !== contentLength) {
              throw new Error("R2 accepted an upload with unexpected metadata");
            }
            if (
              verified.checksumSha256 !== undefined &&
              stored.checksumSha256 !== undefined &&
              stored.checksumSha256 !== verified.checksumSha256
            ) throw new Error("R2 returned an unexpected upload checksum");
            await options.finalizer.finalize({
              requestId,
              attachmentId: uploadId,
              observedByteSize: contentLength,
              observedMimeType: contentType,
              ...(verified.checksumSha256 === undefined
                ? {}
                : { observedChecksumSha256: verified.checksumSha256 }),
            });
          } catch (error) {
            try {
              await options.store.delete(verified.storageKey);
            } catch (cleanupError) {
              console.error(JSON.stringify({
                event: "attachment_upload_compensation_failed",
                requestId,
                attachmentId: uploadId,
                errorName:
                  cleanupError instanceof Error
                    ? cleanupError.name
                    : "UnknownError",
              }));
            }
            throw error;
          }
          return secureResponse(
            json({
              ok: true,
              attachmentId: uploadId,
              byteSize: contentLength,
              etag: stored.httpEtag,
            }, 201),
            request,
            requestId,
            options.allowedBrowserOrigin,
          );
        }

        return secureResponse(
          json({ error: "not_found" }, 404),
          request,
          requestId,
          options.allowedBrowserOrigin,
        );
      } catch (error) {
        console.error(JSON.stringify({
          event: "files_worker_failure",
          requestId,
          errorName: error instanceof Error ? error.name : "UnknownError",
        }));
        return secureResponse(
          json({ error: "internal_error", requestId }, 500),
          request,
          requestId,
          options.allowedBrowserOrigin,
        );
      }
    },
  };
}
