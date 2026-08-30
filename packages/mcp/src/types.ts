import type {
  AuthInfo,
  ContentBlock,
  OAuthMetadata,
  StandardSchemaWithJSON,
  ToolAnnotations,
} from "@modelcontextprotocol/server";
import { operationRegistry } from "@dongo/contracts";
import type {
  AgentScope,
  DomainErrorCode,
  OperationName,
} from "@dongo/contracts";

export const DONGO_OPERATION_NAMES = Object.freeze(
  Object.keys(operationRegistry) as OperationName[],
);

export type DongoOperationName = OperationName;
export type DongoScope = Exclude<AgentScope, "offline_access">;

export type JsonRecord = Record<string, unknown>;
export type ContractSchema = StandardSchemaWithJSON<unknown, JsonRecord>;

/** Structural schema boundary implemented by the canonical contracts package. */
export interface ContractOperation {
  readonly inputSchema: ContractSchema;
  readonly outputSchema: ContractSchema;
}

export type ContractOperationRegistry = Readonly<
  Record<DongoOperationName, ContractOperation>
>;

export interface ToolPolicy {
  readonly operation: DongoOperationName;
  readonly toolName: `dongo_${DongoOperationName}`;
  readonly title: string;
  readonly description: string;
  readonly requiredScopes: readonly DongoScope[];
  readonly effect: "read" | "write";
  readonly annotations: ToolAnnotations;
  readonly sensitiveTextFallback?: boolean;
}

export interface DongoToolDescriptor extends ToolPolicy, ContractOperation {
  readonly renderContent?: (
    output: JsonRecord,
    requestId: string,
  ) => readonly ContentBlock[];
}

export interface DongoInstallationPrincipal {
  readonly clientId: string;
  /** Convex `oauthBindings` document ID, never a provider grant string. */
  readonly grantId: string;
  readonly installationId: string;
  readonly installationActorId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly projectRef: string;
  readonly issuer: string;
  readonly resource: string;
  readonly scopes: readonly string[];
}

export interface OperationExecutionContext {
  readonly principal: DongoInstallationPrincipal;
  readonly projectRef: string;
  readonly requestId: string;
  readonly signal: AbortSignal;
}

export type DongoDomainErrorCode =
  | DomainErrorCode
  | "request_cancelled"
  | "result_too_large"
  | "temporarily_unavailable"
  | (string & {});

export interface DongoDomainError {
  readonly code: DongoDomainErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly details?: unknown;
}

export type OperationExecutionResult =
  | {
      readonly ok: true;
      readonly data: JsonRecord;
      readonly requestId?: string;
    }
  | {
      readonly ok: false;
      readonly error: DongoDomainError;
      readonly requestId?: string;
    };

export interface OperationExecutor {
  execute(
    operation: DongoOperationName,
    input: JsonRecord,
    context: OperationExecutionContext,
  ): Promise<OperationExecutionResult>;
}

export interface DongoVerifiedTokenClaims extends Record<string, unknown> {
  readonly issuer: string;
  /** Convex `oauthBindings` document ID, bound during OAuth issuance. */
  readonly grantId: string;
  readonly installationId: string;
  readonly installationActorId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly projectRef: string;
}

export type DongoVerifiedAuthInfo = Omit<
  AuthInfo,
  "expiresAt" | "extra" | "resource"
> & {
  readonly expiresAt: number;
  readonly resource: URL;
  readonly extra: DongoVerifiedTokenClaims;
};

export interface DongoTokenVerificationContext {
  readonly expectedIssuer: string;
  readonly expectedResource: URL;
  readonly projectRef: string;
  readonly signal?: AbortSignal;
}

export interface DongoTokenVerifier {
  /**
   * The provider validates signature/introspection, expiry, exact resource,
   * client/grant state, and revocation before returning project-bound claims.
   */
  verifyAccessToken(
    token: string,
    context: DongoTokenVerificationContext,
  ): Promise<DongoVerifiedAuthInfo>;
}

export interface RateLimitInput {
  readonly kind: "mcp_request";
  readonly projectRef: string;
  readonly requestId: string;
  readonly clientId?: string;
  readonly httpMethod: string;
  readonly mcpMethod?: string;
  readonly mcpName?: string;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds?: number;
}

export interface DongoRateLimiter {
  check(input: RateLimitInput): Promise<RateLimitDecision>;
}

export interface DongoReadinessProbe {
  isReady(): Promise<boolean>;
}

export interface DongoLogger {
  info(event: Readonly<Record<string, unknown>>): void;
  error(event: Readonly<Record<string, unknown>>): void;
}

export interface DongoMcpLimits {
  readonly maxRequestBytes: number;
  readonly maxResultBytes: number;
  readonly maxTextBytes: number;
  readonly maxErrorDetailsBytes: number;
  readonly operationTimeoutMs: number;
}

export interface DongoMcpGatewayOptions {
  readonly publicOrigin: URL;
  readonly authorizationServerMetadata: OAuthMetadata;
  readonly serviceDocumentationUrl?: URL;
  readonly allowedHostnames: readonly string[];
  readonly allowedOrigins: readonly string[];
  readonly catalog: readonly DongoToolDescriptor[];
  readonly tokenVerifier: DongoTokenVerifier;
  readonly operationExecutor: OperationExecutor;
  readonly rateLimiter: DongoRateLimiter;
  readonly readiness: DongoReadinessProbe;
  readonly logger?: DongoLogger;
  readonly limits?: Partial<DongoMcpLimits>;
  readonly serverName?: string;
  readonly serverVersion?: string;
}

export interface UnavailableDongoMcpWorkerOptions {
  readonly publicOrigin: URL;
  readonly authorizationServerMetadata?: OAuthMetadata;
  readonly serviceDocumentationUrl?: URL;
  readonly allowedHostnames: readonly string[];
  readonly allowedOrigins: readonly string[];
}

export interface DongoMcpWorker {
  fetch(request: Request): Promise<Response>;
}
