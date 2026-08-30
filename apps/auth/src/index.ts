import { createAuthorizationServer } from "./auth";
import type { AuthWorkerEnv } from "./env";
import { provisionProjectResource } from "./resource-provisioning";
import { sendOtpEmail } from "./otp-email";
import { resourceIntrospection } from "./resource-introspection";

function securityHeaders(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers);
  headers.set("x-request-id", requestId);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function configured(env: AuthWorkerEnv): boolean {
  return (
    env.BETTER_AUTH_SECRET?.length >= 32 &&
    env.HUMAN_ASSERTION_SECRET?.length >= 32 &&
    env.DONGO_INTERNAL_GATEWAY_SECRET?.length >= 32 &&
    env.BETTER_AUTH_RESOURCE_CLIENT_ID?.length >= 3 &&
    env.BETTER_AUTH_RESOURCE_CLIENT_SECRET?.length >= 32 &&
    env.DONGO_API_RESOURCE_CLIENT_ID?.length >= 3 &&
    env.DONGO_API_RESOURCE_CLIENT_SECRET?.length >= 32
  );
}

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export default {
  async fetch(request: Request, env: AuthWorkerEnv): Promise<Response> {
    const requestId = crypto.randomUUID();
    try {
      const url = new URL(request.url);
      const publicOrigin = new URL(env.PUBLIC_ORIGIN);
      if (url.hostname !== publicOrigin.hostname || url.protocol !== "https:") {
        return securityHeaders(json({ error: "invalid_host" }, 400), requestId);
      }
      if (url.pathname === "/api/auth/healthz") {
        return securityHeaders(
          request.method === "GET"
            ? json({ status: "ok", serving: configured(env) })
            : json({ error: "method_not_allowed" }, 405),
          requestId,
        );
      }
      if (url.pathname === "/api/auth/readyz") {
        if (request.method !== "GET") {
          return securityHeaders(json({ error: "method_not_allowed" }, 405), requestId);
        }
        if (!configured(env)) {
          return securityHeaders(json({ status: "not_ready" }, 503), requestId);
        }
        await env.AUTH_DB.prepare("SELECT 1 AS ready").first();
        return securityHeaders(json({ status: "ready" }), requestId);
      }
      if (!configured(env)) {
        return securityHeaders(
          json({ error: "authorization_server_not_configured" }, 503),
          requestId,
        );
      }
      if (url.pathname === "/api/auth/internal/resources") {
        return securityHeaders(
          await provisionProjectResource(request, env),
          requestId,
        );
      }
      if (url.pathname === "/api/auth/internal/email/otp") {
        return securityHeaders(await sendOtpEmail(request, env), requestId);
      }
      if (url.pathname === "/api/auth/oauth2/introspect") {
        return securityHeaders(
          await resourceIntrospection(request, env),
          requestId,
        );
      }
      const auth = createAuthorizationServer(env);
      return securityHeaders(await auth.handler(request), requestId);
    } catch {
      return securityHeaders(
        json({ error: "authorization_server_failure", requestId }, 500),
        requestId,
      );
    }
  },
} satisfies ExportedHandler<AuthWorkerEnv>;
