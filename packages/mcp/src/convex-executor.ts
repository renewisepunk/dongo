import { agentScopes, operationRegistry } from "@dongo/contracts";
import type {
  DongoDomainError,
  DongoOperationName,
  JsonRecord,
  OperationExecutionContext,
  OperationExecutionResult,
  OperationExecutor,
} from "./types.js";

const METHOD = "POST";
const PATHNAME = "/internal/agent/v1/execute";
const DEFAULT_MAX_REQUEST_BYTES = 256 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
const encoder = new TextEncoder();
const ALLOWED_SCOPES = new Set<string>(
  agentScopes.filter((scope) => scope !== "offline_access"),
);

export interface ConvexHmacOperationExecutorOptions {
  /** Convex HTTP Actions origin, for example `https://example.convex.site/`. */
  readonly convexSiteUrl: URL;
  /** Shared high-entropy secret used only for the internal gateway HMAC. */
  readonly secret: string;
  readonly keyId?: string;
  readonly timeoutMs?: number;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
  readonly fetch?: typeof fetch;
  readonly nowMs?: () => number;
  readonly nonce?: () => string;
}

type GatewayResponse =
  | {
      readonly ok: true;
      readonly data: unknown;
      readonly requestId: string;
      readonly apiVersion: "v1";
    }
  | {
      readonly ok: false;
      readonly error: DongoDomainError;
      readonly requestId: string;
    };

function validateOrigin(url: URL): URL {
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("convexSiteUrl must be an HTTPS origin URL");
  }
  return new URL(url);
}

function validatePositiveInteger(value: number, label: string): number {
  if (Number.isSafeInteger(value) === false || value <= 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function base64url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  if (response.body === null) {
    return "";
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel("Internal gateway response exceeded its configured limit");
      throw new Error("gateway_response_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function unavailable(message: string): OperationExecutionResult {
  return {
    ok: false,
    error: {
      code: "temporarily_unavailable",
      message,
      retryable: true,
    },
  };
}

function validExecutionContext(context: OperationExecutionContext): boolean {
  const principal = context.principal;
  const identifiers = [
    principal.grantId,
    principal.installationId,
    principal.installationActorId,
    principal.organizationId,
    principal.projectId,
  ];
  if (
    context.requestId.length === 0 ||
    context.requestId.length > 200 ||
    principal.clientId.length === 0 ||
    principal.clientId.length > 500 ||
    identifiers.some((value) => value.length === 0 || value.length > 256) ||
    /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/u.test(principal.projectRef) === false ||
    context.projectRef !== principal.projectRef ||
    principal.scopes.length === 0 ||
    principal.scopes.length > 4 ||
    new Set(principal.scopes).size !== principal.scopes.length ||
    principal.scopes.some((scope) => ALLOWED_SCOPES.has(scope) === false)
  ) {
    return false;
  }
  try {
    const issuer = new URL(principal.issuer);
    const resource = new URL(principal.resource);
    return (
      issuer.protocol === "https:" &&
      issuer.username === "" &&
      issuer.password === "" &&
      issuer.search === "" &&
      issuer.hash === "" &&
      resource.protocol === "https:" &&
      resource.username === "" &&
      resource.password === "" &&
      resource.search === "" &&
      resource.hash === "" &&
      resource.pathname === `/p/${principal.projectRef}/mcp`
    );
  } catch {
    return false;
  }
}

function parseGatewayResponse(value: unknown): GatewayResponse | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as JsonRecord;
  if (
    typeof record.requestId !== "string" ||
    record.requestId.length === 0 ||
    record.requestId.length > 256
  ) {
    return undefined;
  }
  if (record.ok === true) {
    if (record.apiVersion !== "v1" || record.data === undefined) {
      return undefined;
    }
    return record as GatewayResponse;
  }
  if (record.ok !== false) {
    return undefined;
  }
  const error = record.error;
  if (error === null || typeof error !== "object" || Array.isArray(error)) {
    return undefined;
  }
  const domain = error as JsonRecord;
  if (
    typeof domain.code !== "string" ||
    /^[a-z][a-z0-9_]{0,63}$/u.test(domain.code) === false ||
    typeof domain.message !== "string" ||
    domain.message.length === 0 ||
    domain.message.length > 8_192 ||
    typeof domain.retryable !== "boolean"
  ) {
    return undefined;
  }
  return {
    ok: false,
    requestId: record.requestId,
    error: {
      code: domain.code,
      message: domain.message,
      retryable: domain.retryable,
      ...(domain.details === undefined ? {} : { details: domain.details }),
    },
  };
}

/**
 * HMAC-authenticated adapter for the private Convex operation gateway.
 * Trusted tenant and actor fields come exclusively from the verified token
 * principal; the bearer itself is deliberately absent from this interface.
 */
export class ConvexHmacOperationExecutor implements OperationExecutor {
  readonly #endpoint: URL;
  readonly #keyId: string;
  readonly #timeoutMs: number;
  readonly #maxRequestBytes: number;
  readonly #maxResponseBytes: number;
  readonly #fetch: typeof fetch;
  readonly #nowMs: () => number;
  readonly #nonce: () => string;
  readonly #hmacKey: Promise<CryptoKey>;

  constructor(options: ConvexHmacOperationExecutorOptions) {
    this.#endpoint = new URL(PATHNAME, validateOrigin(options.convexSiteUrl));
    this.#keyId = options.keyId ?? "v1";
    this.#timeoutMs = validatePositiveInteger(options.timeoutMs ?? 20_000, "timeoutMs");
    this.#maxRequestBytes = validatePositiveInteger(
      options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES,
      "maxRequestBytes",
    );
    this.#maxResponseBytes = validatePositiveInteger(
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      "maxResponseBytes",
    );
    const fetcher = options.fetch ?? fetch;
    this.#fetch = (input, init) => fetcher(input, init);
    this.#nowMs = options.nowMs ?? Date.now;
    this.#nonce = options.nonce ?? (() => crypto.randomUUID());

    if (this.#keyId !== "v1") {
      throw new Error("keyId must match the active internal gateway key");
    }
    const secretBytes = encoder.encode(options.secret);
    if (
      options.secret.length < 32 ||
      secretBytes.byteLength < 32 ||
      secretBytes.byteLength > 4_096
    ) {
      throw new Error("secret must contain between 32 and 4096 UTF-8 bytes");
    }
    this.#hmacKey = crypto.subtle.importKey(
      "raw",
      secretBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
  }

  async execute(
    operation: DongoOperationName,
    input: JsonRecord,
    context: OperationExecutionContext,
  ): Promise<OperationExecutionResult> {
    if (validExecutionContext(context) === false) {
      return {
        ok: false,
        error: {
          code: "unauthorized",
          message: "The validated operation context is invalid",
          retryable: false,
        },
      };
    }
    const timestamp = String(this.#nowMs());
    if (/^\d{13}$/u.test(timestamp) === false) {
      return unavailable("The internal gateway clock is unavailable");
    }
    const nonce = this.#nonce();
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        nonce,
      ) === false
    ) {
      return unavailable("The internal gateway nonce source is unavailable");
    }

    const externalSessionId = input.externalSessionId;
    const envelope = {
      version: 1 as const,
      operation,
      input,
      context: {
        requestId: context.requestId,
        installationId: context.principal.installationId,
        actorId: context.principal.installationActorId,
        organizationId: context.principal.organizationId,
        projectId: context.principal.projectId,
        projectRef: context.principal.projectRef,
        clientId: context.principal.clientId,
        grantId: context.principal.grantId,
        issuer: context.principal.issuer,
        resource: context.principal.resource,
        scopes: [...context.principal.scopes],
        ...(typeof externalSessionId === "string" && externalSessionId.length > 0
          ? { externalSessionId }
          : {}),
      },
    };
    const rawBody = JSON.stringify(envelope);
    const rawBodyBytes = encoder.encode(rawBody);
    if (rawBodyBytes.byteLength > this.#maxRequestBytes) {
      return {
        ok: false,
        error: {
          code: "validation",
          message: "The operation request exceeds the internal gateway limit",
          retryable: false,
        },
      };
    }

    const bodyHash = hex(await crypto.subtle.digest("SHA-256", rawBodyBytes));
    const canonical = `${timestamp}\n${nonce}\n${METHOD}\n${PATHNAME}\n${bodyHash}`;
    const signature = base64url(
      await crypto.subtle.sign(
        "HMAC",
        await this.#hmacKey,
        encoder.encode(canonical),
      ),
    );

    const controller = new AbortController();
    let timedOut = false;
    const relayAbort = (): void => controller.abort(context.signal.reason);
    context.signal.addEventListener("abort", relayAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("Internal gateway timed out"));
    }, this.#timeoutMs);

    try {
      const response = await this.#fetch(this.#endpoint, {
        method: METHOD,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-dongo-key-id": this.#keyId,
          "x-dongo-timestamp": timestamp,
          "x-dongo-nonce": nonce,
          "x-dongo-signature": signature,
        },
        body: rawBodyBytes,
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
      });
      const text = await readBoundedText(response, this.#maxResponseBytes);
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return unavailable("The internal gateway returned an invalid response");
      }
      const result = parseGatewayResponse(json);
      if (result === undefined || result.requestId !== context.requestId) {
        return unavailable("The internal gateway returned an invalid response");
      }
      if (result.ok === false) {
        return result;
      }
      if (response.ok === false) {
        return unavailable("The internal gateway rejected the operation");
      }

      const validated = await operationRegistry[operation].outputSchema.safeParseAsync(
        result.data,
      );
      if (validated.success === false) {
        return {
          ok: false,
          error: {
            code: "internal",
            message: "The internal gateway response did not match the operation contract",
            retryable: false,
          },
          requestId: result.requestId,
        };
      }
      return {
        ok: true,
        data: validated.data as JsonRecord,
        requestId: result.requestId,
      };
    } catch {
      if (context.signal.aborted) {
        return {
          ok: false,
          error: {
            code: "request_cancelled",
            message: "The operation request was cancelled",
            retryable: false,
          },
        };
      }
      return unavailable(
        timedOut
          ? "The internal gateway timed out"
          : "The internal gateway is temporarily unavailable",
      );
    } finally {
      clearTimeout(timeout);
      context.signal.removeEventListener("abort", relayAbort);
    }
  }
}
