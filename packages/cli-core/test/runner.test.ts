import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { promisify } from "node:util";

import type { Intake, RunnerJob, RunnerRegistration, RunnerWait, WorkItem } from "@dongo/contracts";
import { DongoClientError } from "@dongo/client";
import { MemorySecretStore } from "../src/secret-store.ts";
import {
  generateRunnerToken,
  LocalRunnerManager,
  type RunnerAdapterResolver,
  type RunnerHarnessAdapter,
} from "../src/runner.ts";
import type {
  RunnerServiceController,
  RunnerServiceSpec,
} from "../src/runner-service.ts";

const execFileAsync = promisify(execFile);

test("runner installation stores a one-time credential locally and exposes only redacted status", async (context) => {
  const fixture = await runnerFixture(context);
  const api = new FakeRunnerApi();
  const service = new FakeService();
  const manager = fixture.manager(api, service);
  const installed = await manager.install({
    label: "Studio Mac",
    harnesses: ["codex", "claude", "codex"],
  });
  assert.equal(installed.approvalMode, "ask");
  assert.equal(installed.browserReviewMode, "disabled");
  assert.deepEqual(installed.deploymentPolicy, { mode: "disabled", capabilities: [], sources: [] });
  assert.deepEqual(installed.harnesses, ["claude", "codex"]);
  assert.equal(service.installs.length, 1);
  assert.match(api.registrationToken ?? "", /^dng_run_[A-Za-z0-9_-]{11}_[A-Za-z0-9_-]{43}$/u);
  const status = await manager.status();
  assert.equal(status.installed, true);
  assert.equal(status.enabled, true);
  assert.equal("token" in status, false);
  assert.equal(status.browserReviewMode, "disabled");
  assert.deepEqual(status.deploymentPolicy, { mode: "disabled", capabilities: [], sources: [] });
  assert.doesNotMatch(JSON.stringify(status), /dng_run_/u);
  await assert.rejects(
    manager.install({ label: "Duplicate", harnesses: ["codex"] }),
    /already installed/u,
  );
});

test("runner approval can be changed in place without replacing its credential", async (context) => {
  const fixture = await runnerFixture(context);
  const api = new FakeRunnerApi();
  const service = new FakeService();
  const manager = fixture.manager(api, service);
  await manager.install({ label: "Trusted Mac", harnesses: ["codex"] });
  const beforeToken = api.registrationToken;

  const configured = await manager.configureApproval("automatic");

  assert.equal(configured.changed, true);
  assert.equal(configured.previousApprovalMode, "ask");
  assert.equal(configured.approvalMode, "automatic");
  assert.deepEqual(configured.harnesses, ["codex"]);
  assert.equal(api.registrationToken, beforeToken);
  assert.equal(service.disables, 1);
  assert.equal(service.installs.length, 2);
  assert.equal((await manager.status()).approvalMode, "automatic");
  assert.equal((await manager.status()).state?.status, "starting");

  const unchanged = await manager.configureApproval("automatic");
  assert.equal(unchanged.changed, false);
  assert.equal(service.disables, 1);
  assert.equal(service.installs.length, 2);
});

test("runner browser self-review is an explicit local setting", async (context) => {
  const fixture = await runnerFixture(context);
  const api = new FakeRunnerApi();
  const service = new FakeService();
  const manager = fixture.manager(api, service);
  await manager.install({ label: "Review Mac", harnesses: ["codex"] });
  const beforeToken = api.registrationToken;

  const configured = await manager.configure({ browserReviewMode: "read_only" });

  assert.equal(configured.changed, true);
  assert.equal(configured.previousBrowserReviewMode, "disabled");
  assert.equal(configured.browserReviewMode, "read_only");
  assert.equal(configured.approvalMode, "ask");
  assert.equal(api.registrationToken, beforeToken);
  assert.equal(service.disables, 1);
  assert.equal(service.installs.length, 2);
  assert.equal((await manager.status()).browserReviewMode, "read_only");
});

test("runner deployment access records only reviewed provider and source names", async (context) => {
  const fixture = await runnerFixture(context);
  const api = new FakeRunnerApi();
  const service = new FakeService();
  const manager = fixture.manager(api, service);
  await execFileAsync("git", ["-C", fixture.repository, "remote", "add", "origin", "git@github.com:example/project.git"]);
  await mkdir(path.join(fixture.repository, "convex"));
  await writeFile(path.join(fixture.repository, ".env.local"), "CONVEX_DEPLOYMENT=dev:fixture\n", { mode: 0o600 });

  const installed = await manager.install({
    label: "Release Mac",
    harnesses: ["codex"],
    deploymentAccessMode: "repository",
  });

  assert.deepEqual(installed.deploymentPolicy, {
    mode: "repository",
    capabilities: ["convex", "github"],
    sources: [".env.local"],
  });
  assert.doesNotMatch(JSON.stringify(await manager.status()), /dev:fixture/u);
});

test("ask mode requires exact local approval before executing a command-free job", async (context) => {
  const fixture = await runnerFixture(context);
  const controller = new AbortController();
  const api = new FakeRunnerApi();
  const service = new FakeService();
  let manager: LocalRunnerManager;
  let received: { repositoryRoot: string; workIdentifier: string; browserReviewMode?: string } | undefined;
  const adapter: RunnerHarnessAdapter = {
    harness: "codex",
    validate: async () => "/bin/sh",
    execute: async ({ repositoryRoot, workIdentifier, browserReviewMode, log }) => {
      received = { repositoryRoot, workIdentifier: workIdentifier!, browserReviewMode };
      await log("local output only\n");
      return { outcome: "completed", safeCode: "verified", safeSummary: "Implementation and checks completed." };
    },
  };
  manager = fixture.manager(api, service, {
    adapter: () => adapter,
    sleep: async () => {
      const status = await manager.status();
      if (status.state?.status === "awaiting_local_approval") {
        await manager.approve(status.state.currentJob!.id);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
  });
  await manager.install({ label: "Approval Mac", harnesses: ["codex"], browserReviewMode: "read_only" });
  api.job = runnerJob("delivered", 2);
  api.onTerminal = () => controller.abort();
  await manager.run(controller.signal);
  const states = api.transitions.map(({ state }) => state);
  assert.deepEqual(states.filter((state, index) => state !== "running" || states[index - 1] !== "running"), [
    "awaiting_local_approval",
    "starting",
    "running",
    "completed",
  ]);
  assert.equal(received?.workIdentifier, "dong026");
  assert.equal(received?.browserReviewMode, "read_only");
  assert.notEqual(received?.repositoryRoot, fixture.repository);
  assert.match(received?.repositoryRoot ?? "", /runner-worktrees/u);
  const status = await manager.status();
  assert.equal(status.state?.status, "stopped");
  assert.doesNotMatch(JSON.stringify(api.transitions), /dng_run_|local output only/u);
});

test("runner removal disables startup, revokes remotely, and deletes local material", async (context) => {
  const fixture = await runnerFixture(context);
  const api = new FakeRunnerApi();
  const service = new FakeService();
  const manager = fixture.manager(api, service);
  await manager.install({ label: "Removal Mac", harnesses: ["codex"] });
  const logDirectory = path.join(
    fixture.root,
    "runner-logs",
    createHash("sha256").update("project-ref").digest("hex"),
  );
  await mkdir(logDirectory, { recursive: true });
  await writeFile(path.join(logDirectory, "local.log"), "private local output");
  const removed = await manager.remove();
  assert.equal(removed.removed, true);
  assert.equal(api.revocations, 1);
  assert.equal(service.disables, 2);
  assert.equal(service.removes, 1);
  assert.equal((await manager.status()).installed, false);
  await assert.rejects(access(logDirectory), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
});

test("runner removal cleans local material after the parent grant is inactive", async (context) => {
  const fixture = await runnerFixture(context);
  const api = new FakeRunnerApi();
  const manager = fixture.manager(api, new FakeService());
  await manager.install({ label: "Inactive parent", harnesses: ["codex"] });
  api.revokeError = new DongoClientError({
    code: "unauthorized",
    message: "The parent installation is inactive.",
    status: 401,
  });
  assert.equal((await manager.remove()).removed, true);
  assert.equal((await manager.status()).installed, false);
});

test("a failed service install retains a disabled credential when rollback is unconfirmed", async (context) => {
  const fixture = await runnerFixture(context);
  const api = new FakeRunnerApi();
  api.revokeError = new Error("network unavailable");
  const service = new FakeService();
  service.installError = new Error("service install failed");
  const manager = fixture.manager(api, service);
  await assert.rejects(
    manager.install({ label: "Rollback retry", harnesses: ["codex"] }),
    /service install failed/u,
  );
  const status = await manager.status();
  assert.equal(status.installed, true);
  assert.equal(status.enabled, false);
  assert.equal(api.revocations, 1);
});

test("runner refuses a repository that was replaced at the approved path", async (context) => {
  const fixture = await runnerFixture(context);
  const manager = fixture.manager(new FakeRunnerApi(), new FakeService());
  await manager.install({ label: "Bound Mac", harnesses: ["codex"] });
  await rm(path.join(fixture.repository, ".git"), { recursive: true });
  await mkdir(path.join(fixture.repository, ".git"));
  await assert.rejects(manager.run(AbortSignal.timeout(1_000)), (error: Error & { code?: string }) => {
    assert.equal(error.code, "runner_binding_mismatch");
    return true;
  });
});

test("an existing runner adds the stronger repository identity without reinstalling", async (context) => {
  const fixture = await runnerFixture(context);
  const controller = new AbortController();
  const api = new FakeRunnerApi();
  api.job = runnerJob("delivered", 2);
  api.onTerminal = () => controller.abort();
  const manager = fixture.manager(api, new FakeService());
  await manager.install({ label: "Existing runner", harnesses: ["codex"], approvalMode: "automatic" });

  const key = "runner-config:project-ref";
  const installed = JSON.parse((await fixture.store.get(key))!) as Record<string, unknown>;
  const legacyIdentity = installed.repositoryIdentity;
  delete installed.repositoryIdentityV2;
  await fixture.store.set(key, JSON.stringify(installed));

  await manager.run(controller.signal);

  const migrated = JSON.parse((await fixture.store.get(key))!) as Record<string, unknown>;
  assert.equal(migrated.repositoryIdentity, legacyIdentity);
  assert.match(String(migrated.repositoryIdentityV2), /^[0-9a-f]{64}$/u);
});

test("a lost terminal response is replayed from owner-only local state", async (context) => {
  const fixture = await runnerFixture(context);
  const controller = new AbortController();
  const api = new FakeRunnerApi();
  api.failTerminalOnce = true;
  api.job = runnerJob("delivered", 2);
  api.onTerminal = () => controller.abort();
  const adapter: RunnerHarnessAdapter = {
    harness: "codex",
    validate: async () => "/bin/sh",
    execute: async () => ({
      outcome: "completed",
      safeCode: "verified",
      safeSummary: "Completed before the first response was lost.",
    }),
  };
  const manager = fixture.manager(api, new FakeService(), {
    adapter: () => adapter,
    sleep: async () => undefined,
  });
  await manager.install({
    label: "Replay Mac",
    harnesses: ["codex"],
    approvalMode: "automatic",
  });
  await manager.run(controller.signal);
  assert.equal(api.terminalAttempts, 2);
  assert.equal(api.job.state, "completed");
});

test("a restarted runner resumes only when its adapter has the exact local session", async (context) => {
  const fixture = await runnerFixture(context);
  const controller = new AbortController();
  const api = new FakeRunnerApi();
  api.job = runnerJob("running", 4);
  api.onTerminal = () => controller.abort();
  let executions = 0;
  const adapter: RunnerHarnessAdapter = {
    harness: "codex",
    validate: async () => "/bin/sh",
    canResume: async ({ jobId, registrationId, repositoryRoot }) =>
      jobId === "job-1" && registrationId === "registration-1" &&
      repositoryRoot !== fixture.repository && repositoryRoot.includes("runner-worktrees"),
    execute: async () => {
      executions += 1;
      return { outcome: "completed", sessionReferencePresent: true };
    },
  };
  const manager = fixture.manager(api, new FakeService(), {
    adapter: () => adapter,
    sleep: async () => undefined,
  });
  await manager.install({ label: "Resume Mac", harnesses: ["codex"], approvalMode: "automatic" });
  await manager.run(controller.signal);
  assert.equal(executions, 1);
  assert.deepEqual(api.transitions.map(({ state }) => state), ["running", "running", "completed"]);
});

test("a successful harness exit cannot complete a job until dongo Work is done", async (context) => {
  const fixture = await runnerFixture(context);
  const controller = new AbortController();
  const api = new FakeRunnerApi();
  api.workState = "working";
  api.job = runnerJob("delivered", 2);
  api.onTerminal = () => controller.abort();
  const manager = fixture.manager(api, new FakeService(), {
    adapter: () => ({
      harness: "codex",
      validate: async () => "/bin/sh",
      execute: async () => ({ outcome: "completed", sessionReferencePresent: true }),
    }),
    sleep: async () => undefined,
  });
  await manager.install({ label: "Outcome Mac", harnesses: ["codex"], approvalMode: "automatic" });
  await manager.run(controller.signal);
  assert.equal(api.job.state, "failed");
  assert.equal(api.transitions.at(-1)?.safeCode, "work_not_completed");
});

test("automatic mode isolates work from changes in the registered checkout", async (context) => {
  const fixture = await runnerFixture(context);
  const controller = new AbortController();
  const api = new FakeRunnerApi();
  api.job = runnerJob("delivered", 2);
  api.onTerminal = () => controller.abort();
  await writeFile(path.join(fixture.repository, "uncommitted.txt"), "local change");
  let executions = 0;
  const manager = fixture.manager(api, new FakeService(), {
    adapter: () => ({
      harness: "codex",
      validate: async () => "/bin/sh",
      execute: async () => {
        executions += 1;
        return { outcome: "completed" };
      },
    }),
    sleep: async () => undefined,
  });
  await manager.install({ label: "Clean Mac", harnesses: ["codex"], approvalMode: "automatic" });
  await manager.run(controller.signal);
  assert.equal(executions, 1);
  assert.equal(api.job.state, "completed");
});

test("the runner executes distinct queued jobs concurrently in isolated worktrees", async (context) => {
  const fixture = await runnerFixture(context);
  const controller = new AbortController();
  const api = new ParallelRunnerApi([
    { ...runnerJob("delivered", 2), id: "job-1", workItemId: "work-1", workIdentifier: "dong026" } as RunnerJob,
    { ...runnerJob("delivered", 2), id: "job-2", workItemId: "work-2", workIdentifier: "dong027" } as RunnerJob,
  ], () => controller.abort());
  const roots = new Set<string>();
  const branches = new Set<string>();
  let release!: () => void;
  const bothStarted = new Promise<void>((resolve) => { release = resolve; });
  const manager = fixture.manager(api as never, new FakeService(), {
    adapter: () => ({
      harness: "codex",
      validate: async () => "/bin/sh",
      execute: async ({ repositoryRoot, branch }) => {
        roots.add(repositoryRoot);
        branches.add(branch);
        if (roots.size === 2) release();
        await bothStarted;
        return { outcome: "completed", sessionReferencePresent: true };
      },
    }),
  });
  await manager.install({ label: "Parallel Mac", harnesses: ["codex"], approvalMode: "automatic" });
  await manager.run(controller.signal);
  assert.equal(roots.size, 2);
  assert.equal(branches.size, 2);
  assert.equal([...roots].every((root) => root !== fixture.repository && root.includes("runner-worktrees")), true);
  assert.deepEqual([...api.jobs.values()].map((job) => job.state), ["completed", "completed"]);
});

test("losing the runner lease stops the harness before the manager retries", async (context) => {
  const fixture = await runnerFixture(context);
  const controller = new AbortController();
  const api = new FakeRunnerApi();
  api.job = runnerJob("delivered", 2);
  api.dropInspectedJob = true;
  api.onTerminal = () => controller.abort();
  let harnessStopped = false;
  const manager = fixture.manager(api, new FakeService(), {
    adapter: () => ({
      harness: "codex",
      validate: async () => "/bin/sh",
      execute: async ({ signal }) => await new Promise((resolve) => {
        signal.addEventListener("abort", () => {
          harnessStopped = true;
          resolve({ outcome: "failed", safeCode: "cancelled" });
        }, { once: true });
      }),
    }),
    sleep: async () => undefined,
  });
  await manager.install({ label: "Lease Mac", harnesses: ["codex"], approvalMode: "automatic" });
  await manager.run(controller.signal);
  assert.equal(harnessStopped, true);
  assert.equal(api.job.state, "failed");
  assert.equal(api.transitions.filter(({ state }) => state === "running").length, 1);
});

test("an Attention pause blocks the job and resumes only the exact local session after response", async (context) => {
  const fixture = await runnerFixture(context);
  const firstController = new AbortController();
  const api = new FakeRunnerApi();
  api.workState = "working";
  api.openAttention = true;
  api.job = runnerJob("delivered", 2);
  api.onTransition = (state) => {
    if (state === "blocked") firstController.abort();
  };
  let executions = 0;
  let discarded = 0;
  const adapter: RunnerHarnessAdapter = {
    harness: "codex",
    validate: async () => "/bin/sh",
    canResume: async () => true,
    execute: async () => {
      executions += 1;
      return { outcome: "completed", sessionReferencePresent: true };
    },
    discardSession: async () => { discarded += 1; },
  };
  const firstManager = fixture.manager(api, new FakeService(), {
    adapter: () => adapter,
    sleep: async () => undefined,
  });
  await firstManager.install({ label: "Attention Mac", harnesses: ["codex"], approvalMode: "automatic" });
  await firstManager.run(firstController.signal);
  assert.equal(api.job.state, "blocked");
  assert.equal(executions, 1);
  assert.equal(discarded, 0);

  const secondController = new AbortController();
  api.openAttention = false;
  api.onTransition = undefined;
  api.onTerminal = () => secondController.abort();
  const resumedAdapter: RunnerHarnessAdapter = {
    ...adapter,
    execute: async () => {
      executions += 1;
      api.workState = "done";
      return { outcome: "completed", sessionReferencePresent: true };
    },
  };
  const secondManager = fixture.manager(api, new FakeService(), {
    adapter: () => resumedAdapter,
    sleep: async () => undefined,
  });
  await secondManager.run(secondController.signal);
  assert.equal(api.job.state, "completed");
  assert.equal(executions, 2);
  assert.equal(discarded, 1);
});

test("an Intake Attention pause blocks triage and resumes its exact local session", async (context) => {
  const fixture = await runnerFixture(context);
  const firstController = new AbortController();
  const api = new FakeRunnerApi();
  api.intakeState = "claimed";
  api.intakeOpenAttention = true;
  api.job = intakeRunnerJob("delivered", 2);
  api.onTransition = (state) => {
    if (state === "blocked") firstController.abort();
  };
  let executions = 0;
  const adapter: RunnerHarnessAdapter = {
    harness: "codex",
    validate: async () => "/bin/sh",
    canResume: async () => true,
    execute: async () => {
      executions += 1;
      return { outcome: "completed", sessionReferencePresent: true };
    },
  };
  const firstManager = fixture.manager(api, new FakeService(), {
    adapter: () => adapter,
    sleep: async () => undefined,
  });
  await firstManager.install({ label: "Intake Mac", harnesses: ["codex"], approvalMode: "automatic" });
  await firstManager.run(firstController.signal);
  assert.equal(api.job.state, "blocked");
  assert.equal(executions, 1);

  const secondController = new AbortController();
  api.intakeOpenAttention = false;
  api.onTransition = undefined;
  api.onTerminal = () => secondController.abort();
  const resumedManager = fixture.manager(api, new FakeService(), {
    adapter: () => ({
      ...adapter,
      execute: async () => {
        executions += 1;
        api.intakeState = "processed";
        return { outcome: "completed", sessionReferencePresent: true };
      },
    }),
    sleep: async () => undefined,
  });
  await resumedManager.run(secondController.signal);
  assert.equal(api.job.state, "completed");
  assert.equal(api.transitions.at(-1)?.safeCode, "intake_completed");
  assert.equal(executions, 2);
});

test("runner token format is fixed and contains full local entropy", () => {
  const values = new Set(Array.from({ length: 20 }, generateRunnerToken));
  assert.equal(values.size, 20);
  for (const value of values) {
    assert.match(value, /^dng_run_[A-Za-z0-9_-]{11}_[A-Za-z0-9_-]{43}$/u);
  }
});

test("the daemon reuses the exact executable approved during installation", async (context) => {
  const fixture = await runnerFixture(context);
  const controller = new AbortController();
  const api = new FakeRunnerApi();
  api.job = runnerJob("delivered", 2);
  api.onTerminal = () => controller.abort();
  const resolvedPaths: Array<string | undefined> = [];
  const adapter: RunnerHarnessAdapter = {
    harness: "codex",
    validate: async () => "/bin/sh",
    execute: async () => ({ outcome: "completed" }),
  };
  const manager = fixture.manager(api, new FakeService(), {
    adapter: (_harness, executablePath) => {
      resolvedPaths.push(executablePath);
      return adapter;
    },
    sleep: async () => undefined,
  });
  await manager.install({ label: "Pinned CLI Mac", harnesses: ["codex"], approvalMode: "automatic" });
  await manager.run(controller.signal);
  assert.equal(resolvedPaths[0], undefined);
  assert.equal(resolvedPaths.at(-1), await realpath("/bin/sh"));
});

test("the runner refuses an executable changed after local approval", async (context) => {
  const fixture = await runnerFixture(context);
  const controller = new AbortController();
  const api = new FakeRunnerApi();
  api.job = runnerJob("delivered", 2);
  api.onTerminal = () => controller.abort();
  let executions = 0;
  const manager = fixture.manager(api, new FakeService(), {
    adapter: () => ({
      harness: "codex",
      validate: async () => fixture.nodePath,
      execute: async () => {
        executions += 1;
        return { outcome: "completed" };
      },
    }),
    sleep: async () => undefined,
  });
  await manager.install({ label: "Pinned binary Mac", harnesses: ["codex"], approvalMode: "automatic" });
  await writeFile(fixture.nodePath, "changed local executable contents");
  await manager.run(controller.signal);
  assert.equal(executions, 0);
  assert.equal(api.job.state, "failed");
  assert.equal(api.transitions.at(-1)?.safeCode, "harness_changed");
});

class FakeService implements RunnerServiceController {
  readonly platform = "darwin" as const;
  readonly installs: RunnerServiceSpec[] = [];
  disables = 0;
  removes = 0;
  installError?: Error;

  async install(spec: RunnerServiceSpec) {
    this.installs.push(spec);
    if (this.installError) throw this.installError;
    return { servicePath: "/safe/service", serviceName: "safe-service" };
  }

  async disable() {
    this.disables += 1;
    return { servicePath: "/safe/service", serviceName: "safe-service" };
  }

  async remove() {
    this.removes += 1;
    await this.disable();
    return { servicePath: "/safe/service", serviceName: "safe-service" };
  }
}

class FakeRunnerApi {
  registrationToken?: string;
  revocations = 0;
  job?: RunnerJob;
  transitions: Array<{ state: RunnerJob["state"]; safeCode?: string; safeSummary?: string }> = [];
  onTerminal?: () => void;
  onTransition?: (state: RunnerJob["state"]) => void;
  failTerminalOnce = false;
  terminalAttempts = 0;
  revokeError?: Error;
  workState: WorkItem["state"] = "done";
  openAttention = false;
  intakeState: Intake["state"] = "processed";
  intakeOpenAttention = false;
  waitCalls = 0;
  dropJobOnWait?: number;
  dropInspectedJob = false;

  async getWork(input: { workItemId?: string }): Promise<WorkItem> {
    return {
      id: input.workItemId ?? "work-1",
      projectId: "project-1",
      identifier: "dong026",
      sequence: 26,
      title: "Runner work",
      goal: "Complete runner work",
      state: this.workState,
      orderKey: "a",
      revision: 1,
      sourceIntakeIds: [],
      artifacts: [],
      conversation: [],
      openAttention: this.openAttention ? {
        id: "attention-1",
        workItemId: input.workItemId ?? "work-1",
        kind: "question",
        title: "Decision needed",
        body: "Choose a safe path.",
        important: false,
        requestedBy: { id: "actor-1", kind: "installation", displayName: "Codex" },
        requestedAt: 1,
      } : undefined,
      createdAt: 1,
      updatedAt: 1,
    } as unknown as WorkItem;
  }

  async getIntake(input: { intakeId: string }): Promise<Intake> {
    return {
      id: input.intakeId,
      projectId: "project-1",
      text: "Triage this request",
      state: this.intakeState,
      revision: 1,
      createdBy: { id: "actor-1", kind: "human", displayName: "Owner" },
      attachmentIds: [],
      linkedWorkItemIds: [],
      hasOpenAttention: this.intakeOpenAttention,
      createdAt: 1,
      updatedAt: 1,
    } as unknown as Intake;
  }

  async runnerRegister(input: { token: string; label: string; platform: "darwin" | "linux"; version: string; harnesses: Array<"codex" | "claude">; approvalMode: "ask" | "automatic" }) {
    this.registrationToken = input.token;
    return registration(input);
  }

  async runnerRotate() {
    return registration({ label: "Fake", platform: "darwin", version: "0.1.0", harnesses: ["codex"], approvalMode: "ask" });
  }

  async runnerRevoke() {
    this.revocations += 1;
    if (this.revokeError) throw this.revokeError;
    return { ...registration({ label: "Fake", platform: "darwin", version: "0.1.0", harnesses: ["codex"], approvalMode: "ask" }), status: "revoked" as const };
  }

  async runnerWait(input?: { activeJobIds?: string[]; inspectJobId?: string }): Promise<RunnerWait> {
    this.waitCalls += 1;
    if (
      this.waitCalls === this.dropJobOnWait ||
      (this.dropInspectedJob && input?.inspectJobId === this.job?.id) ||
      (this.job && input?.activeJobIds?.includes(this.job.id))
    ) {
      return {
        registration: registration({ label: "Fake", platform: "darwin", version: "0.1.0", harnesses: ["codex"], approvalMode: "ask" }),
        wait: { status: "timed_out", requestedSeconds: 0, elapsedMilliseconds: 0 },
        serverTime: Date.now(),
      };
    }
    return {
      registration: registration({ label: "Fake", platform: "darwin", version: "0.1.0", harnesses: ["codex"], approvalMode: "ask" }),
      job: this.job,
      wait: { status: this.job ? "job_available" : "timed_out", requestedSeconds: 20, elapsedMilliseconds: 20_000 },
      serverTime: Date.now(),
    };
  }

  async runnerUpdateJob(input: { state: RunnerJob["state"]; safeCode?: string; safeSummary?: string }): Promise<RunnerJob> {
    if (!this.job) throw new Error("missing job");
    if (["completed", "failed", "cancelled"].includes(input.state)) {
      this.terminalAttempts += 1;
      if (this.failTerminalOnce) {
        this.failTerminalOnce = false;
        throw new Error("response lost before status confirmation");
      }
    }
    this.transitions.push({ state: input.state, safeCode: input.safeCode, safeSummary: input.safeSummary });
    this.job = { ...this.job, state: input.state, revision: this.job.revision + 1 };
    this.onTransition?.(input.state);
    if (["completed", "failed", "cancelled"].includes(input.state)) this.onTerminal?.();
    return this.job;
  }
}

class ParallelRunnerApi {
  readonly jobs: Map<string, RunnerJob>;
  readonly #onComplete: () => void;
  completed = 0;

  constructor(jobs: RunnerJob[], onComplete: () => void) {
    this.jobs = new Map(jobs.map((job) => [job.id, job]));
    this.#onComplete = onComplete;
  }

  async getWork(input: { workItemId?: string }): Promise<WorkItem> {
    return {
      id: input.workItemId!, projectId: "project-1", identifier: input.workItemId === "work-1" ? "dong026" : "dong027",
      sequence: 26, title: "Parallel work", goal: "Complete it", state: "done", orderKey: "a", revision: 1,
      sourceIntakeIds: [], artifacts: [], conversation: [], createdAt: 1, updatedAt: 1,
    } as unknown as WorkItem;
  }

  async getIntake(): Promise<Intake> { throw new Error("not used"); }
  async runnerRegister(input: { token: string; label: string; platform: "darwin" | "linux"; version: string; harnesses: Array<"codex" | "claude">; approvalMode: "ask" | "automatic" }) {
    return registration(input);
  }
  async runnerRotate() { return registration({ label: "Parallel", platform: "darwin", version: "0.1.0", harnesses: ["codex"], approvalMode: "automatic" }); }
  async runnerRevoke() { return registration({ label: "Parallel", platform: "darwin", version: "0.1.0", harnesses: ["codex"], approvalMode: "automatic" }); }
  async runnerWait(input: { activeJobIds?: string[]; inspectJobId?: string }): Promise<RunnerWait> {
    const job = input.inspectJobId
      ? this.jobs.get(input.inspectJobId)
      : [...this.jobs.values()].find((candidate) =>
        !["completed", "failed", "cancelled", "expired"].includes(candidate.state) &&
        !input.activeJobIds?.includes(candidate.id));
    return {
      registration: registration({ label: "Parallel", platform: "darwin", version: "0.1.0", harnesses: ["codex"], approvalMode: "automatic" }),
      job,
      wait: { status: job ? "job_available" : "not_requested", requestedSeconds: 0, elapsedMilliseconds: 0 },
      serverTime: Date.now(),
    };
  }
  async runnerUpdateJob(input: { jobId: string; state: RunnerJob["state"] }): Promise<RunnerJob> {
    const job = this.jobs.get(input.jobId)!;
    const updated = { ...job, state: input.state, revision: job.revision + 1 };
    this.jobs.set(input.jobId, updated);
    if (input.state === "completed") {
      this.completed += 1;
      if (this.completed === this.jobs.size) this.#onComplete();
    }
    return updated;
  }
}

function registration(input: {
  label: string;
  platform: "darwin" | "linux";
  version: string;
  harnesses: Array<"codex" | "claude">;
  approvalMode: "ask" | "automatic";
}): RunnerRegistration {
  return {
    id: "registration-1",
    projectId: "project-1",
    installationId: "installation-1",
    status: "active",
    createdAt: 1,
    updatedAt: 1,
    ...input,
  } as RunnerRegistration;
}

function runnerJob(state: RunnerJob["state"], revision: number): RunnerJob {
  return {
    id: "job-1",
    projectId: "project-1",
    kind: "work",
    workItemId: "work-1",
    workIdentifier: "dong026",
    harness: "codex",
    state,
    revision,
    registrationId: "registration-1",
    requestedAt: 1,
    expiresAt: Date.now() + 60_000,
    updatedAt: 1,
  } as RunnerJob;
}

function intakeRunnerJob(state: RunnerJob["state"], revision: number): RunnerJob {
  return {
    id: "job-intake",
    projectId: "project-1",
    kind: "intake",
    intakeId: "intake-1",
    targetRegistrationId: "registration-1",
    harness: "codex",
    state,
    revision,
    registrationId: "registration-1",
    requestedAt: 1,
    expiresAt: Date.now() + 60_000,
    updatedAt: 1,
  } as RunnerJob;
}

async function runnerFixture(context: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), "dongo-runner-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const repository = path.join(root, "repository");
  const bin = path.join(root, "bin");
  await Promise.all([mkdir(path.join(repository, ".git"), { recursive: true }), mkdir(bin)]);
  await execFileAsync("git", ["-C", repository, "init", "--quiet"]);
  await writeFile(path.join(repository, "README.md"), "runner fixture\n");
  await execFileAsync("git", ["-C", repository, "add", "README.md"]);
  await execFileAsync("git", [
    "-C", repository,
    "-c", "user.name=dongo tests",
    "-c", "user.email=tests@dongo.invalid",
    "commit", "--quiet", "-m", "runner fixture",
  ]);
  const nodePath = path.join(bin, "node");
  const cliPath = path.join(bin, "dongo.js");
  await Promise.all([writeFile(nodePath, "node"), writeFile(cliPath, "cli")]);
  const store = new MemorySecretStore();
  const canonicalRepository = await realpath(repository);
  return {
    root,
    repository: canonicalRepository,
    nodePath,
    store,
    manager(
      api: FakeRunnerApi,
      service: FakeService,
      options: { adapter?: RunnerAdapterResolver; sleep?: () => Promise<void> } = {},
    ) {
      return new LocalRunnerManager({
        api,
        store,
        service,
        repositoryRoot: canonicalRepository,
        projectRef: "project-ref",
        projectId: "project-1",
        installationId: "installation-1",
        runtime: { nodePath, cliPath },
        configDirectory: root,
        random: () => 0.5,
        adapter: options.adapter ?? ((harness) => ({
          harness,
          validate: async () => "/bin/sh",
          execute: async () => ({ outcome: "completed" as const }),
        })),
        sleep: options.sleep,
      });
    },
  };
}
