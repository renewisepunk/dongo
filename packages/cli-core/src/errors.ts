export type CliErrorCode =
  | "validation"
  | "authentication_required"
  | "authorization_denied"
  | "authorization_expired"
  | "cancelled"
  | "insufficient_scope"
  | "conflict"
  | "temporary_failure"
  | "secure_store_unavailable"
  | "repository_not_found"
  | "unsafe_path"
  | "internal";

export class CliCoreError extends Error {
  readonly code: CliErrorCode | string;
  readonly retryable: boolean;
  readonly exitCode: number;
  readonly details?: unknown;

  constructor(options: {
    code: CliErrorCode | string;
    message: string;
    retryable?: boolean;
    exitCode?: number;
    details?: unknown;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "CliCoreError";
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.exitCode = options.exitCode ?? 1;
    this.details = options.details;
  }
}
