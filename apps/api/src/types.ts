import type { OperationName } from "@dongo/contracts";
import type {
  DongoDomainError,
  DongoInstallationPrincipal,
  JsonRecord,
  OperationExecutionResult,
} from "@dongo/mcp";

export type {
  DongoDomainError,
  DongoInstallationPrincipal,
  JsonRecord,
  OperationExecutionResult,
};
export type DongoOperationName = OperationName;

export type ApiInstallationPrincipal = Omit<
  DongoInstallationPrincipal,
  "grantId" | "issuer"
> & {
  readonly grantId?: string;
  readonly serviceCredentialId?: string;
  readonly issuer?: string;
};

export interface ApiTokenVerifier {
  verifyAccessToken(
    token: string,
    signal: AbortSignal,
  ): Promise<ApiInstallationPrincipal>;
}

export interface ApiOperationExecutor {
  execute(
    operation: DongoOperationName,
    input: JsonRecord,
    context: {
      readonly principal: ApiInstallationPrincipal;
      readonly requestId: string;
      readonly signal: AbortSignal;
    },
  ): Promise<OperationExecutionResult>;
}

export interface ApiRateLimiter {
  check(input: {
    readonly projectRef: string;
    readonly clientId: string;
  }): Promise<{ readonly allowed: boolean; readonly retryAfterSeconds?: number }>;
}

export class ApiBoundaryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryable = false,
    readonly details?: unknown,
  ) {
    super(message);
  }
}
