import { cimd } from "@better-auth/cimd";
import {
  DEVICE_CODE_GRANT_TYPE,
  oauthDeviceAuthorization,
  oauthProvider,
  type OAuthProviderExtension,
  type SchemaClient,
} from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { dongoHumanBridge } from "./bridge-plugin";
import type { AuthWorkerEnv } from "./env";
import {
  bindOAuthGrant,
  consentReferenceIdForProject,
  decodePinnedAccessToken,
  encodePinnedAccessToken,
  ACCESS_TOKEN_PREFIX,
  pinnedRefreshTokenHandlers,
  REFRESH_TOKEN_PREFIX,
  projectRefForGrant,
  providerGrantId,
  resolveOAuthGrant,
  type BindGrantInput,
  type PinnedGrantContext,
} from "./grant-binding";
import { createMetadataFetcher } from "./security";

const AGENT_SCOPES = [
  "dongo:work:read",
  "dongo:work:write",
  "dongo:attachments:read",
  "offline_access",
] as const;

function staticCliDiscovery(): OAuthProviderExtension["clientDiscovery"] {
  return {
    id: "dongo-static-cli",
    matches: (clientId) => clientId === "dongo-cli",
    async resolve(ctx, _clientId, existing) {
      if (existing?.clientDiscoveryId === "dongo-static-cli") return existing;
      if (existing) return null;
      const now = new Date();
      const client = {
        clientId: "dongo-cli",
        clientDiscoveryId: "dongo-static-cli",
        disabled: false,
        scopes: [...AGENT_SCOPES],
        clientCredentialsScopes: [],
        createdAt: now,
        updatedAt: now,
        name: "Dongo CLI",
        uri: "https://dongo.so",
        redirectUris: [],
        tokenEndpointAuthMethod: "none",
        grantTypes: [DEVICE_CODE_GRANT_TYPE, "refresh_token"],
        responseTypes: [],
        applicationType: "native",
        requirePKCE: true,
        skipConsent: false,
        enableEndSession: false,
        subjectType: "public",
        metadata: JSON.stringify({ official: true }),
      } as unknown as SchemaClient;
      const created = await ctx.context.adapter.create({
        model: "oauthClient",
        data: client,
      });
      return created as unknown as SchemaClient;
    },
  };
}

function exactResource(value: unknown): string[] {
  const resources = typeof value === "string"
    ? [value]
    : Array.isArray(value) && value.every((item) => typeof item === "string")
      ? value
      : [];
  if (resources.length !== 1) throw new Error("A single OAuth resource is required");
  return resources;
}

type TokenResponseInfo = {
  grantType: string;
  user?: Record<string, unknown> | null;
  scopes: readonly string[];
  metadata?: Record<string, unknown>;
  verificationValue?: {
    referenceId?: string;
    query?: unknown;
  };
};

function tokenPinning(env: AuthWorkerEnv) {
  let currentGrant: PinnedGrantContext | undefined;
  const refreshTokens = pinnedRefreshTokenHandlers(env.BETTER_AUTH_SECRET, {
    get: () => currentGrant,
    set: (grant) => {
      currentGrant = grant;
    },
  });

  const inIssuancePhase = async <T>(
    phase: string,
    operation: () => Promise<T>,
  ): Promise<T> => {
    try {
      return await operation();
    } catch (error) {
      console.error(JSON.stringify({
        event: "oauth_token_issuance_failure",
        phase,
        errorName: error instanceof Error ? error.name : "UnknownError",
      }));
      throw error;
    }
  };

  const initialGrant = async (info: TokenResponseInfo): Promise<PinnedGrantContext> => {
    const user = info.user as
      | (Record<string, unknown> & {
          id?: unknown;
          convexProfileId?: unknown;
          activeProjectRef?: unknown;
        })
      | null
      | undefined;
    if (
      !user ||
      typeof user.id !== "string" ||
      typeof user.convexProfileId !== "string"
    ) {
      throw new Error("Dongo token issuance requires a linked Convex user");
    }

    if (info.grantType === "refresh_token") {
      if (!currentGrant) throw new Error("Refresh token is not pinned to a Dongo grant");
      if (
        currentGrant.subject !== user.id ||
        currentGrant.profileId !== user.convexProfileId
      ) {
        throw new Error("Refresh token user does not match its Dongo grant");
      }
      const binding = await resolveOAuthGrant(env, currentGrant);
      return { ...currentGrant, scopes: [...info.scopes], binding };
    }

    const authorizationCode = info.grantType === "authorization_code";
    const deviceCode = info.grantType === DEVICE_CODE_GRANT_TYPE;
    if (!authorizationCode && !deviceCode) {
      throw new Error("Unsupported Dongo OAuth grant type");
    }
    const query = (info.verificationValue?.query ?? {}) as Record<string, unknown>;
    const clientId = deviceCode
      ? "dongo-cli"
      : typeof query.client_id === "string"
        ? query.client_id
        : "";
    const resources = deviceCode
      ? [`${env.PUBLIC_ORIGIN}/api/agent/v1`]
      : exactResource(query.resource);
    if (!clientId) throw new Error("OAuth client identity is missing");
    const activeProjectRef = typeof user.activeProjectRef === "string"
      ? user.activeProjectRef
      : undefined;
    const projectRef = projectRefForGrant({
      publicOrigin: env.PUBLIC_ORIGIN,
      resources,
      activeProjectRef,
      referenceId: info.verificationValue?.referenceId,
    });
    const providerId = await providerGrantId({
      referenceId: info.verificationValue?.referenceId,
      issuer: env.AUTH_ISSUER,
      subject: user.id,
      clientId,
      projectRef,
      resource: resources[0]!,
    });
    const kind: BindGrantInput["kind"] = deviceCode ? "cli" : "mcp";
    const label = deviceCode
      ? "Dongo CLI"
      : typeof info.metadata?.client_name === "string"
        ? info.metadata.client_name
        : "MCP host";
    const grantInput: BindGrantInput = {
      providerIssuer: env.AUTH_ISSUER,
      providerGrantId: providerId,
      subject: user.id,
      clientId,
      label,
      resource: resources[0]!,
      scopes: [...info.scopes],
      kind,
      profileId: user.convexProfileId,
      projectRef,
    };
    const binding = await bindOAuthGrant(env, grantInput);
    return { ...grantInput, binding };
  };

  return {
    async customTokenResponseFields(info: TokenResponseInfo) {
      return await inIssuancePhase("bind_grant", async () => {
        currentGrant = await initialGrant(info);
        return {};
      });
    },
    async generateOpaqueAccessToken() {
      return await inIssuancePhase("access_token", async () => {
        if (!currentGrant) throw new Error("Access token grant context is missing");
        return await encodePinnedAccessToken(env.BETTER_AUTH_SECRET, currentGrant);
      });
    },
    async generateRefreshToken() {
      return await inIssuancePhase("refresh_token", refreshTokens.generate);
    },
    formatRefreshToken: {
      encrypt: refreshTokens.encrypt,
      async decrypt(token: string) {
        return await refreshTokens.decrypt(token);
      },
    },
    claims: {
      async accessToken(input: Parameters<
        NonNullable<NonNullable<OAuthProviderExtension["claims"]>["accessToken"]>
      >[0]) {
        const token = (input.ctx.body as { token?: unknown } | undefined)?.token;
        if (typeof token !== "string") throw new Error("Introspection token is missing");
        const pinned = await decodePinnedAccessToken(env.BETTER_AUTH_SECRET, token);
        const resources = exactResource(input.resources);
        if (
          pinned.subject !== input.user?.id ||
          pinned.clientId !== input.client.clientId ||
          pinned.resource !== resources[0] ||
          pinned.scopes.length !== input.scopes.length ||
          pinned.scopes.some((scope) => !input.scopes.includes(scope))
        ) {
          throw new Error("Opaque token does not match its pinned OAuth grant");
        }
        const binding = await resolveOAuthGrant(env, pinned);
        return {
          issuer: env.AUTH_ISSUER,
          grantId: binding.oauthBindingId,
          installationId: binding.installationId,
          installationActorId: binding.installationActorId,
          organizationId: binding.organizationId,
          projectId: binding.projectId,
          projectRef: binding.projectRef,
        };
      },
    } satisfies OAuthProviderExtension["claims"],
  };
}

function parseSuffixes(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function createAuthorizationServer(env: AuthWorkerEnv) {
  const metadataSuffixes = parseSuffixes(env.CIMD_ALLOWED_HOST_SUFFIXES);
  const staticClient = staticCliDiscovery();
  const pinning = tokenPinning(env);
  return betterAuth({
    appName: "Dongo",
    baseURL: env.AUTH_ISSUER,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    database: env.AUTH_DB,
    trustedOrigins: [env.PUBLIC_ORIGIN],
    user: {
      additionalFields: {
        convexProfileId: {
          type: "string",
          required: false,
          input: false,
        },
        activeProjectRef: {
          type: "string",
          required: false,
          input: false,
        },
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
    },
    advanced: {
      useSecureCookies: true,
      database: { joins: false },
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip"],
        ipv6Subnet: 64,
      },
    },
    plugins: [
      oauthProvider({
        // Better Auth requires recoverable client secrets when JWT access-token
        // mode is disabled because confidential-client ID tokens use HS256.
        // Access and refresh tokens remain opaque and hashed independently.
        disableJwtPlugin: true,
        storeClientSecret: "encrypted",
        prefix: {
          opaqueAccessToken: ACCESS_TOKEN_PREFIX,
          refreshToken: REFRESH_TOKEN_PREFIX,
        },
        generateOpaqueAccessToken: pinning.generateOpaqueAccessToken,
        generateRefreshToken: pinning.generateRefreshToken,
        formatRefreshToken: pinning.formatRefreshToken,
        customTokenResponseFields: pinning.customTokenResponseFields,
        loginPage: "/login",
        consentPage: "/oauth/consent",
        scopes: [...AGENT_SCOPES],
        resources: [
          {
            identifier: `${env.PUBLIC_ORIGIN}/api/agent/v1`,
            name: "Dongo agent API",
            accessTokenTtl: 600,
            refreshTokenTtl: 30 * 24 * 60 * 60,
            allowedScopes: [...AGENT_SCOPES],
          },
        ],
        resourceSeedMode: "insertOnly",
        enforcePerClientResources: false,
        accessTokenExpiresIn: 600,
        refreshTokenExpiresIn: 30 * 24 * 60 * 60,
        refreshTokenReuseInterval: 0,
        codeExpiresIn: 300,
        rateLimit: {
          // A device client polls every five seconds. Keep the token endpoint
          // bounded while leaving room for the independently authenticated
          // CLI, Codex, Claude, and inspector flows in the compatibility gate.
          token: { window: 60, max: 60 },
        },
        grantTypes: [
          "authorization_code",
          "refresh_token",
          DEVICE_CODE_GRANT_TYPE,
        ],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationDefaultScopes: ["dongo:work:read"],
        clientRegistrationAllowedScopes: [
          "dongo:work:write",
          "dongo:attachments:read",
          "offline_access",
        ],
        clientRegistrationRequirePKCE: true,
        clientPrivileges: async () => false,
        resourcePrivileges: async () => false,
        postLogin: {
          page: "/oauth/project",
          shouldRedirect: async ({ user }) =>
            typeof (user as { activeProjectRef?: unknown }).activeProjectRef !==
            "string",
          consentReferenceId: async ({ user }) => {
            const projectRef = (user as { activeProjectRef?: unknown })
              .activeProjectRef;
            if (
              typeof projectRef !== "string" ||
              !/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(projectRef)
            ) {
              throw new Error("Select a Dongo project before authorizing");
            }
            // Better Auth invokes this callback once when it stores consent and
            // again when it immediately checks that consent. The reference must
            // therefore be stable for this user/client/project tuple. The
            // provider grant ID separately includes the client identity.
            return consentReferenceIdForProject(projectRef);
          },
        },
        extensions: [
          { clientDiscovery: staticClient },
          { claims: pinning.claims },
        ],
      }),
      oauthDeviceAuthorization({
        verificationUri: `${env.PUBLIC_ORIGIN}/device`,
        expiresIn: "10m",
        interval: "5s",
        userCodeLength: 8,
        deviceCodeLength: 48,
      }),
      cimd({
        fetchClientMetadataResource: createMetadataFetcher(metadataSuffixes),
        metadataProfile: "mcp-2026-07-28",
        metadataRevalidationInterval: "10m",
        maxCacheEntries: 1_000,
        isMetadataDocumentUrlAllowed: (url) =>
          metadataSuffixes.some((suffix) => {
            const host = new URL(url).hostname.toLowerCase();
            return host === suffix || host.endsWith(`.${suffix}`);
          }),
      }),
      dongoHumanBridge(env),
    ],
  });
}
