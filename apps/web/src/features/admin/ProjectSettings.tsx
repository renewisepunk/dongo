import { A, useNavigate, useSearchParams } from "@solidjs/router";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Brand } from "../../components/Brand";
import { SignOutButton } from "../../components/SignOutButton";
import { dongoPublicOrigin } from "../../lib/auth-config";
import {
  ProjectDataConnection,
  type CreatedServiceCredential,
  type ProjectAdministration,
  type ProjectInfo,
  type ProjectInstallation,
} from "../../lib/project-data";
import "./admin.css";

type ProjectSettingsConnection = {
  project: ProjectInfo;
  getAdministration: () => Promise<ProjectAdministration>;
  subscribeInstallations: (
    onUpdate: (installations: ProjectInstallation[]) => void,
    onError: (error: Error) => void,
  ) => () => void;
  updateProject: (input: {
    name: string;
    repositoryUrl?: string;
    executionMode: "manual" | "autonomous";
  }) => Promise<void>;
  updateOrganization: (name: string) => Promise<void>;
  revokeInstallation: (installationId: string) => Promise<void>;
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

type Tab = "General" | "Agent access" | "Members" | "Plan & storage";
const SETTINGS_TABS: readonly Tab[] = ["General", "Agent access", "Members", "Plan & storage"];
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
  const [projectName, setProjectName] = createSignal("");
  const [repositoryUrl, setRepositoryUrl] = createSignal("");
  const [executionMode, setExecutionMode] = createSignal<"manual" | "autonomous">("manual");
  const [organizationName, setOrganizationName] = createSignal("");
  const [memberEmail, setMemberEmail] = createSignal("");
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  const [status, setStatus] = createSignal("");
  const [savingProject, setSavingProject] = createSignal(false);
  const [savingOrganization, setSavingOrganization] = createSignal(false);
  const [confirmRevoke, setConfirmRevoke] = createSignal<string>();
  const [revoking, setRevoking] = createSignal<string>();
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
  let manualModeButton: HTMLButtonElement | undefined;
  let autonomousModeButton: HTMLButtonElement | undefined;
  let disposed = false;
  const connectForSettings = props.dependencies?.connectForSettings ?? ProjectDataConnection.connectForSettings;
  const writeClipboard = props.dependencies?.writeClipboard ?? (
    (text: string) => navigator.clipboard.writeText(text)
  );

  const owner = createMemo(() => administration()?.membershipRole === "owner");

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
    setAdministration(next);
    setProjectName(next.project.name);
    setRepositoryUrl(next.project.repositoryUrl ?? "");
    setExecutionMode(next.project.executionMode);
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
    setSavingOrganization(true);
    setError("");
    setStatus("");
    try {
      await connection.updateOrganization(name);
      setProject({ ...connection.project });
      await refreshAdministration();
      setStatus("Organization settings saved.");
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
      setError("Enter the email for an existing Dongo account.");
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
      setError("The member could not be added. Ask them to sign in to Dongo once, then try again.");
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
    <main class="settings-page">
      <header class="settings-header">
        <Brand compact href={project()?.archivedAt ? "/" : `/app/${props.orgSlug}/${props.projectSlug}`} />
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
                  <div class="field-group"><label class="field-label" for="settings-prefix">Identifier prefix</label><input class="input mono" id="settings-prefix" value={admin().project.identifierPrefix} disabled /></div>
                </div>
                <div class="field-label" id="settings-mode">Agent execution mode</div>
                <div class="choice-list" role="radiogroup" aria-labelledby="settings-mode">
                  <button ref={manualModeButton} class="choice" data-selected={executionMode() === "manual"} type="button" role="radio" aria-checked={executionMode() === "manual"} tabindex={executionMode() === "manual" ? 0 : -1} disabled={!owner()} onClick={() => selectExecutionMode("manual")} onKeyDown={moveExecutionMode}><span class="choice__dot" /><span class="choice__copy"><span class="choice__title">Manual</span><span class="choice__body">Agents triage and suggest work, then wait for you.</span></span></button>
                  <button ref={autonomousModeButton} class="choice" data-selected={executionMode() === "autonomous"} type="button" role="radio" aria-checked={executionMode() === "autonomous"} tabindex={executionMode() === "autonomous" ? 0 : -1} disabled={!owner()} onClick={() => selectExecutionMode("autonomous")} onKeyDown={moveExecutionMode}><span class="choice__dot" /><span class="choice__copy"><span class="choice__title">Autonomous</span><span class="choice__body">Agents may claim and begin the highest suitable Ready work.</span></span></button>
                </div>
                <Show when={owner()}><button class="button button--primary" type="submit" disabled={savingProject()} style={{ "align-self": "flex-start" }}>{savingProject() ? "Saving…" : "Save project"}</button></Show>
              </form>
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
                      <div class="installation-row__name"><span>{installation.label}</span><span class="installation-row__meta">{installationType(installation)} · {installation.scopes.join(", ")}</span></div>
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
                        <p class="note">It cannot be revealed again. Dongo stores only its keyed hash.</p>
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

          <Show when={!loading() && tab() === "Members" ? administration() : undefined}>{(admin) => (
            <>
              <div class="settings-title-group"><div class="eyebrow">Organization</div><h1 class="settings-title">Members</h1><p class="auth-lede">People with access to {admin().organization.name}.</p></div>
              <form class="settings-section" onSubmit={saveOrganization}>
                <div class="settings-grid">
                  <div class="field-group"><label class="field-label" for="organization-name">Organization name</label><input class="input" id="organization-name" value={organizationName()} disabled={!owner()} onInput={(event) => setOrganizationName(event.currentTarget.value)} /></div>
                  <div class="field-group"><label class="field-label" for="organization-slug">Organization slug</label><input class="input mono" id="organization-slug" value={admin().organization.slug} disabled /></div>
                </div>
                <Show when={owner()}><button class="button" type="submit" disabled={savingOrganization()} style={{ "align-self": "flex-start" }}>{savingOrganization() ? "Saving…" : "Save organization"}</button></Show>
              </form>
              <Show when={owner()}>
                <form class="settings-section" onSubmit={addMember}>
                  <div class="settings-section__title">Add member</div>
                  <p class="note">Add someone who has already signed in to Dongo. New members receive the standard member role.</p>
                  <div class="settings-actions">
                    <div class="field-group" style={{ flex: 1 }}>
                      <label class="field-label" for="member-email">Account email</label>
                      <input class="input" id="member-email" type="email" autocomplete="email" value={memberEmail()} onInput={(event) => setMemberEmail(event.currentTarget.value)} placeholder="teammate@example.com" />
                    </div>
                    <button class="button" type="submit" disabled={addingMember()}>{addingMember() ? "Adding…" : "Add member"}</button>
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
                <div class="plan-stat"><span class="plan-stat__value">{admin().activeProjectCount} / {admin().organization.plan === "free" ? "1" : "∞"}</span><span class="plan-stat__label">active projects</span></div>
                <div class="plan-stat"><span class="plan-stat__value">{formatBytes(admin().storage.activeBytes + admin().storage.reservedBytes)} / {formatBytes(admin().storage.limitBytes)}</span><span class="plan-stat__label">media storage</span></div>
              </div>
              <section class="settings-section"><div class="settings-section__title">{admin().organization.plan === "free" ? "Free" : "Paid"} plan</div><p class="note">Individual uploads are limited to {formatBytes(admin().storage.maximumAttachmentBytes)}. Dongo does not meter people, agents, or WorkItems.</p><Show when={admin().organization.plan === "free"}><p class="security-note">Billing checkout is not configured in this development environment.</p></Show></section>
            </>
          )}</Show>
        </div>
      </div>
    </main>
  );
}
