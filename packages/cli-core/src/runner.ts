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
import type { SecretStore } from "./secret-store.ts";
import { FileSecretStore } from "./secret-store.ts";
import type { RunnerServiceController, RunnerServiceSpec } from "./runner-service.ts";

const RUNNER_SCHEMA_VERSION = 1;
const RUNNER_VERSION = "0.1.0";
const MAX_LOG_BYTES = 5 * 1_024 * 1_024;
const MAX_LOG_FILES = 3;

export interface RunnerConfig {
  schemaVersion: 1;
  projectRef: string;
  projectId: string;
  installationId: string;
  repositoryRoot: string;
  registrationId: string;
  token: string;
  label: string;
  platform: RunnerPlatform;
  version: string;
  harnesses: RunnerHarness[];
  approvalMode: RunnerApprovalMode;
  enabled: boolean;
  installedAt: string;
  updatedAt: string;
}

export interface RunnerLocalState {
  schemaVersion: 1;
  status:
    | "disabled"
    | "starting"
    | "waiting"
    | "awaiting_local_approval"
    | "running"
    | "error"
    | "stopped";
  projectRef: string;
  registrationId: string;
  version: string;
  currentJob?: {
    id: string;
    workIdentifier: string;
    harness: RunnerHarness;
    state: RunnerJob["state"];
    revision: number;
  };
  lastSeenAt?: string;
  lastErrorCode?: string;
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
  execute(input: {
    repositoryRoot: string;
    workIdentifier: string;
    signal: AbortSignal;
    log: (chunk: string) => Promise<void>;
  }): Promise<RunnerHarnessResult>;
}

export type RunnerAdapterResolver = (
  harness: RunnerHarness,
) => RunnerHarnessAdapter | undefined;

type RunnerApi = Pick<
  DongoClient,
  "runnerRegister" | "runnerRotate" | "runnerRevoke" | "runnerWait" | "runnerUpdateJob"
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
    const harnesses = normalizedHarnesses(input.harnesses);
    if (harnesses.length === 0) {
      throw new CliCoreError({ code: "validation", message: "Select at least one supported runner harness.", exitCode: 2 });
    }
    const label = input.label.trim();
    if (!label || label.length > 120) {
      throw new CliCoreError({ code: "validation", message: "Runner label must be between 1 and 120 characters.", exitCode: 2 });
    }
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
      registrationId: registration.id,
      token,
      label,
      platform: this.#service.platform,
      version: RUNNER_VERSION,
      harnesses,
      approvalMode: input.approvalMode ?? "ask",
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
        schemaVersion: 1,
        status: "starting",
        projectRef: this.#projectRef,
        registrationId: registration.id,
        version: RUNNER_VERSION,
        updatedAt: now,
      });
      return {
        registration,
        service: installed,
        repositoryRoot,
        approvalMode: config.approvalMode,
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
      servicePlatform: this.#service.platform,
      state,
    };
  }

  async approve(jobId: string) {
    const config = await this.#readConfig(true);
    const state = await this.#readState();
    if (
      state?.status !== "awaiting_local_approval" ||
      state.currentJob?.id !== jobId ||
      state.registrationId !== config.registrationId
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
    return { approved: true, jobId, workIdentifier: state.currentJob.workIdentifier };
  }

  async disable() {
    const config = await this.#readConfig(true);
    const service = await this.#service.disable(this.#projectRef);
    const now = new Date(this.#now()).toISOString();
    await this.#writeConfig({ ...config, enabled: false, updatedAt: now });
    await this.#writeState({
      schemaVersion: 1,
      status: "disabled",
      projectRef: this.#projectRef,
      registrationId: config.registrationId,
      version: config.version,
      updatedAt: now,
    });
    return { disabled: true, service };
  }

  async remove() {
    const config = await this.#readConfig(true);
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
    await Promise.all([
      this.#store.delete(configKey(this.#projectRef)),
      this.#store.delete(stateKey(this.#projectRef)),
    ]);
    return { removed: true, registrationId: config.registrationId, service };
  }

  async run(signal?: AbortSignal): Promise<{ stopped: true }> {
    const config = await this.#readConfig(true);
    if (!config.enabled) {
      throw new CliCoreError({ code: "runner_disabled", message: "This dongo runner is disabled.", exitCode: 6 });
    }
    const configuredRoot = await realpath(config.repositoryRoot);
    const currentRoot = await realpath(this.#repositoryRoot);
    if (configuredRoot !== currentRoot || config.projectRef !== this.#projectRef) {
      throw new CliCoreError({
        code: "runner_binding_mismatch",
        message: "Runner repository binding does not match this project.",
        exitCode: 4,
      });
    }
    await this.#writeState(this.#state(config, "starting"));
    let failureAttempt = 0;
    while (!signal?.aborted) {
      try {
        await this.#writeState(this.#state(config, "waiting", undefined, {
          lastSeenAt: new Date(this.#now()).toISOString(),
        }));
        const result = await this.#api.runnerWait({
          idempotencyKey: randomUUID(),
          registrationId: config.registrationId,
          token: config.token,
          waitSeconds: 20,
          platform: config.platform,
          version: config.version,
          harnesses: config.harnesses,
          approvalMode: config.approvalMode,
        }, { signal });
        failureAttempt = 0;
        if (result.job) await this.#handleJob(config, result.job, signal);
      } catch (error) {
        if (signal?.aborted || isCancellation(error)) break;
        failureAttempt += 1;
        const code = safeErrorCode(error);
        await this.#writeState(this.#state(config, "error", undefined, {
          lastErrorCode: code,
        }));
        if (code === "unauthorized" || code === "forbidden" || code === "insufficient_scope") {
          return { stopped: true };
        }
        const delay = backoffMilliseconds(failureAttempt, this.#random);
        await this.#sleep(delay, signal).catch(() => undefined);
      }
    }
    await this.#writeState(this.#state(config, "stopped"));
    return { stopped: true };
  }

  async #handleJob(config: RunnerConfig, initialJob: RunnerJob, signal?: AbortSignal) {
    let job = initialJob;
    if (job.state === "cancel_requested") {
      await this.#updateJob(config, job, "cancelled", { safeCode: "cancelled_before_start" }, signal);
      return;
    }
    if (job.state === "running" || job.state === "blocked") {
      const pending = await this.#readPendingResult(config, job);
      if (pending) {
        await this.#updateJob(config, job, pending.outcome, pending, signal);
        await this.#store.delete(resultKey(config.projectRef, job.id));
      } else {
        await this.#updateJob(config, job, "failed", {
          safeCode: "runner_restarted",
          safeSummary: "The local runner restarted before it could confirm the harness outcome.",
        }, signal);
      }
      return;
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
    if (job.state !== "starting") return;
    const adapter = this.#adapter?.(job.harness);
    if (!adapter || adapter.harness !== job.harness) {
      await this.#updateJob(config, job, "failed", {
        safeCode: "harness_unavailable",
        safeSummary: `${job.harness} is not available on this runner.`,
      }, signal);
      return;
    }
    const log = new RunnerLog(this.#configDirectory, config.projectRef, job.id);
    const controller = new AbortController();
    const relayAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", relayAbort, { once: true });
    let current = await this.#updateJob(config, job, "running", {}, signal);
    await this.#writeState(this.#state(config, "running", current));
    const execution = adapter.execute({
      repositoryRoot: config.repositoryRoot,
      workIdentifier: current.workIdentifier,
      signal: controller.signal,
      log: (chunk) => log.append(chunk),
    }).catch((): RunnerHarnessResult => ({
      outcome: "failed",
      safeCode: controller.signal.aborted ? "cancelled" : "harness_failed",
      safeSummary: controller.signal.aborted
        ? "Local execution was cancelled."
        : "The local harness stopped before completing the job.",
    }));
    try {
      while (true) {
        const settled = await Promise.race([
          execution.then((value) => ({ kind: "result" as const, value })),
          this.#sleep(15_000, signal).then(() => ({ kind: "tick" as const })),
        ]);
        if (settled.kind === "result") {
          const state = settled.value.outcome === "completed" ? "completed" : "failed";
          const pending = {
            outcome: state,
            safeCode: settled.value.safeCode,
            safeSummary: settled.value.safeSummary,
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
        current = await this.#updateJob(config, current, "running", {}, signal);
      }
    } finally {
      signal?.removeEventListener("abort", relayAbort);
    }
  }

  async #awaitApproval(config: RunnerConfig, initial: RunnerJob, signal?: AbortSignal) {
    let job = initial;
    await this.#writeState(this.#state(config, "awaiting_local_approval", job));
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
      }, { signal });
      if (!polled.job || polled.job.id !== job.id) {
        throw new CliCoreError({ code: "runner_lease_lost", message: "Runner approval job was lost.", exitCode: 6 });
      }
      job = polled.job;
      if (job.state === "cancel_requested") {
        return await this.#updateJob(config, job, "cancelled", { safeCode: "user_cancelled" }, signal);
      }
      if (job.state === "expired") return job;
      await this.#writeState(this.#state(config, "awaiting_local_approval", job));
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
    return await this.#api.runnerUpdateJob({
      idempotencyKey: randomUUID(),
      registrationId: config.registrationId,
      token: config.token,
      jobId: job.id,
      expectedRevision: job.revision,
      state,
      leaseSeconds: state === "starting" || state === "running" ? 90 : undefined,
      ...detail,
    }, { signal });
  }

  #state(
    config: RunnerConfig,
    status: RunnerLocalState["status"],
    job?: RunnerJob,
    extra: Pick<RunnerLocalState, "lastSeenAt" | "lastErrorCode"> = {},
  ): RunnerLocalState {
    return {
      schemaVersion: 1,
      status,
      projectRef: config.projectRef,
      registrationId: config.registrationId,
      version: config.version,
      currentJob: job ? {
        id: job.id,
        workIdentifier: job.workIdentifier,
        harness: job.harness,
        state: job.state,
        revision: job.revision,
      } : undefined,
      ...extra,
      updatedAt: new Date(this.#now()).toISOString(),
    };
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
      const value = JSON.parse(raw) as RunnerLocalState;
      return value.schemaVersion === 1 && value.projectRef === this.#projectRef
        ? value
        : undefined;
    } catch {
      return undefined;
    }
  }

  async #writeState(state: RunnerLocalState) {
    await this.#store.set(stateKey(this.#projectRef), JSON.stringify(state));
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
    return value as RunnerConfig;
  } catch {
    throw new CliCoreError({
      code: "runner_config_invalid",
      message: "The local dongo runner configuration is invalid. Remove and reinstall it.",
      exitCode: 4,
    });
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
