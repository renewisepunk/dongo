import { agentScopes } from "@dongo/contracts";
import {
  OAuthError,
  OAuthErrorCode,
} from "@modelcontextprotocol/server";
import type {
  DongoScope,
  DongoTokenVerificationContext,
  DongoTokenVerifier,
  DongoVerifiedAuthInfo,
  JsonRecord,
} from "./types.js";

const encoder = new TextEncoder();
const RESOURCE_SCOPES = new Set<string>(
  agentScopes.filter((scope): scope is DongoScope => scope !== "offline_access"),
);
const DEFAULT_ALLOWED_SCOPES = new Set<string>(agentScopes);
const REQUIRED_CUSTOM_CLAIMS = [
  "grantId",
  "installationId",
  "installationActorId",
  "organizationId",
  "projectId",
  "projectRef",
] as const;
const CLAIM_MAX_LENGTHS: Record<(typeof REQUIRED_CUSTOM_CLAIMS)[number], number> = {
  grantId: 256,
  installationId: 256,
  installationActorId: 256,
  organizationId: 256,
  projectId: 256,
  projectRef: 128,
};

export interface BetterAuthIntrospectionTokenVerifierOptions {
  /** Better Auth RFC 7662 endpoint, normally `{issuer}/oauth2/introspect`. */
  readonly introspectionUrl: URL;
  /** Exact Better Auth issuer expected in every active response. */
  readonly issuer: string;
  /** Confidential resource-server client registered with Better Auth. */
  readonly resourceClientId: string;
  readonly resourceClientSecret: string;
  readonly allowedScopes?: readonly string[];
  readonly clockSkewSeconds?: number;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly fetch?: typeof fetch;
  readonly nowSeconds?: () => number;
}

type IntrospectionResponse = JsonRecord & {
  active: boolean;
};

function oauthFailure(
  code: OAuthErrorCode.InvalidToken | OAuthErrorCode.ServerError,
  message: string,
): never {
  throw new OAuthError(code, message);
}

function assertHttpsEndpoint(url: URL, label: string): URL {
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(`${label} must be an HTTPS URL without credentials or fragment`);
  }
  return new URL(url);
}

function canonicalIssuer(value: string): string {
  assertHttpsEndpoint(new URL(value), "issuer");
  return value;
}

function requiredSecret(value: string): string {
  const bytes = encoder.encode(value).byteLength;
  if (value.length < 32 || bytes < 32 || bytes > 4_096) {
    throw new Error("resourceClientSecret is missing or invalid");
  }
  return value;
}

function requiredConfig(value: string, label: string, max = 2_048): string {
  if (value.length === 0 || value.length > max) {
    throw new Error(`${label} is missing or invalid`);
  }
  return value;
}

function formComponent(value: string): string {
  const form = new URLSearchParams({ value }).toString();
  return form.slice("value=".length);
}

function basicAuthorization(clientId: string, clientSecret: string): string {
  const value = `${formComponent(clientId)}:${formComponent(clientSecret)}`;
  const bytes = encoder.encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `Basic ${btoa(binary)}`;
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
      await reader.cancel("Introspection response exceeded its configured limit");
      oauthFailure(
        OAuthErrorCode.ServerError,
        "The authorization server returned an invalid response",
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

function parseResponse(text: string): IntrospectionResponse {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    oauthFailure(
      OAuthErrorCode.ServerError,
      "The authorization server returned an invalid response",
    );
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    oauthFailure(
      OAuthErrorCode.ServerError,
      "The authorization server returned an invalid response",
    );
  }
  return value as IntrospectionResponse;
}

function requiredClaim(
  response: JsonRecord,
  name: string,
  maxLength = 2_048,
): string {
  const value = response[name];
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    oauthFailure(
      OAuthErrorCode.InvalidToken,
      "The access token is missing a required Dongo binding",
    );
  }
  return value;
}

function numericDate(response: JsonRecord, name: "exp" | "nbf"): number | undefined {
  const value = response[name];
  if (value === undefined && name === "nbf") {
    return undefined;
  }
  if (typeof value !== "number" || Number.isSafeInteger(value) === false || value < 0) {
    oauthFailure(
      OAuthErrorCode.InvalidToken,
      "The access token has invalid time claims",
    );
  }
  return value;
}

function exactAudience(response: JsonRecord, expectedResource: string): boolean {
  const audience = response.aud;
  if (typeof audience === "string") {
    return audience === expectedResource;
  }
  return (
    Array.isArray(audience) &&
    audience.length === 1 &&
    audience[0] === expectedResource
  );
}

/**
 * RFC 7662 adapter for a Better Auth 1.7 authorization server.
 *
 * It intentionally performs an authenticated introspection for every bearer
 * request. There is no positive cache: grant/client/session revocation becomes
 * authoritative as soon as Better Auth reports the token inactive.
 */
export class BetterAuthIntrospectionTokenVerifier implements DongoTokenVerifier {
  readonly #introspectionUrl: URL;
  readonly #issuer: string;
  readonly #authorization: string;
  readonly #allowedScopes: ReadonlySet<string>;
  readonly #clockSkewSeconds: number;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;
  readonly #fetch: typeof fetch;
  readonly #nowSeconds: () => number;

  constructor(options: BetterAuthIntrospectionTokenVerifierOptions) {
    this.#introspectionUrl = assertHttpsEndpoint(
      options.introspectionUrl,
      "introspectionUrl",
    );
    this.#issuer = canonicalIssuer(options.issuer);
    this.#authorization = basicAuthorization(
      requiredConfig(options.resourceClientId, "resourceClientId", 512),
      requiredSecret(options.resourceClientSecret),
    );
    this.#allowedScopes = new Set(options.allowedScopes ?? DEFAULT_ALLOWED_SCOPES);
    this.#clockSkewSeconds = options.clockSkewSeconds ?? 5;
    this.#timeoutMs = options.timeoutMs ?? 5_000;
    this.#maxResponseBytes = options.maxResponseBytes ?? 32 * 1024;
    this.#fetch = options.fetch ?? fetch;
    this.#nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1_000));

    for (const [label, value] of [
      ["clockSkewSeconds", this.#clockSkewSeconds],
      ["timeoutMs", this.#timeoutMs],
      ["maxResponseBytes", this.#maxResponseBytes],
    ] as const) {
      if (Number.isSafeInteger(value) === false || value < (label === "clockSkewSeconds" ? 0 : 1)) {
        throw new Error(`${label} is invalid`);
      }
    }
    if ([...RESOURCE_SCOPES].some((scope) => this.#allowedScopes.has(scope) === false)) {
      throw new Error("allowedScopes must include every Dongo resource scope");
    }
  }

  async verifyAccessToken(
    token: string,
    context: DongoTokenVerificationContext,
  ): Promise<DongoVerifiedAuthInfo> {
    if (
      token.length === 0 ||
      token.length > 16 * 1024 ||
      /\s/u.test(token) ||
      canonicalIssuer(context.expectedIssuer) !== this.#issuer
    ) {
      oauthFailure(OAuthErrorCode.InvalidToken, "The access token is not valid");
    }

    const expectedResource = new URL(context.expectedResource);
    if (
      expectedResource.protocol !== "https:" ||
      expectedResource.username !== "" ||
      expectedResource.password !== "" ||
      expectedResource.search !== "" ||
      expectedResource.hash !== ""
    ) {
      oauthFailure(OAuthErrorCode.ServerError, "The MCP resource is misconfigured");
    }

    const controller = new AbortController();
    const relayAbort = (): void => controller.abort(context.signal?.reason);
    context.signal?.addEventListener("abort", relayAbort, { once: true });
    const timeout = setTimeout(
      () => controller.abort(new Error("Authorization introspection timed out")),
      this.#timeoutMs,
    );
    const cleanup = (): void => {
      clearTimeout(timeout);
      context.signal?.removeEventListener("abort", relayAbort);
    };

    let response: Response;
    try {
      response = await this.#fetch(this.#introspectionUrl, {
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
    } catch {
      cleanup();
      oauthFailure(
        OAuthErrorCode.ServerError,
        "The authorization server is temporarily unavailable",
      );
    }

    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      cleanup();
      oauthFailure(
        OAuthErrorCode.ServerError,
        "The authorization server rejected resource authentication",
      );
    }
    let responseText: string;
    try {
      responseText = await readBoundedText(response, this.#maxResponseBytes);
    } catch (error) {
      if (error instanceof OAuthError) {
        throw error;
      }
      oauthFailure(
        OAuthErrorCode.ServerError,
        "The authorization server is temporarily unavailable",
      );
    } finally {
      cleanup();
    }
    const introspection = parseResponse(responseText);
    if (introspection.active !== true) {
      oauthFailure(OAuthErrorCode.InvalidToken, "The access token is inactive");
    }

    const now = this.#nowSeconds();
    const expiresAt = numericDate(introspection, "exp");
    const notBefore = numericDate(introspection, "nbf");
    if (
      expiresAt === undefined ||
      expiresAt <= now - this.#clockSkewSeconds ||
      (notBefore !== undefined && notBefore > now + this.#clockSkewSeconds) ||
      introspection.iss !== this.#issuer ||
      exactAudience(introspection, expectedResource.href) === false ||
      (introspection.token_type !== undefined &&
        (typeof introspection.token_type !== "string" ||
          introspection.token_type.toLowerCase() !== "bearer"))
    ) {
      oauthFailure(OAuthErrorCode.InvalidToken, "The access token is not valid");
    }

    if (typeof introspection.scope !== "string") {
      oauthFailure(OAuthErrorCode.InvalidToken, "The access token has invalid scopes");
    }
    const scopes = [...new Set(introspection.scope.split(" ").filter(Boolean))];
    if (
      scopes.length === 0 ||
      scopes.some((scope) => this.#allowedScopes.has(scope) === false) ||
      scopes.some((scope) => RESOURCE_SCOPES.has(scope)) === false
    ) {
      oauthFailure(OAuthErrorCode.InvalidToken, "The access token has invalid scopes");
    }
    const resourceScopes = scopes.filter((scope) => RESOURCE_SCOPES.has(scope));

    const clientId = requiredClaim(introspection, "client_id", 500);
    const claims = Object.fromEntries(
      REQUIRED_CUSTOM_CLAIMS.map((name) => [
        name,
        requiredClaim(introspection, name, CLAIM_MAX_LENGTHS[name]),
      ]),
    ) as Record<(typeof REQUIRED_CUSTOM_CLAIMS)[number], string>;
    if (claims.projectRef !== context.projectRef) {
      oauthFailure(OAuthErrorCode.InvalidToken, "The access token is bound to another project");
    }

    return {
      token,
      clientId,
      scopes: resourceScopes,
      expiresAt,
      resource: expectedResource,
      extra: {
        issuer: this.#issuer,
        ...claims,
      },
    };
  }
}
