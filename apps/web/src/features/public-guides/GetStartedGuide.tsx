import { A } from "@solidjs/router";
import { dongoPublicOrigin } from "../../lib/auth-config";
import { GuideCode, GuideSection, PublicGuideShell } from "./PublicGuideShell";

const SKILL_PROMPT = `Install the dongo-onboarding and dongo-workflow skills from
https://github.com/renewisepunk/dongo-skills

Set up Dongo for this repository.`;

const INSTALL_COMMANDS = `npm install --global @wisepunk/dongo
dongo --version

cd /path/to/your/repository
dongo connect`;

const VERIFY_COMMANDS = `dongo auth status --json
dongo doctor --json
dongo session-start --json`;

export function GetStartedGuide() {
  return (
    <PublicGuideShell page="get-started">
      <section class="public-guide-hero public-guide-hero--start" aria-labelledby="get-started-title">
        <div class="public-guide-hero__copy">
          <div class="eyebrow eyebrow--amber">Agent-first setup</div>
          <h1 id="get-started-title">Install the skills. Approve once. Start working.</h1>
          <p>Install Dongo’s skills in the coding agent you already use. Then tell it to set up Dongo for this repository. It handles the CLI and MCP connection; you approve each scoped installation in your browser.</p>
          <div class="public-guide-hero__actions">
            <a class="button button--primary" href="https://github.com/renewisepunk/dongo-skills" rel="external">Install Dongo skills <span aria-hidden="true">↗</span></a>
            <A class="button" href="/help">Read the help guide</A>
          </div>
        </div>
        <div class="agent-brief" aria-label="Agent setup brief">
          <div class="agent-brief__top"><span>setup brief</span><span>01 / agent</span></div>
          <div class="agent-brief__prompt"><span aria-hidden="true">›</span> Install the Dongo skills, then set up Dongo for this repository.</div>
          <div class="agent-brief__status">
            <span><i data-state="done" /> skills installed</span>
            <span><i data-state="done" /> agent prepares CLI + MCP</span>
            <span><i data-state="active" /> browser approval</span>
            <span><i /> agent verifies connection</span>
          </div>
        </div>
      </section>

      <div class="public-guide-flow" aria-label="Connection sequence">
        <span>Dongo skills</span><b aria-hidden="true">→</b><span>tell your agent</span><b aria-hidden="true">→</b><span>browser approval</span><b aria-hidden="true">→</b><span>ready to work</span>
      </div>

      <GuideSection
        index="01"
        id="skills"
        title="Install the Dongo skills"
        lede="Use your agent’s normal skill installer to add both Dongo skills from the public repository. This is the only setup step you need to perform before asking the agent to help."
      >
        <GuideCode label="tell your agent">{SKILL_PROMPT}</GuideCode>
        <aside class="guide-callout guide-callout--green"><div class="guide-callout__label">What happens next</div><div><h3>Your agent owns the mechanical setup.</h3><p>It installs the published CLI if needed, connects this repository, previews and applies its own MCP configuration, and checks the resulting connection. You approve the Dongo browser prompts.</p></div></aside>
      </GuideSection>

      <GuideSection
        index="02"
        id="authorize"
        title="Approve the connection"
        lede="Dongo authentication moves from your agent to the browser for your approval, then back to the agent for verification."
      >
        <aside class="guide-callout guide-callout--green">
          <div class="guide-callout__label">One live service</div>
          <div><h3>There is no environment choice.</h3><p>The installed CLI always connects to <code>dongo.so</code>. Development infrastructure is private to dongo's own testing and cannot be selected by a user or agent.</p></div>
        </aside>
        <div class="guide-process" role="list" aria-label="Browser authorization steps">
          <article role="listitem"><span>1</span><h3>Your agent opens the link</h3><p>The CLI opens a complete approval URL. Over SSH, the agent gives you that same URL to open in a trusted browser.</p></article>
          <article role="listitem"><span>2</span><h3>You approve the scoped install</h3><p>Sign in if needed, confirm the account, proposed project, resource, and requested access.</p></article>
          <article role="listitem"><span>3</span><h3>Your agent verifies</h3><p>The page reports “Approved”; the agent only proceeds after the CLI and MCP diagnostics succeed.</p></article>
        </div>
        <aside class="guide-callout guide-callout--green">
          <div class="guide-callout__label">No project yet?</div>
          <div><h3>That is a supported first-run path.</h3><p>The CLI proposes a project from the repository. The approval page shows <strong>Create &amp; approve</strong>; the first project is created and bound before the grant is issued. You do not need to create a project in the app first.</p></div>
        </aside>
        <p class="guide-inline-note"><span aria-hidden="true">↳</span> A newly configured MCP host may need one restart before it can load its new tools.</p>
      </GuideSection>

      <GuideSection
        index="03"
        id="manual"
        title="Prefer manual setup? Use the CLI and MCP directly."
        lede="The skills are the recommended path. These commands remain available when you want to install, connect, or configure a host yourself."
      >
        <GuideCode label="install and connect the CLI">{INSTALL_COMMANDS}</GuideCode>
        <div class="guide-host-grid">
          <article>
            <div class="guide-host-grid__label">Codex</div>
            <h3>Project-scoped configuration</h3>
            <pre tabindex="0"><code>{`dongo integrate codex
dongo integrate codex --apply
codex mcp login dongo-<project-ref> --scopes dongo:work:read,dongo:work:write,dongo:attachments:read --oauth-client-registration auto`}</code></pre>
          </article>
          <article>
            <div class="guide-host-grid__label">Claude Code</div>
            <h3>Remote HTTP + host OAuth</h3>
            <pre tabindex="0"><code>{`dongo integrate claude
dongo integrate claude --apply
claude mcp login dongo-<project-ref>`}</code></pre>
          </article>
          <article>
            <div class="guide-host-grid__label">Generic MCP</div>
            <h3>URL-only configuration</h3>
            <pre tabindex="0"><code>{`dongo integrate generic
dongo integrate generic --apply

${dongoPublicOrigin}/p/<project-ref>/mcp`}</code></pre>
          </article>
        </div>
        <p class="guide-inline-note"><span aria-hidden="true">↳</span> Replace <code>&lt;project-ref&gt;</code> with the project reference printed by <code>dongo connect</code>. Each host receives its own independently revocable grant.</p>
        <div class="guide-mcp-lifecycle" aria-label="MCP connection lifecycle">
          <article>
            <span>Verify</span>
            <div><h3>Call <code>dongo_session_start</code></h3><p>Check the host’s MCP status, then make this read-only call. It must identify the intended project and that host’s own installation actor.</p></div>
          </article>
          <article>
            <span>Re-authenticate</span>
            <div><h3>Refresh only the affected host</h3><p>Log that MCP server out in Codex, Claude Code, or the generic host, then repeat its host-native login. Never paste or reuse the CLI credential.</p></div>
          </article>
          <article>
            <span>Revoke or remove</span>
            <div><h3>These are separate actions</h3><p>Revoke the installation from <A href="/open">Project settings → Agent access</A> to stop server access. Remove the named MCP entry only when you also want to delete local configuration.</p></div>
          </article>
        </div>
      </GuideSection>

      <GuideSection
        index="04"
        id="verify"
        title="Verify before doing work"
        lede="The skills perform these read-only checks for you. Run them manually only when diagnosing a connection."
      >
        <GuideCode label="verify the CLI">{VERIFY_COMMANDS}</GuideCode>
        <div class="guide-verification">
          <div><span>CLI</span><strong>doctor passes</strong><p>Project marker, credential binding, resource, and API connectivity agree.</p></div>
          <div><span>MCP</span><strong><code>dongo_session_start</code> succeeds</strong><p>The host identifies its own actor and the intended project without copying a CLI token.</p></div>
          <div><span>Human</span><strong>project opens</strong><p>Use <A href="/open">Open app</A> to review Intake, work, comments, and agent updates.</p></div>
        </div>
      </GuideSection>

      <GuideSection
        index="05"
        id="security"
        title="Credential storage should feel uneventful"
        lede="The agent uses the npm CLI’s private user file. It does not ask to change or repair an operating-system credential store."
      >
        <div class="guide-security">
          <div class="guide-security__path"><span>POSIX location</span><code>${`{XDG_CONFIG_HOME:-~/.config}`}/dongo/credentials/</code></div>
          <ul>
            <li>The dongo directory is owner-only <code>0700</code>; credential files are owner-only <code>0600</code>.</li>
            <li>Credentials stay outside the repository. Only a non-secret project marker is written inside <code>.agent-work</code>.</li>
            <li>The CLI does not invoke macOS Keychain, Linux Secret Service, password-manager helpers, installers, Swift, or PowerShell.</li>
            <li>Codex, Claude Code, and generic MCP hosts keep their own OAuth credentials. dongo never copies the CLI credential into a host.</li>
          </ul>
        </div>
        <aside class="guide-callout guide-callout--warning"><div class="guide-callout__label">Unexpected prompt</div><div><h3>Deny it and stop.</h3><p>A Keychain repair prompt, generic credential-helper request, or browser request to “access other apps and services on this device” is not part of the normal dongo flow.</p></div></aside>
      </GuideSection>

      <GuideSection
        index="06"
        id="troubleshooting"
        title="Fast recovery"
        lede="Start fresh instead of weakening authentication or copying tokens between tools."
      >
        <dl class="guide-troubleshooting">
          <div><dt>Browser did not open</dt><dd>Rerun with <code>--no-browser</code> and open the complete printed URL in a trusted browser.</dd></div>
          <div><dt>Request denied or expired</dt><dd>Run <code>dongo connect</code> again. Authorization codes and links are short-lived and single-use.</dd></div>
          <div><dt>Approved, but not connected</dt><dd>Return to the terminal. Run <code>dongo auth status --json</code> and <code>dongo doctor --json</code> before approving another installation.</dd></div>
          <div><dt>Wrong project</dt><dd>Deny the request and reconnect with the exact <code>--project-ref</code>. The approval page confirms project choice; it does not silently switch it.</dd></div>
          <div><dt>MCP login succeeds, tools fail</dt><dd>Compare the exact project resource URL and approved scopes, then log out and reauthorize only that host. Revoking another installation will not repair this one.</dd></div>
        </dl>
        <div class="guide-next"><div><span>Need the command reference?</span><strong>Continue with the public help guide.</strong></div><A class="button button--primary" href="/help">Open help</A></div>
      </GuideSection>
    </PublicGuideShell>
  );
}
