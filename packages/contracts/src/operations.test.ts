import { describe, expect, it } from "vitest";
import { mcpToolNames, operationRegistry } from "./operations.ts";
import {
  actorSummarySchema,
  projectSummarySchema,
  runSchema,
} from "./schemas.ts";
import { domainErrorCodes } from "./errors.ts";

describe("operation registry", () => {
  it("uses one project-safe v1 path and one MCP name per operation", () => {
    const operations = Object.values(operationRegistry);
    expect(new Set(operations.map((operation) => operation.path)).size).toBe(operations.length);
    expect(mcpToolNames).toHaveLength(
      operations.filter((operation) => operation.mcpExposed).length,
    );
    expect(operations.every((operation) => operation.path.startsWith("/api/agent/v1/"))).toBe(true);
  });

  it("never treats annotations as authorization", () => {
    for (const operation of Object.values(operationRegistry)) {
      expect(operation.scopes.length).toBeGreaterThan(0);
      expect(operation.destructive).toBe(false);
      if (!operation.readOnly) expect(operation.scopes).toContain("dongo:work:write");
    }
  });

  it("keeps agent identity distinct from connection transport", () => {
    expect(actorSummarySchema.safeParse({
      id: "actor-1",
      kind: "installation",
      displayName: "Claude Code",
      transport: "mcp",
      transportLabel: "Claude Code",
      machineLabel: "Studio Mac",
    }).success).toBe(true);
    expect(actorSummarySchema.safeParse({
      id: "actor-1",
      kind: "installation",
      displayName: "Agent",
      transport: "websocket",
    }).success).toBe(false);
  });

  it("publishes compact identifiers, retained aliases, and exhaustion errors", () => {
    expect(domainErrorCodes).toContain("identifier_conflict");
    expect(domainErrorCodes).toContain("identifier_exhausted");
    expect(operationRegistry.get_work.outputSchema.safeParse({
      id: "work-1",
      projectId: "project-1",
      identifier: "dong012",
      legacyIdentifiers: ["DONGO-12"],
      sequence: 12,
      title: "Compact identifiers",
      goal: "Keep old links working.",
      state: "ready",
      orderKey: "12",
      revision: 1,
      sourceIntakeIds: [],
      artifacts: [],
      conversation: [],
      createdAt: 1,
      updatedAt: 1,
    }).success).toBe(true);
  });

  it("publishes bounded direct parent and child Work relationships", () => {
    const relationship = {
      id: "work-2",
      identifier: "dong002",
      title: "Direct child",
      state: "ready" as const,
    };
    const work = {
      id: "work-1",
      projectId: "project-1",
      identifier: "dong001",
      sequence: 1,
      title: "Parent work",
      goal: "Break the work into direct children.",
      state: "ready" as const,
      orderKey: "1",
      revision: 1,
      sourceIntakeIds: [],
      childWorkItems: [relationship],
      artifacts: [],
      conversation: [],
      createdAt: 1,
      updatedAt: 1,
    };
    expect(operationRegistry.get_work.outputSchema.safeParse(work).success)
      .toBe(true);
    expect(operationRegistry.get_work.outputSchema.safeParse({
      ...work,
      parentWorkItem: relationship,
      childWorkItems: [],
    }).success).toBe(true);
    expect(operationRegistry.get_work.outputSchema.safeParse({
      ...work,
      childWorkItems: Array.from({ length: 101 }, () => relationship),
    }).success).toBe(false);
    expect(operationRegistry.create_work.inputSchema.safeParse({
      idempotencyKey: "idempotency-key",
      title: "Child",
      goal: "A direct child.",
      parentWorkItemId: "work-1",
    }).success).toBe(true);
  });

  it("publishes enriched Intake through the existing agent read contract", () => {
    const base = {
      id: "intake-1",
      projectId: "project-1",
      text: "Investigate the failing import",
      context: "It began after the latest vendor export.",
      links: ["https://example.com/failure-report"],
      state: "waiting",
      revision: 2,
      createdBy: {
        id: "actor-1",
        kind: "human",
        displayName: "Project member",
      },
      attachmentIds: ["attachment-1"],
      linkedWorkItemIds: [],
      createdAt: 1,
      updatedAt: 2,
    };
    expect(operationRegistry.get_intake.outputSchema.safeParse(base).success)
      .toBe(true);
    expect(operationRegistry.get_intake.outputSchema.safeParse({
      ...base,
      links: ["javascript:alert(1)"],
    }).success).toBe(false);
  });

  it("keeps session start observational", () => {
    expect(operationRegistry.session_start.method).toBe("POST");
    expect(operationRegistry.session_start.readOnly).toBe(true);
    expect(operationRegistry.session_start.scopes).toEqual(["dongo:work:read"]);
  });

  it("defines a bounded cursor-based project update pull", () => {
    expect(operationRegistry.get_updates.method).toBe("GET");
    expect(operationRegistry.get_updates.readOnly).toBe(true);
    expect(operationRegistry.get_updates.inputSchema.safeParse({
      cursor: 4,
      waitSeconds: 20,
    }).success).toBe(true);
    expect(operationRegistry.get_updates.inputSchema.safeParse({
      cursor: -1,
      waitSeconds: 21,
    }).success).toBe(false);
    expect(operationRegistry.get_updates.outputSchema.safeParse({
      cursor: 5,
      updates: [{
        id: "signal-5",
        version: 5,
        kind: "intake_available",
        intakeId: "intake-1",
        priority: "important",
        createdAt: 1,
      }],
      hasMore: false,
      wait: {
        status: "updates_available",
        requestedSeconds: 20,
        elapsedMilliseconds: 1_000,
      },
      delivery: {
        mechanism: "bounded_pull",
        stoppedAgentsRestarted: false,
      },
      serverTime: 2,
    }).success).toBe(true);
  });

  it("names the one-item execution limit without limiting planning", () => {
    const result = operationRegistry.session_start.outputSchema.safeParse({
      project: {
        id: "project-1",
        publicRef: "public-1",
        organizationId: "organization-1",
        organizationSlug: "example",
        name: "Example",
        slug: "example",
        identifierPrefix: "EX",
        executionMode: "autonomous",
      },
      installation: {
        id: "actor-1",
        kind: "installation",
        displayName: "Agent",
      },
      overview: {
        project: {
          id: "project-1",
          publicRef: "public-1",
          organizationId: "organization-1",
          organizationSlug: "example",
          name: "Example",
          slug: "example",
          identifierPrefix: "EX",
          executionMode: "autonomous",
        },
        needsYou: [],
        working: [],
        ready: [],
        inbox: [],
        recentlyDone: [],
        serverTime: 1,
      },
      newlyResolvedAttention: [],
      instructions: {
        executionMode: "autonomous",
        maxStartedWorkItemsPerSession: 1,
        maxNewWorkItemsPerSession: 1,
        wakeUpSemantics: "next_pull",
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts additive parallel capabilities and isolated workspace metadata", () => {
    expect(operationRegistry.session_start.inputSchema.safeParse({
      externalSessionId: "host-session-1",
      hostCapabilities: {
        parallelExecution: "supported",
        worktreeIsolation: "supported",
      },
    }).success).toBe(true);
    expect(operationRegistry.session_start.inputSchema.safeParse({
      externalSessionId: "host-session-1",
      hostCapabilities: { parallelExecution: "supported" },
    }).success).toBe(false);
    const base = {
      workItemId: "work-1",
      expectedRevision: 1,
      externalSessionId: "host-session-1",
      idempotencyKey: "idempotency-key",
    };
    expect(operationRegistry.start_work.inputSchema.safeParse({
      ...base,
      workspace: {
        kind: "worktree",
        worktreeName: "feature-one",
        branch: "feature/one",
      },
    }).success).toBe(true);
    expect(operationRegistry.start_work.inputSchema.safeParse({
      ...base,
      workspace: { kind: "shared" },
    }).success).toBe(false);
  });

  it("keeps new project and Run safety metadata additive for rolling clients", () => {
    const project = {
      id: "project-1",
      publicRef: "public-1",
      organizationId: "organization-1",
      organizationSlug: "example",
      name: "Example",
      slug: "example",
      identifierPrefix: "EX",
      executionMode: "manual" as const,
    };
    expect(projectSummarySchema.safeParse(project).success).toBe(true);
    expect(projectSummarySchema.safeParse({
      ...project,
      parallelExecution: {
        enabled: true,
        maxConcurrentRuns: 4,
        requiresIsolatedWorkspaces: true,
      },
    }).success).toBe(true);
    const run = {
      id: "run-1",
      workItemId: "work-1",
      installationActor: {
        id: "actor-1",
        kind: "installation" as const,
        displayName: "Agent",
      },
      externalSessionId: "session-1",
      state: "running" as const,
      startedAt: 1,
    };
    expect(runSchema.safeParse(run).success).toBe(true);
    expect(runSchema.safeParse({
      ...run,
      hostCapabilities: {
        parallelExecution: "supported",
        worktreeIsolation: "supported",
      },
      workspace: { kind: "worktree", worktreeName: "agent-one" },
    }).success).toBe(true);
  });

  it("accepts bounded creation context, links, and an initial comment", () => {
    const base = {
      idempotencyKey: "idempotency-key",
      title: "Plan the migration",
      goal: "Produce an implementation plan.",
    };
    expect(operationRegistry.create_work.inputSchema.safeParse({
      ...base,
      context: "The existing endpoint remains supported.",
      links: ["https://example.com/design"],
      initialComment: "Start with the compatibility audit.",
    }).success).toBe(true);
    expect(operationRegistry.create_work.inputSchema.safeParse({
      ...base,
      links: Array.from({ length: 101 }, (_, index) => `https://example.com/${index}`),
    }).success).toBe(false);
    expect(operationRegistry.create_work.inputSchema.safeParse({
      ...base,
      links: ["not a URL"],
    }).success).toBe(false);
    expect(operationRegistry.create_work.inputSchema.safeParse({
      ...base,
      initialComment: "   ",
    }).success).toBe(false);
  });

  it("rejects unsupported artifact kinds at the public contract boundary", () => {
    const base = {
      workItemId: "work-1",
      expectedRevision: 1,
      idempotencyKey: "idempotency-key",
    };
    expect(operationRegistry.update_work.inputSchema.safeParse({
      ...base,
      artifact: {
        kind: "file",
        label: "Build plan",
        repositoryPath: "build-plan/README.md",
      },
    }).success).toBe(true);
    expect(operationRegistry.update_work.inputSchema.safeParse({
      ...base,
      artifact: {
        kind: "repository",
        label: "Unsupported",
        repositoryPath: "build-plan/README.md",
      },
    }).success).toBe(false);
  });

  it("keeps runner delivery bounded and command-free", () => {
    const token = `dng_run_${"a".repeat(11)}_${"b".repeat(43)}`;
    const registration = {
      idempotencyKey: "runner-register-1",
      token,
      label: "Studio Mac",
      platform: "darwin",
      version: "0.1.0",
      harnesses: ["codex", "claude"],
      approvalMode: "ask",
    };
    expect(operationRegistry.runner_register.method).toBe("POST");
    expect(operationRegistry.runner_register.mcpExposed).toBe(false);
    expect(operationRegistry.runner_register.inputSchema.safeParse(registration).success)
      .toBe(true);
    expect(operationRegistry.runner_register.inputSchema.safeParse({
      ...registration,
      command: "rm -rf /",
    }).success).toBe(false);
    expect(operationRegistry.runner_wait.method).toBe("POST");
    expect(operationRegistry.runner_wait.readOnly).toBe(false);
    expect(operationRegistry.runner_wait.inputSchema.safeParse({
      idempotencyKey: "runner-wait-1",
      registrationId: "registration-1",
      token,
      waitSeconds: 20,
      platform: "darwin",
      version: "0.1.0",
      harnesses: ["codex"],
      approvalMode: "ask",
      activeJobIds: ["job-1", "job-2"],
    }).success).toBe(true);
    expect(operationRegistry.runner_wait.inputSchema.safeParse({
      idempotencyKey: "runner-inspect-1",
      registrationId: "registration-1",
      token,
      waitSeconds: 0,
      platform: "darwin",
      version: "0.1.0",
      harnesses: ["codex"],
      approvalMode: "automatic",
      inspectJobId: "job-1",
    }).success).toBe(true);
    expect(operationRegistry.runner_wait.inputSchema.safeParse({
      idempotencyKey: "runner-invalid-mode",
      registrationId: "registration-1",
      token,
      platform: "darwin",
      version: "0.1.0",
      harnesses: ["codex"],
      approvalMode: "automatic",
      activeJobIds: [],
      inspectJobId: "job-1",
    }).success).toBe(false);
    const runnerJob = {
      id: "job-1",
      projectId: "project-1",
      kind: "intake" as const,
      intakeId: "intake-1",
      targetRegistrationId: "registration-1",
      harness: "codex" as const,
      state: "queued" as const,
      revision: 1,
      requestedAt: 1,
      expiresAt: 2,
      updatedAt: 1,
    };
    expect(operationRegistry.runner_wait.outputSchema.safeParse({
      registration: {
        id: "registration-1",
        projectId: "project-1",
        installationId: "installation-1",
        label: "Studio Mac",
        platform: "darwin",
        version: "0.1.0",
        harnesses: ["codex"],
        approvalMode: "automatic",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      },
      job: runnerJob,
      wait: { status: "job_available", requestedSeconds: 20, elapsedMilliseconds: 1 },
      serverTime: 2,
    }).success).toBe(true);
    expect(operationRegistry.runner_wait.outputSchema.safeParse({
      registration: {
        id: "registration-1",
        projectId: "project-1",
        installationId: "installation-1",
        label: "Studio Mac",
        platform: "darwin",
        version: "0.1.0",
        harnesses: ["codex"],
        approvalMode: "automatic",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      },
      job: { ...runnerJob, workItemId: "work-1" },
      wait: { status: "job_available", requestedSeconds: 20, elapsedMilliseconds: 1 },
      serverTime: 2,
    }).success).toBe(false);
    expect(operationRegistry.runner_update_job.inputSchema.safeParse({
      idempotencyKey: "runner-update-1",
      registrationId: "registration-1",
      token,
      jobId: "job-1",
      expectedRevision: 2,
      state: "running",
      safeMessage: "Working",
      stdout: "must never be uploaded",
    }).success).toBe(false);
  });
});
