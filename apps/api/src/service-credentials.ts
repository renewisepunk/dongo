import type {
  ApiInstallationPrincipal,
  ApiTokenVerifier,
  JsonRecord,
} from "./types.ts";
import { ApiBoundaryError } from "./types.ts";

const INTERNAL_METHOD = "POST";
const INTERNAL_PATH = "/internal/service-credentials/v1/resolve";
const TOKEN_PATTERN = /^dng_svc_([A-Za-z0-9_-]{11})_[A-Za-z0-9_-]{43}$/u;
const ALLOWED_SCOPES = new Set([
  "dongo:work:read",
  "dongo:work:write",
  "dongo:attachments:read",
]);
const encoder = new TextEncoder();

export interface ApiServiceCredentialVerifierOptions {
  readonly convexSiteUrl: URL;
  readonly resource: URL;
  readonly secret: string;
  readonly keyId?: string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly fetch?: typeof fetch;
  readonly nowMs?: () => number;
  readonly nonce?: () => string;
  readonly requestId?: () => string;
}

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

function base64Url(buffer: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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
      await reader.cancel("Service credential response exceeded its limit");
      unavailable();
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

function objectJson(text: string): JsonRecord {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    unavailable();
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    unavailable();
  }
  return value as JsonRecord;
}

function unavailable(): never {
  throw new ApiBoundaryError(
    "temporarily_unavailable",
    "Authorization is temporarily unavailable",
    503,
    true,
  );
}

function invalidToken(): never {
  throw new ApiBoundaryError(
    "unauthorized",
    "The service credential is not valid",
    401,
    false,
  );
}

function requiredString(
  value: unknown,
  maxLength: number,
): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    unavailable();
  }
  return value;
}

export function isServiceCredentialBearer(token: string): boolean {
  return token.startsWith("dng_svc_");
}

export class ApiRoutedTokenVerifier implements ApiTokenVerifier {
  constructor(
    private readonly oauth: ApiTokenVerifier,
    private readonly service: ApiTokenVerifier,
  ) {}

  verifyAccessToken(
    token: string,
    signal: AbortSignal,
  ): Promise<ApiInstallationPrincipal> {
    return isServiceCredentialBearer(token)
      ? this.service.verifyAccessToken(token, signal)
      : this.oauth.verifyAccessToken(token, signal);
  }
}

export class ApiServiceCredentialTokenVerifier implements ApiTokenVerifier {
  readonly #endpoint: URL;
  readonly #resource: string;
  readonly #keyId: string;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;
  readonly #fetch: typeof fetch;
  readonly #nowMs: () => number;
  readonly #nonce: () => string;
  readonly #requestId: () => string;
  readonly #hmacKey: Promise<CryptoKey>;

  constructor(options: ApiServiceCredentialVerifierOptions) {
    this.#endpoint = new URL(INTERNAL_PATH, safeOrigin(options.convexSiteUrl));
    this.#resource = safeResource(options.resource).toString();
    this.#keyId = options.keyId ?? "v1";
    if (this.#keyId !== "v1") throw new Error("keyId must be v1");
    this.#timeoutMs = positiveInteger(options.timeoutMs ?? 5_000, "timeoutMs");
    this.#maxResponseBytes = positiveInteger(
      options.maxResponseBytes ?? 32 * 1024,
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
    this.#requestId = options.requestId ?? (() => crypto.randomUUID());
  }

  async verifyAccessToken(
    token: string,
    signal: AbortSignal,
  ): Promise<ApiInstallationPrincipal> {
    const tokenMatch = TOKEN_PATTERN.exec(token);
    if (!tokenMatch) invalidToken();
    const tokenPrefix = tokenMatch[1]!;
    const timestamp = String(this.#nowMs());
    const nonce = this.#nonce();
    const requestId = this.#requestId();
    if (
      !/^\d{13}$/u.test(timestamp) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        nonce,
      ) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        requestId,
      )
    ) {
      unavailable();
    }
    const body = JSON.stringify({
      version: 1,
      requestId,
      input: { token },
    });
    const bodyHash = hex(await crypto.subtle.digest("SHA-256", encoder.encode(body)));
    const canonical = `${timestamp}\n${nonce}\n${INTERNAL_METHOD}\n${INTERNAL_PATH}\n${bodyHash}`;
    const signature = base64Url(
      await crypto.subtle.sign(
        "HMAC",
        await this.#hmacKey,
        encoder.encode(canonical),
      ),
    );
    const controller = new AbortController();
    const relayAbort = (): void => controller.abort(signal.reason);
    if (signal.aborted) relayAbort();
    else signal.addEventListener("abort", relayAbort, { once: true });
    const timeout = setTimeout(
      () => controller.abort(new Error("Service credential lookup timed out")),
      this.#timeoutMs,
    );
    let responseText: string;
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
        body,
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
      });
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => undefined);
        unavailable();
      }
      responseText = await readBoundedText(response, this.#maxResponseBytes);
    } catch (error) {
      if (error instanceof ApiBoundaryError) throw error;
      unavailable();
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", relayAbort);
    }
    const envelope = objectJson(responseText);
    if (
      envelope.ok !== true ||
      envelope.apiVersion !== "v1" ||
      envelope.requestId !== requestId ||
      envelope.data === null ||
      typeof envelope.data !== "object" ||
      Array.isArray(envelope.data)
    ) {
      unavailable();
    }
    const data = envelope.data as JsonRecord;
    if (data.active === false) invalidToken();
    if (data.active !== true) unavailable();
    const clientId = requiredString(data.clientId, 500);
    const resource = requiredString(data.resource, 2_048);
    const projectRef = requiredString(data.projectRef, 128);
    const scopes = data.scopes;
    if (
      clientId !== `dongo-service-v1:${tokenPrefix}` ||
      resource !== this.#resource ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/u.test(projectRef) ||
      !Array.isArray(scopes) ||
      scopes.length === 0 ||
      scopes.length > 3 ||
      scopes.some((scope) => typeof scope !== "string" || !ALLOWED_SCOPES.has(scope)) ||
      new Set(scopes).size !== scopes.length
    ) {
      unavailable();
    }
    return {
      clientId,
      serviceCredentialId: requiredString(data.serviceCredentialId, 256),
      installationId: requiredString(data.installationId, 256),
      installationActorId: requiredString(data.actorId, 256),
      organizationId: requiredString(data.organizationId, 256),
      projectId: requiredString(data.projectId, 256),
      projectRef,
      resource,
      scopes: scopes as string[],
    };
  }
}

