import { deliveryRequestSchema, type DeliveryResult } from "./contracts";
import { providerConfig } from "./config";
import { json } from "./http";
import { deliverApns, deliverEmail, deliverFcm } from "./providers";
import { verifyInternalRequest } from "./security";

const DELIVER_PATH = "/api/notifications/v1/deliver";
const MAX_BODY_BYTES = 24 * 1_024;

function allowedHostname(env: Env, hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return env.ALLOWED_HOSTNAMES.split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .includes(normalized);
}

function secretAvailable(value: string): boolean {
  const byteLength = new TextEncoder().encode(value).byteLength;
  return byteLength >= 32 && byteLength <= 4_096;
}

async function readBoundedRequest(request: Request): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new Error("payload_too_large");
  }
  if (request.body === null) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel("request body exceeded limit");
      throw new Error("payload_too_large");
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

function validDeepLink(value: string, env: Env): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const origin = new URL(env.PUBLIC_ORIGIN);
  return (
    url.origin === origin.origin &&
    url.username === "" &&
    url.password === "" &&
    url.pathname.startsWith("/app/")
  );
}

function resultResponse(result: DeliveryResult): Response {
  if (result.ok) return json(result, 200);
  const status = result.error.retryable ? 503 : 422;
  return json(result, status, result.error.retryable ? { "retry-after": "60" } : undefined);
}

async function handleDelivery(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return json({ ok: false, error: { code: "method_not_allowed" } }, 405, {
      allow: "POST",
    });
  }
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return json({ ok: false, error: { code: "unsupported_media_type" } }, 415);
  }
  const rateLimit = await env.NOTIFICATION_RATE_LIMITER.limit({ key: "convex" });
  if (!rateLimit.success) {
    return json(
      { ok: false, error: { code: "rate_limited", retryable: true } },
      429,
      { "retry-after": "60" },
    );
  }
  let body: Uint8Array;
  try {
    body = await readBoundedRequest(request);
  } catch {
    return json({ ok: false, error: { code: "payload_too_large" } }, 413);
  }
  try {
    await verifyInternalRequest({
      secret: env.DONGO_NOTIFICATION_DISPATCH_SECRET,
      keyId: request.headers.get("x-dongo-key-id"),
      timestamp: request.headers.get("x-dongo-timestamp"),
      nonce: request.headers.get("x-dongo-nonce"),
      signature: request.headers.get("x-dongo-signature"),
      method: request.method,
      pathname: new URL(request.url).pathname,
      body,
    });
  } catch {
    return json({ ok: false, error: { code: "unauthorized" } }, 401);
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return json({ ok: false, error: { code: "invalid_json" } }, 400);
  }
  const parsed = deliveryRequestSchema.safeParse(decoded);
  if (!parsed.success || !validDeepLink(parsed.data.deepLink, env)) {
    return json({ ok: false, error: { code: "invalid_request" } }, 400);
  }
  const config = providerConfig(env);
  if (parsed.data.channel === "email") {
    if (!config.resend) {
      return json(
        { ok: false, error: { code: "resend_not_configured", retryable: true } },
        503,
        { "retry-after": "300" },
      );
    }
    return resultResponse(
      await deliverEmail({
        request: parsed.data,
        config: config.resend,
        fromEmail: env.RESEND_FROM_EMAIL,
        fromName: env.RESEND_FROM_NAME,
      }),
    );
  }
  if (parsed.data.platform === "ios") {
    if (!config.apns) {
      return json(
        { ok: false, error: { code: "apns_not_configured", retryable: true } },
        503,
        { "retry-after": "300" },
      );
    }
    return resultResponse(
      await deliverApns({ request: parsed.data, config: config.apns }),
    );
  }
  if (!config.fcm) {
    return json(
      { ok: false, error: { code: "fcm_not_configured", retryable: true } },
      503,
      { "retry-after": "300" },
    );
  }
  return resultResponse(
    await deliverFcm({ request: parsed.data, config: config.fcm }),
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!allowedHostname(env, url.hostname)) {
      return json({ ok: false, error: { code: "not_found" } }, 404);
    }
    if (url.pathname === "/api/notifications/healthz") {
      return request.method === "GET"
        ? json({ ok: true, service: "notifications" }, 200)
        : json({ ok: false, error: { code: "method_not_allowed" } }, 405, {
            allow: "GET",
          });
    }
    if (url.pathname === "/api/notifications/readyz") {
      if (request.method !== "GET") {
        return json({ ok: false, error: { code: "method_not_allowed" } }, 405, {
          allow: "GET",
        });
      }
      const providers = providerConfig(env);
      const status = {
        dispatch: secretAvailable(env.DONGO_NOTIFICATION_DISPATCH_SECRET),
        resend: providers.resend !== undefined,
        apns: providers.apns !== undefined,
        fcm: providers.fcm !== undefined,
      };
      const ready = Object.values(status).every(Boolean);
      return json({ ok: ready, service: "notifications", providers: status }, ready ? 200 : 503);
    }
    if (url.pathname !== DELIVER_PATH) {
      return json({ ok: false, error: { code: "not_found" } }, 404);
    }
    try {
      return await handleDelivery(request, env);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "notification_delivery_failure",
          path: url.pathname,
          ray: request.headers.get("cf-ray"),
          errorName: error instanceof Error ? error.name : "UnknownError",
        }),
      );
      return json(
        { ok: false, error: { code: "internal_error", retryable: true } },
        500,
      );
    }
  },
} satisfies ExportedHandler<Env>;

export { renderAttentionEmail } from "./providers";
export { verifyInternalRequest } from "./security";
