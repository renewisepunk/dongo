import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import type { RunnerJob, RunnerRegistration, RunnerWait } from "@dongo/contracts";
import { DongoClientError } from "@dongo/client";
import { MemorySecretStore } from "../src/secret-store.ts";
import {
  generateRunnerToken,
  LocalRunnerManager,
  type RunnerHarnessAdapter,
} from "../src/runner.ts";
import type {
  RunnerServiceController,
  RunnerServiceSpec,
} from "../src/runner-service.ts";

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
  assert.deepEqual(installed.harnesses, ["claude", "codex"]);
  assert.equal(service.installs.length, 1);
  assert.match(api.registrationToken ?? "", /^dng_run_[A-Za-z0-9_-]{11}_[A-Za-z0-9_-]{43}$/u);
  const status = await manager.status();
  assert.equal(status.installed, true);
  assert.equal(status.enabled, true);
  assert.equal("token" in status, false);
  assert.doesNotMatch(JSON.stringify(status), /dng_run_/u);
  await assert.rejects(
    manager.install({ label: "Duplicate", harnesses: ["codex"] }),
    /already installed/u,
  );
});

test("ask mode requires exact local approval before executing a command-free job", async (context) => {
  const fixture = await runnerFixture(context);
  const controller = new AbortController();
  const api = new FakeRunnerApi();
  const service = new FakeService();
  let manager: LocalRunnerManager;
  let received: { repositoryRoot: string; workIdentifier: string } | undefined;
  const adapter: RunnerHarnessAdapter = {
    harness: "codex",
    execute: async ({ repositoryRoot, workIdentifier, log }) => {
      received = { repositoryRoot, workIdentifier };
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
  await manager.install({ label: "Approval Mac", harnesses: ["codex"] });
  api.job = runnerJob("delivered", 2);
  api.onTerminal = () => controller.abort();
  await manager.run(controller.signal);
  assert.deepEqual(api.transitions.map(({ state }) => state), [
    "awaiting_local_approval",
    "starting",
    "running",
    "completed",
  ]);
  assert.deepEqual(received, {
    repositoryRoot: fixture.repository,
    workIdentifier: "dong026",
  });
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
  const removed = await manager.remove();
  assert.equal(removed.removed, true);
  assert.equal(api.revocations, 1);
  assert.equal(service.disables, 2);
  assert.equal(service.removes, 1);
  assert.equal((await manager.status()).installed, false);
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

test("a lost terminal response is replayed from owner-only local state", async (context) => {
  const fixture = await runnerFixture(context);
  const controller = new AbortController();
  const api = new FakeRunnerApi();
  api.failTerminalOnce = true;
  api.job = runnerJob("delivered", 2);
  api.onTerminal = () => controller.abort();
  const adapter: RunnerHarnessAdapter = {
    harness: "codex",
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

test("runner token format is fixed and contains full local entropy", () => {
  const values = new Set(Array.from({ length: 20 }, generateRunnerToken));
  assert.equal(values.size, 20);
  for (const value of values) {
    assert.match(value, /^dng_run_[A-Za-z0-9_-]{11}_[A-Za-z0-9_-]{43}$/u);
  }
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
  transitions: Array<{ state: RunnerJob["state"]; safeSummary?: string }> = [];
  onTerminal?: () => void;
  failTerminalOnce = false;
  terminalAttempts = 0;
  revokeError?: Error;

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

  async runnerWait(): Promise<RunnerWait> {
    return {
      registration: registration({ label: "Fake", platform: "darwin", version: "0.1.0", harnesses: ["codex"], approvalMode: "ask" }),
      job: this.job,
      wait: { status: this.job ? "job_available" : "timed_out", requestedSeconds: 20, elapsedMilliseconds: 20_000 },
      serverTime: Date.now(),
    };
  }

  async runnerUpdateJob(input: { state: RunnerJob["state"]; safeSummary?: string }): Promise<RunnerJob> {
    if (!this.job) throw new Error("missing job");
    if (["completed", "failed", "cancelled"].includes(input.state)) {
      this.terminalAttempts += 1;
      if (this.failTerminalOnce) {
        this.failTerminalOnce = false;
        throw new Error("response lost before status confirmation");
      }
    }
    this.transitions.push({ state: input.state, safeSummary: input.safeSummary });
    this.job = { ...this.job, state: input.state, revision: this.job.revision + 1 };
    if (["completed", "failed", "cancelled"].includes(input.state)) this.onTerminal?.();
    return this.job;
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

async function runnerFixture(context: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), "dongo-runner-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const repository = path.join(root, "repository");
  const bin = path.join(root, "bin");
  await Promise.all([mkdir(repository), mkdir(bin)]);
  const nodePath = path.join(bin, "node");
  const cliPath = path.join(bin, "dongo.js");
  await Promise.all([writeFile(nodePath, "node"), writeFile(cliPath, "cli")]);
  const store = new MemorySecretStore();
  const canonicalRepository = await realpath(repository);
  return {
    repository: canonicalRepository,
    manager(
      api: FakeRunnerApi,
      service: FakeService,
      options: { adapter?: () => RunnerHarnessAdapter; sleep?: () => Promise<void> } = {},
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
        ...options,
      });
    },
  };
}
