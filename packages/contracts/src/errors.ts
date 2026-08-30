export const domainErrorCodes = [
  "unauthorized",
  "forbidden",
  "insufficient_scope",
  "not_found",
  "validation",
  "revision_conflict",
  "claim_conflict",
  "lease_expired",
  "idempotency_conflict",
  "quota_exceeded",
  "upload_incomplete",
  "rate_limited",
  "internal",
] as const;

export type DomainErrorCode = (typeof domainErrorCodes)[number];

export type DomainError = {
  code: DomainErrorCode;
  message: string;
  retryable: boolean;
  details?: unknown;
};

export type ApiResult<T> =
  | { ok: true; data: T; requestId: string; apiVersion: "v1" }
  | { ok: false; error: DomainError; requestId: string };
