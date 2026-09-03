import {
  DEVICE_CODE_GRANT_TYPE,
  type OAuthProviderExtension,
  type SchemaClient,
} from "@better-auth/oauth-provider";

export const AGENT_SCOPES = [
  "dongo:work:read",
  "dongo:work:write",
  "dongo:attachments:read",
  "offline_access",
] as const;

export const CODEX_OAUTH_CLIENT_ID = "dongo-codex";
export const CODEX_OAUTH_CALLBACK = "http://127.0.0.1/callback";

type OAuthAdapter = {
  findOne<T>(input: {
    model: string;
    where: Array<{ field: string; value: unknown }>;
  }): Promise<T | null>;
  create<T>(input: { model: string; data: Record<string, unknown> }): Promise<T>;
};

function firstPartyClient(clientId: "dongo-cli" | typeof CODEX_OAUTH_CLIENT_ID): SchemaClient {
  const now = new Date();
  const cli = clientId === "dongo-cli";
  return {
    clientId,
    clientDiscoveryId: "dongo-first-party",
    disabled: false,
    scopes: [...AGENT_SCOPES],
    clientCredentialsScopes: [],
    createdAt: now,
    updatedAt: now,
    name: cli ? "dongo CLI" : "Codex",
    uri: "https://dongo.so",
    redirectUris: cli ? [] : [CODEX_OAUTH_CALLBACK],
    tokenEndpointAuthMethod: "none",
    grantTypes: cli
      ? [DEVICE_CODE_GRANT_TYPE, "refresh_token"]
      : ["authorization_code", "refresh_token"],
    responseTypes: cli ? [] : ["code"],
    applicationType: "native",
    requirePKCE: true,
    skipConsent: false,
    enableEndSession: false,
    subjectType: "public",
    metadata: JSON.stringify({ official: true }),
  } as unknown as SchemaClient;
}

export async function ensureFirstPartyClient(
  adapter: OAuthAdapter,
  clientId: "dongo-cli" | typeof CODEX_OAUTH_CLIENT_ID,
): Promise<SchemaClient> {
  const existing = await adapter.findOne<SchemaClient>({
    model: "oauthClient",
    where: [{ field: "clientId", value: clientId }],
  });
  if (
    existing?.clientDiscoveryId === "dongo-first-party"
    || (clientId === "dongo-cli" && existing?.clientDiscoveryId === "dongo-static-cli")
  ) return existing;
  if (existing) throw new Error(`OAuth client ${clientId} is not owned by dongo`);
  return await adapter.create<SchemaClient>({
    model: "oauthClient",
    data: firstPartyClient(clientId) as unknown as Record<string, unknown>,
  });
}

export function firstPartyClientDiscovery(): OAuthProviderExtension["clientDiscovery"] {
  return {
    id: "dongo-first-party",
    matches: (clientId) =>
      clientId === "dongo-cli" || clientId === CODEX_OAUTH_CLIENT_ID,
    async resolve(ctx, clientId, existing) {
      if (clientId !== "dongo-cli" && clientId !== CODEX_OAUTH_CLIENT_ID) return null;
      if (
        existing?.clientDiscoveryId === "dongo-first-party"
        || (clientId === "dongo-cli" && existing?.clientDiscoveryId === "dongo-static-cli")
      ) return existing;
      if (existing) return null;
      return await ensureFirstPartyClient(ctx.context.adapter, clientId);
    },
  };
}
