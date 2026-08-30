import { A, useNavigate } from "@solidjs/router";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Brand } from "../../components/Brand";
import { SignOutButton } from "../../components/SignOutButton";
import { humanSession } from "../../lib/auth-client";
import {
  ProjectDataConnection,
  type ProjectInfo,
  type ProjectInstallation,
} from "../../lib/project-data";
import "./admin.css";

type ProjectSettingsProps = {
  orgSlug: string;
  projectSlug: string;
};

type Tab = "General" | "Agent access" | "Members" | "Plan & storage";
type Viewer = { name: string; email: string };

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

export function ProjectSettings(props: ProjectSettingsProps) {
  const navigate = useNavigate();
  const [tab, setTab] = createSignal<Tab>("General");
  const [project, setProject] = createSignal<ProjectInfo>();
  const [viewer, setViewer] = createSignal<Viewer>();
  const [installations, setInstallations] = createSignal<ProjectInstallation[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  const [confirmRevoke, setConfirmRevoke] = createSignal<string>();
  const [revoking, setRevoking] = createSignal<string>();
  const [confirmArchive, setConfirmArchive] = createSignal(false);
  const [archiving, setArchiving] = createSignal(false);
  let connection: ProjectDataConnection | undefined;
  let unsubscribe: (() => void) | undefined;
  let disposed = false;

  onMount(() => {
    void Promise.all([
      ProjectDataConnection.connect(props.orgSlug, props.projectSlug),
      humanSession(),
    ])
      .then(([connected, session]) => {
        if (disposed) {
          void connected.close();
          return;
        }
        connection = connected;
        setProject(connected.project);
        if (session) setViewer({ name: session.user.name, email: session.user.email });
        unsubscribe = connected.subscribeInstallations(
          (next) => {
            setInstallations(next);
            setError("");
            setLoading(false);
          },
          () => {
            setError("Agent access is available to project owners.");
            setLoading(false);
          },
        );
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

  const revoke = async (installationId: string) => {
    if (!connection || revoking()) return;
    setRevoking(installationId);
    setError("");
    try {
      await connection.revokeInstallation(installationId);
      setConfirmRevoke(undefined);
    } catch {
      setError("The installation could not be revoked. Try again.");
    } finally {
      setRevoking(undefined);
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

  return (
    <main class="settings-page">
      <header class="settings-header">
        <Brand compact href={`/app/${props.orgSlug}/${props.projectSlug}`} />
        <div class="settings-header__title">/ {props.projectSlug} / settings</div>
        <div style={{ flex: 1 }} />
        <A class="button button--quiet" href={`/app/${props.orgSlug}/${props.projectSlug}`}>← Overview</A>
        <SignOutButton />
      </header>
      <div class="settings-layout">
        <nav class="settings-nav" aria-label="Project settings">
          <For each={(["General", "Agent access", "Members", "Plan & storage"] as Tab[])}>{(item) => (
            <button class="settings-nav__link" data-selected={tab() === item} type="button" onClick={() => setTab(item)}>{item}</button>
          )}</For>
        </nav>

        <div class="settings-content">
          <Show when={loading()}><div class="note" role="status">Loading project settings…</div></Show>
          <Show when={error()}><div class="error" role="alert">{error()}</div></Show>

          <Show when={!loading() && project() && tab() === "General"}>
            <>
              <div class="settings-title-group"><div class="eyebrow">Project settings</div><h1 class="settings-title">General</h1><p class="auth-lede">Project identity and agent execution behavior.</p></div>
              <section class="settings-section">
                <div class="settings-grid">
                  <div class="field-group"><label class="field-label" for="settings-name">Project name</label><input class="input" id="settings-name" value={project()!.name} disabled /></div>
                  <div class="field-group"><label class="field-label" for="settings-slug">Project slug</label><input class="input mono" id="settings-slug" value={project()!.slug} disabled /></div>
                </div>
                <div class="field-group"><label class="field-label" for="settings-repo">Repository URL</label><input class="input mono" id="settings-repo" value={project()!.repositoryUrl || "Not configured"} disabled /></div>
                <p class="security-note">Project metadata editing is not exposed in this build.</p>
              </section>
              <section class="settings-section">
                <div class="settings-section__title">Agent execution mode</div>
                <div class="choice-list">
                  <div class="choice" data-selected={project()!.executionMode === "manual"}><span class="choice__dot" /><span class="choice__copy"><span class="choice__title">Manual</span><span class="choice__body">Agents triage and suggest work, then wait for you.</span></span></div>
                  <div class="choice" data-selected={project()!.executionMode === "autonomous"}><span class="choice__dot" /><span class="choice__copy"><span class="choice__title">Autonomous</span><span class="choice__body">Agents may claim and begin the highest suitable Ready work.</span></span></div>
                </div>
              </section>
              <section class="settings-section danger-zone">
                <div class="settings-section__title">Archive project</div>
                <p class="note">Archiving revokes every active agent installation. Existing project data remains stored.</p>
                <Show when={confirmArchive()} fallback={<button class="button button--danger" type="button" style={{ "align-self": "flex-start" }} onClick={() => setConfirmArchive(true)}>Archive {project()!.name}</button>}>
                  <div class="confirmation-row">
                    <span class="note">Archive this project and revoke agent access?</span>
                    <button class="button button--danger" type="button" disabled={archiving()} onClick={() => void archive()}>{archiving() ? "Archiving…" : "Yes, archive"}</button>
                    <button class="button button--quiet" type="button" disabled={archiving()} onClick={() => setConfirmArchive(false)}>Cancel</button>
                  </div>
                </Show>
              </section>
            </>
          </Show>

          <Show when={!loading() && project() && tab() === "Agent access"}>
            <div class="settings-title-group"><div class="eyebrow">Project settings</div><h1 class="settings-title">Agent access</h1><p class="auth-lede">Each CLI or MCP host has its own revocable grant and installation identity.</p></div>
            <div class="settings-actions"><A class="button button--primary" href="/connect">Connect an agent</A><A class="button" href="/device">Authorize a terminal</A></div>
            <div class="installation-list">
              <For each={installations()}>{(installation) => (
                <div class="installation-row">
                  <div class="installation-row__name"><span>{installation.label}</span><span class="installation-row__meta">{installationType(installation)}</span></div>
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
            <p class="security-note">Token material is never shown here. Revocation blocks the installation’s next authenticated request.</p>
          </Show>

          <Show when={!loading() && project() && tab() === "Members"}>
            <>
              <div class="settings-title-group"><div class="eyebrow">Organization</div><h1 class="settings-title">Members</h1><p class="auth-lede">People with access to {project()!.organizationName}.</p></div>
              <div class="installation-list">
                <Show when={viewer()} fallback={<div class="note" style={{ padding: "16px" }}>Signed-in member details are unavailable.</div>}>
                  {(account) => <div class="installation-row"><div class="installation-row__name"><span>{account().name}</span><span class="installation-row__meta">{account().email}</span></div><div class="installation-row__meta">{project()!.membershipRole}</div><span /></div>}
                </Show>
              </div>
              <p class="security-note">Organization member invitations are not exposed in this build.</p>
            </>
          </Show>

          <Show when={!loading() && project() && tab() === "Plan & storage"}>
            <>
              <div class="settings-title-group"><div class="eyebrow">Organization</div><h1 class="settings-title">Plan & storage</h1><p class="auth-lede">Current limits for {project()!.organizationName}.</p></div>
              <div class="plan-card"><div class="plan-stat"><span class="plan-stat__value">{project()!.activeProjectCount} / 1</span><span class="plan-stat__label">active projects</span></div><div class="plan-stat"><span class="plan-stat__value">Not reported</span><span class="plan-stat__label">media usage</span></div></div>
              <section class="settings-section"><div class="settings-section__title">Free plan</div><p class="note">Individual uploads are limited to 250 MB. Storage usage reporting and billing are not enabled in this development environment.</p></section>
            </>
          </Show>
        </div>
      </div>
    </main>
  );
}
