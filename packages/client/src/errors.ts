import type { ApiErrorCode } from "./types.ts";

export class DongoClientError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly requestId?: string;
  readonly status?: number;
  readonly details?: unknown;
  readonly retryAfterMs?: number;

  constructor(options: {
    code: ApiErrorCode;
    message: string;
    retryable?: boolean;
    requestId?: string;
    status?: number;
    details?: unknown;
    retryAfterMs?: number;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "DongoClientError";
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.requestId = options.requestId;
    this.status = options.status;
    this.details = options.details;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export function isDongoClientError(value: unknown): value is DongoClientError {
  return value instanceof DongoClientError;
}
