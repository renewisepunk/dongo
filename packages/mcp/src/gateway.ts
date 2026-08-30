import {
  OAuthError,
  OAuthErrorCode,
  bearerAuthChallengeResponse,
  getOAuthProtectedResourceMetadataUrl,
  hostHeaderValidationResponse,
  oauthMetadataResponse,
  originValidationResponse,
  requireBearerAuth,
  type AuthInfo,
  type OAuthMetadata,
} from "@modelcontextprotocol/server";
import { agentScopes, mcpToolNames } from "@dongo/contracts";
import {
  attachDongoRequestContext,
  hasRequiredScopes,
  validateDongoAuthInfo,
} from "./auth.js";
import { createDongoMcpHandler, DEFAULT_DONGO_MCP_LIMITS } from "./server.js";
import type {
  DongoMcpGatewayOptions,
  DongoMcpLimits,
  DongoMcpWorker,
  DongoToolDescriptor,
} from "./types.js";
import { DONGO_OPERATION_NAMES } from "./types.js";

const PROJECT_ENDPOINT = /^\/p\/([A-Za-z0-9][A-Za-z0-9_-]{2,127})\/mcp$/;
const PROJECT_METADATA =
  /^\/\.well-known\/oauth-protected-resource\/p\/([A-Za-z0-9][A-Za-z0-9_-]{2,127})\/mcp$/;
const ALL_SCOPES = agentScopes.filter((scope) => scope !== "offline_access");

function jsonResponse(
  body: Readonly<Record<string, unknown>>,
  status: number,
  headers?: HeadersInit,
): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      ...headers,
    },
  });
}

function issuerFromMetadata(metadata: OAuthMetadata): string {
  const issuer = (metadata as { issuer?: unknown }).issuer;
  if (typeof issuer !== "string" || issuer.length === 0) {
    throw new Error("Authorization server metadata must include an issuer");
  }
  const url = new URL(issuer);
  if (url.hash !== "" || url.search !== "") {
    throw new Error("Authorization issuer must not contain query or fragment");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error("Authorization issuer must use HTTPS");
  }
  return issuer;
}

function endpointFor(publicOrigin: URL, projectRef: string): URL {
  return new URL(`/p/${projectRef}/mcp`, publicOrigin);
}

function metadataOptions(
  options: DongoMcpGatewayOptions,
  resourceServerUrl: URL,
) {
  return {
    oauthMetadata: options.authorizationServerMetadata,
    resourceServerUrl,
    scopesSupported: ALL_SCOPES,
    resourceName: `Dongo project ${resourceServerUrl.pathname.split("/")[2] ?? ""}`,
    ...(options.serviceDocumentationUrl === undefined
      ? {}
      : { serviceDocumentationUrl: options.serviceDocumentationUrl }),
  };
}

function withRequestHeaders(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers);
  headers.set("x-request-id", requestId);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  if (headers.has("cache-control") === false) {
    headers.set("cache-control", "no-store");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function boundedRequest(
  request: Request,
  maxBytes: number,
): Promise<Request | Response> {
  if (request.method !== "POST" || request.body === null) {
    return request;
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const claimed = Number(contentLength);
    if (
      Number.isSafeInteger(claimed) === false ||
      claimed < 0 ||
      claimed > maxBytes
    ) {
      return jsonResponse(
        { error: "request_too_large", maxBytes },
        413,
      );
    }
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel("Dongo MCP request exceeded the body-size limit");
      return jsonResponse(
        { error: "request_too_large", maxBytes },
        413,
      );
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const headers = new Headers(request.headers);
  headers.set("content-length", String(total));
  return new Request(request, { body: bytes, headers });
}

function validatePublicConfiguration(options: DongoMcpGatewayOptions): void {
  if (
    options.publicOrigin.protocol !== "https:" ||
    options.publicOrigin.pathname !== "/" ||
    options.publicOrigin.search !== "" ||
    options.publicOrigin.hash !== "" ||
    options.publicOrigin.username !== "" ||
    options.publicOrigin.password !== ""
  ) {
    throw new Error("Dongo MCP publicOrigin must be an HTTPS origin URL");
  }
  if (options.allowedHostnames.includes(options.publicOrigin.hostname) === false) {
    throw new Error("allowedHostnames must include the public origin hostname");
  }
  if (options.catalog.length === 0) {
    throw new Error("Dongo MCP requires a canonical tool catalog");
  }
  const operations = options.catalog.map((descriptor) => descriptor.operation);
  if (
    operations.length !== DONGO_OPERATION_NAMES.length ||
    new Set(operations).size !== DONGO_OPERATION_NAMES.length ||
    DONGO_OPERATION_NAMES.some((operation) => operations.includes(operation) === false)
  ) {
    throw new Error("Dongo MCP catalog must cover every canonical operation once");
  }
  if (
    options.catalog.some(
      (descriptor) => mcpToolNames.includes(descriptor.toolName) === false,
    )
  ) {
    throw new Error("Dongo MCP catalog contains a non-canonical tool name");
  }
  if (
    options.serviceDocumentationUrl !== undefined &&
    options.serviceDocumentationUrl.protocol !== "https:"
  ) {
    throw new Error("Dongo MCP service documentation URL must use HTTPS");
  }
}

function resolveLimits(
  partial: DongoMcpGatewayOptions["limits"],
): DongoMcpLimits {
  const limits = { ...DEFAULT_DONGO_MCP_LIMITS, ...partial };
  for (const [name, value] of Object.entries(limits)) {
    if (Number.isSafeInteger(value) === false || value <= 0) {
      throw new Error(`Invalid Dongo MCP limit ${name}`);
    }
  }
  return Object.freeze(limits);
}

function descriptorForHeader(
  catalog: readonly DongoToolDescriptor[],
  request: Request,
): DongoToolDescriptor | undefined {
  if (request.headers.get("mcp-method") !== "tools/call") {
    return undefined;
  }
  const name = request.headers.get("mcp-name");
  return catalog.find((descriptor) => descriptor.toolName === name);
}

export function createDongoMcpGateway(
  options: DongoMcpGatewayOptions,
): DongoMcpWorker {
  validatePublicConfiguration(options);
  const expectedIssuer = issuerFromMetadata(
    options.authorizationServerMetadata,
  );
  const limits = resolveLimits(options.limits);
  const protocolHandler = createDongoMcpHandler({
    catalog: options.catalog,
    operationExecutor: options.operationExecutor,
    limits,
    logger: options.logger,
    serverName: options.serverName ?? "dongo",
    serverVersion: options.serverVersion ?? "0.1.0",
  });

  return {
    async fetch(request): Promise<Response> {
      const requestId = crypto.randomUUID();
      try {
        const validationFailure =
          hostHeaderValidationResponse(request, [...options.allowedHostnames]) ??
          originValidationResponse(request, [...options.allowedOrigins]);
        if (validationFailure !== undefined) {
          return withRequestHeaders(validationFailure, requestId);
        }

        const url = new URL(request.url);
        if (url.pathname === "/healthz") {
          return withRequestHeaders(
            request.method === "GET"
              ? jsonResponse({ status: "ok" }, 200)
              : jsonResponse({ error: "method_not_allowed" }, 405, {
                  allow: "GET",
                }),
            requestId,
          );
        }
        if (url.pathname === "/readyz") {
          if (request.method !== "GET") {
            return withRequestHeaders(
              jsonResponse({ error: "method_not_allowed" }, 405, {
                allow: "GET",
              }),
              requestId,
            );
          }
          const ready = await options.readiness.isReady();
          return withRequestHeaders(
            jsonResponse({ status: ready ? "ready" : "unavailable" }, ready ? 200 : 503),
            requestId,
          );
        }

        if (url.pathname === "/.well-known/oauth-authorization-server") {
          const response = oauthMetadataResponse(
            request,
            metadataOptions(
              options,
              endpointFor(options.publicOrigin, "discovery"),
            ),
          );
          return withRequestHeaders(
            response ?? jsonResponse({ error: "not_found" }, 404),
            requestId,
          );
        }

        const metadataMatch = PROJECT_METADATA.exec(url.pathname);
        if (metadataMatch !== null) {
          const projectRef = metadataMatch[1];
          if (projectRef === undefined) {
            return withRequestHeaders(
              jsonResponse({ error: "not_found" }, 404),
              requestId,
            );
          }
          const response = oauthMetadataResponse(
            request,
            metadataOptions(options, endpointFor(options.publicOrigin, projectRef)),
          );
          return withRequestHeaders(
            response ?? jsonResponse({ error: "not_found" }, 404),
            requestId,
          );
        }

        const endpointMatch = PROJECT_ENDPOINT.exec(url.pathname);
        const projectRef = endpointMatch?.[1];
        if (projectRef === undefined) {
          return withRequestHeaders(
            jsonResponse({ error: "not_found" }, 404),
            requestId,
          );
        }

        const resource = endpointFor(options.publicOrigin, projectRef);
        const resourceMetadataUrl =
          getOAuthProtectedResourceMetadataUrl(resource);
        if ((await options.readiness.isReady()) === false) {
          return withRequestHeaders(
            jsonResponse(
              { error: "temporarily_unavailable", requestId },
              503,
              { "retry-after": "30" },
            ),
            requestId,
          );
        }

        const bodyChecked = await boundedRequest(request, limits.maxRequestBytes);
        if (bodyChecked instanceof Response) {
          return withRequestHeaders(bodyChecked, requestId);
        }

        const authGate = requireBearerAuth({
          verifier: {
            verifyAccessToken: (token) =>
              options.tokenVerifier.verifyAccessToken(token, {
                expectedIssuer,
                expectedResource: resource,
                projectRef,
                signal: bodyChecked.signal,
              }),
          },
          resourceMetadataUrl,
        });
        const authOrResponse: AuthInfo | Response = await authGate(bodyChecked);
        if (authOrResponse instanceof Response) {
          return withRequestHeaders(authOrResponse, requestId);
        }

        let principal;
        try {
          principal = validateDongoAuthInfo(authOrResponse, {
            expectedIssuer,
            expectedResource: resource,
            projectRef,
          });
        } catch (error) {
          return withRequestHeaders(
            bearerAuthChallengeResponse(error, { resourceMetadataUrl }),
            requestId,
          );
        }

        const rateLimit = await options.rateLimiter.check({
          kind: "mcp_request",
          projectRef,
          requestId,
          clientId: principal.clientId,
          httpMethod: bodyChecked.method,
          ...(bodyChecked.headers.get("mcp-method") === null
            ? {}
            : { mcpMethod: bodyChecked.headers.get("mcp-method") ?? undefined }),
          ...(bodyChecked.headers.get("mcp-name") === null
            ? {}
            : { mcpName: bodyChecked.headers.get("mcp-name") ?? undefined }),
        });
        if (rateLimit.allowed === false) {
          const retryAfter =
            Number.isSafeInteger(rateLimit.retryAfterSeconds) &&
            (rateLimit.retryAfterSeconds ?? 0) > 0
              ? rateLimit.retryAfterSeconds
              : 30;
          return withRequestHeaders(
            jsonResponse(
              { error: "rate_limited", requestId },
              429,
              {
                "retry-after": String(
                  retryAfter,
                ),
              },
            ),
            requestId,
          );
        }

        const descriptor = descriptorForHeader(options.catalog, bodyChecked);
        if (
          descriptor !== undefined &&
          hasRequiredScopes(principal.scopes, descriptor.requiredScopes) === false
        ) {
          return withRequestHeaders(
            bearerAuthChallengeResponse(
              new OAuthError(
                OAuthErrorCode.InsufficientScope,
                "The access token does not grant this Dongo tool",
              ),
              {
                requiredScopes: [...descriptor.requiredScopes],
                resourceMetadataUrl,
              },
            ),
            requestId,
          );
        }

        const authInfo = attachDongoRequestContext(
          authOrResponse,
          principal,
          requestId,
        );
        const response = await protocolHandler.fetch(bodyChecked, { authInfo });
        return withRequestHeaders(response, requestId);
      } catch (error) {
        options.logger?.error({
          event: "mcp_gateway_failure",
          requestId,
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
        return withRequestHeaders(
          jsonResponse({ error: "internal_error", requestId }, 500),
          requestId,
        );
      }
    },
  };
}
