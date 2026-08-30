import {
  hostHeaderValidationResponse,
  oauthMetadataResponse,
  originValidationResponse,
} from "@modelcontextprotocol/server";
import type {
  DongoMcpWorker,
  UnavailableDongoMcpWorkerOptions,
} from "./types.js";

const PROJECT_ENDPOINT = /^\/p\/([A-Za-z0-9][A-Za-z0-9_-]{2,127})\/mcp$/;
const PROJECT_METADATA =
  /^\/\.well-known\/oauth-protected-resource\/p\/([A-Za-z0-9][A-Za-z0-9_-]{2,127})\/mcp$/;

function unavailable(status: "not_ready" | "auth_not_configured"): Response {
  return Response.json(
    { status },
    {
      status: 503,
      headers: {
        "cache-control": "no-store",
        "retry-after": "30",
      },
    },
  );
}

/**
 * Safe deployment placeholder. It exposes liveness and optional public OAuth
 * metadata but will not accept a bearer token until the real verifier,
 * operation executor, contracts, limiter, and readiness probe are injected.
 */
export function createUnavailableDongoMcpWorker(
  options: UnavailableDongoMcpWorkerOptions,
): DongoMcpWorker {
  return {
    async fetch(request): Promise<Response> {
      const rejected =
        hostHeaderValidationResponse(request, [...options.allowedHostnames]) ??
        originValidationResponse(request, [...options.allowedOrigins]);
      if (rejected !== undefined) {
        return rejected;
      }

      const url = new URL(request.url);
      if (url.pathname === "/healthz" || url.pathname === "/api/mcp/healthz") {
        return request.method === "GET"
          ? Response.json(
              { status: "ok", serving: false },
              { headers: { "cache-control": "no-store" } },
            )
          : Response.json(
              { error: "method_not_allowed" },
              { status: 405, headers: { allow: "GET" } },
            );
      }
      if (url.pathname === "/readyz" || url.pathname === "/api/mcp/readyz") {
        return unavailable("not_ready");
      }

      if (options.authorizationServerMetadata !== undefined) {
        const projectRef = PROJECT_METADATA.exec(url.pathname)?.[1];
        if (
          projectRef !== undefined ||
          url.pathname === "/.well-known/oauth-authorization-server"
        ) {
          const resourceServerUrl = new URL(
            `/p/${projectRef ?? "discovery"}/mcp`,
            options.publicOrigin,
          );
          const metadata = oauthMetadataResponse(request, {
            oauthMetadata: options.authorizationServerMetadata,
            resourceServerUrl,
            resourceName: `dongo project ${projectRef ?? ""}`,
            scopesSupported: [
              "dongo:work:read",
              "dongo:work:write",
              "dongo:attachments:read",
            ],
            ...(options.serviceDocumentationUrl === undefined
              ? {}
              : { serviceDocumentationUrl: options.serviceDocumentationUrl }),
          });
          if (metadata !== undefined) {
            return metadata;
          }
        }
      }

      if (PROJECT_ENDPOINT.test(url.pathname)) {
        return unavailable("auth_not_configured");
      }
      return Response.json({ error: "not_found" }, { status: 404 });
    },
  };
}
