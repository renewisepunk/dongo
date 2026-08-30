import { randomUUID } from "node:crypto";

import { operationRegistry } from "@dongo/contracts";

import { DongoClientError } from "./errors.ts";
import type {
  ApiResult,
  CallOptions,
  ClientClock,
  ClientOptions,
  OperationInput,
  OperationName,
  OperationOutput,
} from "./types.ts";

const DEFAULT_CLOCK: ClientClock = {
  now: () => Date.now(),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname))
  ) {
    throw new DongoClientError({
      code: "validation",
      message: "The Dongo API URL must use HTTPS (HTTP is allowed only for localhost).",
    });
  }
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

function parseRetryAfter(value: string | null, now: number): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

function retryDelay(attempt: number, random: () => number): number {
  const ceiling = Math.min(8_000, 250 * 2 ** Math.max(0, attempt - 1));
  return Math.floor(ceiling / 2 + random() * (ceiling / 2));
}

function isApiResult(value: unknown): value is ApiResult<unknown> {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  if (typeof result.requestId !== "string") return false;
  if (result.ok === true) return result.apiVersion === "v1" && "data" in result;
  if (result.ok !== false || !result.error || typeof result.error !== "object") return false;
  const error = result.error as Record<string, unknown>;
  return typeof error.code === "string" && typeof error.message === "string" && typeof error.retryable === "boolean";
}

function safeRequestId(value: string | undefined): string | undefined {
  return value && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : undefined;
}

function safeErrorCode(value: string): string {
  return /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : "api_error";
}

function safeErrorMessage(code: string): string {
  switch (code) {
    case "unauthorized":
      return "Dongo authorization was rejected. Reconnect and try again.";
    case "forbidden":
      return "This Dongo installation cannot perform that operation.";
    case "insufficient_scope":
      return "The Dongo installation needs additional access for this operation.";
    case "not_found":
      return "The requested Dongo resource was not found.";
    case "validation":
      return "Dongo rejected the request as invalid.";
    case "revision_conflict":
    case "claim_conflict":
    case "lease_expired":
    case "idempotency_conflict":
      return "Dongo rejected the operation because the work changed. Refetch before retrying.";
    case "rate_limited":
      return "Dongo is receiving too many requests. Retry later.";
    default:
      return "Dongo rejected the operation.";
  }
}

function requestUrl(baseUrl: string, operation: OperationName, input: object): string {
  const url = new URL(`${baseUrl}/${operation}`);
  if (operationRegistry[operation].method !== "GET") return url.toString();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function inputIdempotencyKey(input: object): string | undefined {
  const value = (input as Record<string, unknown>).idempotencyKey;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export class DongoClient {
  readonly #baseUrl: string;
  readonly #tokenProvider: ClientOptions["tokenProvider"];
  readonly #fetch: typeof globalThis.fetch;
  readonly #clock: ClientClock;
  readonly #random: () => number;
  readonly #requestTimeoutMs: number;
  readonly #maxAttempts: number;

  constructor(options: ClientOptions) {
    this.#baseUrl = normalizeBaseUrl(options.baseUrl);
    this.#tokenProvider = options.tokenProvider;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#clock = options.clock ?? DEFAULT_CLOCK;
    this.#random = options.random ?? Math.random;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 20_000;
    this.#maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  }

  async call<Name extends OperationName>(
    operation: Name,
    input: OperationInput<Name>,
    options: CallOptions = {},
  ): Promise<OperationOutput<Name>> {
    const validation = operationRegistry[operation].inputSchema.safeParse(input);
    if (!validation.success) {
      throw new DongoClientError({
        code: "validation",
        message: `The ${operation} request does not match the Dongo v1 contract.`,
      });
    }
    const validatedInput = validation.data as OperationInput<Name>;
    const idempotencyKey = options.idempotencyKey ?? inputIdempotencyKey(validatedInput);
    const specification = operationRegistry[operation];
    const mayRetry = specification.readOnly || (specification.idempotent && (operation === "session_start" || Boolean(idempotencyKey)));
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      try {
        return await this.#callOnce(operation, validatedInput, { ...options, idempotencyKey });
      } catch (error) {
        lastError = error;
        const retryable = error instanceof DongoClientError ? error.retryable : true;
        if (!mayRetry || !retryable || attempt >= this.#maxAttempts || options.signal?.aborted) throw error;
        const delay = error instanceof DongoClientError ? error.retryAfterMs : undefined;
        await this.#clock.sleep(delay ?? retryDelay(attempt, this.#random));
      }
    }

    throw lastError;
  }

  async #callOnce<Name extends OperationName>(
    operation: Name,
    input: OperationInput<Name>,
    options: CallOptions,
  ): Promise<OperationOutput<Name>> {
    const token = await this.#tokenProvider.getAccessToken();
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(new Error("request timeout")), this.#requestTimeoutMs);
    const abort = () => timeoutController.abort(options.signal?.reason);
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });

    try {
      const headers = new Headers({
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "x-dongo-client": "cli",
      });
      const method = operationRegistry[operation].method;
      if (method === "POST") headers.set("content-type", "application/json");
      if (options.idempotencyKey) headers.set("idempotency-key", options.idempotencyKey);

      let response: Response;
      try {
        response = await this.#fetch(requestUrl(this.#baseUrl, operation, input), {
          method,
          headers,
          body: method === "POST" ? JSON.stringify(input) : undefined,
          signal: timeoutController.signal,
        });
      } catch (cause) {
        const cancelled = Boolean(options.signal?.aborted);
        throw new DongoClientError({
          code: cancelled ? "cancelled" : "network_error",
          message: cancelled
            ? "The Dongo request was cancelled."
            : timeoutController.signal.aborted
              ? "The Dongo request timed out."
              : "Could not reach Dongo.",
          retryable: !cancelled,
          cause,
        });
      }

      const requestId = safeRequestId(response.headers.get("x-request-id") ?? undefined);
      const body = await response.json().catch(() => undefined);
      if (!isApiResult(body)) {
        throw new DongoClientError({
          code: response.ok ? "invalid_response" : `http_${response.status}`,
          message: response.ok ? "Dongo returned an invalid response." : `Dongo returned HTTP ${response.status}.`,
          retryable: RETRYABLE_STATUS.has(response.status),
          requestId,
          status: response.status,
        });
      }

      if (!response.ok || !body.ok) {
        if (body.ok) {
          throw new DongoClientError({
            code: `http_${response.status}`,
            message: `Dongo returned HTTP ${response.status}.`,
            retryable: RETRYABLE_STATUS.has(response.status),
            requestId,
            status: response.status,
          });
        }
        const retryAfter = parseRetryAfter(response.headers.get("retry-after"), this.#clock.now());
        const code = safeErrorCode(body.error.code);
        const conflict = code.includes("conflict") || code === "lease_expired";
        const retryable = !conflict && (body.error.retryable || RETRYABLE_STATUS.has(response.status));
        throw new DongoClientError({
          code,
          message: safeErrorMessage(code),
          retryable,
          retryAfterMs: retryable ? retryAfter : undefined,
          requestId: safeRequestId(body.requestId),
          status: response.status,
        });
      }

      return body.data as OperationOutput<Name>;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
    }
  }

  sessionStart(input: OperationInput<"session_start">, options?: CallOptions) {
    return this.call("session_start", input, options);
  }

  getOverview(input: OperationInput<"get_overview"> = {}, options?: CallOptions) {
    return this.call("get_overview", input, options);
  }

  syncSnapshot(input: OperationInput<"sync_snapshot"> = {}, options?: CallOptions) {
    return this.call("sync_snapshot", input, options);
  }

  getIntake(input: OperationInput<"get_intake">, options?: CallOptions) {
    return this.call("get_intake", input, options);
  }

  claimIntake(input: OperationInput<"claim_intake">, options?: CallOptions) {
    return this.call("claim_intake", input, options);
  }

  renewIntakeClaim(input: OperationInput<"renew_intake_claim">, options?: CallOptions) {
    return this.call("renew_intake_claim", input, options);
  }

  completeTriage(input: OperationInput<"complete_triage">, options?: CallOptions) {
    return this.call("complete_triage", input, options);
  }

  createWork(input: OperationInput<"create_work">, options?: CallOptions) {
    return this.call("create_work", input, options);
  }

  getWork(input: OperationInput<"get_work">, options?: CallOptions) {
    return this.call("get_work", input, options);
  }

  startWork(input: OperationInput<"start_work">, options?: CallOptions) {
    return this.call("start_work", input, options);
  }

  updateWork(input: OperationInput<"update_work">, options?: CallOptions) {
    return this.call("update_work", input, options);
  }

  renewClaim(input: OperationInput<"renew_claim">, options?: CallOptions) {
    return this.call("renew_claim", input, options);
  }

  finishWork(input: OperationInput<"finish_work">, options?: CallOptions) {
    return this.call("finish_work", input, options);
  }

  addComment(input: OperationInput<"add_comment">, options?: CallOptions) {
    return this.call("add_comment", input, options);
  }

  requestAttention(input: OperationInput<"request_attention">, options?: CallOptions) {
    return this.call("request_attention", input, options);
  }

  getAttention(input: OperationInput<"get_attention">, options?: CallOptions) {
    return this.call("get_attention", input, options);
  }

  resolveAttention(input: OperationInput<"resolve_attention">, options?: CallOptions) {
    return this.call("resolve_attention", input, options);
  }

  getAttachment(input: OperationInput<"get_attachment">, options?: CallOptions) {
    return this.call("get_attachment", input, options);
  }

  static idempotencyKey(): string {
    return randomUUID();
  }
}
