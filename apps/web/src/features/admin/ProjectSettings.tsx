import { A, useNavigate, useSearchParams } from "@solidjs/router";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Brand } from "../../components/Brand";
import { PageTitle } from "../../components/PageTitle";
import { SignOutButton } from "../../components/SignOutButton";
import { ChangelogPublisher, type ChangelogPublisherProps } from "./ChangelogPublisher";
import { dongoPublicOrigin } from "../../lib/auth-config";
import {
  ProjectDataConnection,
  type CreatedServiceCredential,
  type ProjectAdministration,
  type ProjectInfo,
  type ProjectInstallation,
  type RunnerRegistration,
  type RunnerHarness,
  type RunnerJobState,
  type RunnerSnapshot,
} from "../../lib/project-data";
import { lowercaseDongoBrand } from "../../lib/brand-case";
import { projectCreationAction } from "../../lib/plans";
import { projectPageTitle } from "../../lib/page-title";
import {
  DEFAULT_PARALLEL_RUN_LIMIT,
  parallelExecutionPolicy,
} from "../../lib/parallel-execution";
import { organizationSlugify } from "../../lib/slug";
import "./admin.css";

type ProjectSettingsConnection = {
  project: ProjectInfo;
  getAdministration: () => Promise<ProjectAdministration>;
  subscribeInstallations: (
    onUpdate: (installations: ProjectInstallation[]) => void,
    onError: (error: Error) => void,
  ) => () => void;
  subscribeRunners: (
    onUpdate: (snapshot: RunnerSnapshot) => void,
    onError: (error: Error) => void,
  ) => () => void;
  updateProject: (input: {
    name: string;
    repositoryUrl?: string;
    executionMode: "manual" | "autonomous";
    parallelExecution: {
      enabled: boolean;
      maxConcurrentRuns: number;
      requiresIsolatedWorkspaces: true;
    };
  }) => Promise<void>;
  updateOrganization: (name: string) => Promise<{ name: string; slug: string }>;
  revokeInstallation: (installationId: string) => Promise<void>;
  revokeRunner: (registrationId: string) => Promise<RunnerRegistration>;
  configureAutomaticIntake: (input: {
    expectedRevision: number;
    registrationId?: string;
    harness?: RunnerHarness;
    includeExisting?: boolean;
  }) => Promise<RunnerSnapshot["automaticIntake"] & { queuedExistingCount: number; hasMoreExisting: boolean }>;
  createServiceCredential: (input: {
    label: string;
    scopes: string[];
  }) => Promise<CreatedServiceCredential>;
  removeMember: (membershipId: string) => Promise<void>;
  addMember: (email: string) => Promise<{ created: boolean }>;
  archive: () => Promise<void>;
  unarchive: () => Promise<void>;
  close: () => Promise<void>;
};

export type ProjectSettingsDependencies = {
  changelog?: Omit<ChangelogPublisherProps, "projectId">;
  connectForSettings: (
    orgSlug: string,
    projectSlug: string,
  ) => Promise<ProjectSettingsConnection>;
  writeClipboard: (text: string) => Promise<void>;
};

export type ProjectSettingsProps = {
  orgSlug: string;
  projectSlug: string;
  dependencies?: Partial<ProjectSettingsDependencies>;
};

type Tab = "General" | "Agent access" | "Local runner" | "Members" | "Plan & storage";
const SETTINGS_TABS: readonly Tab[] = ["General", "Agent access", "Local runner", "Members", "Plan & storage"];
const SERVICE_SCOPES = [
  {
    value: "dongo:work:read",
    label: "Read project work",
    detail: "Overview, Intake, Work, Attention, comments, and sync snapshots.",
  },
  {
    value: "dongo:work:write",
    label: "Change project work",
    detail: "Claim, triage, create, update, comment, request Attention, and finish.",
  },
  {
    value: "dongo:attachments:read",
    label: "Read attachments",
    detail: "Request short-lived download links for project attachments.",
  },
] as const;

function settingsTab(value: string | undefined): Tab {
  return SETTINGS_TABS.find((tab) => tab === value) ?? "General";
}

function relativeTime(timestamp: number | undefined): string {
  if (!timestamp) return "never used";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000));
  if (seconds < 10) return "used now";
  if (seconds < 60) return `used ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `used ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `used ${hours}h ago`;
  return `used ${Math.floor(hours / 24)}d ago`;
}

function installationType(installation: ProjectInstallation): string {
  const host = installation.kind === "mcp" ? "remote MCP" : installation.kind.toUpperCase();
  return [host, installation.machineLabel].filter(Boolean).join(" · ");
}

function runnerJobLabel(state: RunnerJobState): string {
  switch (state) {
    case "queued": return "queued · waiting for an online runner";
    case "delivered": return "delivered";
    case "awaiting_local_approval": return "waiting for local approval";
    case "starting": return "starting";
    case "running": return "running";
    case "blocked": return "blocked";
    case "cancel_requested": return "cancelling";
    case "cancelled": return "cancelled";
    case "failed": return "failed";
    case "completed": return "completed";
    case "expired": return "expired";
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1_024;
  let unit = 0;
  while (value >= 1_024 && unit < units.length - 1) {
    value /= 1_024;
    unit += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function normalizedRepositoryUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("invalid repository URL");
  }
  return parsed.toString();
}

export function ProjectSettings(props: ProjectSettingsProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams<{ tab?: string }>();
  const [tab, setTab] = createSignal<Tab>(settingsTab(searchParams.tab));
  const [project, setProject] = createSignal<ProjectInfo>();
  const [administration, setAdministration] = createSignal<ProjectAdministration>();
  const [installations, setInstallations] = createSignal<ProjectInstallation[]>([]);
  const [runners, setRunners] = createSignal<RunnerSnapshot>({ registrations: [], jobs: [], automaticIntake: { enabled: false, revision: 0 }, serverTime: Date.now() });
  const [projectName, setProjectName] = createSignal("");
  const [repositoryUrl, setRepositoryUrl] = createSignal("");
  const [executionMode, setExecutionMode] = createSignal<"manual" | "autonomous">("manual");
  const [allowParallelWork, setAllowParallelWork] = createSignal(false);
  const [maxConcurrentRuns, setMaxConcurrentRuns] = createSignal(DEFAULT_PARALLEL_RUN_LIMIT);
  const [organizationName, setOrganizationName] = createSignal("");
  const [memberEmail, setMemberEmail] = createSignal("");
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  const [status, setStatus] = createSignal("");
  const [savingProject, setSavingProject] = createSignal(false);
  const [savingOrganization, setSavingOrganization] = createSignal(false);
  const [confirmRevoke, setConfirmRevoke] = createSignal<string>();
  const [revoking, setRevoking] = createSignal<string>();
  const [confirmRunnerRevoke, setConfirmRunnerRevoke] = createSignal<string>();
  const [revokingRunner, setRevokingRunner] = createSignal<string>();
  const [configuringAutomaticIntake, setConfiguringAutomaticIntake] = createSignal(false);
  const [confirmRemove, setConfirmRemove] = createSignal<string>();
  const [removing, setRemoving] = createSignal<string>();
  const [addingMember, setAddingMember] = createSignal(false);
  const [serviceLabel, setServiceLabel] = createSignal("Repository CI");
  const [serviceScopes, setServiceScopes] = createSignal<string[]>(
    SERVICE_SCOPES.map((scope) => scope.value),
  );
  const [creatingServiceCredential, setCreatingServiceCredential] = createSignal(false);
  const [createdServiceCredential, setCreatedServiceCredential] =
    createSignal<CreatedServiceCredential>();
  const [confirmArchive, setConfirmArchive] = createSignal(false);
  const [archiving, setArchiving] = createSignal(false);
  const [unarchiving, setUnarchiving] = createSignal(false);
  let connection: ProjectSettingsConnection | undefined;
  let unsubscribe: (() => void) | undefined;
  let unsubscribeRunners: (() => void) | undefined;
  let manualModeButton: HTMLButtonElement | undefined;
  let autonomousModeButton: HTMLButtonElement | undefined;
  let disposed = false;
  const connectForSettings = props.dependencies?.connectForSettings ?? ProjectDataConnection.connectForSettings;
  const writeClipboard = props.dependencies?.writeClipboard ?? (
    (text: string) => navigator.clipboard.writeText(text)
  );

  const owner = createMemo(() => administration()?.membershipRole === "owner");
  const organizationSlugPreview = createMemo(() => {
    const current = administration()?.organization;
    return current && current.name === organizationName().trim()
      ? current.slug
      : organizationSlugify(organizationName());
  });
  const planAction = createMemo(() => {
    const admin = administration();
    if (!admin) return undefined;
    return projectCreationAction({
      plan: admin.organization.plan,
      activeProjectCount: admin.activeProjectCount,
      activeProjectLimit: admin.projectAllowance.limit ?? null,
      projectCapacitySource: admin.projectAllowance.source,
      canCreateProject: admin.projectAllowance.canCreate,
    }, admin.organization.slug, admin.project.slug);
  });

  createEffect(() => setTab(settingsTab(searchParams.tab)));

  const selectTab = (next: Tab) => {
    setTab(next);
    setSearchParams({ tab: next === "General" ? undefined : next });
    setError("");
    setStatus("");
  };

  const selectExecutionMode = (
    mode: "manual" | "autonomous",
    focus = false,
  ) => {
    setExecutionMode(mode);
    if (focus) {
      queueMicrotask(() => {
        (mode === "manual" ? manualModeButton : autonomousModeButton)?.focus();
      });
    }
  };

  const moveExecutionMode = (event: KeyboardEvent) => {
    if (!owner()) return;
    let next: "manual" | "autonomous" | undefined;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp" || event.key === "Home") {
      next = "manual";
    }
    if (event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === "End") {
      next = "autonomous";
    }
    if (!next) return;
    event.preventDefault();
    selectExecutionMode(next, true);
  };

  const applyAdministration = (next: ProjectAdministration) => {
    const parallelExecution = next.project.parallelExecution ?? parallelExecutionPolicy(false);
    setAdministration(next);
    setProjectName(next.project.name);
    setRepositoryUrl(next.project.repositoryUrl ?? "");
    setExecutionMode(next.project.executionMode);
    setAllowParallelWork(parallelExecution.enabled);
    setMaxConcurrentRuns(
      parallelExecution.enabled
        ? parallelExecution.maxConcurrentRuns
        : DEFAULT_PARALLEL_RUN_LIMIT,
    );
    setOrganizationName(next.organization.name);
  };

  const refreshAdministration = async () => {
    if (!connection) return;
    const next = await connection.getAdministration();
    if (!disposed) applyAdministration(next);
  };

  onMount(() => {
    void connectForSettings(props.orgSlug, props.projectSlug)
      .then(async (connected) => {
        if (disposed) {
          await connected.close();
          return;
        }
        connection = connected;
        setProject(connected.project);
        const next = await connected.getAdministration();
        if (disposed) return;
        applyAdministration(next);
        if (next.membershipRole === "owner") {
          unsubscribe = connected.subscribeInstallations(
            setInstallations,
            () => setError("Agent installations are temporarily unavailable."),
          );
          unsubscribeRunners = connected.subscribeRunners(
            setRunners,
            () => setError("Local runner status is temporarily unavailable."),
          );
        }
        setLoading(false);
      })
      .catch(() => {
        setError("This project could not be loaded for your account.");
        setLoading(false);
      });
  });

  onCleanup(() => {
    disposed = true;
    unsubscribe?.();
    unsubscribeRunners?.();
    void connection?.close();
  });

  const saveProject = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!connection || savingProject() || !owner()) return;
    const name = projectName().trim();
    if (!name) {
      setError("Enter a project name.");
      return;
    }
    let repository: string | undefined;
    try {
      repository = normalizedRepositoryUrl(repositoryUrl());
    } catch {
      setError("Enter a credential-free HTTP or HTTPS repository URL.");
      return;
    }
    setSavingProject(true);
    setError("");
    setStatus("");
    try {
      await connection.updateProject({
        name,
        repositoryUrl: repository,
        executionMode: executionMode(),
        parallelExecution: parallelExecutionPolicy(
          allowParallelWork(),
          maxConcurrentRuns(),
        ),
      });
      setProject({ ...connection.project });
      await refreshAdministration();
      setStatus("Project settings saved.");
    } catch {
      setError("Project settings could not be saved. Try again.");
    } finally {
      setSavingProject(false);
    }
  };

  const saveOrganization = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!connection || savingOrganization() || !owner()) return;
    const name = organizationName().trim();
    if (!name) {
      setError("Enter an organization name.");
      return;
    }
    if (!organizationSlugPreview()) {
      setError("Use at least one letter or number in the organization name.");
      return;
    }
    setSavingOrganization(true);
    setError("");
    setStatus("");
    try {
      const updated = await connection.updateOrganization(name);
      setProject({ ...connection.project });
      await refreshAdministration();
      setStatus("Organization settings saved.");
      navigate(
        `/app/${encodeURIComponent(updated.slug)}/${encodeURIComponent(connection.project.slug)}/settings?tab=Members`,
        { replace: true },
      );
    } catch {
      setError("Organization settings could not be saved. Try again.");
    } finally {
      setSavingOrganization(false);
    }
  };

  const revoke = async (installationId: string) => {
    if (!connection || revoking()) return;
    setRevoking(installationId);
    setError("");
    try {
      await connection.revokeInstallation(installationId);
      setConfirmRevoke(undefined);
      setStatus("Agent access revoked.");
    } catch {
      setError("The installation could not be revoked. Try again.");
    } finally {
      setRevoking(undefined);
    }
  };

  const revokeLocalRunner = async (registrationId: string) => {
    if (!connection || revokingRunner()) return;
    setRevokingRunner(registrationId);
    setError("");
    try {
      await connection.revokeRunner(registrationId);
      setConfirmRunnerRevoke(undefined);
      setStatus("Local runner access revoked. Remove its local service from that computer when available.");
    } catch {
      setError("The local runner could not be revoked. Try again.");
    } finally {
      setRevokingRunner(undefined);
    }
  };

  const configureAutomaticIntake = async (registrationId?: string, harness?: RunnerHarness, includeExisting = false) => {
    if (!connection || configuringAutomaticIntake()) return;
    setConfiguringAutomaticIntake(true);
    setError("");
    try {
      const result = await connection.configureAutomaticIntake({
        expectedRevision: runners().automaticIntake.revision,
        ...(registrationId && harness ? { registrationId, harness } : {}),
        ...(includeExisting ? { includeExisting: true } : {}),
      });
      setStatus(registrationId && harness
        ? `${harness === "claude" ? "Claude Code" : "Codex"} will process new Inbox items automatically on this computer.${result.queuedExistingCount > 0 ? ` ${result.queuedExistingCount} waiting ${result.queuedExistingCount === 1 ? "item was" : "items were"} queued too.` : ""}${result.hasMoreExisting ? " More are still waiting; choose Process waiting Inbox now again." : ""}`
        : "Automatic Inbox processing is off.");
    } catch {
      setError("Automatic Inbox processing could not be changed. Refresh and try again.");
    } finally {
      setConfiguringAutomaticIntake(false);
    }
  };

  const runnerPresence = (runner: RunnerRegistration) => {
    if (runner.status === "revoked") return "revoked";
    const activeStates = new Set<RunnerJobState>([
      "delivered",
      "awaiting_local_approval",
      "starting",
      "running",
      "blocked",
      "cancel_requested",
    ]);
    const activeJobs = runners().jobs.filter((job) =>
      job.registrationId === runner.id && activeStates.has(job.state)).length;
    if (
      (runner.waitingUntil !== undefined && runner.waitingUntil > runners().serverTime) ||
      (runner.lastSeenAt !== undefined && runner.lastSeenAt >= runners().serverTime - 45_000)
    ) {
      if (activeJobs > 0) {
        const limit = allowParallelWork() ? maxConcurrentRuns() : 1;
        return activeJobs >= limit
          ? `online · at capacity · ${activeJobs} active`
          : `online · ${activeJobs} active of ${limit}`;
      }
      return "online · waiting for work";
    }
    return runner.lastSeenAt
      ? `offline · ${relativeTime(runner.lastSeenAt).replace(/^used /u, "last seen ")}`
      : "offline · never connected";
  };

  const toggleServiceScope = (scope: string) => {
    setServiceScopes((current) =>
      current.includes(scope)
        ? current.filter((entry) => entry !== scope)
        : [...current, scope],
    );
  };

  const createServiceCredential = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!connection || creatingServiceCredential() || !owner()) return;
    const label = serviceLabel().trim();
    if (!label) {
      setError("Name this CI/service credential.");
      return;
    }
    if (serviceScopes().length === 0) {
      setError("Select at least one CI/service permission.");
      return;
    }
    setCreatingServiceCredential(true);
    setCreatedServiceCredential(undefined);
    setError("");
    setStatus("");
    try {
      const created = await connection.createServiceCredential({
        label,
        scopes: serviceScopes(),
      });
      setCreatedServiceCredential(created);
      setStatus("CI/service credential created. Copy it before leaving this page.");
    } catch {
      setError("The CI/service credential could not be created. Try again.");
    } finally {
      setCreatingServiceCredential(false);
    }
  };

  const copyServiceCredential = async () => {
    const credential = createdServiceCredential();
    if (!credential) return;
    try {
      await writeClipboard(credential.token);
      setError("");
      setStatus("Credential copied. Store it as the DONGO_TOKEN secret in your CI provider.");
    } catch {
      setError("Copy failed. Select the credential and copy it manually before closing it.");
    }
  };

  const removeMember = async (membershipId: string) => {
    if (!connection || removing()) return;
    setRemoving(membershipId);
    setError("");
    try {
      await connection.removeMember(membershipId);
      setConfirmRemove(undefined);
      await refreshAdministration();
      setStatus("Member access removed.");
    } catch {
      setError("The member could not be removed. Try again.");
    } finally {
      setRemoving(undefined);
    }
  };

  const addMember = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!connection || addingMember() || !owner()) return;
    const email = memberEmail().trim().toLowerCase();
    if (!email || !email.includes("@")) {
      setError("Enter the email for an existing dongo account.");
      return;
    }
    setAddingMember(true);
    setError("");
    setStatus("");
    try {
      const result = await connection.addMember(email);
      await refreshAdministration();
      setMemberEmail("");
      setStatus(result.created ? "Member access added." : "That account is already a member.");
    } catch {
      setError("The member could not be added. Ask them to sign in to dongo once, then try again.");
    } finally {
      setAddingMember(false);
    }
  };

  const archive = async () => {
    if (!connection || archiving()) return;
    setArchiving(true);
    setError("");
    try {
      await connection.archive();
      navigate("/onboarding", { replace: true });
    } catch {
      setError("The project could not be archived. Try again.");
      setArchiving(false);
    }
  };

  const unarchive = async () => {
    if (!connection || unarchiving()) return;
    setUnarchiving(true);
    setError("");
    try {
      await connection.unarchive();
      setProject({ ...connection.project });
      await refreshAdministration();
      setStatus("Project restored. Existing agent installations remain revoked.");
    } catch {
      setError("The project could not be restored. Archive any other active free-plan project first.");
    } finally {
      setUnarchiving(false);
    }
  };

  return (
    <>
      <PageTitle value={projectPageTitle(project()?.name ?? props.projectSlug, "Settings")} />
      <main class="settings-page">
      <header class="settings-header">
        <Brand compact href={project()?.archivedAt ? "/open" : `/app/${props.orgSlug}/${props.projectSlug}`} />
        <div class="settings-header__title">/ {props.projectSlug} / settings</div>
        <div style={{ flex: 1 }} />
        <Show when={!project()?.archivedAt}>
          <A class="button button--quiet" href={`/app/${props.orgSlug}/${props.projectSlug}`}>← Overview</A>
        </Show>
        <SignOutButton />
      </header>
      <div class="settings-layout">
        <nav class="settings-nav" aria-label="Project settings">
          <For each={SETTINGS_TABS}>{(item) => (
            <button class="settings-nav__link" data-selected={tab() === item} aria-current={tab() === item ? "page" : undefined} type="button" onClick={() => selectTab(item)}>{item}</button>
          )}</For>
        </nav>

        <div class="settings-content">
          <Show when={loading()}><div class="note" role="status">Loading project settings…</div></Show>
          <Show when={error()}><div class="error" role="alert">{error()}</div></Show>
          <Show when={status()}><div class="success" role="status">{status()}</div></Show>
          <Show when={project()?.archivedAt}>
            <div class="archived-banner" role="status">
              <div><strong>This project is archived.</strong><span> Existing work is retained, and agent access is revoked.</span></div>
              <Show when={owner()}><button class="button" type="button" disabled={unarchiving()} onClick={() => void unarchive()}>{unarchiving() ? "Restoring…" : "Restore project"}</button></Show>
            </div>
          </Show>

          <Show when={!loading() && tab() === "General" ? administration() : undefined}>{(admin) => (
            <>
              <div class="settings-title-group"><div class="eyebrow">Project settings</div><h1 class="settings-title">General</h1><p class="auth-lede">Project identity and agent execution behavior.</p></div>
              <form class="settings-section" onSubmit={saveProject}>
                <div class="settings-grid">
                  <div class="field-group"><label class="field-label" for="settings-name">Project name</label><input class="input" id="settings-name" value={projectName()} disabled={!owner()} onInput={(event) => setProjectName(event.currentTarget.value)} /></div>
                  <div class="field-group"><label class="field-label" for="settings-slug">Project slug</label><input class="input mono" id="settings-slug" value={admin().project.slug} disabled /></div>
                </div>
                <div class="settings-grid">
                  <div class="field-group"><label class="field-label" for="settings-repo">Repository URL</label><input class="input mono" id="settings-repo" value={repositoryUrl()} disabled={!owner()} onInput={(event) => setRepositoryUrl(event.currentTarget.value)} placeholder="https://github.com/owner/repository" /></div>
                  <div class="field-group"><label class="field-label" for="settings-prefix">Work identifier code</label><input class="input mono" id="settings-prefix" value={admin().project.compactIdentifierPrefix} disabled /></div>
                </div>
                <div class="field-label" id="settings-mode">Agent execution mode</div>
                <div class="choice-list" role="radiogroup" aria-labelledby="settings-mode">
                  <button ref={manualModeButton} class="choice" data-selected={executionMode() === "manual"} type="button" role="radio" aria-checked={executionMode() === "manual"} tabindex={executionMode() === "manual" ? 0 : -1} disabled={!owner()} onClick={() => selectExecutionMode("manual")} onKeyDown={moveExecutionMode}><span class="choice__dot" /><span class="choice__copy"><span class="choice__title">Manual</span><span class="choice__body">Agents triage and suggest work, then wait for you.</span></span></button>
                  <button ref={autonomousModeButton} class="choice" data-selected={executionMode() === "autonomous"} type="button" role="radio" aria-checked={executionMode() === "autonomous"} tabindex={executionMode() === "autonomous" ? 0 : -1} disabled={!owner()} onClick={() => selectExecutionMode("autonomous")} onKeyDown={moveExecutionMode}><span class="choice__dot" /><span class="choice__copy"><span class="choice__title">Autonomous</span><span class="choice__body">Agents may claim and begin the highest suitable Ready work.</span></span></button>
                </div>
                <div class="parallel-option" data-enabled={allowParallelWork()}>
                  <div class="parallel-option__status" aria-live="polite">{allowParallelWork() ? "Parallel work enabled" : "Single-agent"}</div>
                  <label class="parallel-option__toggle" for="settings-parallel-work">
                    <input
                      id="settings-parallel-work"
                      type="checkbox"
                      checked={allowParallelWork()}
                      disabled={!owner()}
                      onChange={(event) => setAllowParallelWork(event.currentTarget.checked)}
                    />
                    <span>
                      <strong>Allow parallel work</strong>
                      <span>Agents may work on separate claimed items at the same time when their host supports isolated workspaces.</span>
                    </span>
                  </label>
                  <Show when={allowParallelWork()}>
                    <label class="parallel-option__limit" for="settings-parallel-run-limit">
                      <span>Maximum concurrent runs <small>Safety cap</small></span>
                      <select
                        class="input mono"
                        id="settings-parallel-run-limit"
                        value={maxConcurrentRuns()}
                        disabled={!owner()}
                        onChange={(event) => setMaxConcurrentRuns(Number(event.currentTarget.value))}
                      >
                        {[2, 3, 4, 5, 6, 7, 8].map((limit) => <option value={limit}>{limit}</option>)}
                      </select>
                    </label>
                  </Show>
                  <p class="security-note">This is a safety cap, not a plan limit. dongo coordinates claims; each agent host creates its agents and isolated worktrees. Unsupported or undisclosed hosts remain usable one item at a time.</p>
                </div>
                <Show when={owner()}><button class="button button--primary" type="submit" disabled={savingProject()} style={{ "align-self": "flex-start" }}>{savingProject() ? "Saving…" : "Save project"}</button></Show>
              </form>
              <Show when={owner() && project()}>{(info) => (
                <ChangelogPublisher {...props.dependencies?.changelog} projectId={info().id} />
              )}</Show>
              <Show when={owner() && !admin().project.archivedAt}>
                <section class="settings-section danger-zone">
                  <div class="settings-section__title">Archive project</div>
                  <p class="note">Archiving revokes every active agent installation. Existing project data remains stored.</p>
                  <Show when={confirmArchive()} fallback={<button class="button button--danger" type="button" style={{ "align-self": "flex-start" }} onClick={() => setConfirmArchive(true)}>Archive {admin().project.name}</button>}>
                    <div class="confirmation-row"><span class="note">Archive {admin().project.name} and revoke agent access?</span><button class="button button--danger" type="button" disabled={archiving()} onClick={() => void archive()}>{archiving() ? "Archiving…" : "Yes, archive"}</button><button class="button button--quiet" type="button" disabled={archiving()} onClick={() => setConfirmArchive(false)}>Cancel</button></div>
                  </Show>
                </section>
              </Show>
            </>
          )}</Show>

          <Show when={!loading() && tab() === "Agent access" ? administration() : undefined}>{(_admin) => (
            <>
              <div class="settings-title-group"><div class="eyebrow">Project settings</div><h1 class="settings-title">Agent access</h1><p class="auth-lede">Each CLI or MCP host has its own revocable grant and installation identity.</p></div>
              <Show when={owner()} fallback={<div class="security-note">Only an organization owner can view or manage agent installations.</div>}>
                <div class="settings-actions"><A class="button button--primary" href="/connect">Connect an agent</A><span class="mono installation-row__meta">{`${dongoPublicOrigin}/p/${project()!.publicRef}/mcp`}</span></div>
                <div class="installation-list">
                  <For each={installations()}>{(installation) => (
                    <div class="installation-row">
                      <div class="installation-row__name"><span>{lowercaseDongoBrand(installation.label)}</span><span class="installation-row__meta">{installationType(installation)} · {installation.scopes.join(", ")}</span></div>
                      <div class="installation-row__meta">{relativeTime(installation.lastUsedAt)} · {installation.status}</div>
                      <Show when={installation.status !== "revoked"} fallback={<span class="installation-row__meta">revoked</span>}>
                        <Show when={confirmRevoke() === installation.id} fallback={<button class="button button--quiet button--danger" type="button" onClick={() => setConfirmRevoke(installation.id)}>Revoke</button>}>
                          <div class="installation-row__actions"><button class="button button--danger" type="button" disabled={Boolean(revoking())} onClick={() => void revoke(installation.id)}>{revoking() === installation.id ? "Revoking…" : "Confirm"}</button><button class="button button--quiet" type="button" disabled={Boolean(revoking())} onClick={() => setConfirmRevoke(undefined)}>Cancel</button></div>
                        </Show>
                      </Show>
                    </div>
                  )}</For>
                  <Show when={installations().length === 0}><div class="note" style={{ padding: "16px" }}>No agent installations yet.</div></Show>
                </div>
                <p class="security-note">Token material is never shown here. Revocation blocks the installation’s next authenticated request; local host configuration must be removed separately.</p>
                <section class="settings-section service-credential-section">
                  <div class="settings-section__title">Advanced CI/service credential</div>
                  <p class="note">For unattended CI only. Interactive CLI and MCP hosts should use <span class="mono">Connect an agent</span> so each host gets revocable OAuth access.</p>
                  <Show when={createdServiceCredential()}>{(credential) => (
                    <div class="service-secret" role="status" aria-live="polite">
                      <div>
                        <strong>Copy this credential now.</strong>
                        <p class="note">It cannot be revealed again. dongo stores only its keyed hash.</p>
                      </div>
                      <label class="field-label" for="service-credential-secret">One-time DONGO_TOKEN value</label>
                      <textarea
                        class="input mono service-secret__value"
                        id="service-credential-secret"
                        readonly
                        rows="3"
                        spellcheck={false}
                        value={credential().token}
                        onFocus={(event) => event.currentTarget.select()}
                      />
                      <div class="settings-actions">
                        <button class="button button--primary" type="button" onClick={() => void copyServiceCredential()}>Copy credential</button>
                        <button class="button button--quiet" type="button" onClick={() => setCreatedServiceCredential(undefined)}>I have stored it</button>
                      </div>
                      <p class="security-note">Add it to your CI provider as a masked secret named <span class="mono">DONGO_TOKEN</span>, then run <span class="mono">dongo ci setup</span> in the checkout. Never commit it to this repository or place it in a command argument.</p>
                    </div>
                  )}</Show>
                  <Show when={!createdServiceCredential()}>
                    <form class="service-credential-form" onSubmit={createServiceCredential}>
                      <div class="field-group">
                        <label class="field-label" for="service-credential-label">Credential name</label>
                        <input class="input" id="service-credential-label" maxlength="240" value={serviceLabel()} onInput={(event) => setServiceLabel(event.currentTarget.value)} placeholder="Repository CI" />
                      </div>
                      <fieldset class="scope-fieldset">
                        <legend class="field-label">Project permissions</legend>
                        <div class="scope-grid">
                          <For each={SERVICE_SCOPES}>{(scope) => (
                            <label class="scope-option">
                              <input type="checkbox" checked={serviceScopes().includes(scope.value)} onChange={() => toggleServiceScope(scope.value)} />
                              <span><strong>{scope.label}</strong><span>{scope.detail}</span></span>
                            </label>
                          )}</For>
                        </div>
                      </fieldset>
                      <button class="button" type="submit" disabled={creatingServiceCredential()} style={{ "align-self": "flex-start" }}>{creatingServiceCredential() ? "Creating…" : "Create CI credential"}</button>
                    </form>
                  </Show>
                </section>
              </Show>
            </>
          )}</Show>

          <Show when={!loading() && tab() === "Local runner" ? administration() : undefined}>{(_admin) => (
            <>
              <div class="settings-title-group">
                <div class="eyebrow">Project settings</div>
                <h1 class="settings-title">Local runner</h1>
                <p class="auth-lede">A visible, user-controlled background service that picks up dongo work on a computer you trust.</p>
              </div>
              <Show when={owner()} fallback={<div class="security-note">Only an organization owner can view, install, or revoke local runners.</div>}>
                <section class="settings-section runner-setup">
                  <div class="settings-section__title">What dongo installs</div>
                  <ol class="runner-steps">
                    <li>Open this connected repository on the computer that should run the work.</li>
                    <li>Install and sign in to Codex and/or Claude Code locally.</li>
                    <li>Connect the selected agent to this project: run <code>dongo integrate codex --apply</code> or <code>dongo integrate claude --apply</code>, complete the printed login, and verify <code>dongo_session_start</code> from that agent.</li>
                    <li>Install the user-level service and give this computer a recognizable label: <code>dongo runner install --harness codex --label "Studio Mac"</code>. Use <code>--harness claude</code> for Claude Code, or include both <code>--harness</code> options.</li>
                    <li>Confirm <code>dongo runner status</code> shows the service waiting.</li>
                  </ol>
                  <p class="security-note"><strong>What to expect on macOS:</strong> macOS may show a one-time “Background Items Added” alert for <strong>dongo</strong>. That is this local runner. It starts only after you sign in, runs without administrator access, opens no inbound port, and can be managed in System Settings → General → Login Items & Extensions. If the alert names <strong>node</strong>, it came from an older dongo CLI; remove that runner, update the CLI, and install it again.</p>
                  <p class="security-note">The agent connection and runner use separate project-scoped credentials; never copy the dongo CLI credential into an agent. Local approval is required for every job by default. Use <code>dongo runner configure --approval automatic</code> only when this exact repository and computer are deliberately trusted. Then turn on Inbox pickup below. Each active job gets its own local Git worktree and agent session; eligible jobs run concurrently up to this project's safety cap without sharing uncommitted files. dongo does not wake a sleeping or powered-off computer; queued work waits durably until the runner reconnects. Inspect, pause, or remove it anytime with <code>dongo runner status</code>, <code>dongo runner disable</code>, or <code>dongo runner remove</code>.</p>
                </section>
                <section class="settings-section">
                  <div class="settings-section__title">Computers allowed to run dongo</div>
                  <div class="security-note" data-inbox-pickup={runners().automaticIntake.enabled ? "on" : "off"}>
                    <strong>Inbox pickup is {runners().automaticIntake.enabled ? "on" : "off"}.</strong>{" "}
                    {runners().automaticIntake.enabled
                      ? "New Inbox items are routed to the selected computer."
                      : "New Inbox items will wait here until an agent checks manually. Turning pickup on includes items already waiting."}
                  </div>
                  <p class="note">Every registration below is scoped to {project()?.name}{project()?.repositoryUrl ? ` · ${project()!.repositoryUrl}` : ""}. The local repository path remains private to that computer.</p>
                  <div class="installation-list">
                    <For each={runners().registrations}>{(runner) => (
                      <div class="installation-row">
                        <div class="installation-row__name">
                          <span>{runner.label}</span>
                          <span class="installation-row__meta">dongo runner · {runner.platform === "darwin" ? "macOS" : "Linux"} · {runner.harnesses.map((harness) => harness === "claude" ? "Claude Code" : "Codex").join(" + ")} · {runner.approvalMode === "ask" ? "asks locally" : "automatic for this repository"} · v{runner.version}</span>
                        </div>
                        <div class="installation-row__meta" data-runner-presence={runnerPresence(runner).startsWith("online") ? "online" : "offline"}>{runnerPresence(runner)}</div>
                        <Show when={runner.status !== "revoked"} fallback={<span class="installation-row__meta">revoked</span>}>
                          <div class="installation-row__actions">
                            <Show when={runner.approvalMode === "automatic"} fallback={<span class="installation-row__meta">Run <code>dongo runner configure --approval automatic</code> on this computer to allow Inbox pickup.</span>}>
                              <Show
                                when={runners().automaticIntake.enabled && runners().automaticIntake.registrationId === runner.id}
                                fallback={<For each={runner.harnesses}>{(harness) => (
                                  <button class="button" type="button" disabled={configuringAutomaticIntake()} onClick={() => void configureAutomaticIntake(runner.id, harness, true)}>
                                    Use this computer for Inbox pickup with {harness === "claude" ? "Claude Code" : "Codex"}
                                  </button>
                                )}</For>}
                              >
                                <button class="button button--quiet" type="button" disabled={configuringAutomaticIntake()} onClick={() => void configureAutomaticIntake(runner.id, runners().automaticIntake.harness ?? runner.harnesses[0], true)}>
                                  Process waiting Inbox now
                                </button><button class="button button--quiet button--danger" type="button" disabled={configuringAutomaticIntake()} onClick={() => void configureAutomaticIntake()}>
                                  {configuringAutomaticIntake() ? "Turning off…" : "Turn off Inbox pickup"}
                                </button>
                              </Show>
                            </Show>
                            <Show when={confirmRunnerRevoke() === runner.id} fallback={<button class="button button--quiet button--danger" type="button" onClick={() => setConfirmRunnerRevoke(runner.id)}>Revoke</button>}>
                              <button class="button button--danger" type="button" disabled={Boolean(revokingRunner())} onClick={() => void revokeLocalRunner(runner.id)}>{revokingRunner() === runner.id ? "Revoking…" : "Confirm revoke"}</button><button class="button button--quiet" type="button" disabled={Boolean(revokingRunner())} onClick={() => setConfirmRunnerRevoke(undefined)}>Cancel</button>
                            </Show>
                          </div>
                        </Show>
                      </div>
                    )}</For>
                    <Show when={runners().registrations.length === 0}><div class="note" style={{ padding: "16px" }}>No local runner is registered for this project.</div></Show>
                  </div>
                </section>
                <section class="settings-section">
                  <div class="settings-section__title">Runner activity</div>
                  <div class="installation-list">
                    <For each={runners().jobs.slice(0, 20)}>{(job) => (
                      <div class="installation-row">
                        <div class="installation-row__name"><A href={job.kind === "intake" ? `/app/${props.orgSlug}/${props.projectSlug}?intake=${encodeURIComponent(job.intakeId!)}` : `/app/${props.orgSlug}/${props.projectSlug}?work=${encodeURIComponent(job.workIdentifier!)}`}>{job.kind === "intake" ? "Inbox Intake" : job.workIdentifier}</A><span class="installation-row__meta">{job.harness === "claude" ? "Claude Code" : "Codex"} · {job.safeSummary ?? job.safeMessage ?? runnerJobLabel(job.state)}</span></div>
                        <span class="runner-state" data-state={job.state}>{runnerJobLabel(job.state)}</span>
                      </div>
                    )}</For>
                    <Show when={runners().jobs.length === 0}><div class="note" style={{ padding: "16px" }}>No jobs have been queued for a local runner yet.</div></Show>
                  </div>
                </section>
              </Show>
            </>
          )}</Show>

          <Show when={!loading() && tab() === "Members" ? administration() : undefined}>{(admin) => (
            <>
              <div class="settings-title-group"><div class="eyebrow">Organization</div><h1 class="settings-title">Members</h1><p class="auth-lede">People with access to {admin().organization.name}.</p></div>
              <form class="settings-section" onSubmit={saveOrganization}>
                <div class="settings-grid">
                  <div class="field-group"><label class="field-label" for="organization-name">Organization name</label><input class="input" id="organization-name" value={organizationName()} disabled={!owner()} onInput={(event) => setOrganizationName(event.currentTarget.value)} /><p class="note">Saving changes the organization address to <span class="mono">{organizationSlugPreview()}</span>; dongo adds a unique suffix only when needed.</p></div>
                  <div class="field-group"><label class="field-label" for="organization-slug">Organization slug</label><input class="input mono" id="organization-slug" value={admin().organization.slug} disabled /></div>
                </div>
                <Show when={owner()}><button class="button" type="submit" disabled={savingOrganization()} style={{ "align-self": "flex-start" }}>{savingOrganization() ? "Saving…" : "Save organization"}</button></Show>
              </form>
              <Show when={owner()}>
                <form class="settings-section" onSubmit={addMember}>
                  <div class="settings-section__title">Add member</div>
                  <p class="note">Add someone who has already signed in to dongo. New members receive the standard member role.</p>
                  <div class="settings-actions member-add-actions">
                    <div class="field-group member-add-actions__field">
                      <label class="field-label" for="member-email">Account email</label>
                      <input class="input" id="member-email" type="email" autocomplete="email" value={memberEmail()} onInput={(event) => setMemberEmail(event.currentTarget.value)} placeholder="teammate@example.com" />
                    </div>
                    <button class="button member-add-actions__submit" type="submit" disabled={addingMember()}>{addingMember() ? "Adding…" : "Add member"}</button>
                  </div>
                </form>
              </Show>
              <div class="installation-list">
                <For each={admin().members}>{(member) => (
                  <div class="installation-row">
                    <div class="installation-row__name"><span>{member.name}{member.current ? " (you)" : ""}</span><span class="installation-row__meta">{member.email ?? "Email unavailable"}</span></div>
                    <div class="installation-row__meta">{member.role}</div>
                    <Show when={owner() && !member.current && member.role === "member"}>
                      <Show when={confirmRemove() === member.membershipId} fallback={<button class="button button--quiet button--danger" type="button" onClick={() => setConfirmRemove(member.membershipId)}>Remove</button>}>
                        <div class="installation-row__actions"><button class="button button--danger" type="button" disabled={Boolean(removing())} onClick={() => void removeMember(member.membershipId)}>{removing() === member.membershipId ? "Removing…" : "Confirm"}</button><button class="button button--quiet" type="button" disabled={Boolean(removing())} onClick={() => setConfirmRemove(undefined)}>Cancel</button></div>
                      </Show>
                    </Show>
                  </div>
                )}</For>
              </div>
              <p class="security-note">Owners manage organization and agent access. Members can capture Intake, comment, and respond to Attention.</p>
            </>
          )}</Show>

          <Show when={!loading() && tab() === "Plan & storage" ? administration() : undefined}>{(admin) => (
            <>
              <div class="settings-title-group"><div class="eyebrow">Organization</div><h1 class="settings-title">Plan & storage</h1><p class="auth-lede">Current limits for {admin().organization.name}.</p></div>
              <div class="plan-card">
                <div class="plan-stat"><span class="plan-stat__value">{admin().activeProjectCount} / {admin().projectAllowance.limit ?? "∞"}</span><span class="plan-stat__label">active projects</span></div>
                <div class="plan-stat"><span class="plan-stat__value">{admin().workItemAllowance.totalWorkItemCount === undefined ? "Counting…" : `${admin().workItemAllowance.totalWorkItemCount}${admin().workItemAllowance.totalIsExact ? "" : "+"}`} / {admin().workItemAllowance.limit ?? "∞"}</span><span class="plan-stat__label">total Work</span></div>
                <div class="plan-stat"><span class="plan-stat__value">{formatBytes(admin().storage.activeBytes + admin().storage.reservedBytes)} / {formatBytes(admin().storage.limitBytes)}</span><span class="plan-stat__label">media storage</span></div>
              </div>
              <section class="settings-section">
                <div class="settings-section__title">{admin().organization.plan === "free" ? "Free" : "Paid"} plan</div>
                <Show when={admin().organization.plan === "free"} fallback={<p class="note">This organization can create multiple active projects.</p>}>
                  <p class="note">This organization is using {admin().activeProjectCount} of {admin().projectAllowance.limit ?? 1} active projects.{admin().projectAllowance.source === "operator_override" ? " Additional capacity has been granted to this organization." : " The standard Free allowance is 1."} Archive an active project when the allowance is full, or review plan availability.</p>
                </Show>
                <p class="note">Individual uploads are limited to {formatBytes(admin().storage.maximumAttachmentBytes)}. dongo does not meter people or agents. {admin().organization.plan === "free" && admin().workItemAllowance.source === "plan" ? "The standard Free allowance is 250 total Work items." : `This organization can create ${admin().workItemAllowance.limit ?? "unlimited"} total Work items.`}</p>
                <Show when={!admin().workItemAllowance.totalIsExact}>
                  <p class="security-note">The complete Work count is being established by a bounded server migration. Finite creation checks remain authoritative.</p>
                </Show>
                <Show when={owner()}>
                  <A class="button" href={planAction()!.href} style={{ "align-self": "flex-start" }}>
                    {planAction()!.label}
                  </A>
                </Show>
                <Show when={admin().organization.plan === "free"}><p class="security-note">The planned $19 Unlimited plan is available to review. Checkout and paid activation are not connected yet.</p></Show>
              </section>
            </>
          )}</Show>
        </div>
      </div>
      </main>
    </>
  );
}
