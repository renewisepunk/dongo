import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { assertJsonSize, fail, requireString, stableStringify } from "./errors";
import { MAX_IDEMPOTENCY_KEY_LENGTH } from "./validators";

const IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export async function runIdempotent<T>(
  ctx: MutationCtx,
  options: {
    organizationId: Id<"organizations">;
    projectId: Id<"projects">;
    principalKey: string;
    operation: string;
    key: string;
    payload: unknown;
    now: number;
  },
  operation: () => Promise<T>,
): Promise<T> {
  const key = requireString(
    options.key,
    "idempotencyKey",
    MAX_IDEMPOTENCY_KEY_LENGTH,
  );
  const canonicalPayload = assertJsonSize(options.payload, 128 * 1_024);
  const existing = await ctx.db
    .query("idempotencyKeys")
    .withIndex("by_scope_operation_key", (query) =>
      query
        .eq("projectId", options.projectId)
        .eq("principalKey", options.principalKey)
        .eq("operation", options.operation)
        .eq("key", key),
    )
    .unique();

  if (existing && existing.expiresAt > options.now) {
    if (existing.canonicalPayload !== canonicalPayload) {
      fail(
        "idempotency_conflict",
        "The idempotency key was already used with a different payload",
      );
    }
    return JSON.parse(existing.resultJson) as T;
  }
  if (existing) await ctx.db.delete(existing._id);

  const result = await operation();
  const resultJson = stableStringify(result);
  if (new TextEncoder().encode(resultJson).byteLength > 16_384) {
    fail("validation", "Idempotent result is too large to cache safely");
  }
  await ctx.db.insert("idempotencyKeys", {
    organizationId: options.organizationId,
    projectId: options.projectId,
    principalKey: options.principalKey,
    operation: options.operation,
    key,
    canonicalPayload,
    resultJson,
    createdAt: options.now,
    expiresAt: options.now + IDEMPOTENCY_TTL_MS,
  });
  return result;
}
