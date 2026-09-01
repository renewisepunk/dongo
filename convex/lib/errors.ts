import { ConvexError } from "convex/values";
import type { Value } from "convex/values";

export type DongoErrorCode =
  | "unauthorized"
  | "forbidden"
  | "insufficient_scope"
  | "not_found"
  | "validation"
  | "revision_conflict"
  | "claim_conflict"
  | "parallel_execution_unavailable"
  | "concurrency_limit"
  | "session_work_limit"
  | "lease_expired"
  | "idempotency_conflict"
  | "already_resolved"
  | "identifier_conflict"
  | "identifier_exhausted"
  | "plan_limit"
  | "project_archived"
  | "invalid_transition"
  | "quota_exceeded"
  | "upload_incomplete"
  | "rate_limited"
  | "internal"
  | "development_bootstrap_disabled";

export function fail(
  code: DongoErrorCode,
  message: string,
  details?: Record<string, Value>,
): never {
  throw new ConvexError({ code, message, details });
}

export function requireString(
  value: string,
  field: string,
  maxLength: number,
): string {
  const normalized = value.trim();
  if (!normalized) fail("validation", `${field} is required`);
  if (normalized.length > maxLength) {
    fail("validation", `${field} exceeds ${maxLength} characters`);
  }
  return normalized;
}

export function optionalString(
  value: string | undefined,
  field: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength) {
    fail("validation", `${field} exceeds ${maxLength} characters`);
  }
  return normalized;
}

export function assertExpectedRevision(
  actual: number,
  expected: number,
): void {
  if (actual !== expected) {
    fail("revision_conflict", "The work item changed since it was read", {
      expectedRevision: expected,
      currentRevision: actual,
    });
  }
}

export function assertJsonSize(value: unknown, maxBytes = 16_384): string {
  const encoded = stableStringify(value);
  if (new TextEncoder().encode(encoded).byteLength > maxBytes) {
    fail("validation", "Structured payload is too large");
  }
  return encoded;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJson(child)]),
    );
  }
  return value;
}
