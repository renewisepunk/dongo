import { z } from "zod";
import { symmetricEncrypt } from "better-auth/crypto";
import type { AuthWorkerEnv } from "./env";
import { verifyInternalRequest } from "./security";

const MAX_BODY_BYTES = 8 * 1024;
const requestSchema = z.object({
  projectRef: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/),
  projectName: z.string().trim().min(1).max(120).optional(),
});

const scopes = [
  "dongo:work:read",
  "dongo:work:write",
  "dongo:attachments:read",
  "offline_access",
] as const;

function json(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function provisionProjectResource(
  request: Request,
  env: AuthWorkerEnv,
): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return json({ error: "payload_too_large" }, 413);
  }
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > MAX_BODY_BYTES) {
    return json({ error: "payload_too_large" }, 413);
  }

  let signed: { timestamp: number; nonce: string };
  try {
    signed = await verifyInternalRequest({
      secret: env.DONGO_INTERNAL_GATEWAY_SECRET,
      keyId: request.headers.get("x-dongo-key-id"),
      timestamp: request.headers.get("x-dongo-timestamp"),
      nonce: request.headers.get("x-dongo-nonce"),
      signature: request.headers.get("x-dongo-signature"),
      method: request.method,
      pathname: new URL(request.url).pathname,
      body,
    });
  } catch {
    return json({ error: "unauthorized" }, 401);
  }

  const parsed = requestSchema.safeParse(
    (() => {
      try {
        return JSON.parse(new TextDecoder().decode(body));
      } catch {
        return undefined;
      }
    })(),
  );
  if (!parsed.success) return json({ error: "invalid_request" }, 400);

  const now = Date.now();
  try {
    await env.AUTH_DB.prepare(
      `INSERT INTO dongoInternalNonce (nonce, timestamp, expiresAt)
       VALUES (?, ?, ?)`,
    )
      .bind(signed.nonce, signed.timestamp, now + 2 * 60_000)
      .run();
  } catch {
    return json({ error: "replayed_request" }, 409);
  }

  const identifier = `${new URL(env.PUBLIC_ORIGIN).origin}/p/${parsed.data.projectRef}/mcp`;
  const agentApiIdentifier = `${new URL(env.PUBLIC_ORIGIN).origin}/api/agent/v1`;
  const resourceName = parsed.data.projectName
    ? `${parsed.data.projectName} MCP`
    : `dongo project ${parsed.data.projectRef}`;
  const encryptedResourceClientSecret = await symmetricEncrypt({
    key: env.BETTER_AUTH_SECRET,
    data: env.BETTER_AUTH_RESOURCE_CLIENT_SECRET,
  });
  const encryptedApiResourceClientSecret = await symmetricEncrypt({
    key: env.BETTER_AUTH_SECRET,
    data: env.DONGO_API_RESOURCE_CLIENT_SECRET,
  });
  await env.AUTH_DB.batch([
    env.AUTH_DB.prepare(
      `INSERT INTO oauthResource (
         id, identifier, name, accessTokenTtl, refreshTokenTtl,
         allowedScopes, dpopBoundAccessTokensRequired, disabled,
         createdAt, updatedAt, policyVersion, metadata
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(identifier) DO UPDATE SET
         name = excluded.name,
         allowedScopes = excluded.allowedScopes,
         disabled = 0,
         updatedAt = excluded.updatedAt`,
    ).bind(
      crypto.randomUUID(),
      agentApiIdentifier,
      "dongo agent API",
      600,
      30 * 24 * 60 * 60,
      JSON.stringify(scopes),
      0,
      0,
      now,
      now,
      1,
      JSON.stringify({ kind: "agent-api" }),
    ),
    env.AUTH_DB.prepare(
      `INSERT INTO oauthResource (
         id, identifier, name, accessTokenTtl, refreshTokenTtl,
         allowedScopes, dpopBoundAccessTokensRequired, disabled,
         createdAt, updatedAt, policyVersion, metadata
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(identifier) DO UPDATE SET
         name = excluded.name,
         allowedScopes = excluded.allowedScopes,
         disabled = 0,
         updatedAt = excluded.updatedAt`,
    ).bind(
      crypto.randomUUID(),
      identifier,
      resourceName,
      600,
      30 * 24 * 60 * 60,
      JSON.stringify(scopes),
      0,
      0,
      now,
      now,
      1,
      JSON.stringify({ projectRef: parsed.data.projectRef }),
    ),
    env.AUTH_DB.prepare(
      `INSERT INTO oauthClient (
         id, clientId, clientSecret, disabled, skipConsent, enableEndSession,
         subjectType, scopes, clientCredentialsScopes, createdAt, updatedAt,
         name, redirectUris, tokenEndpointAuthMethod, applicationType,
         grantTypes, responseTypes, requirePKCE, metadata
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(clientId) DO UPDATE SET
         clientSecret = excluded.clientSecret,
         disabled = 0,
         updatedAt = excluded.updatedAt`,
    ).bind(
      crypto.randomUUID(),
      env.BETTER_AUTH_RESOURCE_CLIENT_ID,
      encryptedResourceClientSecret,
      0,
      1,
      0,
      "public",
      JSON.stringify([]),
      JSON.stringify([]),
      now,
      now,
      "dongo MCP resource server",
      JSON.stringify([]),
      "client_secret_basic",
      "web",
      JSON.stringify([]),
      JSON.stringify([]),
      0,
      JSON.stringify({ internal: true, resourceServer: true }),
    ),
    env.AUTH_DB.prepare(
      `INSERT INTO oauthClient (
         id, clientId, clientSecret, disabled, skipConsent, enableEndSession,
         subjectType, scopes, clientCredentialsScopes, createdAt, updatedAt,
         name, redirectUris, tokenEndpointAuthMethod, applicationType,
         grantTypes, responseTypes, requirePKCE, metadata
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(clientId) DO UPDATE SET
         clientSecret = excluded.clientSecret,
         disabled = 0,
         updatedAt = excluded.updatedAt`,
    ).bind(
      crypto.randomUUID(),
      env.DONGO_API_RESOURCE_CLIENT_ID,
      encryptedApiResourceClientSecret,
      0,
      1,
      0,
      "public",
      JSON.stringify([]),
      JSON.stringify([]),
      now,
      now,
      "dongo agent API resource server",
      JSON.stringify([]),
      "client_secret_basic",
      "web",
      JSON.stringify([]),
      JSON.stringify([]),
      0,
      JSON.stringify({ internal: true, resourceServer: true }),
    ),
    env.AUTH_DB.prepare(
      `INSERT INTO oauthClientResource (
         id, clientId, resourceId, metadata, createdAt
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(clientId, resourceId) DO UPDATE SET
         metadata = excluded.metadata`,
    ).bind(
      crypto.randomUUID(),
      env.BETTER_AUTH_RESOURCE_CLIENT_ID,
      identifier,
      JSON.stringify({ internal: true }),
      now,
    ),
    env.AUTH_DB.prepare(
      `INSERT INTO oauthClientResource (
         id, clientId, resourceId, metadata, createdAt
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(clientId, resourceId) DO UPDATE SET
         metadata = excluded.metadata`,
    ).bind(
      crypto.randomUUID(),
      env.DONGO_API_RESOURCE_CLIENT_ID,
      agentApiIdentifier,
      JSON.stringify({ internal: true }),
      now,
    ),
    env.AUTH_DB.prepare(
      "DELETE FROM dongoInternalNonce WHERE expiresAt < ?",
    ).bind(now),
  ]);
  return json(
    { ok: true, resource: identifier, agentApiResource: agentApiIdentifier },
    200,
  );
}
