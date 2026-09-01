import { agentScopes, operationRegistry } from "@dongo/contracts";
import type {
  ApiOperationExecutor,
  ApiInstallationPrincipal,
  DongoDomainError,
  DongoOperationName,
  JsonRecord,
  OperationExecutionResult,
} from "./types.ts";

const INTERNAL_METHOD = "POST";
const INTERNAL_PATH = "/internal/agent/v1/execute";
const encoder = new TextEncoder();
const ALLOWED_SCOPES = new Set<string>(
  agentScopes.filter((scope) => scope !== "offline_access"),
);

export interface ApiConvexExecutorOptions {
  readonly convexSiteUrl: URL;
  readonly resource: URL;
  readonly secret: string;
  readonly keyId?: string;
  readonly timeoutMs?: number;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
  readonly fetch?: typeof fetch;
  readonly nowMs?: () => number;
  readonly nonce?: () => string;
}

type InternalGatewayResponse =
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

function safeOrigin(value: URL): URL {
  if (
    value.protocol !== "https:" ||
    value.username !== "" ||
    value.password !== "" ||
    value.pathname !== "/" ||
    value.search !== "" ||
    value.hash !== ""
  ) {
    throw new Error("convexSiteUrl must be an HTTPS origin URL");
  }
  return new URL(value);
}

function safeResource(value: URL): URL {
  if (
    value.protocol !== "https:" ||
    value.username !== "" ||
    value.password !== "" ||
    value.search !== "" ||
    value.hash !== ""
  ) {
    throw new Error("resource must be a safe HTTPS URL");
  }
  return new URL(value);
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function base64Url(buffer: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

async function readBoundedText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel("Internal gateway response exceeded its limit");
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
    error: { code: "temporarily_unavailable", message, retryable: true },
  };
}

function validPrincipal(
  principal: ApiInstallationPrincipal,
  expectedResource: string,
): boolean {
  const identifiers = [
    principal.installationId,
    principal.installationActorId,
    principal.organizationId,
    principal.projectId,
  ];
  const oauth = principal.grantId !== undefined;
  const service = principal.serviceCredentialId !== undefined;
  if (
    oauth === service ||
    principal.clientId.length === 0 ||
    principal.clientId.length > 500 ||
    identifiers.some((value) => value.length === 0 || value.length > 256) ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/u.test(principal.projectRef) ||
    principal.resource !== expectedResource ||
    principal.scopes.length === 0 ||
    principal.scopes.length > 3 ||
    new Set(principal.scopes).size !== principal.scopes.length ||
    principal.scopes.some((scope) => !ALLOWED_SCOPES.has(scope))
  ) {
    return false;
  }
  const authorizationId = oauth
    ? principal.grantId
    : principal.serviceCredentialId;
  if (!authorizationId || authorizationId.length > 256) return false;
  if (service) return principal.issuer === undefined;
  try {
    if (!principal.issuer) return false;
    const issuer = new URL(principal.issuer);
    return (
      issuer.protocol === "https:" &&
      issuer.username === "" &&
      issuer.password === "" &&
      issuer.search === "" &&
      issuer.hash === ""
    );
  } catch {
    return false;
  }
}

function parseGatewayResponse(value: unknown): InternalGatewayResponse | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as JsonRecord;
  if (
    typeof record.requestId !== "string" ||
    record.requestId.length === 0 ||
    record.requestId.length > 200
  ) {
    return undefined;
  }
  if (record.ok === true) {
    return record.apiVersion === "v1" && record.data !== undefined
      ? (record as InternalGatewayResponse)
      : undefined;
  }
  if (record.ok !== false) return undefined;
  const error = record.error;
  if (error === null || typeof error !== "object" || Array.isArray(error)) {
    return undefined;
  }
  const domain = error as JsonRecord;
  if (
    typeof domain.code !== "string" ||
    !/^[a-z][a-z0-9_]{0,63}$/u.test(domain.code) ||
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

export class ApiConvexOperationExecutor implements ApiOperationExecutor {
  readonly #endpoint: URL;
  readonly #resource: string;
  readonly #keyId: string;
  readonly #timeoutMs: number;
  readonly #maxRequestBytes: number;
  readonly #maxResponseBytes: number;
  readonly #fetch: typeof fetch;
  readonly #nowMs: () => number;
  readonly #nonce: () => string;
  readonly #hmacKey: Promise<CryptoKey>;

  constructor(options: ApiConvexExecutorOptions) {
    this.#endpoint = new URL(INTERNAL_PATH, safeOrigin(options.convexSiteUrl));
    this.#resource = safeResource(options.resource).toString();
    this.#keyId = options.keyId ?? "v1";
    if (this.#keyId !== "v1") throw new Error("keyId must be v1");
    this.#timeoutMs = positiveInteger(options.timeoutMs ?? 15_000, "timeoutMs");
    this.#maxRequestBytes = positiveInteger(
      options.maxRequestBytes ?? 256 * 1024,
      "maxRequestBytes",
    );
    this.#maxResponseBytes = positiveInteger(
      options.maxResponseBytes ?? 1024 * 1024,
      "maxResponseBytes",
    );
    const secret = encoder.encode(options.secret);
    if (secret.byteLength < 32 || secret.byteLength > 4_096) {
      throw new Error("secret must contain between 32 and 4096 bytes");
    }
    this.#hmacKey = crypto.subtle.importKey(
      "raw",
      secret,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const fetcher = options.fetch ?? fetch;
    this.#fetch = (input, init) => fetcher(input, init);
    this.#nowMs = options.nowMs ?? Date.now;
    this.#nonce = options.nonce ?? (() => crypto.randomUUID());
  }

  async execute(
    operation: DongoOperationName,
    input: JsonRecord,
    context: {
      readonly principal: ApiInstallationPrincipal;
      readonly requestId: string;
      readonly signal: AbortSignal;
    },
  ): Promise<OperationExecutionResult> {
    if (
      context.requestId.length === 0 ||
      context.requestId.length > 128 ||
      !validPrincipal(context.principal, this.#resource)
    ) {
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
    const nonce = this.#nonce();
    if (
      !/^\d{13}$/u.test(timestamp) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        nonce,
      )
    ) {
      return unavailable("The internal gateway signing clock is unavailable");
    }
    const externalSessionId = input.externalSessionId;
    const body = JSON.stringify({
      version: 1,
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
        ...(context.principal.grantId
          ? { grantId: context.principal.grantId }
          : {}),
        ...(context.principal.serviceCredentialId
          ? { serviceCredentialId: context.principal.serviceCredentialId }
          : {}),
        ...(context.principal.issuer
          ? { issuer: context.principal.issuer }
          : {}),
        resource: context.principal.resource,
        scopes: [...context.principal.scopes],
        ...(typeof externalSessionId === "string" && externalSessionId.length > 0
          ? { externalSessionId }
          : {}),
      },
    });
    const bytes = encoder.encode(body);
    if (bytes.byteLength > this.#maxRequestBytes) {
      return {
        ok: false,
        error: {
          code: "validation",
          message: "The operation request is too large",
          retryable: false,
        },
      };
    }
    const bodyHash = hex(await crypto.subtle.digest("SHA-256", bytes));
    const canonical = `${timestamp}\n${nonce}\n${INTERNAL_METHOD}\n${INTERNAL_PATH}\n${bodyHash}`;
    const signature = base64Url(
      await crypto.subtle.sign(
        "HMAC",
        await this.#hmacKey,
        encoder.encode(canonical),
      ),
    );
    const controller = new AbortController();
    const updateWaitSeconds = operation === "get_updates"
      ? ((input as { waitSeconds?: number }).waitSeconds ?? 0)
      : 0;
    const effectiveTimeoutMs = operation === "get_updates"
      ? Math.max(this.#timeoutMs, updateWaitSeconds * 1_000 + 5_000)
      : this.#timeoutMs;
    let timedOut = false;
    const relayAbort = (): void => controller.abort(context.signal.reason);
    if (context.signal.aborted) relayAbort();
    else context.signal.addEventListener("abort", relayAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("Internal gateway timed out"));
    }, effectiveTimeoutMs);
    try {
      const response = await this.#fetch(this.#endpoint, {
        method: INTERNAL_METHOD,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-dongo-key-id": this.#keyId,
          "x-dongo-timestamp": timestamp,
          "x-dongo-nonce": nonce,
          "x-dongo-signature": signature,
        },
        body: bytes,
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
      });
      const text = await readBoundedText(response, this.#maxResponseBytes);
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        return unavailable("The internal gateway returned an invalid response");
      }
      const result = parseGatewayResponse(value);
      if (!result || result.requestId !== context.requestId) {
        return unavailable("The internal gateway returned an invalid response");
      }
      if (!result.ok) return result;
      if (!response.ok) {
        return unavailable("The internal gateway rejected the operation");
      }
      const validated = await operationRegistry[operation].outputSchema.safeParseAsync(
        result.data,
      );
      if (!validated.success) {
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
      if (context.signal.aborted && !timedOut) {
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
