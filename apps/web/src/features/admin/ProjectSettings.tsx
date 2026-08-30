import { A } from "@solidjs/router";
import { createSignal, For, Show } from "solid-js";
import { Brand } from "../../components/Brand";
import { SignOutButton } from "../../components/SignOutButton";
import "./admin.css";

type ProjectSettingsProps = {
  orgSlug: string;
  projectSlug: string;
};

type Tab = "General" | "Agent access" | "Members" | "Plan & storage";

const installations = [
  { id: "cli", name: "Dongo CLI", type: "Codex · macbook-rene", lastUsed: "used 4m ago" },
  { id: "claude", name: "Claude Code MCP", type: "remote MCP · project grant", lastUsed: "used 18m ago" },
];

export function ProjectSettings(props: ProjectSettingsProps) {
  const [tab, setTab] = createSignal<Tab>("General");
  const [name, setName] = createSignal("Dongo");
  const [mode, setMode] = createSignal<"manual" | "autonomous">("manual");
  const [activeInstallations, setActiveInstallations] = createSignal(installations);
  const [saved, setSaved] = createSignal(false);

  const save = () => {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
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
          <Show when={tab() === "General"}>
            <div class="settings-title-group"><div class="eyebrow">Project settings</div><h1 class="settings-title">General</h1><p class="auth-lede">Project identity and agent execution behavior.</p></div>
            <section class="settings-section">
              <div class="settings-grid">
                <div class="field-group"><label class="field-label" for="settings-name">Project name</label><input class="input" id="settings-name" value={name()} onInput={(event) => setName(event.currentTarget.value)} /></div>
                <div class="field-group"><label class="field-label" for="settings-slug">Project slug</label><input class="input mono" id="settings-slug" value={props.projectSlug} disabled /></div>
              </div>
              <div class="field-group"><label class="field-label" for="settings-repo">Repository URL</label><input class="input mono" id="settings-repo" value="github.com/renewisepunk/dongo" /></div>
            </section>
            <section class="settings-section"><div class="settings-section__title">Agent execution mode</div><div class="choice-list">
              <button class="choice" data-selected={mode() === "manual"} type="button" onClick={() => setMode("manual")}><span class="choice__dot" /><span class="choice__copy"><span class="choice__title">Manual</span><span class="choice__body">Agents triage and suggest work, then wait for you.</span></span></button>
              <button class="choice" data-selected={mode() === "autonomous"} type="button" onClick={() => setMode("autonomous")}><span class="choice__dot" /><span class="choice__copy"><span class="choice__title">Autonomous</span><span class="choice__body">Agents may claim and begin the highest suitable Ready work.</span></span></button>
            </div></section>
            <div class="settings-actions"><button class="button button--primary" type="button" onClick={save}>Save changes</button><Show when={saved()}><span class="security-note" style={{ color: "var(--green)" }}>✓ saved</span></Show></div>
            <section class="settings-section danger-zone"><div class="settings-section__title">Archive project</div><p class="note">Agents will lose access. Existing work remains available read-only until the project is unarchived.</p><button class="button button--danger" type="button" style={{ "align-self": "flex-start" }}>Archive Dongo</button></section>
          </Show>

          <Show when={tab() === "Agent access"}>
            <div class="settings-title-group"><div class="eyebrow">Project settings</div><h1 class="settings-title">Agent access</h1><p class="auth-lede">Each CLI or MCP host has its own grant and installation identity.</p></div>
            <div class="settings-actions"><A class="button button--primary" href="/connect">Connect an agent</A><A class="button" href="/device">Authorize a terminal</A></div>
            <div class="installation-list">
              <For each={activeInstallations()}>{(installation) => (
                <div class="installation-row">
                  <div class="installation-row__name"><span>{installation.name}</span><span class="installation-row__meta">{installation.type}</span></div>
                  <div class="installation-row__meta">{installation.lastUsed} · active</div>
                  <button class="button button--quiet button--danger" type="button" onClick={() => setActiveInstallations((items) => items.filter((item) => item.id !== installation.id))}>Revoke</button>
                </div>
              )}</For>
              <Show when={activeInstallations().length === 0}><div class="note" style={{ padding: "16px" }}>No active agent installations.</div></Show>
            </div>
            <p class="security-note">Token material is never shown here. Revocation blocks the installation’s next request.</p>
          </Show>

          <Show when={tab() === "Members"}>
            <div class="settings-title-group"><div class="eyebrow">Organization</div><h1 class="settings-title">Members</h1><p class="auth-lede">People with access to this organization.</p></div>
            <div class="installation-list"><div class="installation-row"><div class="installation-row__name"><span>René Bauer</span><span class="installation-row__meta">rene@wisepunk.com</span></div><div class="installation-row__meta">owner</div><span /></div></div>
            <button class="button" type="button" style={{ "align-self": "flex-start" }}>Invite member</button>
          </Show>

          <Show when={tab() === "Plan & storage"}>
            <div class="settings-title-group"><div class="eyebrow">Organization</div><h1 class="settings-title">Plan & storage</h1><p class="auth-lede">Free includes one active project and bounded media storage.</p></div>
            <div class="plan-card"><div class="plan-stat"><span class="plan-stat__value">1 / 1</span><span class="plan-stat__label">active projects</span></div><div class="plan-stat"><span class="plan-stat__value">18.4 MB</span><span class="plan-stat__label">media used</span></div></div>
            <section class="settings-section"><div class="settings-section__title">Free plan</div><p class="note">Individual uploads are limited to 250 MB. Billing is not enabled in this development environment.</p></section>
          </Show>
        </div>
      </div>
    </main>
  );
}
