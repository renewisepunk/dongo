import type { AuthWorkerEnv } from "./env";
import { sha256Hex, signInternalRequest } from "./security";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { z } from "zod";

const encoder = new TextEncoder();
const MCP_RESOURCE = /^\/p\/([A-Za-z0-9][A-Za-z0-9_-]{2,127})\/mcp$/;
const REFERENCE_ID = /^dongo-grant:([A-Za-z0-9][A-Za-z0-9_-]{2,127}):([0-9a-f-]{36})$/;
export const ACCESS_TOKEN_PREFIX = "dgo_at_";
export const REFRESH_TOKEN_PREFIX = "dgo_rt_";

export interface GrantBinding {
  installationId: string;
  oauthBindingId: string;
  installationActorId: string;
  organizationId: string;
  projectId: string;
  projectRef: string;
}

interface GrantBindingWire {
  installationId: string;
  oauthBindingId: string;
  actorId: string;
  organizationId: string;
  projectId: string;
  projectRef: string;
  created: boolean;
  reactivated: boolean;
}

export interface BindGrantInput {
  providerIssuer: string;
  providerGrantId: string;
  subject: string;
  clientId: string;
  label: string;
  resource: string;
  scopes: string[];
  kind: "cli" | "mcp";
  profileId: string;
  projectRef: string;
}

export interface PinnedGrantContext extends BindGrantInput {
  binding: GrantBinding;
}

const bindingSchema = z.object({
  installationId: z.string().min(1),
  oauthBindingId: z.string().min(1),
  installationActorId: z.string().min(1),
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
  projectRef: z.string().min(3).max(128),
});
const pinnedGrantSchema = z.object({
  version: z.literal(1),
  entropy: z.string().uuid(),
  providerIssuer: z.url(),
  providerGrantId: z.string().min(1).max(1_000),
  subject: z.string().min(1).max(1_000),
  clientId: z.string().min(1).max(500),
  label: z.string().min(1).max(240),
  resource: z.url(),
  scopes: z.array(z.string()).min(1).max(4),
  kind: z.enum(["cli", "mcp"]),
  profileId: z.string().min(1).max(256),
  projectRef: z.string().min(3).max(128),
  binding: bindingSchema,
});
const refreshEnvelopeSchema = z.object({
  version: z.literal(1),
  token: z.string().min(16).max(1_000),
  sessionId: z.string().max(1_000).optional(),
  grant: pinnedGrantSchema,
});

function validOriginUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Invalid internal Convex site URL");
  }
  return url;
}

export function projectRefForGrant(input: {
  publicOrigin: string;
  resources: readonly string[];
  activeProjectRef?: string;
  referenceId?: string;
}): string {
  if (input.resources.length !== 1) {
    throw new Error("Dongo grants must target exactly one resource");
  }
  const resource = new URL(input.resources[0]!);
  const publicOrigin = new URL(input.publicOrigin);
  if (resource.origin !== publicOrigin.origin || resource.search || resource.hash) {
    throw new Error("OAuth resource is outside this Dongo environment");
  }

  const mcpProject = MCP_RESOURCE.exec(resource.pathname)?.[1];
  const referencedProject = input.referenceId
    ? REFERENCE_ID.exec(input.referenceId)?.[1]
    : undefined;
  if (mcpProject !== undefined) {
    if (referencedProject !== undefined && referencedProject !== mcpProject) {
      throw new Error("OAuth consent project does not match the MCP resource");
    }
    if (input.activeProjectRef !== undefined && input.activeProjectRef !== mcpProject) {
      throw new Error("Selected project does not match the MCP resource");
    }
    return mcpProject;
  }

  if (resource.pathname !== "/api/agent/v1" || !input.activeProjectRef) {
    throw new Error("A project must be selected for the Dongo CLI grant");
  }
  return input.activeProjectRef;
}

export async function providerGrantId(input: {
  referenceId?: string;
  issuer: string;
  subject: string;
  clientId: string;
  projectRef: string;
  resource: string;
}): Promise<string> {
  if (input.referenceId) {
    const match = REFERENCE_ID.exec(input.referenceId);
    if (!match || match[1] !== input.projectRef) {
      throw new Error("OAuth grant reference is invalid");
    }
    return input.referenceId;
  }
  const digest = await sha256Hex(
    encoder.encode(
      [input.issuer, input.subject, input.clientId, input.projectRef, input.resource].join("\0"),
    ),
  );
  return `dongo-device:${digest}`;
}

function isBinding(value: unknown): value is GrantBindingWire {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return [
    "installationId",
    "oauthBindingId",
    "actorId",
    "organizationId",
    "projectId",
    "projectRef",
  ].every((key) => typeof record[key] === "string" && record[key] !== "");
}

function mappedBinding(binding: GrantBindingWire): GrantBinding {
  return {
    installationId: binding.installationId,
    oauthBindingId: binding.oauthBindingId,
    installationActorId: binding.actorId,
    organizationId: binding.organizationId,
    projectId: binding.projectId,
    projectRef: binding.projectRef,
  };
}

async function callOAuthGateway(
  env: AuthWorkerEnv,
  path: "/internal/oauth/v1/bind" | "/internal/oauth/v1/resolve",
  input: Record<string, unknown>,
): Promise<GrantBindingWire> {
  const base = validOriginUrl(env.CONVEX_INTERNAL_SITE_URL);
  const requestId = crypto.randomUUID();
  const body = encoder.encode(JSON.stringify({ version: 1, requestId, input }));
  const timestamp = String(Date.now());
  const nonce = crypto.randomUUID();
  const signature = await signInternalRequest({
    secret: env.DONGO_INTERNAL_GATEWAY_SECRET,
    timestamp,
    nonce,
    method: "POST",
    pathname: path,
    body,
  });
  const response = await fetch(new URL(path, base), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-dongo-key-id": "v1",
      "x-dongo-timestamp": timestamp,
      "x-dongo-nonce": nonce,
      "x-dongo-signature": signature,
    },
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  const result = (await response.json().catch(() => undefined)) as
    | {
        ok?: boolean;
        data?: unknown;
        requestId?: string;
        apiVersion?: string;
        error?: { code?: string };
      }
    | undefined;
  if (
    !response.ok ||
    result?.ok !== true ||
    result.requestId !== requestId ||
    result.apiVersion !== "v1" ||
    !isBinding(result.data)
  ) {
    throw new Error(
      `Convex rejected OAuth grant ${path.endsWith("/bind") ? "binding" : "resolution"}${result?.error?.code ? ` (${result.error.code})` : ""}`,
    );
  }
  return result.data;
}

export async function bindOAuthGrant(
  env: AuthWorkerEnv,
  input: BindGrantInput,
): Promise<GrantBinding> {
  const result = await callOAuthGateway(env, "/internal/oauth/v1/bind", {
    providerIssuer: input.providerIssuer,
    providerGrantId: input.providerGrantId,
    subject: input.subject,
    clientId: input.clientId,
    label: input.label,
    resource: input.resource,
    scopes: input.scopes,
    kind: input.kind,
    profileId: input.profileId,
    projectRef: input.projectRef,
  });
  if (result.projectRef !== input.projectRef) {
    throw new Error("Convex returned a mismatched OAuth project binding");
  }
  return mappedBinding(result);
}

export async function resolveOAuthGrant(
  env: AuthWorkerEnv,
  input: PinnedGrantContext,
): Promise<GrantBinding> {
  const result = await callOAuthGateway(env, "/internal/oauth/v1/resolve", {
    providerIssuer: input.providerIssuer,
    providerGrantId: input.providerGrantId,
    subject: input.subject,
    clientId: input.clientId,
    resource: input.resource,
    projectRef: input.projectRef,
    profileId: input.profileId,
  });
  if (
    result.projectRef !== input.projectRef ||
    result.oauthBindingId !== input.binding.oauthBindingId ||
    result.installationId !== input.binding.installationId
  ) {
    throw new Error("Convex returned a mismatched OAuth grant resolution");
  }
  return mappedBinding(result);
}

export async function encodePinnedAccessToken(
  secret: string,
  grant: PinnedGrantContext,
): Promise<string> {
  return await symmetricEncrypt({
    key: secret,
    data: JSON.stringify({ version: 1, entropy: crypto.randomUUID(), ...grant }),
  });
}

export async function decodePinnedAccessToken(
  secret: string,
  token: string,
): Promise<PinnedGrantContext> {
  const encrypted = token.startsWith(ACCESS_TOKEN_PREFIX)
    ? token.slice(ACCESS_TOKEN_PREFIX.length)
    : token;
  const parsed = pinnedGrantSchema.safeParse(
    JSON.parse(await symmetricDecrypt({ key: secret, data: encrypted })),
  );
  if (!parsed.success) throw new Error("Opaque access token context is invalid");
  const { version: _version, entropy: _entropy, ...grant } = parsed.data;
  return grant;
}

export async function encodePinnedRefreshToken(input: {
  secret: string;
  token: string;
  sessionId?: string;
  grant: PinnedGrantContext;
}): Promise<string> {
  return await symmetricEncrypt({
    key: input.secret,
    data: JSON.stringify({
      version: 1,
      token: input.token,
      sessionId: input.sessionId,
      grant: { version: 1, entropy: crypto.randomUUID(), ...input.grant },
    }),
  });
}

export async function decodePinnedRefreshToken(
  secret: string,
  token: string,
): Promise<{ token: string; sessionId?: string; grant: PinnedGrantContext }> {
  const encrypted = token.startsWith(REFRESH_TOKEN_PREFIX)
    ? token.slice(REFRESH_TOKEN_PREFIX.length)
    : token;
  const parsed = refreshEnvelopeSchema.safeParse(
    JSON.parse(await symmetricDecrypt({ key: secret, data: encrypted })),
  );
  if (!parsed.success) throw new Error("Opaque refresh token context is invalid");
  const { version: _version, entropy: _entropy, ...grant } = parsed.data.grant;
  return { token: parsed.data.token, sessionId: parsed.data.sessionId, grant };
}
