import { randomUUID } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";

import { DongoClient, DongoClientError } from "@dongo/client";
import type { OverviewData, SessionStartData, SyncSnapshotData } from "@dongo/client";
import { agentScopes } from "@dongo/contracts";
import type {
  OperationInput,
  OperationName,
  OperationOutput,
  RunnerApprovalMode,
  RunnerHarness,
} from "@dongo/contracts";
import { exportSnapshot } from "@dongo/repo-export";
import type { ExportResult } from "@dongo/repo-export";
import { fetchAttachmentFile } from "./attachments.ts";
import type { AttachmentFetchResult } from "./attachments.ts";
import type { BrowserOpener } from "./browser.ts";
import { SystemBrowserOpener } from "./browser.ts";
import { DeviceAuthorizationClient } from "./device-auth.ts";
import type { DeviceAuthorizationEvents, DeviceAuthClock } from "./device-auth.ts";
import type { DongoEnvironment, EnvironmentConfig } from "./environment.ts";
import { resolveEnvironment } from "./environment.ts";
import { CliCoreError } from "./errors.ts";
import { configureIntegration } from "./integrations.ts";
import type { IntegrationHost, IntegrationResult } from "./integrations.ts";
import type { ProjectMarker } from "./marker.ts";
import { readProjectMarker, writeProjectMarker } from "./marker.ts";
import { createRunnerAdapterResolver } from "./runner-adapters.ts";
import {
  createRunnerStore,
  LocalRunnerManager,
  type RunnerAdapterResolver,
  type RunnerBrowserReviewMode,
} from "./runner.ts";
import {
  LocalRunnerServiceController,
  type RunnerServiceController,
} from "./runner-service.ts";
import {
  credentialProfile,
  findRepositoryRoot,
  normalizeRepositoryUrl,
  repositoryOriginUrl,
  suggestedProjectName,
} from "./repository.ts";
import type { SecretStore } from "./secret-store.ts";
import { createDefaultSecretStore, defaultConfigDirectory } from "./secret-store.ts";
import type { StoredCredential } from "./token-manager.ts";
import { TokenManager } from "./token-manager.ts";

export interface CoreServiceOptions {
  cwd?: string;
  fetch?: typeof globalThis.fetch;
  browserOpener?: BrowserOpener;
  deviceClock?: DeviceAuthClock;
  now?: () => number;
  secretStore?: SecretStore;
  configDirectory?: string;
  /** Source-only escape hatch for dongo's own isolated development harnesses. */
  allowNonProduction?: boolean;
  runnerServiceController?: RunnerServiceController;
  runnerAdapter?: RunnerAdapterResolver;
  runnerRuntime?: { nodePath: string; cliPath: string };
}

export interface ConnectOptions {
  environment?: DongoEnvironment;
  origin?: string;
  noBrowser?: boolean;
  projectName?: string;
  projectRef?: string;
  repositoryUrl?: string;
  executionMode?: "manual" | "autonomous";
  /** Explicitly propose creating a new project instead of matching an existing one. */
  createProject?: boolean;
  /** Include one supported MCP host in the browser's single setup approval. */
  agentHost?: "codex";
  events?: DeviceAuthorizationEvents;
  signal?: AbortSignal;
}

export interface ConnectResult {
  repositoryRoot: string;
  markerPath: string;
  project: SessionStartData["project"];
  installation: SessionStartData["installation"];
  scopes: string[];
  credentialStore: string;
}

export type CreateProjectOptions = Omit<
  ConnectOptions,
  "projectRef" | "createProject"
>;

async function resolveProspectivePath(target: string): Promise<string> {
  let existing = path.resolve(target);
  const missing: string[] = [];
  while (true) {
    try {
      return path.join(await realpath(existing), ...missing.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(existing);
      if (parent === existing) throw error;
      missing.push(path.basename(existing));
      existing = parent;
    }
  }
}

export interface CiSetupOptions {
  environment?: Exclude<DongoEnvironment, "custom">;
  signal?: AbortSignal;
}

export interface CiSetupResult extends ConnectResult {
  credentialStore: "environment";
}

export interface DoctorResult {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
  project?: SessionStartData["project"];
  installation?: SessionStartData["installation"];
}

export class CoreService {
  readonly #cwd: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #browserOpener: BrowserOpener;
  readonly #deviceClock?: DeviceAuthClock;
  readonly #now: () => number;
  readonly #providedStore?: SecretStore;
  readonly #configDirectory: string;
  readonly #allowNonProduction: boolean;
  readonly #runnerServiceController?: RunnerServiceController;
  readonly #runnerAdapter?: RunnerAdapterResolver;
  readonly #runnerRuntime?: { nodePath: string; cliPath: string };

  constructor(options: CoreServiceOptions = {}) {
    this.#cwd = options.cwd ?? process.cwd();
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#browserOpener = options.browserOpener ?? new SystemBrowserOpener();
    this.#deviceClock = options.deviceClock;
    this.#now = options.now ?? Date.now;
    this.#providedStore = options.secretStore;
    this.#configDirectory = options.configDirectory ?? defaultConfigDirectory();
    this.#allowNonProduction = options.allowNonProduction ?? false;
    this.#runnerServiceController = options.runnerServiceController;
    this.#runnerAdapter = options.runnerAdapter;
    this.#runnerRuntime = options.runnerRuntime;
  }

  async connect(options: ConnectOptions = {}): Promise<ConnectResult> {
    if (process.env.DONGO_TOKEN) {
      throw new CliCoreError({
        code: "validation",
        message: "Unset DONGO_TOKEN before interactive dongo connect; it is only a non-interactive CI/service override.",
        exitCode: 2,
      });
    }
    if (!this.#allowNonProduction && (options.environment !== undefined || options.origin !== undefined)) {
      throw new CliCoreError({
        code: "validation",
        message: "The dongo CLI connects to dongo.so. Development and custom origins are internal-only.",
        exitCode: 2,
      });
    }
    const repositoryRoot = await findRepositoryRoot(this.#cwd);
    await this.#validateConfigDirectory(repositoryRoot);
    const environment = resolveEnvironment({ environment: options.environment, origin: options.origin });
    const projectName = options.projectName?.trim() || suggestedProjectName(repositoryRoot);
    if (!projectName || projectName.length > 120) {
      throw new CliCoreError({ code: "validation", message: "The proposed project name must be between 1 and 120 characters.", exitCode: 2 });
    }
    const inferredRepositoryUrl = await repositoryOriginUrl(repositoryRoot);
    const repositoryUrl = options.repositoryUrl === undefined
      ? inferredRepositoryUrl
      : normalizeRepositoryUrl(options.repositoryUrl);
    if (options.repositoryUrl !== undefined && !repositoryUrl) {
      throw new CliCoreError({ code: "validation", message: "--repository-url must be a safe HTTP, HTTPS, or SSH repository URL.", exitCode: 2 });
    }
    const profile = credentialProfile(environment.productOrigin, repositoryRoot);
    const requestedProjectRef = options.projectRef?.trim();
    if (options.createProject && requestedProjectRef) {
      throw new CliCoreError({
        code: "validation",
        message: "A new project cannot also bind to --project-ref.",
        exitCode: 2,
      });
    }
    if (requestedProjectRef !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/u.test(requestedProjectRef)) {
      throw new CliCoreError({ code: "validation", message: "--project-ref must be a valid dongo public project reference.", exitCode: 2 });
    }
    const existingMarker = await readProjectMarker(repositoryRoot);
    const markerMatchesEnvironment = existingMarker
      && existingMarker.productOrigin === environment.productOrigin
      && existingMarker.issuer === environment.issuer
      && existingMarker.apiBaseUrl === environment.apiBaseUrl
      && existingMarker.apiResource === environment.apiResource
      && existingMarker.credentialProfile === profile;
    const projectRef = options.createProject
      ? undefined
      : requestedProjectRef || (markerMatchesEnvironment ? existingMarker.publicProjectRef : undefined);
    const store = this.#secretStore();
    const auth = new DeviceAuthorizationClient({
      deviceAuthorizationEndpoint: environment.deviceAuthorizationEndpoint,
      tokenEndpoint: environment.tokenEndpoint,
      clientId: environment.cliClientId,
      resource: environment.apiResource,
      scopes: [...agentScopes],
      fetch: this.#fetch,
      clock: this.#deviceClock,
      browserOpener: this.#browserOpener,
      noBrowser: options.noBrowser,
      projectProposal: {
        name: projectName,
        repositoryUrl,
        executionMode: options.executionMode ?? "manual",
        projectRef,
        projectAction: options.createProject ? "create" : undefined,
        agentHost: options.agentHost,
      },
      events: options.events,
      signal: options.signal,
    });
    const tokenSet = await auth.authorize();
    if (options.signal?.aborted) throw this.#cancellationError();
    await mkdir(this.#configDirectory, { recursive: true, mode: 0o700 });
    const manager = this.#tokenManager(profile, store);
    const credential: StoredCredential = {
      schemaVersion: 1,
      clientId: environment.cliClientId,
      issuer: environment.issuer,
      resource: environment.apiResource,
      tokenEndpoint: environment.tokenEndpoint,
      revocationEndpoint: environment.revocationEndpoint,
      accessToken: tokenSet.accessToken,
      accessTokenExpiresAt: tokenSet.expiresAt,
      refreshToken: tokenSet.refreshToken,
      tokenType: tokenSet.tokenType,
      scopes: tokenSet.scope,
    };
    const bootstrapClient = new DongoClient({
      baseUrl: environment.apiBaseUrl,
      tokenProvider: { getAccessToken: async () => tokenSet.accessToken },
      fetch: this.#fetch,
    });
    const session = await bootstrapClient.sessionStart(
      { externalSessionId: randomUUID() },
      { signal: options.signal },
    );
    if (options.signal?.aborted) throw this.#cancellationError();
    this.#validateSession(session);
    await manager.save(credential);
    const marker: ProjectMarker = {
      schemaVersion: 1,
      environment: environment.environment,
      productOrigin: environment.productOrigin,
      issuer: environment.issuer,
      apiBaseUrl: environment.apiBaseUrl,
      apiResource: environment.apiResource,
      publicProjectRef: session.project.publicRef,
      projectId: session.project.id,
      projectName: session.project.name,
      installationId: session.installation.id,
      credentialProfile: profile,
      connectedAt: new Date(this.#now()).toISOString(),
    };
    const writtenMarker = await writeProjectMarker(repositoryRoot, marker);
    return {
      repositoryRoot,
      markerPath: writtenMarker,
      project: session.project,
      installation: session.installation,
      scopes: tokenSet.scope,
      credentialStore: store.kind,
    };
  }

  async createProject(options: CreateProjectOptions = {}): Promise<ConnectResult> {
    return await this.connect({ ...options, createProject: true });
  }

  async setupCi(options: CiSetupOptions = {}): Promise<CiSetupResult> {
    if (!this.#allowNonProduction && options.environment !== undefined) {
      throw new CliCoreError({
        code: "validation",
        message: "The dongo CLI connects to dongo.so. Development environments are internal-only.",
        exitCode: 2,
      });
    }
    const token = process.env.DONGO_TOKEN;
    if (
      !token ||
      !/^dng_svc_[A-Za-z0-9_-]{11}_[A-Za-z0-9_-]{43}$/u.test(token)
    ) {
      throw new CliCoreError({
        code: "authentication_required",
        message:
          "Set DONGO_TOKEN to a dongo CI/service credential before running dongo ci setup.",
        exitCode: 3,
      });
    }
    const repositoryRoot = await findRepositoryRoot(this.#cwd);
    await this.#validateConfigDirectory(repositoryRoot);
    const environment = resolveEnvironment({
      environment: options.environment ?? "production",
    });
    const profile = credentialProfile(environment.productOrigin, repositoryRoot);
    const bootstrapClient = new DongoClient({
      baseUrl: environment.apiBaseUrl,
      tokenProvider: { getAccessToken: async () => token },
      fetch: this.#fetch,
    });
    const session = await bootstrapClient.sessionStart(
      { externalSessionId: randomUUID() },
      { signal: options.signal },
    );
    if (options.signal?.aborted) throw this.#cancellationError();
    this.#validateSession(session);
    const marker: ProjectMarker = {
      schemaVersion: 1,
      environment: environment.environment,
      productOrigin: environment.productOrigin,
      issuer: environment.issuer,
      apiBaseUrl: environment.apiBaseUrl,
      apiResource: environment.apiResource,
      publicProjectRef: session.project.publicRef,
      projectId: session.project.id,
      projectName: session.project.name,
      installationId: session.installation.id,
      credentialProfile: profile,
      connectedAt: new Date(this.#now()).toISOString(),
    };
    const writtenMarker = await writeProjectMarker(repositoryRoot, marker);
    return {
      repositoryRoot,
      markerPath: writtenMarker,
      project: session.project,
      installation: session.installation,
      scopes: [],
      credentialStore: "environment",
    };
  }

  async authStatus() {
    const context = await this.#context(false);
    if (!context) {
      return { authenticated: false, repositoryRoot: await findRepositoryRoot(this.#cwd), marker: undefined, credential: undefined };
    }
    const credential = await context.manager.status();
    return {
      authenticated: credential.authenticated,
      repositoryRoot: context.repositoryRoot,
      marker: context.marker,
      credential,
    };
  }

  async logout(): Promise<{ revoked: true; repositoryRoot: string; installationId: string }> {
    const context = await this.#context(true);
    await context.manager.logout();
    return { revoked: true, repositoryRoot: context.repositoryRoot, installationId: context.marker.installationId };
  }

  async doctor(signal?: AbortSignal): Promise<DoctorResult> {
    const checks: DoctorResult["checks"] = [];
    let context;
    try {
      context = await this.#context(true);
      checks.push({ name: "repository", ok: true, detail: context.repositoryRoot });
      checks.push({ name: "project-marker", ok: true, detail: `${context.marker.projectName} (${context.marker.publicProjectRef})` });
      const status = await context.manager.status();
      checks.push({ name: "authorization-server", ok: true, detail: context.environment.issuer });
      checks.push({ name: "api-resource", ok: true, detail: context.environment.apiResource });
      checks.push({
        name: "credential-store",
        ok: status.authenticated,
        detail: status.authenticated
          ? `${status.store}; ${status.scopes.join(", ") || "scope metadata unavailable"}; expires ${
              status.accessTokenExpiresAt ? new Date(status.accessTokenExpiresAt).toISOString() : "on demand"
            }`
          : "not authenticated",
      });
      const session = await this.#client(context.environment.apiBaseUrl, context.manager).sessionStart({
        externalSessionId: randomUUID(),
      }, { signal });
      this.#validateSession(session);
      const matches = session.project.publicRef === context.marker.publicProjectRef && session.installation.id === context.marker.installationId;
      checks.push({ name: "server-context", ok: matches, detail: matches ? "project and installation match" : "server context does not match marker" });
      return { ok: checks.every((check) => check.ok), checks, project: session.project, installation: session.installation };
    } catch (error) {
      if (signal?.aborted) throw this.#cancellationError();
      const detail =
        error instanceof CliCoreError || error instanceof DongoClientError ? error.message : "Unexpected local failure.";
      checks.push({ name: "connectivity", ok: false, detail });
      return { ok: false, checks };
    }
  }

  async sessionStart(signal?: AbortSignal): Promise<SessionStartData> {
    const context = await this.#context(true);
    return this.#client(context.environment.apiBaseUrl, context.manager).sessionStart({
      externalSessionId: randomUUID(),
    }, { signal });
  }

  async overview(signal?: AbortSignal): Promise<OverviewData> {
    const context = await this.#context(true);
    return this.#client(context.environment.apiBaseUrl, context.manager).getOverview({}, { signal });
  }

  async execute<Name extends OperationName>(
    operation: Name,
    input: OperationInput<Name>,
    signal?: AbortSignal,
  ): Promise<OperationOutput<Name>> {
    const context = await this.#context(true);
    return this.#client(context.environment.apiBaseUrl, context.manager).call(operation, input, { signal });
  }

  async attachmentInfo(attachmentId: string, signal?: AbortSignal): Promise<{
    attachmentId: string;
    filename: string;
    contentType: string;
    byteSize: number;
    expiresAt: number;
    downloadAvailable: true;
  }> {
    const { downloadUrl: _downloadUrl, ...access } = await this.execute("get_attachment", { attachmentId }, signal);
    return { ...access, downloadAvailable: true };
  }

  async fetchAttachment(attachmentId: string, output?: string, signal?: AbortSignal): Promise<AttachmentFetchResult> {
    const context = await this.#context(true);
    const access = await this.#client(context.environment.apiBaseUrl, context.manager).getAttachment({ attachmentId }, { signal });
    return fetchAttachmentFile({
      repositoryRoot: context.repositoryRoot,
      access,
      output,
      fetch: this.#fetch,
      signal,
    });
  }

  async integration(host: IntegrationHost, apply = false): Promise<IntegrationResult> {
    const repositoryRoot = await findRepositoryRoot(this.#cwd);
    const marker = await readProjectMarker(repositoryRoot);
    if (!marker) {
      throw new CliCoreError({ code: "authentication_required", message: "This repository is not connected. Run dongo connect.", exitCode: 3 });
    }
    this.#validateMarker(repositoryRoot, marker);
    return configureIntegration({
      repositoryRoot,
      productOrigin: marker.productOrigin,
      publicProjectRef: marker.publicProjectRef,
      host,
      apply,
    });
  }

  async sync(signal?: AbortSignal): Promise<{ snapshot: SyncSnapshotData; export: ExportResult }> {
    const context = await this.#context(true);
    const snapshot = await this.#client(context.environment.apiBaseUrl, context.manager).syncSnapshot({}, { signal });
    if (!snapshot || !Array.isArray(snapshot.workItems)) {
      throw new CliCoreError({ code: "validation", message: "dongo returned an invalid sync snapshot." });
    }
    if (signal?.aborted) throw this.#cancellationError();
    return { snapshot, export: await exportSnapshot(context.repositoryRoot, snapshot) };
  }

  async runnerInstall(
    options: {
      label: string;
      harnesses: RunnerHarness[];
      approvalMode?: RunnerApprovalMode;
      browserReviewMode?: RunnerBrowserReviewMode;
    },
  ) {
    return await (await this.#runnerManager()).install(options);
  }

  async runnerStatus() {
    return await (await this.#runnerManager()).status();
  }

  async runnerApprove(jobId: string) {
    return await (await this.#runnerManager()).approve(jobId);
  }

  async runnerConfigureApproval(approvalMode: RunnerApprovalMode) {
    return await (await this.#runnerManager()).configureApproval(approvalMode);
  }

  async runnerConfigure(options: {
    approvalMode?: RunnerApprovalMode;
    browserReviewMode?: RunnerBrowserReviewMode;
  }) {
    return await (await this.#runnerManager()).configure(options);
  }

  async runnerDisable() {
    return await (await this.#runnerManager()).disable();
  }

  async runnerRemove() {
    return await (await this.#runnerManager()).remove();
  }

  async runnerRun(projectRef: string, signal?: AbortSignal) {
    const manager = await this.#runnerManager();
    const status = await manager.status();
    if (status.projectRef !== projectRef) {
      throw new CliCoreError({
        code: "runner_binding_mismatch",
        message: "Runner service project reference does not match this repository.",
        exitCode: 4,
      });
    }
    return await manager.run(signal);
  }

  async #runnerManager(): Promise<LocalRunnerManager> {
    const context = await this.#context(true);
    const cliPath = this.#runnerRuntime?.cliPath ?? process.argv[1];
    if (!cliPath) {
      throw new CliCoreError({
        code: "runner_service_failed",
        message: "The dongo CLI entrypoint could not be resolved for the runner service.",
        exitCode: 4,
      });
    }
    const runnerStore = this.#providedStore ?? createRunnerStore(this.#configDirectory);
    return new LocalRunnerManager({
      api: this.#client(context.environment.apiBaseUrl, context.manager),
      store: runnerStore,
      service: this.#runnerServiceController ?? new LocalRunnerServiceController(),
      repositoryRoot: context.repositoryRoot,
      projectRef: context.marker.publicProjectRef,
      projectId: context.marker.projectId ?? context.marker.publicProjectRef,
      installationId: context.marker.installationId,
      runtime: {
        nodePath: await realpath(this.#runnerRuntime?.nodePath ?? process.execPath),
        cliPath: await realpath(path.resolve(cliPath)),
      },
      configDirectory: this.#configDirectory,
      now: this.#now,
      adapter: this.#runnerAdapter ?? createRunnerAdapterResolver({ store: runnerStore }),
    });
  }

  async #context(required: true): Promise<{
    repositoryRoot: string;
    marker: ProjectMarker;
    environment: EnvironmentConfig;
    store: SecretStore;
    manager: TokenManager;
  }>;
  async #context(required: false): Promise<
    | { repositoryRoot: string; marker: ProjectMarker; environment: EnvironmentConfig; store: SecretStore; manager: TokenManager }
    | undefined
  >;
  async #context(required: boolean) {
    const repositoryRoot = await findRepositoryRoot(this.#cwd);
    await this.#validateConfigDirectory(repositoryRoot);
    const marker = await readProjectMarker(repositoryRoot);
    if (!marker) {
      if (!required) return undefined;
      throw new CliCoreError({ code: "authentication_required", message: "This repository is not connected. Run dongo connect.", exitCode: 3 });
    }
    const environment = this.#validateMarker(repositoryRoot, marker);
    const store = this.#secretStore();
    const manager = this.#tokenManager(marker.credentialProfile, store);
    if (process.env.DONGO_TOKEN && marker.environment === "custom") {
      throw new CliCoreError({
        code: "validation",
        message: "DONGO_TOKEN cannot be sent to a custom origin from repository configuration.",
        exitCode: 2,
      });
    }
    const credential = process.env.DONGO_TOKEN ? undefined : await manager.load();
    if (
      credential &&
      (credential.clientId !== environment.cliClientId ||
        credential.issuer !== environment.issuer ||
        credential.resource !== environment.apiResource ||
        credential.tokenEndpoint !== environment.tokenEndpoint ||
        credential.revocationEndpoint !== environment.revocationEndpoint)
    ) {
      throw new CliCoreError({
        code: "authentication_required",
        message: "Stored dongo authorization does not match this repository marker. Run dongo connect again.",
        exitCode: 3,
      });
    }
    return { repositoryRoot, marker, environment, store, manager };
  }

  #secretStore(): SecretStore {
    return (
      this.#providedStore ??
      createDefaultSecretStore({ configDirectory: this.#configDirectory })
    );
  }

  async #validateConfigDirectory(repositoryRoot: string): Promise<void> {
    if (this.#providedStore) return;
    const [resolvedRepositoryRoot, resolvedConfigDirectory] = await Promise.all([
      realpath(repositoryRoot),
      resolveProspectivePath(this.#configDirectory),
    ]);
    const relative = path.relative(resolvedRepositoryRoot, resolvedConfigDirectory);
    if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
      throw new CliCoreError({
        code: "unsafe_path",
        message: "DONGO_CONFIG_DIR must be outside the repository.",
        exitCode: 2,
      });
    }
  }

  #tokenManager(profile: string, store: SecretStore): TokenManager {
    return new TokenManager({
      profile,
      store,
      lockDirectory: this.#configDirectory,
      fetch: this.#fetch,
      now: this.#now,
    });
  }

  #client(baseUrl: string, manager: TokenManager): DongoClient {
    return new DongoClient({ baseUrl, tokenProvider: manager, fetch: this.#fetch });
  }

  #validateMarker(repositoryRoot: string, marker: ProjectMarker): EnvironmentConfig {
    if (!this.#allowNonProduction && marker.environment !== "production") {
      throw new CliCoreError({
        code: "validation",
        message: "This repository uses an internal dongo environment. Run dongo connect to connect it to dongo.so.",
        exitCode: 2,
      });
    }
    const environment =
      marker.environment === "custom"
        ? resolveEnvironment({ origin: marker.productOrigin })
        : resolveEnvironment({ environment: marker.environment });
    const expectedProfile = credentialProfile(environment.productOrigin, repositoryRoot);
    const matches =
      marker.productOrigin === environment.productOrigin &&
      marker.issuer === environment.issuer &&
      marker.apiBaseUrl === environment.apiBaseUrl &&
      marker.apiResource === environment.apiResource &&
      marker.credentialProfile === expectedProfile;
    if (!matches) {
      throw new CliCoreError({
        code: "validation",
        message: "Project marker origins or credential binding are inconsistent. Run dongo connect to repair it.",
        exitCode: 2,
      });
    }
    return environment;
  }

  #validateSession(session: SessionStartData): void {
    if (!session?.project?.publicRef || !session.project.name || !session.installation?.id) {
      throw new CliCoreError({ code: "validation", message: "dongo returned an incomplete session context." });
    }
  }

  #cancellationError(): CliCoreError {
    return new CliCoreError({ code: "cancelled", message: "The dongo command was cancelled.", exitCode: 130 });
  }
}

export function mapClientError(error: unknown): never {
  if (error instanceof DongoClientError) {
    const conflict = error.code.includes("conflict") || error.code === "lease_expired";
    throw new CliCoreError({
      code: conflict ? "conflict" : error.code,
      message: error.message,
      retryable: error.retryable,
      exitCode:
        error.code === "cancelled"
          ? 130
          : error.code === "unauthorized"
            ? 3
            : error.code === "insufficient_scope"
              ? 4
              : conflict
                ? 6
                : error.retryable
                  ? 5
                  : 1,
      details: {
        ...(error.details && typeof error.details === "object"
          ? error.details
          : {}),
        ...(error.requestId ? { requestId: error.requestId } : {}),
      },
      cause: error,
    });
  }
  throw error;
}
