import { createHash, randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";

import type { DongoClient } from "@dongo/client";
import { DongoClientError } from "@dongo/client";
import type {
  RunnerApprovalMode,
  RunnerHarness,
  RunnerJob,
  RunnerPlatform,
} from "@dongo/contracts";
import { CliCoreError } from "./errors.ts";
import {
  discoverRunnerDeploymentPolicy,
  type RunnerDeploymentAccessMode,
  type RunnerDeploymentPolicy,
} from "./runner-deployment-access.ts";
import type { SecretStore } from "./secret-store.ts";
import { FileSecretStore } from "./secret-store.ts";
import type { RunnerServiceController, RunnerServiceSpec } from "./runner-service.ts";
import { RunnerWorkspaceManager, type RunnerWorkspace } from "./runner-workspaces.ts";

const RUNNER_SCHEMA_VERSION = 1;
const RUNNER_VERSION = "0.3.0";
const DEFAULT_MAX_CONCURRENT_JOBS = 6;
const MAX_LOG_BYTES = 5 * 1_024 * 1_024;
const MAX_LOG_FILES = 3;

export type RunnerBrowserReviewMode = "disabled" | "read_only";

export interface RunnerConfig {
  schemaVersion: 1;
  projectRef: string;
  projectId: string;
  installationId: string;
  repositoryRoot: string;
  repositoryIdentity: string;
  repositoryIdentityV2?: string;
  executablePaths: Record<RunnerHarness, string>;
  executableIdentities: Record<RunnerHarness, string>;
  environmentPath: string;
  registrationId: string;
  token: string;
  label: string;
  platform: RunnerPlatform;
  version: string;
  harnesses: RunnerHarness[];
  approvalMode: RunnerApprovalMode;
  browserReviewMode: RunnerBrowserReviewMode;
  maxConcurrentJobs: number;
  deploymentPolicy: RunnerDeploymentPolicy;
  enabled: boolean;
  installedAt: string;
  updatedAt: string;
}

export interface RunnerLocalState {
  schemaVersion: 2;
  status:
    | "disabled"
    | "starting"
    | "waiting"
    | "awaiting_local_approval"
    | "running"
    | "blocked"
    | "recovering"
    | "error"
    | "stopped";
  projectRef: string;
  registrationId: string;
  version: string;
  currentJob?: {
    id: string;
    kind: RunnerJob["kind"];
    workIdentifier?: string;
    intakeId?: string;
    harness: RunnerHarness;
    state: RunnerJob["state"];
    revision: number;
    worktreeName?: string;
    branch?: string;
  };
  currentJobs: Array<{
    id: string;
    kind: RunnerJob["kind"];
    workIdentifier?: string;
    intakeId?: string;
    harness: RunnerHarness;
    state: RunnerJob["state"];
    revision: number;
    worktreeName?: string;
    branch?: string;
  }>;
  lastSeenAt?: string;
  lastErrorCode?: string;
  consecutiveFailures?: number;
  nextRetryAt?: string;
  updatedAt: string;
}

export interface RunnerHarnessResult {
  outcome: "completed" | "failed";
  safeCode?: string;
  safeSummary?: string;
  sessionReferencePresent?: boolean;
}

export interface RunnerHarnessAdapter {
  readonly harness: RunnerHarness;
  validate(): Promise<string>;
  canResume?(input: {
    repositoryRoot: string;
    gitCommonDirectory: string;
    registrationId: string;
    jobId: string;
  }): Promise<boolean>;
  discardSession?(input: {
    repositoryRoot: string;
    registrationId: string;
    jobId: string;
  }): Promise<void>;
  discardRegistration?(registrationId: string): Promise<void>;
  execute(input: {
    repositoryRoot: string;
    gitCommonDirectory: string;
    registrationId: string;
    jobId: string;
    kind: RunnerJob["kind"];
    workIdentifier?: string;
    intakeId?: string;
    worktreeName: string;
    branch: string;
    browserReviewMode?: RunnerBrowserReviewMode;
    deploymentPolicy?: RunnerDeploymentPolicy;
    trustedRepositoryRoot?: string;
    signal: AbortSignal;
    log: (chunk: string) => Promise<void>;
  }): Promise<RunnerHarnessResult>;
}

export type RunnerAdapterResolver = (
  harness: RunnerHarness,
  executablePath?: string,
  environmentPath?: string,
) => RunnerHarnessAdapter | undefined;

type RunnerApi = Pick<
  DongoClient,
  "getIntake" | "getWork" | "runnerRegister" | "runnerRotate" | "runnerRevoke" | "runnerWait" | "runnerUpdateJob"
>;

export interface RunnerManagerOptions {
  api: RunnerApi;
  store: SecretStore;
  service: RunnerServiceController;
  repositoryRoot: string;
  projectRef: string;
  projectId: string;
  installationId: string;
  runtime: Pick<RunnerServiceSpec, "nodePath" | "cliPath">;
  configDirectory: string;
  now?: () => number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  adapter?: RunnerAdapterResolver;
}

export function createRunnerStore(configDirectory: string): SecretStore {
  return new FileSecretStore(path.join(configDirectory, "runner"));
}

export function generateRunnerToken(): string {
  return `dng_run_${randomBytes(8).toString("base64url")}_${randomBytes(32).toString("base64url")}`;
}

export class LocalRunnerManager {
  readonly #api: RunnerApi;
  readonly #store: SecretStore;
  readonly #service: RunnerServiceController;
  readonly #repositoryRoot: string;
  readonly #projectRef: string;
  readonly #projectId: string;
  readonly #installationId: string;
  readonly #runtime: Pick<RunnerServiceSpec, "nodePath" | "cliPath">;
  readonly #configDirectory: string;
  readonly #now: () => number;
  readonly #sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  readonly #random: () => number;
  readonly #adapter?: RunnerAdapterResolver;
  readonly #activeJobs = new Map<string, { job: RunnerJob; workspace?: RunnerWorkspace }>();
  #stateWrite: Promise<void> = Promise.resolve();

  constructor(options: RunnerManagerOptions) {
    this.#api = options.api;
    this.#store = options.store;
    this.#service = options.service;
    this.#repositoryRoot = path.resolve(options.repositoryRoot);
    this.#projectRef = options.projectRef;
    this.#projectId = options.projectId;
    this.#installationId = options.installationId;
    this.#runtime = options.runtime;
    this.#configDirectory = options.configDirectory;
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? abortableSleep;
    this.#random = options.random ?? Math.random;
    this.#adapter = options.adapter;
  }

  async install(input: {
    label: string;
    harnesses: RunnerHarness[];
    approvalMode?: RunnerApprovalMode;
    browserReviewMode?: RunnerBrowserReviewMode;
    maxConcurrentJobs?: number;
    deploymentAccessMode?: RunnerDeploymentAccessMode;
  }) {
    const existing = await this.#readConfig(false);
    if (existing) {
      throw new CliCoreError({
        code: "runner_already_installed",
        message: "A dongo runner is already installed for this project. Remove it before installing a new credential.",
        exitCode: 6,
      });
    }
    const repositoryRoot = await realpath(this.#repositoryRoot);
    const repositoryIdentity = await captureRepositoryIdentity(repositoryRoot);
    const repositoryIdentityV2 = await captureRepositoryIdentityV2(repositoryRoot);
    const environmentPath = normalizedEnvironmentPath(process.env.PATH);
    const harnesses = normalizedHarnesses(input.harnesses);
    if (harnesses.length === 0) {
      throw new CliCoreError({ code: "validation", message: "Select at least one supported runner harness.", exitCode: 2 });
    }
    const label = input.label.trim();
    if (!label || label.length > 120) {
      throw new CliCoreError({ code: "validation", message: "Runner label must be between 1 and 120 characters.", exitCode: 2 });
    }
    const maxConcurrentJobs = normalizedMaxConcurrentJobs(input.maxConcurrentJobs);
    const executablePaths = {} as Record<RunnerHarness, string>;
    const executableIdentities = {} as Record<RunnerHarness, string>;
    for (const harness of harnesses) {
      const adapter = this.#adapter?.(harness);
      if (!adapter || adapter.harness !== harness) {
        throw new CliCoreError({
          code: "harness_unavailable",
          message: `${harness} is not available in this dongo runner build.`,
          exitCode: 4,
        });
      }
      const executablePath = await adapter.validate();
      if (!path.isAbsolute(executablePath)) {
        throw new CliCoreError({ code: "harness_unavailable", message: `${harness} did not resolve to a safe executable path.`, exitCode: 4 });
      }
      executablePaths[harness] = await realpath(executablePath);
      executableIdentities[harness] = await captureExecutableIdentity(executablePaths[harness]);
    }
    const deploymentPolicy = await discoverRunnerDeploymentPolicy(
      repositoryRoot,
      input.deploymentAccessMode ?? "disabled",
    );
    const token = generateRunnerToken();
    const idempotencyKey = randomUUID();
    const registration = await this.#api.runnerRegister({
      idempotencyKey,
      token,
      label,
      platform: this.#service.platform,
      version: RUNNER_VERSION,
      harnesses,
      approvalMode: input.approvalMode ?? "ask",
    });
    const now = new Date(this.#now()).toISOString();
    const config: RunnerConfig = {
      schemaVersion: RUNNER_SCHEMA_VERSION,
      projectRef: this.#projectRef,
      projectId: this.#projectId,
      installationId: this.#installationId,
      repositoryRoot,
      repositoryIdentity,
      repositoryIdentityV2,
      executablePaths,
      executableIdentities,
      environmentPath,
      registrationId: registration.id,
      token,
      label,
      platform: this.#service.platform,
      version: RUNNER_VERSION,
      harnesses,
      approvalMode: input.approvalMode ?? "ask",
      browserReviewMode: input.browserReviewMode ?? "disabled",
      maxConcurrentJobs,
      deploymentPolicy,
      enabled: true,
      installedAt: now,
      updatedAt: now,
    };
    await this.#writeConfig(config);
    try {
      const installed = await this.#service.install({
        projectRef: this.#projectRef,
        repositoryRoot,
        ...this.#runtime,
      });
      await this.#writeState({
        schemaVersion: 2,
        status: "starting",
        projectRef: this.#projectRef,
        registrationId: registration.id,
        version: RUNNER_VERSION,
        currentJobs: [],
        updatedAt: now,
      });
      return {
        registration,
        service: installed,
        repositoryRoot,
        approvalMode: config.approvalMode,
        browserReviewMode: config.browserReviewMode,
        maxConcurrentJobs: config.maxConcurrentJobs,
        deploymentPolicy: config.deploymentPolicy,
        harnesses,
      };
    } catch (error) {
      let revoked = false;
      try {
        await this.#api.runnerRevoke({
          idempotencyKey: randomUUID(),
          registrationId: registration.id,
          token,
        });
        revoked = true;
      } catch {
        await this.#writeConfig({
          ...config,
          enabled: false,
          updatedAt: new Date(this.#now()).toISOString(),
        });
      }
      if (revoked) await this.#store.delete(configKey(this.#projectRef));
      throw error;
    }
  }

  async status() {
    const config = await this.#readConfig(false);
    const state = await this.#readState();
    return {
      installed: Boolean(config),
      enabled: config?.enabled ?? false,
      projectRef: this.#projectRef,
      registrationId: config?.registrationId,
      repositoryRoot: config?.repositoryRoot,
      harnesses: config?.harnesses ?? [],
      approvalMode: config?.approvalMode,
      browserReviewMode: config?.browserReviewMode,
      maxConcurrentJobs: config?.maxConcurrentJobs,
      deploymentPolicy: config?.deploymentPolicy,
      servicePlatform: this.#service.platform,
      state,
    };
  }

  async approve(jobId: string) {
    const config = await this.#readConfig(true);
    const state = await this.#readState();
    const job = state?.currentJobs.find((candidate) => candidate.id === jobId);
    if (
      job?.state !== "awaiting_local_approval" ||
      state?.registrationId !== config.registrationId
    ) {
      throw new CliCoreError({
        code: "runner_job_not_waiting",
        message: "That runner job is not waiting for local approval on this machine.",
        exitCode: 6,
      });
    }
    const approval = {
      schemaVersion: 1,
      registrationId: config.registrationId,
      jobId,
      approvedAt: new Date(this.#now()).toISOString(),
    };
    await this.#store.set(approvalKey(this.#projectRef, jobId), JSON.stringify(approval));
    return {
      approved: true,
      jobId,
      kind: job.kind,
      workIdentifier: job.workIdentifier,
      intakeId: job.intakeId,
    };
  }

  async configureApproval(approvalMode: RunnerApprovalMode) {
    return await this.configure({ approvalMode });
  }

  async configure(input: {
    approvalMode?: RunnerApprovalMode;
    browserReviewMode?: RunnerBrowserReviewMode;
    maxConcurrentJobs?: number;
    deploymentAccessMode?: RunnerDeploymentAccessMode;
  }) {
    const config = await this.#readConfig(true);
    const state = await this.#readState();
    if (state?.currentJobs.length) {
      throw new CliCoreError({
        code: "runner_busy",
        message: "Wait for the current runner jobs to finish before changing local runner settings.",
        exitCode: 6,
      });
    }
    if (
      input.approvalMode === undefined &&
      input.browserReviewMode === undefined &&
      input.maxConcurrentJobs === undefined &&
      input.deploymentAccessMode === undefined
    ) {
      throw new CliCoreError({
        code: "validation",
        message: "Choose an approval mode, browser review mode, concurrency limit, or deployment access mode to configure.",
        exitCode: 2,
      });
    }
    const approvalMode = input.approvalMode ?? config.approvalMode;
    const browserReviewMode = input.browserReviewMode ?? config.browserReviewMode;
    const maxConcurrentJobs = normalizedMaxConcurrentJobs(input.maxConcurrentJobs ?? config.maxConcurrentJobs);
    const deploymentPolicy = input.deploymentAccessMode === undefined
      ? config.deploymentPolicy
      : await discoverRunnerDeploymentPolicy(config.repositoryRoot, input.deploymentAccessMode);
    if (
      config.approvalMode === approvalMode &&
      config.browserReviewMode === browserReviewMode &&
      config.maxConcurrentJobs === maxConcurrentJobs &&
      JSON.stringify(config.deploymentPolicy) === JSON.stringify(deploymentPolicy)
    ) {
      return {
        changed: false,
        approvalMode,
        previousApprovalMode: config.approvalMode,
        browserReviewMode,
        previousBrowserReviewMode: config.browserReviewMode,
        maxConcurrentJobs,
        previousMaxConcurrentJobs: config.maxConcurrentJobs,
        deploymentPolicy,
        previousDeploymentPolicy: config.deploymentPolicy,
        harnesses: config.harnesses,
      };
    }

    const now = new Date(this.#now()).toISOString();
    const updated = { ...config, approvalMode, browserReviewMode, maxConcurrentJobs, deploymentPolicy, updatedAt: now };
    await this.#service.disable(this.#projectRef);
    await this.#writeConfig(updated);
    try {
      const service = await this.#service.install({
        projectRef: this.#projectRef,
        repositoryRoot: config.repositoryRoot,
        ...this.#runtime,
      });
      await this.#writeState({
        schemaVersion: 2,
        status: "starting",
        projectRef: this.#projectRef,
        registrationId: config.registrationId,
        version: config.version,
        currentJobs: [],
        updatedAt: now,
      });
      return {
        changed: true,
        approvalMode,
        previousApprovalMode: config.approvalMode,
        browserReviewMode,
        previousBrowserReviewMode: config.browserReviewMode,
        maxConcurrentJobs,
        previousMaxConcurrentJobs: config.maxConcurrentJobs,
        deploymentPolicy,
        previousDeploymentPolicy: config.deploymentPolicy,
        harnesses: config.harnesses,
        service,
      };
    } catch (error) {
      await this.#writeConfig(config);
      await this.#service.install({
        projectRef: this.#projectRef,
        repositoryRoot: config.repositoryRoot,
        ...this.#runtime,
      }).catch(() => undefined);
      throw error;
    }
  }

  async disable() {
    const config = await this.#readConfig(true);
    const service = await this.#service.disable(this.#projectRef);
    const now = new Date(this.#now()).toISOString();
    await this.#writeConfig({ ...config, enabled: false, updatedAt: now });
    await this.#writeState({
      schemaVersion: 2,
      status: "disabled",
      projectRef: this.#projectRef,
      registrationId: config.registrationId,
      version: config.version,
      currentJobs: [],
      updatedAt: now,
    });
    return { disabled: true, service };
  }

  async remove() {
    const config = await this.#readConfig(true);
    const state = await this.#readState();
    await this.#service.disable(this.#projectRef);
    try {
      await this.#api.runnerRevoke({
        idempotencyKey: randomUUID(),
        registrationId: config.registrationId,
        token: config.token,
      });
    } catch (error) {
      if (!(error instanceof DongoClientError) || error.code !== "unauthorized") throw error;
    }
    const service = await this.#service.remove(this.#projectRef);
    for (const harness of config.harnesses) {
      await this.#adapter?.(
        harness,
        config.executablePaths[harness],
        config.environmentPath,
      )?.discardRegistration?.(config.registrationId);
    }
    for (const job of state?.currentJobs ?? []) {
      await this.#adapter?.(
        job.harness,
        config.executablePaths[job.harness],
        config.environmentPath,
      )?.discardSession?.({
        repositoryRoot: config.repositoryRoot,
        registrationId: config.registrationId,
        jobId: job.id,
      });
      await Promise.all([
        this.#store.delete(approvalKey(config.projectRef, job.id)),
        this.#store.delete(resultKey(config.projectRef, job.id)),
      ]);
    }
    await this.#removeLogs(config.projectRef);
    await Promise.all([
      this.#store.delete(configKey(this.#projectRef)),
      this.#store.delete(stateKey(this.#projectRef)),
    ]);
    return { removed: true, registrationId: config.registrationId, service };
  }

  async run(signal?: AbortSignal): Promise<{ stopped: true }> {
    const runController = new AbortController();
    const relayAbort = () => runController.abort(signal?.reason);
    signal?.addEventListener("abort", relayAbort, { once: true });
    if (signal?.aborted) runController.abort(signal.reason);
    const runSignal = runController.signal;
    const config = await this.#readConfig(true);
    if (!config.enabled) {
      throw new CliCoreError({ code: "runner_disabled", message: "This dongo runner is disabled.", exitCode: 6 });
    }
    const configuredRoot = await realpath(config.repositoryRoot);
    const currentRoot = await realpath(this.#repositoryRoot);
    const [currentIdentity, currentIdentityV2] = await Promise.all([
      captureRepositoryIdentity(currentRoot),
      captureRepositoryIdentityV2(currentRoot),
    ]);
    if (
      configuredRoot !== currentRoot ||
      currentIdentity !== config.repositoryIdentity ||
      (config.repositoryIdentityV2 !== undefined && currentIdentityV2 !== config.repositoryIdentityV2) ||
      config.projectRef !== this.#projectRef
    ) {
      throw new CliCoreError({
        code: "runner_binding_mismatch",
        message: "Runner repository binding does not match this project.",
        exitCode: 4,
      });
    }
    if (config.repositoryIdentityV2 === undefined) {
      config.repositoryIdentityV2 = currentIdentityV2;
      config.updatedAt = new Date(this.#now()).toISOString();
      await this.#writeConfig(config);
    }
    if (config.version !== RUNNER_VERSION) {
      config.version = RUNNER_VERSION;
      config.updatedAt = new Date(this.#now()).toISOString();
      await this.#writeConfig(config);
    }
    const workspaceManager = new RunnerWorkspaceManager({
      repositoryRoot: config.repositoryRoot,
      configDirectory: this.#configDirectory,
      projectRef: config.projectRef,
      environmentPath: config.environmentPath,
    });
    try {
      await workspaceManager.preflight();
    } catch (error) {
      await this.#publishState(config, "error", { lastErrorCode: safeErrorCode(error) });
      throw error;
    }
    await this.#publishState(config, "starting");
    let failureAttempt = 0;
    let terminalAuthorizationCode: string | undefined;
    const workers = new Map<string, Promise<void>>();
    while (!runSignal.aborted) {
      try {
        if (workers.size >= config.maxConcurrentJobs) {
          await Promise.race(workers.values()).catch(() => undefined);
          continue;
        }
        await this.#publishState(config, workers.size > 0 ? "running" : "waiting");
        const result = await this.#api.runnerWait({
          idempotencyKey: randomUUID(),
          registrationId: config.registrationId,
          token: config.token,
          waitSeconds: 20,
          platform: config.platform,
          version: config.version,
          harnesses: config.harnesses,
          approvalMode: config.approvalMode,
          activeJobIds: [...workers.keys()],
          hostCapacity: config.maxConcurrentJobs,
        }, { signal: runSignal });
        failureAttempt = 0;
        await this.#publishState(config, workers.size > 0 ? "running" : "waiting", {
          lastSeenAt: new Date(this.#now()).toISOString(),
          consecutiveFailures: 0,
        });
        if (result.job && !workers.has(result.job.id)) {
          this.#activeJobs.set(result.job.id, { job: result.job });
          const worker = Promise.resolve()
            .then(() => this.#runJob(config, result.job!, workspaceManager, runSignal))
            .finally(async () => {
              workers.delete(result.job!.id);
              this.#activeJobs.delete(result.job!.id);
              await this.#publishState(config, workers.size > 0 ? "running" : "waiting");
            });
          workers.set(result.job.id, worker);
          continue;
        }
        if (workers.size > 0) {
          await Promise.race([
            ...workers.values(),
            abortableSleep(250, runSignal),
          ]).catch(() => undefined);
        }
      } catch (error) {
        if (runSignal.aborted || isCancellation(error)) break;
        failureAttempt += 1;
        const code = safeErrorCode(error);
        if (code === "unauthorized" || code === "forbidden" || code === "insufficient_scope") {
          await this.#publishState(config, "error", { lastErrorCode: code, consecutiveFailures: failureAttempt });
          runController.abort(error);
          await Promise.allSettled(workers.values());
          await this.#service.disarm(this.#projectRef);
          await this.#writeConfig({
            ...config,
            enabled: false,
            updatedAt: new Date(this.#now()).toISOString(),
          });
          terminalAuthorizationCode = code;
          break;
        }
        const delay = backoffMilliseconds(failureAttempt, this.#random);
        await this.#publishState(config, "recovering", {
          lastErrorCode: code,
          consecutiveFailures: failureAttempt,
          nextRetryAt: new Date(this.#now() + delay).toISOString(),
        });
        await this.#sleep(delay, runSignal).catch(() => undefined);
      }
    }
    await Promise.allSettled(workers.values());
    await this.#publishState(
      config,
      terminalAuthorizationCode ? "disabled" : "stopped",
      terminalAuthorizationCode ? { lastErrorCode: terminalAuthorizationCode, consecutiveFailures: failureAttempt } : {},
    );
    signal?.removeEventListener("abort", relayAbort);
    return { stopped: true };
  }

  async #runJob(
    config: RunnerConfig,
    initialJob: RunnerJob,
    workspaceManager: RunnerWorkspaceManager,
    signal?: AbortSignal,
  ) {
    try {
      await this.#handleJob(config, initialJob, workspaceManager, signal);
    } catch (error) {
      if (signal?.aborted || isCancellation(error)) return;
      const current = this.#activeJobs.get(initialJob.id)?.job;
      if (current && await this.#readPendingResult(config, current)) return;
      if (current && !["cancelled", "failed", "completed", "expired"].includes(current.state)) {
        const code = safeErrorCode(error);
        await this.#updateJob(config, current, "failed", {
          safeCode: code === "worktree_setup_failed" || code === "runner_workspace_missing"
            ? "worktree_setup_failed"
            : "harness_failed",
          safeSummary: "The local runner could not complete this job. Review the owner-only runner log.",
        }, signal).catch(() => undefined);
      }
    }
  }

  async #handleJob(
    config: RunnerConfig,
    initialJob: RunnerJob,
    workspaceManager: RunnerWorkspaceManager,
    signal?: AbortSignal,
  ) {
    let job = initialJob;
    if (job.state === "cancel_requested") {
      await this.#updateJob(config, job, "cancelled", { safeCode: "cancelled_before_start" }, signal);
      return;
    }
    const recovering = job.state === "running" || job.state === "blocked";
    let workspace = recovering ? await workspaceManager.recover(job) : undefined;
    if (workspace) this.#activeJobs.set(job.id, { job, workspace });
    if (recovering) {
      const pending = await this.#readPendingResult(config, job);
      if (pending) {
        await this.#updateJob(config, job, pending.outcome, pending, signal);
        await this.#store.delete(resultKey(config.projectRef, job.id));
        await this.#adapter?.(
          job.harness,
          config.executablePaths[job.harness],
          config.environmentPath,
        )?.discardSession?.({
          repositoryRoot: workspace!.repositoryRoot,
          registrationId: config.registrationId,
          jobId: job.id,
        });
        if (pending.outcome === "completed") await workspaceManager.cleanup(workspace!);
        return;
      }
    }
    if (job.state === "blocked") {
      const target = job.kind === "work"
        ? await this.#api.getWork({ workItemId: job.workItemId! }, { signal })
        : await this.#api.getIntake({ intakeId: job.intakeId! }, { signal });
      const complete = job.kind === "work"
        ? target.state === "done"
        : target.state === "processed" || target.state === "dismissed";
      if (complete) {
        const running = await this.#updateJob(config, job, "running", {}, signal);
        await this.#updateJob(config, running, "completed", {
          safeCode: job.kind === "work" ? "work_completed" : "intake_completed",
          safeSummary: job.kind === "work"
            ? "The queued dongo work is complete."
            : "The queued dongo Intake was triaged.",
          sessionReferencePresent: true,
        }, signal);
        await this.#adapter?.(
          job.harness,
          config.executablePaths[job.harness],
          config.environmentPath,
        )?.discardSession?.({
          repositoryRoot: workspace!.repositoryRoot,
          registrationId: config.registrationId,
          jobId: job.id,
        });
        await workspaceManager.cleanup(workspace!);
        return;
      }
      const waitingForAttention = job.kind === "work"
        ? "openAttention" in target && Boolean(target.openAttention)
        : "hasOpenAttention" in target && Boolean(target.hasOpenAttention);
      if (waitingForAttention) {
        await this.#recordJob(config, job, workspace);
        await this.#sleep(15_000, signal);
        return;
      }
      job = await this.#updateJob(config, job, "running", {}, signal);
    }
    if (job.state === "delivered" && config.approvalMode === "ask") {
      job = await this.#updateJob(config, job, "awaiting_local_approval", {}, signal);
    }
    if (job.state === "awaiting_local_approval") {
      job = await this.#awaitApproval(config, job, signal);
      if (job.state === "cancelled" || job.state === "expired") return;
    }
    if (job.state === "delivered") {
      job = await this.#updateJob(config, job, "starting", {}, signal);
    }
    if (job.state !== "starting" && !recovering) return;
    if (
      await captureExecutableIdentity(config.executablePaths[job.harness]).catch(() => undefined) !==
      config.executableIdentities[job.harness]
    ) {
      await this.#updateJob(config, job, "failed", {
        safeCode: "harness_changed",
        safeSummary: "The approved local harness executable changed or is unavailable. Reinstall the runner to approve it again.",
      }, signal);
      return;
    }
    workspace ??= await workspaceManager.prepare(job);
    this.#activeJobs.set(job.id, { job, workspace });
    const adapter = this.#adapter?.(
      job.harness,
      config.executablePaths[job.harness],
      config.environmentPath,
    );
    if (!adapter || adapter.harness !== job.harness) {
      await this.#updateJob(config, job, "failed", {
        safeCode: "harness_unavailable",
        safeSummary: `${job.harness} is not available on this runner.`,
      }, signal);
      return;
    }
    if (recovering && !(await adapter.canResume?.({
      repositoryRoot: workspace.repositoryRoot,
      gitCommonDirectory: workspace.gitCommonDirectory,
      registrationId: config.registrationId,
      jobId: job.id,
    }))) {
      await this.#updateJob(config, job, "failed", {
        safeCode: "runner_restarted",
        safeSummary: "The local runner restarted without a supported harness session to resume.",
      }, signal);
      return;
    }
    const log = new RunnerLog(this.#configDirectory, config.projectRef, job.id);
    const controller = new AbortController();
    const relayAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", relayAbort, { once: true });
    let current = await this.#updateJob(config, job, "running", {}, signal);
    await this.#recordJob(config, current, workspace);
    let executionFinished = false;
    const execution = adapter.execute({
      repositoryRoot: workspace.repositoryRoot,
      gitCommonDirectory: workspace.gitCommonDirectory,
      registrationId: config.registrationId,
      jobId: current.id,
      kind: current.kind,
      workIdentifier: current.workIdentifier,
      intakeId: current.intakeId,
      worktreeName: workspace.worktreeName,
      branch: workspace.branch,
      browserReviewMode: config.browserReviewMode,
      deploymentPolicy: config.deploymentPolicy,
      trustedRepositoryRoot: config.repositoryRoot,
      signal: controller.signal,
      log: (chunk) => log.append(chunk),
    }).then(
      (result) => {
        executionFinished = true;
        return result;
      },
      (): RunnerHarnessResult => {
        executionFinished = true;
        return {
          outcome: "failed",
          safeCode: controller.signal.aborted ? "cancelled" : "harness_failed",
          safeSummary: controller.signal.aborted
            ? "Local execution was cancelled."
            : "The local harness stopped before completing the job.",
        };
      },
    );
    try {
      while (true) {
        const settled = await Promise.race([
          execution.then((value) => ({ kind: "result" as const, value })),
          this.#sleep(15_000, signal).then(() => ({ kind: "tick" as const })),
        ]);
        if (settled.kind === "result") {
          const target = current.kind === "work"
            ? await this.#api.getWork({ workItemId: current.workItemId }, { signal })
            : await this.#api.getIntake({ intakeId: current.intakeId! }, { signal });
          const waitingForAttention = current.kind === "work"
            ? target.state !== "done" && "openAttention" in target && Boolean(target.openAttention)
            : target.state !== "processed" && target.state !== "dismissed" &&
              "hasOpenAttention" in target && Boolean(target.hasOpenAttention);
          if (waitingForAttention) {
            current = await this.#updateJob(config, current, "blocked", {
              safeCode: "attention_required",
              safeSummary: "The agent is waiting for a response in dongo.",
              sessionReferencePresent: settled.value.sessionReferencePresent,
            }, signal);
            await this.#recordJob(config, current, workspace);
            return;
          }
          const targetCompleted = current.kind === "work"
            ? target.state === "done"
            : target.state === "processed" || target.state === "dismissed";
          const state = targetCompleted ? "completed" : "failed";
          const pending = {
            outcome: state,
            safeCode: targetCompleted
              ? current.kind === "work" ? "work_completed" : "intake_completed"
              : settled.value.outcome === "failed"
                ? settled.value.safeCode
                : current.kind === "work" ? "work_not_completed" : "intake_not_completed",
            safeSummary: targetCompleted
              ? current.kind === "work"
                ? "The queued dongo work is complete."
                : "The queued dongo Intake was triaged."
              : settled.value.outcome === "failed"
                ? settled.value.safeSummary
                : current.kind === "work"
                  ? "The agent stopped before completing the queued dongo work."
                  : "The agent stopped before triaging the queued dongo Intake.",
            sessionReferencePresent: settled.value.sessionReferencePresent,
          } as const;
          await this.#store.set(resultKey(config.projectRef, current.id), JSON.stringify({
            schemaVersion: 1,
            registrationId: config.registrationId,
            jobId: current.id,
            ...pending,
          }));
          await this.#updateJob(config, current, state, pending, signal);
          await this.#store.delete(resultKey(config.projectRef, current.id));
          await adapter.discardSession?.({
            repositoryRoot: workspace.repositoryRoot,
            registrationId: config.registrationId,
            jobId: current.id,
          });
          if (state === "completed") await workspaceManager.cleanup(workspace);
          return;
        }
        const polled = await this.#api.runnerWait({
          idempotencyKey: randomUUID(),
          registrationId: config.registrationId,
          token: config.token,
          waitSeconds: 0,
          platform: config.platform,
          version: config.version,
          harnesses: config.harnesses,
          approvalMode: config.approvalMode,
          inspectJobId: current.id,
        }, { signal });
        if (!polled.job || polled.job.id !== current.id) {
          controller.abort(new Error("runner job lease was lost"));
          await execution.catch(() => undefined);
          throw new CliCoreError({ code: "runner_lease_lost", message: "Runner job lease was lost.", exitCode: 6 });
        }
        current = polled.job;
        if (current.state === "cancel_requested") {
          controller.abort(new Error("runner job cancelled"));
          await execution.catch(() => undefined);
          await this.#updateJob(config, current, "cancelled", { safeCode: "user_cancelled" }, signal);
          return;
        }
        if (["cancelled", "failed", "completed", "expired"].includes(current.state)) {
          controller.abort(new Error("runner job is no longer active"));
          await execution.catch(() => undefined);
          return;
        }
        current = await this.#updateJob(config, current, "running", {}, signal);
      }
    } finally {
      signal?.removeEventListener("abort", relayAbort);
      if (!executionFinished) {
        controller.abort(new Error("runner execution lease ended"));
        await execution;
      }
    }
  }

  async #awaitApproval(config: RunnerConfig, initial: RunnerJob, signal?: AbortSignal) {
    let job = initial;
    await this.#recordJob(config, job);
    let interval = 2_000;
    while (!signal?.aborted) {
      const approval = await this.#store.get(approvalKey(config.projectRef, job.id));
      if (approval && validApproval(approval, config, job)) {
        await this.#store.delete(approvalKey(config.projectRef, job.id));
        return await this.#updateJob(config, job, "starting", {}, signal);
      }
      await this.#sleep(interval, signal);
      interval = Math.min(interval * 2, 15_000);
      const polled = await this.#api.runnerWait({
        idempotencyKey: randomUUID(),
        registrationId: config.registrationId,
        token: config.token,
        waitSeconds: 0,
        platform: config.platform,
        version: config.version,
        harnesses: config.harnesses,
        approvalMode: config.approvalMode,
        inspectJobId: job.id,
      }, { signal });
      if (!polled.job || polled.job.id !== job.id) {
        throw new CliCoreError({ code: "runner_lease_lost", message: "Runner approval job was lost.", exitCode: 6 });
      }
      job = polled.job;
      if (job.state === "cancel_requested") {
        return await this.#updateJob(config, job, "cancelled", { safeCode: "user_cancelled" }, signal);
      }
      if (["cancelled", "failed", "completed", "expired"].includes(job.state)) return job;
      await this.#recordJob(config, job);
    }
    throw new CliCoreError({ code: "cancelled", message: "Runner approval wait was cancelled.", exitCode: 130 });
  }

  async #updateJob(
    config: RunnerConfig,
    job: RunnerJob,
    state: RunnerJob["state"],
    detail: {
      safeCode?: string;
      safeSummary?: string;
      sessionReferencePresent?: boolean;
    },
    signal?: AbortSignal,
  ) {
    const updated = await this.#api.runnerUpdateJob({
      idempotencyKey: randomUUID(),
      registrationId: config.registrationId,
      token: config.token,
      jobId: job.id,
      expectedRevision: job.revision,
      state,
      leaseSeconds: state === "starting" || state === "running" ? 90 : undefined,
      ...detail,
    }, { signal });
    const active = this.#activeJobs.get(job.id);
    if (active) this.#activeJobs.set(job.id, { ...active, job: updated });
    return updated;
  }

  async #recordJob(
    config: RunnerConfig,
    job: RunnerJob,
    workspace?: RunnerWorkspace,
  ) {
    const active = this.#activeJobs.get(job.id);
    this.#activeJobs.set(job.id, { job, workspace: workspace ?? active?.workspace });
    await this.#publishState(config, this.#aggregateStatus());
  }

  #aggregateStatus(): RunnerLocalState["status"] {
    const states = [...this.#activeJobs.values()].map(({ job }) => job.state);
    if (states.length === 0) return "waiting";
    if (states.some((state) => ["delivered", "starting", "running", "cancel_requested"].includes(state))) return "running";
    if (states.some((state) => state === "awaiting_local_approval")) return "awaiting_local_approval";
    if (states.some((state) => state === "blocked")) return "blocked";
    return "running";
  }

  async #publishState(
    config: RunnerConfig,
    status: RunnerLocalState["status"],
    extra: Pick<RunnerLocalState, "lastSeenAt" | "lastErrorCode" | "consecutiveFailures" | "nextRetryAt"> = {},
  ) {
    const write = async () => {
      const currentJobs = [...this.#activeJobs.values()].map(({ job, workspace }) => ({
        id: job.id,
        kind: job.kind,
        workIdentifier: job.workIdentifier,
        intakeId: job.intakeId,
        harness: job.harness,
        state: job.state,
        revision: job.revision,
        worktreeName: workspace?.worktreeName,
        branch: workspace?.branch,
      }));
      const effectiveStatus = currentJobs.length > 0 && !["error", "recovering", "stopped", "disabled"].includes(status)
        ? this.#aggregateStatus()
        : status;
      await this.#writeState({
        schemaVersion: 2,
        status: effectiveStatus,
        projectRef: config.projectRef,
        registrationId: config.registrationId,
        version: config.version,
        currentJob: currentJobs.length === 1 ? currentJobs[0] : undefined,
        currentJobs,
        ...extra,
        updatedAt: new Date(this.#now()).toISOString(),
      });
    };
    this.#stateWrite = this.#stateWrite.then(write, write);
    await this.#stateWrite;
  }

  async #readConfig(required: true): Promise<RunnerConfig>;
  async #readConfig(required: false): Promise<RunnerConfig | undefined>;
  async #readConfig(required: boolean): Promise<RunnerConfig | undefined> {
    const raw = await this.#store.get(configKey(this.#projectRef));
    if (!raw) {
      if (required) {
        throw new CliCoreError({ code: "runner_not_installed", message: "No dongo runner is installed for this project.", exitCode: 3 });
      }
      return undefined;
    }
    return parseConfig(raw, this.#projectRef, this.#projectId, this.#installationId);
  }

  async #writeConfig(config: RunnerConfig) {
    await this.#store.set(configKey(this.#projectRef), JSON.stringify(config));
  }

  async #readState(): Promise<RunnerLocalState | undefined> {
    const raw = await this.#store.get(stateKey(this.#projectRef));
    if (!raw) return undefined;
    try {
      const value = JSON.parse(raw) as RunnerLocalState | (Omit<RunnerLocalState, "schemaVersion" | "currentJobs"> & { schemaVersion: 1 });
      if (value.projectRef !== this.#projectRef) return undefined;
      if (value.schemaVersion === 2 && Array.isArray(value.currentJobs)) return value;
      if (value.schemaVersion === 1) {
        return {
          ...value,
          schemaVersion: 2,
          currentJobs: value.currentJob ? [value.currentJob] : [],
        };
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  async #writeState(state: RunnerLocalState) {
    await this.#store.set(stateKey(this.#projectRef), JSON.stringify(state));
  }

  async #removeLogs(projectRef: string) {
    const directory = path.join(this.#configDirectory, "runner-logs", createSafeHash(projectRef));
    try {
      const info = await lstat(directory);
      if (
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        (typeof process.getuid === "function" && info.uid !== process.getuid())
      ) {
        throw new CliCoreError({ code: "unsafe_path", message: "Runner log directory is not safe to remove." });
      }
      await rm(directory, { recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async #readPendingResult(
    config: RunnerConfig,
    job: RunnerJob,
  ): Promise<{
    outcome: "completed" | "failed";
    safeCode?: string;
    safeSummary?: string;
    sessionReferencePresent?: boolean;
  } | undefined> {
    const raw = await this.#store.get(resultKey(config.projectRef, job.id));
    if (!raw) return undefined;
    try {
      const value = JSON.parse(raw) as Record<string, unknown>;
      if (
        value.schemaVersion !== 1 ||
        value.registrationId !== config.registrationId ||
        value.jobId !== job.id ||
        (value.outcome !== "completed" && value.outcome !== "failed") ||
        (value.safeCode !== undefined && (typeof value.safeCode !== "string" || value.safeCode.length > 80)) ||
        (value.safeSummary !== undefined && (typeof value.safeSummary !== "string" || value.safeSummary.length > 2_000)) ||
        (value.sessionReferencePresent !== undefined && typeof value.sessionReferencePresent !== "boolean")
      ) return undefined;
      return value as {
        outcome: "completed" | "failed";
        safeCode?: string;
        safeSummary?: string;
        sessionReferencePresent?: boolean;
      };
    } catch {
      return undefined;
    }
  }
}

class RunnerLog {
  readonly #directory: string;
  readonly #target: string;

  constructor(configDirectory: string, projectRef: string, jobId: string) {
    const project = path.basename(createSafeHash(projectRef));
    const job = path.basename(createSafeHash(jobId));
    this.#directory = path.join(configDirectory, "runner-logs", project);
    this.#target = path.join(this.#directory, `${job}.log`);
  }

  async append(chunk: string) {
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    const directoryInfo = await lstat(this.#directory);
    if (
      !directoryInfo.isDirectory() ||
      directoryInfo.isSymbolicLink() ||
      (typeof process.getuid === "function" && directoryInfo.uid !== process.getuid())
    ) {
      throw new CliCoreError({ code: "unsafe_path", message: "Runner log directory is not safe." });
    }
    await chmod(this.#directory, 0o700);
    const bytes = Buffer.from(chunk).subarray(0, MAX_LOG_BYTES);
    await this.#rotateIfNeeded(bytes.byteLength);
    const handle = await open(
      this.#target,
      constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      const info = await handle.stat();
      if (!info.isFile() || (typeof process.getuid === "function" && info.uid !== process.getuid())) {
        throw new CliCoreError({ code: "unsafe_path", message: "Runner log path is not safe." });
      }
      await handle.write(bytes);
    } finally {
      await handle.close();
    }
    await chmod(this.#target, 0o600);
  }

  async #rotateIfNeeded(incomingBytes: number) {
    const current = await lstat(this.#target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!current || current.size + incomingBytes <= MAX_LOG_BYTES) return;
    if (!current.isFile() || current.isSymbolicLink()) {
      throw new CliCoreError({ code: "unsafe_path", message: "Runner log rotation path is not safe." });
    }
    await rm(`${this.#target}.${MAX_LOG_FILES}`, { force: true });
    for (let index = MAX_LOG_FILES - 1; index >= 1; index -= 1) {
      const source = `${this.#target}.${index}`;
      try {
        const info = await lstat(source);
        if (!info.isFile() || info.isSymbolicLink()) {
          throw new CliCoreError({ code: "unsafe_path", message: "Runner rotated log path is not safe." });
        }
        await rename(source, `${this.#target}.${index + 1}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    await rename(this.#target, `${this.#target}.1`);
  }
}

function createSafeHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function configKey(projectRef: string) {
  return `runner-config:${projectRef}`;
}

function stateKey(projectRef: string) {
  return `runner-state:${projectRef}`;
}

function approvalKey(projectRef: string, jobId: string) {
  return `runner-approval:${projectRef}:${jobId}`;
}

function resultKey(projectRef: string, jobId: string) {
  return `runner-result:${projectRef}:${jobId}`;
}

function normalizedHarnesses(values: RunnerHarness[]): RunnerHarness[] {
  return [...new Set(values.filter((value) => value === "codex" || value === "claude"))]
    .sort();
}

function parseConfig(
  raw: string,
  projectRef: string,
  projectId: string,
  installationId: string,
): RunnerConfig {
  try {
    const value = JSON.parse(raw) as Partial<RunnerConfig>;
    if (
      value.schemaVersion !== 1 ||
      value.projectRef !== projectRef ||
      value.projectId !== projectId ||
      value.installationId !== installationId ||
      typeof value.repositoryRoot !== "string" ||
      typeof value.repositoryIdentity !== "string" ||
      !/^[0-9a-f]{64}$/u.test(value.repositoryIdentity) ||
      (value.repositoryIdentityV2 !== undefined &&
        (typeof value.repositoryIdentityV2 !== "string" || !/^[0-9a-f]{64}$/u.test(value.repositoryIdentityV2))) ||
      !validExecutablePaths(value.executablePaths, value.harnesses) ||
      !validExecutableIdentities(value.executableIdentities, value.harnesses) ||
      !validEnvironmentPath(value.environmentPath) ||
      typeof value.registrationId !== "string" ||
      typeof value.token !== "string" ||
      !/^dng_run_[A-Za-z0-9_-]{11}_[A-Za-z0-9_-]{43}$/u.test(value.token) ||
      typeof value.label !== "string" ||
      (value.platform !== "darwin" && value.platform !== "linux") ||
      typeof value.version !== "string" ||
      !Array.isArray(value.harnesses) ||
      normalizedHarnesses(value.harnesses).length !== value.harnesses.length ||
      (value.approvalMode !== "ask" && value.approvalMode !== "automatic") ||
      typeof value.enabled !== "boolean" ||
      typeof value.installedAt !== "string" ||
      typeof value.updatedAt !== "string"
    ) throw new Error("invalid runner configuration");
    const browserReviewMode = value.browserReviewMode ?? "disabled";
    if (browserReviewMode !== "disabled" && browserReviewMode !== "read_only") {
      throw new Error("invalid runner browser review mode");
    }
    const maxConcurrentJobs = normalizedMaxConcurrentJobs(value.maxConcurrentJobs);
    const deploymentPolicy = value.deploymentPolicy ?? { mode: "disabled", capabilities: [], sources: [] };
    if (
      (deploymentPolicy.mode !== "disabled" && deploymentPolicy.mode !== "repository") ||
      !Array.isArray(deploymentPolicy.capabilities) ||
      deploymentPolicy.capabilities.some((capability) => !["github", "convex", "cloudflare", "npm"].includes(capability)) ||
      new Set(deploymentPolicy.capabilities).size !== deploymentPolicy.capabilities.length ||
      !Array.isArray(deploymentPolicy.sources) ||
      deploymentPolicy.sources.some((source) => source !== ".env" && source !== ".env.local") ||
      new Set(deploymentPolicy.sources).size !== deploymentPolicy.sources.length
    ) {
      throw new Error("invalid runner deployment policy");
    }
    return { ...value, browserReviewMode, maxConcurrentJobs, deploymentPolicy } as RunnerConfig;
  } catch {
    throw new CliCoreError({
      code: "runner_config_invalid",
      message: "The local dongo runner configuration is invalid. Remove and reinstall it.",
      exitCode: 4,
    });
  }
}

function normalizedMaxConcurrentJobs(value: number | undefined): number {
  const normalized = value ?? DEFAULT_MAX_CONCURRENT_JOBS;
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 8) {
    throw new CliCoreError({
      code: "validation",
      message: "Runner concurrency must be an integer between 1 and 8.",
      exitCode: 2,
    });
  }
  return normalized;
}

function validExecutablePaths(
  value: unknown,
  harnesses: unknown,
): value is Record<RunnerHarness, string> {
  if (!value || typeof value !== "object" || !Array.isArray(harnesses)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length === harnesses.length && harnesses.every((harness) =>
    (harness === "codex" || harness === "claude") &&
    typeof (value as Record<string, unknown>)[harness] === "string" &&
    path.isAbsolute((value as Record<string, string>)[harness]!));
}

function validExecutableIdentities(
  value: unknown,
  harnesses: unknown,
): value is Record<RunnerHarness, string> {
  if (!value || typeof value !== "object" || !Array.isArray(harnesses)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length === harnesses.length && harnesses.every((harness) =>
    (harness === "codex" || harness === "claude") &&
    typeof (value as Record<string, unknown>)[harness] === "string" &&
    /^[0-9a-f]{64}$/u.test((value as Record<string, string>)[harness]!));
}

function normalizedEnvironmentPath(value: string | undefined): string {
  const entries = (value ?? "")
    .split(path.delimiter)
    .filter((entry) => path.isAbsolute(entry) && !/[\r\n\0]/u.test(entry));
  const normalized = [...new Set(entries)].join(path.delimiter);
  if (!normalized || normalized.length > 8_192) {
    throw new CliCoreError({ code: "unsafe_path", message: "The local executable search path is not safe.", exitCode: 4 });
  }
  return normalized;
}

function validEnvironmentPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 8_192) return false;
  const entries = value.split(path.delimiter);
  return entries.every((entry) => path.isAbsolute(entry) && !/[\r\n\0]/u.test(entry));
}

async function captureExecutableIdentity(executablePath: string): Promise<string> {
  const canonicalPath = await realpath(executablePath);
  const info = await lstat(canonicalPath);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new CliCoreError({ code: "harness_unavailable", message: "The approved harness path is not a safe executable.", exitCode: 4 });
  }
  return createHash("sha256")
    .update(canonicalPath)
    .update("\0")
    .update(`${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`)
    .digest("hex");
}

async function captureRepositoryIdentity(repositoryRoot: string): Promise<string> {
  const canonicalRoot = await realpath(repositoryRoot);
  const [rootInfo, gitInfo] = await Promise.all([
    lstat(canonicalRoot),
    lstat(path.join(canonicalRoot, ".git")),
  ]);
  assertSafeRepositoryIdentityPaths(rootInfo, gitInfo);
  return createHash("sha256")
    .update(canonicalRoot)
    .update("\0")
    .update(`${rootInfo.dev}:${rootInfo.ino}`)
    .update("\0")
    .update(`${gitInfo.dev}:${gitInfo.ino}:${gitInfo.isDirectory() ? "directory" : "file"}`)
    .digest("hex");
}

async function captureRepositoryIdentityV2(repositoryRoot: string): Promise<string> {
  const canonicalRoot = await realpath(repositoryRoot);
  const [rootInfo, gitInfo] = await Promise.all([
    lstat(canonicalRoot, { bigint: true }),
    lstat(path.join(canonicalRoot, ".git"), { bigint: true }),
  ]);
  assertSafeRepositoryIdentityPaths(rootInfo, gitInfo);
  return createHash("sha256")
    .update(canonicalRoot)
    .update("\0")
    .update(`${rootInfo.dev}:${rootInfo.ino}:${rootInfo.birthtimeNs}`)
    .update("\0")
    .update(`${gitInfo.dev}:${gitInfo.ino}:${gitInfo.birthtimeNs}:${gitInfo.isDirectory() ? "directory" : "file"}`)
    .digest("hex");
}

function assertSafeRepositoryIdentityPaths(
  rootInfo: Awaited<ReturnType<typeof lstat>>,
  gitInfo: Awaited<ReturnType<typeof lstat>>,
): void {
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new CliCoreError({ code: "unsafe_path", message: "Runner repository root is not a safe directory.", exitCode: 4 });
  }
  if (
    gitInfo.isSymbolicLink() ||
    (!gitInfo.isDirectory() && !gitInfo.isFile())
  ) {
    throw new CliCoreError({ code: "unsafe_path", message: "Runner repository Git metadata is not safe.", exitCode: 4 });
  }
}

function validApproval(raw: string, config: RunnerConfig, job: RunnerJob): boolean {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return value.schemaVersion === 1 &&
      value.registrationId === config.registrationId &&
      value.jobId === job.id &&
      typeof value.approvedAt === "string";
  } catch {
    return false;
  }
}

function safeErrorCode(error: unknown): string {
  if (error instanceof DongoClientError || error instanceof CliCoreError) {
    return /^[a-z][a-z0-9_]{0,63}$/u.test(error.code) ? error.code : "runner_error";
  }
  return "runner_error";
}

function isCancellation(error: unknown): boolean {
  return (error instanceof DongoClientError || error instanceof CliCoreError) &&
    error.code === "cancelled";
}

function backoffMilliseconds(attempt: number, random: () => number): number {
  const schedule = [1_000, 2_000, 5_000, 10_000, 30_000];
  const base = schedule[Math.min(Math.max(0, attempt - 1), schedule.length - 1)]!;
  return Math.floor(base * (0.8 + random() * 0.4));
}

async function abortableSleep(milliseconds: number, signal?: AbortSignal) {
  if (signal?.aborted) throw new CliCoreError({ code: "cancelled", message: "Runner was stopped.", exitCode: 130 });
  await new Promise<void>((resolve, reject) => {
    const complete = () => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    };
    const timer = setTimeout(complete, milliseconds);
    const cancel = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      reject(new CliCoreError({ code: "cancelled", message: "Runner was stopped.", exitCode: 130 }));
    };
    signal?.addEventListener("abort", cancel, { once: true });
  });
}
