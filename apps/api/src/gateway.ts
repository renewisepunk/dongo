import { operationRegistry } from "@dongo/contracts";
import type {
  ApiOperationExecutor,
  ApiRateLimiter,
  ApiTokenVerifier,
  DongoOperationName,
  JsonRecord,
  OperationExecutionResult,
} from "./types.ts";
import { ApiBoundaryError } from "./types.ts";

const API_PREFIX = "/api/agent/v1/";
const HEALTH_PATH = `${API_PREFIX}healthz`;
const READY_PATH = `${API_PREFIX}readyz`;
const MAX_PUBLIC_BODY_BYTES = 192 * 1024;
const MAX_QUERY_BYTES = 8 * 1024;
const OPERATION_TIMEOUT_MS = 20_000;

export interface DongoApiWorker {
  fetch(request: Request): Promise<Response>;
}

export interface DongoApiGatewayOptions {
  readonly resource: URL;
  readonly allowedHostnames: readonly string[];
  readonly tokenVerifier: ApiTokenVerifier;
  readonly operationExecutor: ApiOperationExecutor;
  readonly rateLimiter: ApiRateLimiter;
  readonly maxBodyBytes?: number;
  readonly operationTimeoutMs?: number;
}

function safeRequestId(value: string | null): string {
  return value && /^[A-Za-z0-9._:-]{1,128}$/u.test(value)
    ? value
    : crypto.randomUUID();
}

function jsonResponse(
  body: unknown,
  status: number,
  requestId: string,
  extraHeaders?: HeadersInit,
): Response {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-request-id", requestId);
  return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(
  error: ApiBoundaryError,
  requestId: string,
  resource: string,
  extraHeaders?: HeadersInit,
): Response {
  const headers = new Headers(extraHeaders);
  if (error.status === 401) {
    headers.set(
      "www-authenticate",
      `Bearer resource="${resource}", error="invalid_token"`,
    );
  }
  return jsonResponse(
    {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
      requestId,
    },
    error.status,
    requestId,
    headers,
  );
}

function operationStatus(result: OperationExecutionResult): number {
  if (result.ok) return 200;
  switch (result.error.code) {
    case "unauthorized":
      return 401;
    case "forbidden":
    case "insufficient_scope":
      return 403;
    case "not_found":
      return 404;
    case "revision_conflict":
    case "claim_conflict":
    case "idempotency_conflict":
      return 409;
    case "lease_expired":
      return 410;
    case "quota_exceeded":
    case "rate_limited":
      return 429;
    case "request_cancelled":
      return 408;
    case "temporarily_unavailable":
      return 503;
    case "internal":
      return 500;
    default:
      return 400;
  }
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer ([^\s,]+)$/iu);
  if (!match?.[1] || match[1].length > 16 * 1024) {
    throw new ApiBoundaryError(
      "unauthorized",
      "A valid bearer access token is required",
      401,
    );
  }
  return match[1];
}

function operationFromPath(pathname: string): DongoOperationName | undefined {
  if (!pathname.startsWith(API_PREFIX)) return undefined;
  const name = pathname.slice(API_PREFIX.length);
  if (
    name.length === 0 ||
    name.includes("/") ||
    !Object.hasOwn(operationRegistry, name)
  ) {
    return undefined;
  }
  return name as DongoOperationName;
}

function parseQuery(url: URL): JsonRecord {
  if (new TextEncoder().encode(url.search).byteLength > MAX_QUERY_BYTES) {
    throw new ApiBoundaryError("validation", "Query string is too large", 413);
  }
  const input: JsonRecord = {};
  for (const [key, value] of url.searchParams) {
    if (Object.hasOwn(input, key)) {
      throw new ApiBoundaryError(
        "validation",
        `Query parameter ${key} must not be repeated`,
        400,
      );
    }
    input[key] = value;
  }
  return input;
}

async function readBoundedJson(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ApiBoundaryError("validation", "Request body is too large", 413);
  }
  if (request.body === null) {
    throw new ApiBoundaryError("validation", "A JSON request body is required", 400);
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel("Request body exceeded its limit");
      throw new ApiBoundaryError("validation", "Request body is too large", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiBoundaryError("validation", "Request body is not valid JSON", 400);
  }
}

async function validatedInput(
  request: Request,
  url: URL,
  operation: DongoOperationName,
  maxBodyBytes: number,
): Promise<JsonRecord> {
  const specification = operationRegistry[operation];
  let candidate: unknown;
  if (specification.method === "GET") {
    candidate = parseQuery(url);
  } else {
    if (url.search !== "") {
      throw new ApiBoundaryError(
        "validation",
        "POST operations do not accept query parameters",
        400,
      );
    }
    const mediaType = request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (mediaType !== "application/json") {
      throw new ApiBoundaryError(
        "validation",
        "POST operations require application/json",
        415,
      );
    }
    candidate = await readBoundedJson(request, maxBodyBytes);
  }
  const parsed = await specification.inputSchema.safeParseAsync(candidate);
  if (!parsed.success) {
    throw new ApiBoundaryError(
      "validation",
      `The ${operation} request does not match the dongo v1 contract`,
      400,
      false,
      {
        issues: parsed.error.issues.slice(0, 10).map((issue) => ({
          path: issue.path.join("."),
          code: issue.code,
          message: issue.message.slice(0, 300),
        })),
      },
    );
  }
  if (
    parsed.data === null ||
    typeof parsed.data !== "object" ||
    Array.isArray(parsed.data)
  ) {
    throw new ApiBoundaryError("validation", "Operation input is invalid", 400);
  }
  return parsed.data as JsonRecord;
}

function enforceIdempotency(
  request: Request,
  operation: DongoOperationName,
  input: JsonRecord,
): void {
  const bodyKey = input.idempotencyKey;
  const headerKey = request.headers.get("idempotency-key");
  if (typeof bodyKey === "string") {
    if (headerKey === null || headerKey !== bodyKey) {
      throw new ApiBoundaryError(
        "validation",
        "Idempotency-Key must exactly match input.idempotencyKey",
        400,
      );
    }
    return;
  }
  if (headerKey !== null && operation !== "session_start") {
    throw new ApiBoundaryError(
      "validation",
      "Idempotency-Key is not valid for this operation",
      400,
    );
  }
}

export function createDongoApiGateway(
  options: DongoApiGatewayOptions,
): DongoApiWorker {
  const resource = new URL(options.resource);
  if (
    resource.protocol !== "https:" ||
    resource.username !== "" ||
    resource.password !== "" ||
    resource.search !== "" ||
    resource.hash !== "" ||
    resource.pathname !== API_PREFIX.slice(0, -1)
  ) {
    throw new Error("resource must be the exact dongo API v1 HTTPS URL");
  }
  const allowedHostnames = new Set(
    options.allowedHostnames.map((hostname) => hostname.toLowerCase()),
  );
  if (!allowedHostnames.has(resource.hostname.toLowerCase())) {
    throw new Error("resource hostname must be explicitly allowed");
  }
  const maxBodyBytes = options.maxBodyBytes ?? MAX_PUBLIC_BODY_BYTES;
  const operationTimeoutMs = options.operationTimeoutMs ?? OPERATION_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(maxBodyBytes) ||
    maxBodyBytes <= 0 ||
    !Number.isSafeInteger(operationTimeoutMs) ||
    operationTimeoutMs <= 0
  ) {
    throw new Error("API request limits are invalid");
  }

  return Object.freeze({
    async fetch(request: Request): Promise<Response> {
      const requestId = safeRequestId(request.headers.get("x-request-id"));
      const url = new URL(request.url);
      if (
        url.protocol !== "https:" ||
        url.username !== "" ||
        url.password !== "" ||
        !allowedHostnames.has(url.hostname.toLowerCase())
      ) {
        return errorResponse(
          new ApiBoundaryError("not_found", "Route not found", 421),
          requestId,
          resource.toString(),
        );
      }
      if (url.pathname === HEALTH_PATH || url.pathname === READY_PATH) {
        if (request.method !== "GET") {
          return errorResponse(
            new ApiBoundaryError("validation", "Method not allowed", 405),
            requestId,
            resource.toString(),
            { allow: "GET" },
          );
        }
        return jsonResponse(
          { ok: true, status: url.pathname === HEALTH_PATH ? "healthy" : "ready" },
          200,
          requestId,
        );
      }
      const operation = operationFromPath(url.pathname);
      if (!operation) {
        return errorResponse(
          new ApiBoundaryError("not_found", "Operation not found", 404),
          requestId,
          resource.toString(),
        );
      }
      const specification = operationRegistry[operation];
      if (request.method !== specification.method) {
        return errorResponse(
          new ApiBoundaryError("validation", "Method not allowed", 405),
          requestId,
          resource.toString(),
          { allow: specification.method },
        );
      }
      const declared = Number(request.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maxBodyBytes) {
        return errorResponse(
          new ApiBoundaryError("validation", "Request body is too large", 413),
          requestId,
          resource.toString(),
        );
      }
      if (specification.method === "GET" && request.body !== null) {
        return errorResponse(
          new ApiBoundaryError(
            "validation",
            "GET operations do not accept a request body",
            400,
          ),
          requestId,
          resource.toString(),
        );
      }
      const controller = new AbortController();
      let timedOut = false;
      const relayAbort = (): void => controller.abort(request.signal.reason);
      if (request.signal.aborted) relayAbort();
      else request.signal.addEventListener("abort", relayAbort, { once: true });
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error("API operation timed out"));
      }, operationTimeoutMs);
      try {
        const token = bearerToken(request);
        const principal = await options.tokenVerifier.verifyAccessToken(
          token,
          controller.signal,
        );
        const missingScopes = specification.scopes.filter(
          (scope) => !principal.scopes.includes(scope),
        );
        if (missingScopes.length > 0) {
          throw new ApiBoundaryError(
            "insufficient_scope",
            "The access token lacks a required operation scope",
            403,
          );
        }
        let rateLimit: Awaited<ReturnType<ApiRateLimiter["check"]>>;
        try {
          rateLimit = await options.rateLimiter.check({
            projectRef: principal.projectRef,
            clientId: principal.clientId,
          });
        } catch {
          throw new ApiBoundaryError(
            "temporarily_unavailable",
            "API rate limiting is temporarily unavailable",
            503,
            true,
          );
        }
        if (!rateLimit.allowed) {
          const retryAfter = Math.max(1, rateLimit.retryAfterSeconds ?? 60);
          return errorResponse(
            new ApiBoundaryError(
              "rate_limited",
              "Too many dongo API requests",
              429,
              true,
            ),
            requestId,
            resource.toString(),
            { "retry-after": String(retryAfter) },
          );
        }
        const input = await validatedInput(
          request,
          url,
          operation,
          maxBodyBytes,
        );
        enforceIdempotency(request, operation, input);
        const result = await options.operationExecutor.execute(operation, input, {
          principal,
          requestId,
          signal: controller.signal,
        });
        const status = operationStatus(result);
        if (result.ok) {
          return jsonResponse(
            { ok: true, data: result.data, requestId, apiVersion: "v1" },
            status,
            requestId,
          );
        }
        return errorResponse(
          new ApiBoundaryError(
            result.error.code,
            result.error.message,
            status,
            result.error.retryable,
            result.error.details,
          ),
          requestId,
          resource.toString(),
        );
      } catch (error) {
        const boundary =
          error instanceof ApiBoundaryError
            ? error
            : new ApiBoundaryError(
                timedOut ? "temporarily_unavailable" : "internal",
                timedOut
                  ? "The dongo API request timed out"
                  : "The dongo API could not complete the request",
                timedOut ? 503 : 500,
                timedOut,
              );
        return errorResponse(boundary, requestId, resource.toString());
      } finally {
        clearTimeout(timeout);
        request.signal.removeEventListener("abort", relayAbort);
      }
    },
  });
}

export function createUnavailableDongoApiWorker(resourceValue: string): DongoApiWorker {
  let resource = "https://invalid.dongo.invalid/api/agent/v1";
  try {
    resource = new URL(resourceValue).toString();
  } catch {
    // The unavailable worker deliberately retains a non-routable fallback.
  }
  return Object.freeze({
    async fetch(request: Request): Promise<Response> {
      const requestId = safeRequestId(request.headers.get("x-request-id"));
      const pathname = new URL(request.url).pathname;
      if (pathname === HEALTH_PATH && request.method === "GET") {
        return jsonResponse({ ok: true, status: "healthy" }, 200, requestId);
      }
      if (pathname === READY_PATH && request.method === "GET") {
        return jsonResponse(
          { ok: false, status: "not_ready", requestId },
          503,
          requestId,
        );
      }
      return errorResponse(
        new ApiBoundaryError(
          "temporarily_unavailable",
          "The dongo API is not configured",
          503,
          true,
        ),
        requestId,
        resource,
      );
    },
  });
}
