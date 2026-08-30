import { agentScopes } from "@dongo/contracts";
import type {
  ApiInstallationPrincipal,
  ApiTokenVerifier,
  JsonRecord,
} from "./types.ts";
import { ApiBoundaryError } from "./types.ts";

const encoder = new TextEncoder();
const RESOURCE_SCOPES = new Set<string>(
  agentScopes.filter((scope) => scope !== "offline_access"),
);
const ALLOWED_SCOPES = new Set<string>(agentScopes);
const REQUIRED_BINDING_CLAIMS = [
  "grantId",
  "installationId",
  "installationActorId",
  "organizationId",
  "projectId",
  "projectRef",
] as const;

export interface ApiIntrospectionVerifierOptions {
  readonly introspectionUrl: URL;
  readonly issuer: string;
  readonly resource: URL;
  readonly resourceClientId: string;
  readonly resourceClientSecret: string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly clockSkewSeconds?: number;
  readonly fetch?: typeof fetch;
  readonly nowSeconds?: () => number;
}

function safeHttpsUrl(value: URL, label: string, originOnly = false): URL {
  if (
    value.protocol !== "https:" ||
    value.username !== "" ||
    value.password !== "" ||
    value.search !== "" ||
    value.hash !== "" ||
    (originOnly && value.pathname !== "/")
  ) {
    throw new Error(`${label} is not a safe HTTPS URL`);
  }
  return new URL(value);
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function requiredConfig(value: string, label: string, maxLength: number): string {
  if (value.length === 0 || value.length > maxLength) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function basicAuthorization(clientId: string, clientSecret: string): string {
  const escapedId = new URLSearchParams({ value: clientId })
    .toString()
    .slice("value=".length);
  const escapedSecret = new URLSearchParams({ value: clientSecret })
    .toString()
    .slice("value=".length);
  const bytes = encoder.encode(`${escapedId}:${escapedSecret}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
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
      await reader.cancel("Introspection response exceeded its limit");
      throw new ApiBoundaryError(
        "temporarily_unavailable",
        "Authorization is temporarily unavailable",
        503,
        true,
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
  return new TextDecoder().decode(bytes);
}

function objectJson(text: string): JsonRecord {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ApiBoundaryError(
      "temporarily_unavailable",
      "Authorization is temporarily unavailable",
      503,
      true,
    );
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiBoundaryError(
      "temporarily_unavailable",
      "Authorization is temporarily unavailable",
      503,
      true,
    );
  }
  return value as JsonRecord;
}

function invalidToken(message = "The access token is not valid"): never {
  throw new ApiBoundaryError("unauthorized", message, 401, false);
}

function requiredClaim(
  response: JsonRecord,
  name: string,
  maxLength = 256,
): string {
  const value = response[name];
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    invalidToken("The access token is missing a required dongo binding");
  }
  return value;
}

function numericDate(response: JsonRecord, name: "exp" | "nbf"): number | undefined {
  const value = response[name];
  if (value === undefined && name === "nbf") return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalidToken("The access token has invalid time claims");
  }
  return value;
}

function exactAudience(response: JsonRecord, resource: string): boolean {
  const audience = response.aud;
  return (
    audience === resource ||
    (Array.isArray(audience) && audience.length === 1 && audience[0] === resource)
  );
}

export class ApiIntrospectionTokenVerifier implements ApiTokenVerifier {
  readonly #introspectionUrl: URL;
  readonly #issuer: string;
  readonly #resource: URL;
  readonly #authorization: string;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;
  readonly #clockSkewSeconds: number;
  readonly #fetch: typeof fetch;
  readonly #nowSeconds: () => number;

  constructor(options: ApiIntrospectionVerifierOptions) {
    this.#introspectionUrl = safeHttpsUrl(
      options.introspectionUrl,
      "introspectionUrl",
    );
    const issuer = safeHttpsUrl(new URL(options.issuer), "issuer");
    this.#issuer = issuer.toString().replace(/\/$/u, "");
    this.#resource = safeHttpsUrl(options.resource, "resource");
    this.#timeoutMs = positiveInteger(options.timeoutMs ?? 5_000, "timeoutMs");
    this.#maxResponseBytes = positiveInteger(
      options.maxResponseBytes ?? 32 * 1024,
      "maxResponseBytes",
    );
    this.#clockSkewSeconds = options.clockSkewSeconds ?? 5;
    if (!Number.isSafeInteger(this.#clockSkewSeconds) || this.#clockSkewSeconds < 0) {
      throw new Error("clockSkewSeconds is invalid");
    }
    const clientId = requiredConfig(options.resourceClientId, "resourceClientId", 500);
    const secret = requiredConfig(
      options.resourceClientSecret,
      "resourceClientSecret",
      4_096,
    );
    if (encoder.encode(secret).byteLength < 32) {
      throw new Error("resourceClientSecret must contain at least 32 bytes");
    }
    this.#authorization = basicAuthorization(clientId, secret);
    const fetcher = options.fetch ?? fetch;
    this.#fetch = (input, init) => fetcher(input, init);
    this.#nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1_000));
  }

  async verifyAccessToken(
    token: string,
    signal: AbortSignal,
  ): Promise<ApiInstallationPrincipal> {
    if (
      token.length === 0 ||
      token.length > 16 * 1024 ||
      /\s/u.test(token)
    ) {
      invalidToken();
    }
    const controller = new AbortController();
    const relayAbort = (): void => controller.abort(signal.reason);
    if (signal.aborted) relayAbort();
    else signal.addEventListener("abort", relayAbort, { once: true });
    const timeout = setTimeout(
      () => controller.abort(new Error("Introspection timed out")),
      this.#timeoutMs,
    );
    let responseText: string;
    try {
      const response = await this.#fetch(this.#introspectionUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: this.#authorization,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          token,
          token_type_hint: "access_token",
        }),
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
      });
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => undefined);
        throw new ApiBoundaryError(
          "temporarily_unavailable",
          "Authorization is temporarily unavailable",
          503,
          true,
        );
      }
      responseText = await readBoundedText(response, this.#maxResponseBytes);
    } catch (error) {
      if (error instanceof ApiBoundaryError) throw error;
      throw new ApiBoundaryError(
        "temporarily_unavailable",
        "Authorization is temporarily unavailable",
        503,
        true,
      );
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", relayAbort);
    }
    const introspection = objectJson(responseText);
    if (introspection.active !== true) invalidToken("The access token is inactive");
    const now = this.#nowSeconds();
    const expiresAt = numericDate(introspection, "exp");
    const notBefore = numericDate(introspection, "nbf");
    if (
      expiresAt === undefined ||
      expiresAt <= now - this.#clockSkewSeconds ||
      (notBefore !== undefined && notBefore > now + this.#clockSkewSeconds) ||
      introspection.iss !== this.#issuer ||
      !exactAudience(introspection, this.#resource.toString()) ||
      (introspection.token_type !== undefined &&
        (typeof introspection.token_type !== "string" ||
          introspection.token_type.toLowerCase() !== "bearer"))
    ) {
      invalidToken();
    }
    if (typeof introspection.scope !== "string") {
      invalidToken("The access token has invalid scopes");
    }
    const scopes = [...new Set(introspection.scope.split(" ").filter(Boolean))];
    if (
      scopes.length === 0 ||
      scopes.some((scope) => !ALLOWED_SCOPES.has(scope)) ||
      !scopes.some((scope) => RESOURCE_SCOPES.has(scope))
    ) {
      invalidToken("The access token has invalid scopes");
    }
    const bindings = Object.fromEntries(
      REQUIRED_BINDING_CLAIMS.map((name) => [
        name,
        requiredClaim(introspection, name, name === "projectRef" ? 128 : 256),
      ]),
    ) as Record<(typeof REQUIRED_BINDING_CLAIMS)[number], string>;
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/u.test(bindings.projectRef)) {
      invalidToken("The access token has an invalid project binding");
    }
    requiredClaim(introspection, "sub", 1_000);
    return {
      clientId: requiredClaim(introspection, "client_id", 500),
      grantId: bindings.grantId,
      installationId: bindings.installationId,
      installationActorId: bindings.installationActorId,
      organizationId: bindings.organizationId,
      projectId: bindings.projectId,
      projectRef: bindings.projectRef,
      issuer: this.#issuer,
      resource: this.#resource.toString(),
      scopes: scopes.filter((scope) => RESOURCE_SCOPES.has(scope)),
    };
  }
}
