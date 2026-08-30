import { jwtVerify, type JWTPayload } from "jose";

const encoder = new TextEncoder();
const MAX_METADATA_BYTES = 5 * 1_024;
const METADATA_TIMEOUT_MS = 5_000;
const INTERNAL_REQUEST_WINDOW_MS = 60_000;

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export type HumanBridgeClaims = JWTPayload & {
  sub: string;
  jti: string;
  email: string;
  name: string;
  profileId: string;
  projectRef?: string;
  returnTo?: string;
};

function requiredClaim(payload: JWTPayload, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Bridge assertion is missing ${key}`);
  }
  return value;
}

export async function verifyHumanBridgeAssertion(input: {
  token: string;
  secret: string;
  issuer: string;
  audience: string;
}): Promise<HumanBridgeClaims> {
  if (input.secret.length < 32) {
    throw new Error("Human assertion secret is not configured safely");
  }
  const { payload, protectedHeader } = await jwtVerify(
    input.token,
    encoder.encode(input.secret),
    {
      algorithms: ["HS256"],
      issuer: input.issuer,
      audience: input.audience,
      maxTokenAge: "2m",
      clockTolerance: 5,
    },
  );
  if (protectedHeader.typ !== undefined && protectedHeader.typ !== "JWT") {
    throw new Error("Bridge assertion has an invalid type");
  }
  const claims = {
    ...payload,
    sub: requiredClaim(payload, "sub"),
    jti: requiredClaim(payload, "jti"),
    email: requiredClaim(payload, "email"),
    name: requiredClaim(payload, "name"),
    profileId: requiredClaim(payload, "profileId"),
  } as HumanBridgeClaims;
  if (claims.sub !== claims.profileId) {
    throw new Error("Bridge assertion subject does not match its profile");
  }
  return claims;
}

export function safeReturnTo(value: unknown, publicOrigin: string): string {
  const fallback = "/app";
  if (typeof value !== "string" || value.length === 0) return fallback;
  let url: URL;
  try {
    url = new URL(value, publicOrigin);
  } catch {
    return fallback;
  }
  if (url.origin !== new URL(publicOrigin).origin || url.username || url.password) {
    return fallback;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function allowedMetadataHostname(
  hostname: string,
  allowedSuffixes: readonly string[],
): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized) ||
    normalized.includes(":")
  ) {
    return false;
  }
  return allowedSuffixes.some((suffix) => {
    const clean = suffix.toLowerCase().replace(/^\./, "").replace(/\.$/, "");
    return normalized === clean || normalized.endsWith(`.${clean}`);
  });
}

async function readBoundedMetadataBody(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_METADATA_BYTES) {
      await reader.cancel("client metadata response exceeded limit");
      throw new Error("Client metadata response is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function metadataResponseHeaders(source: Headers): Headers {
  const headers = new Headers();
  for (const name of [
    "content-type",
    "cache-control",
    "vary",
    "expires",
    "date",
    "age",
    "etag",
    "last-modified",
  ]) {
    const value = source.get(name);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}

export function createMetadataFetcher(allowedSuffixes: readonly string[]) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const sourceRequest = input instanceof Request ? input : undefined;
    const rawUrl = sourceRequest
      ? sourceRequest.url
      : input instanceof URL || typeof input === "string"
        ? input.toString()
        : input.url;
    const url = new URL(rawUrl);
    const method = (init?.method ?? sourceRequest?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers ?? sourceRequest?.headers);
    const callerSignal = init?.signal ?? sourceRequest?.signal;
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== "" ||
      !allowedMetadataHostname(url.hostname, allowedSuffixes)
    ) {
      throw new Error("Client metadata URL is not allowed");
    }
    if (method !== "GET" && method !== "HEAD") {
      throw new Error("Client metadata fetch permits only GET and HEAD");
    }
    // Workerd accepts AbortController-backed fetch signals, but composite
    // AbortSignal helpers have varied across edge-runtime releases. Forward
    // the caller's cancellation explicitly and keep our own bounded timeout so
    // a client-controlled metadata origin can never hold the request open.
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timeout = setTimeout(abort, METADATA_TIMEOUT_MS);
    if (callerSignal?.aborted) abort();
    else callerSignal?.addEventListener("abort", abort, { once: true });
    let response: Response;
    try {
      // Do not reuse the caller-owned Request here. CIMD resolvers commonly
      // construct it with redirect="error"; workerd rejects attempts to reuse
      // that Request while overriding the redirect mode. Rebuild the bounded
      // GET/HEAD subrequest from the already-validated URL and headers.
      response = await fetch(url.toString(), {
        method,
        headers,
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (error) {
      const cause =
        error && typeof error === "object" && "cause" in error
          ? (error as { cause?: unknown }).cause
          : undefined;
      const causeCode =
        cause && typeof cause === "object" && "code" in cause
          ? (cause as { code?: unknown }).code
          : undefined;
      console.warn(JSON.stringify({
        event: "cimd_metadata_fetch_failure",
        errorName: error instanceof Error ? error.name : "UnknownError",
        causeName: cause instanceof Error ? cause.name : undefined,
        causeCode:
          typeof causeCode === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(causeCode)
            ? causeCode
            : undefined,
      }));
      throw error;
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", abort);
    }
    if (response.status >= 300 && response.status < 400) {
      throw new Error("Client metadata redirects are not allowed");
    }
    console.info(JSON.stringify({
      event: "cimd_metadata_fetch_response",
      status: response.status,
      contentType: response.headers.get("content-type")?.slice(0, 100),
      encoded: response.headers.has("content-encoding"),
      declaredLength: response.headers.has("content-length"),
      redirected: response.redirected,
      bodyUsed: response.bodyUsed,
    }));
    let body: ArrayBuffer | null = null;
    if (method !== "HEAD") {
      try {
        body = ownedArrayBuffer(await readBoundedMetadataBody(response));
      } catch (error) {
        console.warn(JSON.stringify({
          event: "cimd_metadata_body_failure",
          errorName: error instanceof Error ? error.name : "UnknownError",
        }));
        throw error;
      }
    }
    // Worker fetches may decode the body while retaining upstream transport
    // headers. Return a small clean response so the CIMD resolver never sees a
    // stale content-encoding/content-length pair, cookies, or unrelated origin
    // headers. It independently validates JSON, Content-Type, and the same 5 KB
    // maximum before accepting the client.
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: metadataResponseHeaders(response.headers),
    });
  };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", ownedArrayBuffer(bytes)),
  );
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function signInternalRequest(input: {
  secret: string;
  timestamp: string;
  nonce: string;
  method: string;
  pathname: string;
  body: Uint8Array;
}): Promise<string> {
  const bodyHash = await sha256Hex(input.body);
  const canonical = [
    input.timestamp,
    input.nonce,
    input.method.toUpperCase(),
    input.pathname,
    bodyHash,
  ].join("\n");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(input.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(canonical)),
  );
  return btoa(String.fromCharCode(...signature))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Internal signature has an invalid encoding");
  }
  const standard = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = standard.padEnd(Math.ceil(standard.length / 4) * 4, "=");
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

export async function verifyInternalRequest(input: {
  secret: string;
  keyId: string | null;
  timestamp: string | null;
  nonce: string | null;
  signature: string | null;
  method: string;
  pathname: string;
  body: Uint8Array;
  now?: number;
}): Promise<{ timestamp: number; nonce: string }> {
  if (input.secret.length < 32 || input.keyId !== "v1") {
    throw new Error("Internal request credentials are not configured");
  }
  if (
    input.timestamp === null ||
    !/^\d{13}$/.test(input.timestamp) ||
    input.nonce === null ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.nonce) ||
    input.signature === null
  ) {
    throw new Error("Internal request headers are invalid");
  }
  const timestamp = Number(input.timestamp);
  if (Math.abs((input.now ?? Date.now()) - timestamp) > INTERNAL_REQUEST_WINDOW_MS) {
    throw new Error("Internal request timestamp is outside the accepted window");
  }
  const bodyHash = await sha256Hex(input.body);
  const canonical = [
    input.timestamp,
    input.nonce,
    input.method.toUpperCase(),
    input.pathname,
    bodyHash,
  ].join("\n");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(input.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signature = decodeBase64Url(input.signature);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    ownedArrayBuffer(signature),
    encoder.encode(canonical),
  );
  if (!valid) throw new Error("Internal request signature is invalid");
  return { timestamp, nonce: input.nonce };
}
