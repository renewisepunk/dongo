import { describe, expect, it } from "vitest";

import {
  activitySignalState,
  formatRunElapsed,
  formatRunUpdateAge,
  hostFallbackLabel,
  leaseHealthLabel,
  parallelExecutionPolicy,
  runActivityLabel,
  workspaceLabel,
} from "./parallel-execution";

describe("parallel execution presentation", () => {
  it("reports active, idle, and unavailable activity signal states truthfully", () => {
    expect(activitySignalState("ready", 2)).toBe("active");
    expect(activitySignalState("ready", 0)).toBe("idle");
    expect(activitySignalState("loading", 0)).toBe("unavailable");
    expect(activitySignalState("error", 2)).toBe("unavailable");
  });

  it("keeps single-agent mode safe and bounds the opt-in safety cap", () => {
    expect(parallelExecutionPolicy(false, 8)).toEqual({
      enabled: false,
      maxConcurrentRuns: 1,
      requiresIsolatedWorkspaces: true,
    });
    expect(parallelExecutionPolicy(true, 99).maxConcurrentRuns).toBe(8);
    expect(parallelExecutionPolicy(true, 0).maxConcurrentRuns).toBe(2);
  });

  it("formats elapsed time and lease health without implying host liveness", () => {
    expect(formatRunElapsed(22_000)).toBe("less than a minute");
    expect(formatRunElapsed(7_200_000)).toBe("2h elapsed");
    expect(leaseHealthLabel("healthy")).toBe("Lease healthy");
    expect(leaseHealthLabel("expiring")).toBe("Lease renewing");
    expect(formatRunUpdateAge(1_000, 31_000)).toBe("updated 30s ago");
    expect(formatRunUpdateAge(1_000, 7_201_000)).toBe("updated 2h ago");
    expect(runActivityLabel("verification")).toBe("Verifying");
    expect(runActivityLabel("waiting_for_resource")).toBe("Resource wait");
    expect(runActivityLabel("process_exited")).toBe("Process exited");
  });

  it("shows only safe workspace detail and truthful capability fallbacks", () => {
    expect(workspaceLabel({
      hostCapabilities: { parallelExecution: "supported", worktreeIsolation: "supported" },
      workspace: { kind: "worktree", worktreeName: "worker-a", branch: "codex/agent-grid" },
    })).toBe("Worktree · codex/agent-grid");
    expect(workspaceLabel({
      hostCapabilities: { parallelExecution: "supported", worktreeIsolation: "supported" },
      workspace: { kind: "undisclosed" },
    })).toBe("Isolated workspace");
    expect(workspaceLabel({
      hostCapabilities: { parallelExecution: "undisclosed", worktreeIsolation: "undisclosed" },
      workspace: { kind: "undisclosed" },
    })).toBe("Workspace details unavailable");
    expect(hostFallbackLabel({
      hostCapabilities: { parallelExecution: "undisclosed", worktreeIsolation: "undisclosed" },
      workspace: { kind: "undisclosed" },
    })).toContain("continues serially");
    expect(hostFallbackLabel({
      hostCapabilities: { parallelExecution: "supported", worktreeIsolation: "supported" },
      workspace: { kind: "shared_checkout" },
    })).toContain("shared checkout");
  });
});
