import { A } from "@solidjs/router";
import { GuideCode, GuideSection, PublicGuideShell } from "./PublicGuideShell";

const INSTALL_COMMANDS = `git clone https://github.com/renewisepunk/dongo.git
cd dongo
npm ci
npm pack --workspace @dongo/cli
npm install --global ./dongo-cli-0.1.0.tgz
dongo --version`;

const CONNECT_COMMAND = `cd /path/to/your/repository
dongo connect --environment development --origin https://dev.dongo.so`;

const VERIFY_COMMANDS = `dongo auth status --json
dongo doctor --json
dongo session-start --json`;

export function GetStartedGuide() {
  return (
    <PublicGuideShell page="get-started">
      <section class="public-guide-hero public-guide-hero--start" aria-labelledby="get-started-title">
        <div class="public-guide-hero__copy">
          <div class="eyebrow eyebrow--amber">Agent-first setup</div>
          <h1 id="get-started-title">Your agent can set up dongo.</h1>
          <p>Connect a repository from the terminal, approve one browser link, and let the CLI create or bind the project. Add MCP only when the local connection is healthy.</p>
          <div class="public-guide-hero__actions">
            <a class="button button--primary" href="#install">Start with the CLI</a>
            <A class="button" href="/help">Read the help guide</A>
          </div>
        </div>
        <div class="agent-brief" aria-label="Agent setup brief">
          <div class="agent-brief__top"><span>setup brief</span><span>01 / agent</span></div>
          <div class="agent-brief__prompt"><span aria-hidden="true">›</span> Install dongo in this repository, connect it to development, preview the MCP configuration, and verify each connection.</div>
          <div class="agent-brief__status">
            <span><i data-state="done" /> CLI installed</span>
            <span><i data-state="active" /> browser approval</span>
            <span><i /> MCP after verification</span>
          </div>
        </div>
      </section>

      <div class="public-guide-flow" aria-label="Connection sequence">
        <span>terminal</span><b aria-hidden="true">→</b><span>browser approval</span><b aria-hidden="true">→</b><span>terminal connected</span><b aria-hidden="true">→</b><span>MCP host</span>
      </div>

      <GuideSection
        index="01"
        id="install"
        title="Install the development CLI"
        lede="The current development build is installed from the dongo source checkout. Node.js 20 or newer is required for the packed CLI."
      >
        <GuideCode label="install from source">{INSTALL_COMMANDS}</GuideCode>
        <p class="guide-inline-note"><span aria-hidden="true">↳</span> Run the final <code>dongo</code> commands inside the repository you want the agent to use.</p>
      </GuideSection>

      <GuideSection
        index="02"
        id="authorize"
        title="Authorize with one link"
        lede="Authentication begins in the terminal, moves to the web for human approval, then finishes back in the terminal."
      >
        <GuideCode label="connect this repository">{CONNECT_COMMAND}</GuideCode>
        <div class="guide-process" role="list" aria-label="Browser authorization steps">
          <article role="listitem"><span>1</span><h3>Terminal opens the link</h3><p>The CLI prints and opens a complete approval URL. Over SSH, add <code>--no-browser</code> and open that same URL yourself.</p></article>
          <article role="listitem"><span>2</span><h3>You compare the code</h3><p>Sign in if needed, confirm the matching short code, account, proposed project, API resource, and requested access.</p></article>
          <article role="listitem"><span>3</span><h3>Terminal verifies</h3><p>The page reports “Approved”; only the CLI reports “Connected” after credential storage, repository marking, and diagnostics succeed.</p></article>
        </div>
        <aside class="guide-callout guide-callout--green">
          <div class="guide-callout__label">No project yet?</div>
          <div><h3>That is a supported first-run path.</h3><p>The CLI proposes a project from the repository. The approval page shows <strong>Create &amp; approve</strong>; the first project is created and bound before the grant is issued. You do not need to create a project in the app first.</p></div>
        </aside>
        <p class="guide-inline-note"><span aria-hidden="true">↳</span> To override the inferred values, use <code>--project-name</code>, <code>--repository-url</code>, or <code>--execution-mode manual|autonomous</code>. For an existing project, use <code>--project-ref</code>.</p>
      </GuideSection>

      <GuideSection
        index="03"
        id="mcp"
        title="Add an MCP host"
        lede="CLI and MCP access are separate installations. Preview the exact files first, apply only the named dongo entry, then let the host complete its own OAuth flow."
      >
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

https://dev.dongo.so/p/<project-ref>/mcp`}</code></pre>
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
        lede="Connection checks are read-only. Run them before asking an agent to create, claim, or update work."
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
        lede="The npm CLI uses its own private user file. It does not ask to change or repair an operating-system credential store."
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
