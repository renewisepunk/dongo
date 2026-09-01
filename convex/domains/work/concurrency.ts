import { v } from "convex/values";
import type { Doc } from "../../_generated/dataModel";
import { fail } from "../../lib/errors";

export const DEFAULT_MAX_CONCURRENT_RUNS = 4;
export const MIN_MAX_CONCURRENT_RUNS = 2;
export const MAX_MAX_CONCURRENT_RUNS = 8;

export const hostCapabilitiesValidator = v.object({
  parallelExecution: v.union(v.literal("supported"), v.literal("unsupported")),
  worktreeIsolation: v.union(v.literal("supported"), v.literal("unsupported")),
});

export const workspaceValidator = v.object({
  kind: v.union(
    v.literal("worktree"),
    v.literal("shared_checkout"),
    v.literal("undisclosed"),
  ),
  worktreeName: v.optional(v.string()),
  branch: v.optional(v.string()),
});

export type HostCapabilitiesInput = {
  parallelExecution: "supported" | "unsupported";
  worktreeIsolation: "supported" | "unsupported";
};

export type WorkspaceInput = {
  kind: "worktree" | "shared_checkout" | "undisclosed";
  worktreeName?: string;
  branch?: string;
};

export function parallelExecutionPolicy(
  project: Pick<Doc<"projects">, "parallelExecutionEnabled" | "maxConcurrentRuns">,
) {
  const enabled = project.parallelExecutionEnabled === true;
  const configured = project.maxConcurrentRuns ?? DEFAULT_MAX_CONCURRENT_RUNS;
  const maxConcurrentRuns = enabled ? configured : 1;
  return {
    enabled,
    maxConcurrentRuns,
    requiresIsolatedWorkspaces: true as const,
  };
}

export function normalizeParallelExecutionSettings(input: {
  enabled: boolean;
  maxConcurrentRuns: number;
  requiresIsolatedWorkspaces?: true;
}) {
  if (!input.enabled && input.maxConcurrentRuns === 1) {
    return {
      enabled: false,
      maxConcurrentRuns: DEFAULT_MAX_CONCURRENT_RUNS,
      requiresIsolatedWorkspaces: true as const,
    };
  }
  if (
    !Number.isSafeInteger(input.maxConcurrentRuns) ||
    input.maxConcurrentRuns < MIN_MAX_CONCURRENT_RUNS ||
    input.maxConcurrentRuns > MAX_MAX_CONCURRENT_RUNS
  ) {
    fail(
      "validation",
      `parallelExecution.maxConcurrentRuns must be an integer from ${MIN_MAX_CONCURRENT_RUNS} to ${MAX_MAX_CONCURRENT_RUNS}`,
    );
  }
  return {
    enabled: input.enabled,
    maxConcurrentRuns: input.maxConcurrentRuns,
    requiresIsolatedWorkspaces: true as const,
  };
}

function safeOptionalLabel(
  value: string | undefined,
  field: "worktreeName" | "branch",
): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > 240) {
    fail("validation", `workspace.${field} exceeds 240 characters`);
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(normalized)) {
    fail("validation", `workspace.${field} must not be a URL`);
  }
  if (/^(?:\/|\\|[A-Za-z]:[\\/])/u.test(normalized)) {
    fail("validation", `workspace.${field} must not be an absolute path`);
  }
  if (/\p{Cc}/u.test(normalized)) {
    fail("validation", `workspace.${field} contains control characters`);
  }
  if (field === "worktreeName" && /[\\/]/u.test(normalized)) {
    fail("validation", "workspace.worktreeName must be a label, not a path");
  }
  return normalized;
}

export function normalizeWorkspace(
  workspace: WorkspaceInput | undefined,
): WorkspaceInput {
  const kind = workspace?.kind ?? "undisclosed";
  const worktreeName = safeOptionalLabel(workspace?.worktreeName, "worktreeName");
  const branch = safeOptionalLabel(workspace?.branch, "branch");
  if (kind !== "worktree" && worktreeName !== undefined) {
    fail("validation", "workspace.worktreeName requires workspace.kind worktree");
  }
  return { kind, worktreeName, branch };
}

export function capabilityState(
  value: "supported" | "unsupported" | undefined,
): "supported" | "unsupported" | "undisclosed" {
  return value ?? "undisclosed";
}
