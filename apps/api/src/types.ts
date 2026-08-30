import type {
  DongoDomainError,
  DongoInstallationPrincipal,
  DongoOperationName,
  JsonRecord,
  OperationExecutionResult,
} from "@dongo/mcp";

export type {
  DongoDomainError,
  DongoInstallationPrincipal,
  DongoOperationName,
  JsonRecord,
  OperationExecutionResult,
};

export interface ApiTokenVerifier {
  verifyAccessToken(
    token: string,
    signal: AbortSignal,
  ): Promise<DongoInstallationPrincipal>;
}

export interface ApiOperationExecutor {
  execute(
    operation: DongoOperationName,
    input: JsonRecord,
    context: {
      readonly principal: DongoInstallationPrincipal;
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
