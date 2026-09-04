import type {
  ParallelExecutionPolicy,
  ProjectConcurrencySnapshot,
} from "./project-data";

export const DEFAULT_PARALLEL_RUN_LIMIT = 4;
export const MIN_PARALLEL_RUN_LIMIT = 2;
export const MAX_PARALLEL_RUN_LIMIT = 8;

export function activitySignalState(
  status: "loading" | "ready" | "error",
  activeRunCount: number,
): "active" | "idle" | "unavailable" {
  if (status !== "ready") return "unavailable";
  return activeRunCount > 0 ? "active" : "idle";
}

export function parallelExecutionPolicy(
  enabled: boolean,
  maxConcurrentRuns = DEFAULT_PARALLEL_RUN_LIMIT,
): ParallelExecutionPolicy {
  return {
    enabled,
    maxConcurrentRuns: enabled
      ? Math.min(
          MAX_PARALLEL_RUN_LIMIT,
          Math.max(MIN_PARALLEL_RUN_LIMIT, Math.round(maxConcurrentRuns)),
        )
      : 1,
    requiresIsolatedWorkspaces: true,
  };
}

export function formatRunElapsed(elapsedMilliseconds: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMilliseconds / 1_000));
  if (seconds < 60) return "less than a minute";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m elapsed`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m elapsed` : `${hours}h elapsed`;
}

export function formatRunUpdateAge(updatedAt: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - updatedAt) / 1_000));
  if (seconds < 15) return "updated just now";
  if (seconds < 60) return `updated ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `updated ${hours}h ago`;
}

export function runActivityLabel(
  kind: ProjectConcurrencySnapshot["runs"][number]["activity"]["kind"],
): string {
  if (kind === "verification") return "Verifying";
  if (kind === "release") return "Releasing";
  if (kind === "waiting_for_owner") return "Needs you";
  if (kind === "waiting_for_resource") return "Resource wait";
  if (kind === "paused") return "Paused";
  if (kind === "process_exited") return "Process exited";
  return "Executing";
}

export function leaseHealthLabel(
  status: ProjectConcurrencySnapshot["runs"][number]["lease"]["status"],
): string {
  if (status === "healthy") return "Lease healthy";
  if (status === "expiring") return "Lease renewing";
  if (status === "released") return "Lease released";
  return "Lease expired";
}

export function workspaceLabel(
  run: Pick<
    ProjectConcurrencySnapshot["runs"][number],
    "hostCapabilities" | "workspace"
  >,
): string {
  if (run.workspace.kind === "worktree") {
    const detail = run.workspace.branch?.trim() || run.workspace.worktreeName?.trim();
    return detail ? `Worktree · ${detail}` : "Isolated workspace";
  }
  if (
    run.workspace.kind === "undisclosed" &&
    run.hostCapabilities.parallelExecution === "supported" &&
    run.hostCapabilities.worktreeIsolation === "supported"
  ) {
    return "Isolated workspace";
  }
  return "Workspace details unavailable";
}

export function hostFallbackLabel(
  run: Pick<ProjectConcurrencySnapshot["runs"][number], "hostCapabilities" | "workspace">,
): string | undefined {
  const capabilities = run.hostCapabilities;
  if (run.workspace.kind === "shared_checkout") {
    return "This run uses a shared checkout, so additional work stays serial.";
  }
  if (
    capabilities.parallelExecution === "supported" &&
    capabilities.worktreeIsolation === "supported"
  ) return undefined;
  if (
    capabilities.parallelExecution === "unsupported" ||
    capabilities.worktreeIsolation === "unsupported"
  ) return "This host continues serially because isolated parallel work is unsupported.";
  return "This host continues serially until it reports isolated-workspace support.";
}
