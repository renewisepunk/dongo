import { describe, expect, it } from "vitest";

import type { RunnerRegistration, RunnerSnapshot } from "./project-data";
import { intakeRunnerEligibility } from "./runner-eligibility";

const now = 1_800_000_000_000;

function runner(overrides: Partial<RunnerRegistration> = {}): RunnerRegistration {
  return {
    id: "runner-1",
    projectId: "project-1",
    installationId: "installation-1",
    label: "Studio Mac",
    platform: "darwin",
    version: "0.2.15",
    harnesses: ["codex"],
    approvalMode: "automatic",
    status: "active",
    lastSeenAt: now,
    waitingUntil: now + 20_000,
    createdAt: now - 60_000,
    updatedAt: now,
    ...overrides,
  };
}

function snapshot(overrides: Partial<RunnerSnapshot> = {}): RunnerSnapshot {
  return {
    registrations: [],
    jobs: [],
    automaticIntake: { enabled: false, revision: 0 },
    serverTime: now,
    ...overrides,
  };
}

describe("intakeRunnerEligibility", () => {
  it("distinguishes no runner from disabled automatic pickup", () => {
    expect(intakeRunnerEligibility("intake-1", snapshot()).code).toBe("no_runner");
    expect(intakeRunnerEligibility("intake-1", snapshot({ registrations: [runner()] })).code)
      .toBe("automatic_pickup_disabled");
  });

  it("explains stale runners and incompatible harnesses", () => {
    const offline = runner({ lastSeenAt: now - 8 * 60_000, waitingUntil: now - 1 });
    expect(intakeRunnerEligibility("intake-1", snapshot({
      registrations: [offline],
      automaticIntake: { enabled: true, revision: 1, registrationId: offline.id, harness: "codex" },
    })).label).toBe("Studio Mac is offline");

    const incompatible = runner({ harnesses: ["claude"] });
    expect(intakeRunnerEligibility("intake-1", snapshot({
      registrations: [incompatible],
      automaticIntake: { enabled: true, revision: 1, registrationId: incompatible.id, harness: "codex" },
    })).code).toBe("incompatible_harness");
  });

  it("shows the state of an active intake job", () => {
    const registration = runner({ approvalMode: "ask" });
    const result = intakeRunnerEligibility("intake-1", snapshot({
      registrations: [registration],
      jobs: [{
        id: "job-1",
        projectId: "project-1",
        kind: "intake",
        intakeId: "intake-1",
        targetRegistrationId: registration.id,
        harness: "codex",
        state: "awaiting_local_approval",
        revision: 2,
        requestedAt: now - 2_000,
        expiresAt: now + 60_000,
        updatedAt: now,
      }],
      automaticIntake: { enabled: true, revision: 1, registrationId: registration.id, harness: "codex" },
    }));
    expect(result.code).toBe("awaiting_local_approval");
    expect(result.label).toContain("Studio Mac");
  });

  it("reports capacity when the configured automatic runner is healthy", () => {
    const registration = runner();
    const result = intakeRunnerEligibility("intake-1", snapshot({
      registrations: [registration],
      automaticIntake: { enabled: true, revision: 1, registrationId: registration.id, harness: "codex" },
    }), {
      serverTime: now,
      policy: { enabled: true, maxConcurrentRuns: 6, requiresIsolatedWorkspaces: true },
      capacity: { activeRuns: 6, maxConcurrentRuns: 6, remaining: 0 },
      runs: [],
    });
    expect(result.label).toBe("all 6 agent slots are busy");
  });

  it("keeps a safe terminal runner failure visible", () => {
    const registration = runner();
    const result = intakeRunnerEligibility("intake-1", snapshot({
      registrations: [registration],
      jobs: [{
        id: "job-failed",
        projectId: "project-1",
        kind: "intake",
        intakeId: "intake-1",
        registrationId: registration.id,
        harness: "codex",
        state: "failed",
        revision: 3,
        safeMessage: "The Codex executable is unavailable.",
        requestedAt: now - 60_000,
        expiresAt: now + 60_000,
        updatedAt: now,
        terminalAt: now,
      }],
      automaticIntake: { enabled: true, revision: 1, registrationId: registration.id, harness: "codex" },
    }));
    expect(result.code).toBe("failed");
    expect(result.detail).toBe("The Codex executable is unavailable.");
  });
});
