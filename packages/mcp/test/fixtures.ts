import { operationRegistry } from "@dongo/contracts";
import {
  OAuthError,
  OAuthErrorCode,
  type OAuthMetadata,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  DONGO_OPERATION_NAMES,
  type ContractOperationRegistry,
  type ContractSchema,
  type DongoMcpGatewayOptions,
  type DongoOperationName,
  type DongoScope,
  type DongoVerifiedAuthInfo,
  type OperationExecutionContext,
  type OperationExecutionResult,
} from "../src/index.js";

export const PUBLIC_ORIGIN = new URL("https://dongo.example/");
export const PROJECT_REF = "project_ref_123";
export const MCP_RESOURCE = new URL(`/p/${PROJECT_REF}/mcp`, PUBLIC_ORIGIN);
export const ISSUER = "https://auth.example/";

export const OAUTH_METADATA = {
  issuer: ISSUER,
  authorization_endpoint: "https://auth.example/authorize",
  token_endpoint: "https://auth.example/token",
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"],
  client_id_metadata_document_supported: true,
} as OAuthMetadata;

function inputSchema(operation: DongoOperationName): ContractSchema {
  const canonical = operationRegistry[operation];
  const shape: Record<string, z.ZodType> = {};
  if (canonical.readOnly === false) {
    shape.idempotencyKey = z.string().min(1);
  }
  if (operation === "session_start") {
    shape.externalSessionId = z.string().min(1);
  }
  if (operation === "get_updates") {
    shape.cursor = z.number().int().nonnegative().optional();
    shape.waitSeconds = z.number().int().min(0).max(20).optional();
  }
  return z.object(shape).strict() as unknown as ContractSchema;
}

const outputSchema = z
  .object({
    operation: z.string(),
    authorizationForwarded: z.boolean(),
  })
  .strict() as unknown as ContractSchema;

export function fixtureContracts(): ContractOperationRegistry {
  return Object.fromEntries(
    DONGO_OPERATION_NAMES.map((operation) => [
      operation,
      { inputSchema: inputSchema(operation), outputSchema },
    ]),
  ) as ContractOperationRegistry;
}

export interface GatewayFixture {
  readonly options: DongoMcpGatewayOptions;
  readonly calls: Array<{
    operation: DongoOperationName;
    input: Readonly<Record<string, unknown>>;
    context: OperationExecutionContext;
  }>;
}

export function gatewayFixture(input?: {
  readonly tokenScopes?: readonly DongoScope[];
  readonly tokenResource?: URL;
  readonly tokenIssuer?: string;
  readonly tokenProjectRef?: string;
  readonly expired?: boolean;
  readonly revoked?: boolean;
  readonly ready?: boolean;
  readonly rateLimited?: boolean;
}): GatewayFixture {
  const calls: GatewayFixture["calls"] = [];
  const scopes = input?.tokenScopes ?? [
    "dongo:work:read",
    "dongo:work:write",
    "dongo:attachments:read",
  ];
  const verifier = {
    async verifyAccessToken(token: string): Promise<DongoVerifiedAuthInfo> {
      if (token !== "fixture-access-token" || input?.revoked === true) {
        throw new OAuthError(OAuthErrorCode.InvalidToken, "Invalid fixture token");
      }
      return {
        token,
        clientId: "fixture-client",
        scopes: [...scopes],
        expiresAt:
          Math.floor(Date.now() / 1000) + (input?.expired === true ? -30 : 300),
        resource: input?.tokenResource ?? MCP_RESOURCE,
        extra: {
          issuer: input?.tokenIssuer ?? ISSUER,
          projectRef: input?.tokenProjectRef ?? PROJECT_REF,
          projectId: "project-internal-id",
          organizationId: "organization-internal-id",
          grantId: "grant-id",
          installationId: "installation-id",
          installationActorId: "installation-actor-id",
        },
      };
    },
  };

  return {
    calls,
    options: {
      publicOrigin: PUBLIC_ORIGIN,
      authorizationServerMetadata: OAUTH_METADATA,
      allowedHostnames: [PUBLIC_ORIGIN.hostname],
      allowedOrigins: [PUBLIC_ORIGIN.hostname],
      catalog: [],
      tokenVerifier: verifier,
      operationExecutor: {
        async execute(
          operation,
          operationInput,
          context,
        ): Promise<OperationExecutionResult> {
          calls.push({ operation, input: operationInput, context });
          return {
            ok: true,
            data: {
              operation,
              authorizationForwarded: "token" in context,
            },
          };
        },
      },
      rateLimiter: {
        async check() {
          return input?.rateLimited
            ? { allowed: false, retryAfterSeconds: 17 }
            : { allowed: true };
        },
      },
      readiness: {
        async isReady() {
          return input?.ready ?? true;
        },
      },
      limits: {
        maxRequestBytes: 32 * 1024,
        maxResultBytes: 32 * 1024,
        maxTextBytes: 4 * 1024,
        maxErrorDetailsBytes: 4 * 1024,
        operationTimeoutMs: 2_000,
      },
      serverName: "dongo-fixture",
      serverVersion: "test",
    },
  };
}

export function authenticatedRequest(
  path = MCP_RESOURCE.pathname,
  init: RequestInit = {},
): Request {
  const headers = new Headers(init.headers);
  headers.set("host", PUBLIC_ORIGIN.host);
  headers.set("authorization", "Bearer fixture-access-token");
  return new Request(new URL(path, PUBLIC_ORIGIN), { ...init, headers });
}

export function unauthenticatedRequest(
  path = MCP_RESOURCE.pathname,
  init: RequestInit = {},
): Request {
  const headers = new Headers(init.headers);
  headers.set("host", PUBLIC_ORIGIN.host);
  return new Request(new URL(path, PUBLIC_ORIGIN), { ...init, headers });
}
