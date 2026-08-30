import type { AuthWorkerEnv } from "./env";
import {
  ACCESS_TOKEN_PREFIX,
  decodePinnedAccessToken,
  resolveOAuthGrant,
} from "./grant-binding";

const MAX_FORM_BYTES = 20 * 1024;
const MAX_TOKEN_BYTES = 16 * 1024;

type AccessTokenRow = {
  clientId: string | null;
  userId: string | null;
  resources: string | null;
  scopes: string | null;
  expiresAt: number | string | null;
  createdAt: number | string | null;
  revoked: number | string | null;
};

function json(body: Record<string, unknown>, status = 200, headers?: HeadersInit) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", pragma: "no-cache", ...headers },
  });
}

function invalidClient(): Response {
  return json(
    { error: "invalid_client", error_description: "Client authentication failed" },
    401,
    { "www-authenticate": "Basic" },
  );
}

function decodeBasicAuthorization(value: string | null): {
  clientId: string;
  clientSecret: string;
} | null {
  if (!value || !/^Basic\s+/i.test(value)) return null;
  try {
    const encoded = value.replace(/^Basic\s+/i, "");
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)),
    );
    const separator = decoded.indexOf(":");
    if (separator < 1) return null;
    const clientId = decodeURIComponent(decoded.slice(0, separator));
    const clientSecret = decodeURIComponent(decoded.slice(separator + 1));
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  } catch {
    return null;
  }
}

async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([
    sha256(new TextEncoder().encode(left)),
    sha256(new TextEncoder().encode(right)),
  ]);
  let difference = 0;
  for (let index = 0; index < leftDigest.length; index += 1) {
    difference |= leftDigest[index]! ^ rightDigest[index]!;
  }
  return difference === 0;
}

async function authenticateResourceClient(
  request: Request,
  env: AuthWorkerEnv,
): Promise<string | null> {
  const credentials = decodeBasicAuthorization(
    request.headers.get("authorization"),
  );
  if (!credentials) return null;
  const expectedSecret =
    credentials.clientId === env.BETTER_AUTH_RESOURCE_CLIENT_ID
      ? env.BETTER_AUTH_RESOURCE_CLIENT_SECRET
      : credentials.clientId === env.DONGO_API_RESOURCE_CLIENT_ID
        ? env.DONGO_API_RESOURCE_CLIENT_SECRET
        : undefined;
  if (
    !expectedSecret ||
    !(await constantTimeEqual(credentials.clientSecret, expectedSecret))
  ) {
    return null;
  }
  return credentials.clientId;
}

function parseStringArray(value: string | null): string[] | null {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function exactStrings(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value) => right.includes(value))
  );
}

function dateMillis(value: number | string | null): number | null {
  if (value === null) return null;
  const numeric = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1_000 : numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

async function resourceClientMayIntrospect(
  env: AuthWorkerEnv,
  clientId: string,
  resource: string,
): Promise<boolean> {
  const row = await env.AUTH_DB.prepare(
    `SELECT c.disabled AS clientDisabled, r.disabled AS resourceDisabled
       FROM oauthClient c
       JOIN oauthClientResource cr ON cr.clientId = c.clientId
       JOIN oauthResource r ON r.identifier = cr.resourceId
      WHERE c.clientId = ? AND cr.resourceId = ?
      LIMIT 1`,
  )
    .bind(clientId, resource)
    .first<{ clientDisabled: number | null; resourceDisabled: number | null }>();
  return row !== null && row.clientDisabled !== 1 && row.resourceDisabled !== 1;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", owned.buffer));
}

async function storedTokenHash(token: string): Promise<string> {
  const digest = await sha256(new TextEncoder().encode(token));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function introspect(
  env: AuthWorkerEnv,
  resourceClientId: string,
  token: string,
): Promise<Record<string, unknown>> {
  if (
    !token.startsWith(ACCESS_TOKEN_PREFIX) ||
    token.length > MAX_TOKEN_BYTES ||
    /\s/.test(token)
  ) {
    return { active: false };
  }
  let pinned;
  try {
    pinned = await decodePinnedAccessToken(env.BETTER_AUTH_SECRET, token);
  } catch {
    return { active: false };
  }
  const apiResource = `${new URL(env.PUBLIC_ORIGIN).origin}/api/agent/v1`;
  if (
    (resourceClientId === env.DONGO_API_RESOURCE_CLIENT_ID &&
      pinned.resource !== apiResource) ||
    (resourceClientId === env.BETTER_AUTH_RESOURCE_CLIENT_ID &&
      !/^https:\/\/[^/]+\/p\/[A-Za-z0-9][A-Za-z0-9_-]{2,127}\/mcp$/.test(
        pinned.resource,
      )) ||
    !(await resourceClientMayIntrospect(
      env,
      resourceClientId,
      pinned.resource,
    ))
  ) {
    return { active: false };
  }
  const tokenWithoutPrefix = token.slice(ACCESS_TOKEN_PREFIX.length);
  const row = await env.AUTH_DB.prepare(
    `SELECT clientId, userId, resources, scopes, expiresAt, createdAt, revoked
       FROM oauthAccessToken
      WHERE token = ?
      LIMIT 1`,
  )
    .bind(await storedTokenHash(tokenWithoutPrefix))
    .first<AccessTokenRow>();
  const resources = parseStringArray(row?.resources ?? null);
  const scopes = parseStringArray(row?.scopes ?? null);
  const expiresAt = dateMillis(row?.expiresAt ?? null);
  const createdAt = dateMillis(row?.createdAt ?? null);
  if (
    !row ||
    row.revoked !== null ||
    expiresAt === null ||
    expiresAt <= Date.now() ||
    row.clientId !== pinned.clientId ||
    row.userId !== pinned.subject ||
    resources === null ||
    resources.length !== 1 ||
    resources[0] !== pinned.resource ||
    scopes === null ||
    !exactStrings(scopes, pinned.scopes)
  ) {
    return { active: false };
  }
  let binding;
  try {
    binding = await resolveOAuthGrant(env, pinned);
  } catch {
    return { active: false };
  }
  return {
    active: true,
    iss: env.AUTH_ISSUER,
    aud: pinned.resource,
    sub: pinned.subject,
    client_id: pinned.clientId,
    scope: pinned.scopes.join(" "),
    token_type: "Bearer",
    exp: Math.floor(expiresAt / 1_000),
    ...(createdAt === null ? {} : { iat: Math.floor(createdAt / 1_000) }),
    grantId: binding.oauthBindingId,
    installationId: binding.installationId,
    installationActorId: binding.installationActorId,
    organizationId: binding.organizationId,
    projectId: binding.projectId,
    projectRef: binding.projectRef,
  };
}

export async function resourceIntrospection(
  request: Request,
  env: AuthWorkerEnv,
): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405, { allow: "POST" });
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_FORM_BYTES) {
    return json({ error: "invalid_request" }, 400);
  }
  const resourceClientId = await authenticateResourceClient(request, env);
  if (!resourceClientId) return invalidClient();
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .includes("application/x-www-form-urlencoded")
  ) {
    return json({ error: "invalid_request" }, 400);
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_FORM_BYTES) {
    return json({ error: "invalid_request" }, 400);
  }
  const form = new URLSearchParams(body);
  const tokens = form.getAll("token");
  if (tokens.length !== 1 || !tokens[0]) {
    return json({ error: "invalid_request" }, 400);
  }
  try {
    return json(await introspect(env, resourceClientId, tokens[0]));
  } catch {
    return json(
      { error: "server_error", error_description: "Authorization is temporarily unavailable" },
      500,
    );
  }
}
