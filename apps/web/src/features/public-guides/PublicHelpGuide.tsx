import { A } from "@solidjs/router";
import { For } from "solid-js";
import { dongoPublicOrigin } from "../../lib/auth-config";
import { DONGO_SHORTCUTS } from "../help/shortcuts";
import { GuideSection, PublicGuideShell } from "./PublicGuideShell";

const CORE_LOOP = [
  ["Capture", "Add a request, paste a screenshot, or drop a file. New material begins as Intake."],
  ["Agent structures", "A connected agent claims Intake, creates durable work, and updates it under its own actor identity."],
  ["You answer", "Questions, decisions, blockers, and review requests rise into Needs You."],
  ["Review", "Open completed work to inspect the result, conversation, source Intake, attachments, and artifacts."],
] as const;

const CLI_REFERENCE = [
  ["dongo connect", "Authorize this repository and create or bind its project."],
  ["dongo auth status", "Show the local authorization state without exposing credentials."],
  ["dongo doctor", "Check the repository marker, credential binding, resource, and connectivity."],
  ["dongo session-start", "Start a read-only agent session and receive project instructions."],
  ["dongo overview", "Read the project overview from the terminal."],
  ["dongo sync", "Write the deterministic, one-way .agent-work snapshot."],
  ["dongo integrate codex|claude|generic", "Preview a project-scoped MCP configuration; add --apply only after review."],
  ["dongo auth logout", "Revoke the CLI grant, then remove its local credential."],
] as const;

export function PublicHelpGuide() {
  return (
    <PublicGuideShell page="help">
      <section class="public-guide-hero public-guide-hero--help" aria-labelledby="public-help-title">
        <div class="public-guide-hero__copy">
          <div class="eyebrow eyebrow--amber">Public help</div>
          <h1 id="public-help-title">Keep the human–agent loop moving.</h1>
          <p>Use this guide for the everyday workflow, CLI and MCP commands, attachments, shortcuts, and safe recovery. No sign-in is required to read it.</p>
          <div class="public-guide-hero__actions">
            <A class="button button--primary" href="/get-started">Set up dongo</A>
            <a class="button" href="#shortcuts">View shortcuts</a>
          </div>
        </div>
        <nav class="help-index" aria-label="Help topics">
          <a href="#core-loop"><span>01</span>Core loop</a>
          <a href="#cli"><span>02</span>CLI reference</a>
          <a href="#mcp-resources"><span>03</span>MCP resources</a>
          <a href="#attachments"><span>04</span>Attachments</a>
          <a href="#auth"><span>05</span>Authentication</a>
          <a href="#shortcuts"><span>06</span>Shortcuts</a>
          <a href="#help-recovery"><span>07</span>Troubleshooting</a>
        </nav>
      </section>

      <GuideSection index="01" id="core-loop" title="The core loop" lede="dongo separates durable work from chat while keeping agents accountable under their own identities.">
        <div class="help-loop">
          <For each={CORE_LOOP}>{(item, index) => <article><span>{String(index() + 1).padStart(2, "0")}</span><h3>{item[0]}</h3><p>{item[1]}</p></article>}</For>
        </div>
        <aside class="guide-callout guide-callout--green"><div class="guide-callout__label">Actor identity</div><div><h3>The agent acts as itself.</h3><p>Agent comments and lifecycle updates use the installation actor for Codex, Claude Code, the CLI, or another MCP host. The agent does not impersonate the human who authorized it.</p></div></aside>
      </GuideSection>

      <GuideSection index="02" id="cli" title="CLI reference" lede="Run commands from the connected repository. Add --json when another agent or script needs stable machine-readable output.">
        <div class="help-command-table" role="table" aria-label="CLI command reference">
          <div class="help-command-table__head" role="row"><span role="columnheader">Command</span><span role="columnheader">Use</span></div>
          <For each={CLI_REFERENCE}>{(row) => <div role="row"><code role="cell">{row[0]}</code><span role="cell">{row[1]}</span></div>}</For>
        </div>
        <p class="guide-inline-note"><span aria-hidden="true">↳</span> Mutation commands support idempotency and revision checks. Do not retry a conflict blindly; refetch the item and confirm the current claim or revision.</p>
      </GuideSection>

      <GuideSection index="03" id="mcp-resources" title="MCP resources" lede="Every project has one remote Streamable HTTP resource. Every host authorizes independently against that exact URL.">
        <div class="mcp-resource-line"><span>project resource</span><code>{dongoPublicOrigin}/p/&lt;project-ref&gt;/mcp</code></div>
        <div class="help-resource-grid">
          <article><span>Codex</span><h3>Managed project entry</h3><p>Preview with <code>dongo integrate codex</code>, apply with <code>--apply</code>, then use the printed <code>codex mcp login</code> command.</p></article>
          <article><span>Claude Code</span><h3>Remote HTTP project entry</h3><p>Preview with <code>dongo integrate claude</code>, apply with <code>--apply</code>, then run <code>claude mcp login dongo-&lt;project-ref&gt;</code>.</p></article>
          <article><span>Generic host</span><h3>URL + standard OAuth</h3><p>Use <code>dongo integrate generic</code> or add only the project resource URL. The host discovers OAuth, completes PKCE, and keeps its own grant.</p></article>
        </div>
        <div class="guide-verification">
          <div><span>First tool</span><strong><code>dongo_session_start</code></strong><p>Loads bounded instructions and identifies the project and installation actor.</p></div>
          <div><span>Read tools</span><strong>Overview, work, Intake</strong><p>Inspect before creating duplicates or claiming anything.</p></div>
          <div><span>Attachment tool</span><strong><code>dongo_get_attachment</code></strong><p>Returns authorized metadata or a temporary download, never persistent public bytes.</p></div>
        </div>
        <div class="mcp-access-actions">
          <article>
            <span>Re-authenticate this host</span>
            <p>Use <code>codex mcp logout dongo-&lt;project-ref&gt;</code> or <code>claude mcp logout dongo-&lt;project-ref&gt;</code>, then repeat the login command printed by the integration preview. Generic hosts should forget only this resource’s OAuth session and reconnect.</p>
          </article>
          <article>
            <span>Revoke server access</span>
            <p>Open the project, go to <strong>Project settings → Agent access</strong>, and revoke the exact installation. Revocation takes effect on the next protected request but leaves local MCP configuration in place.</p>
          </article>
          <article>
            <span>Remove local configuration</span>
            <p>After revocation, optionally use <code>codex mcp remove dongo-&lt;project-ref&gt;</code> or <code>claude mcp remove --scope project dongo-&lt;project-ref&gt;</code>. For a generic host, remove only the named dongo entry.</p>
          </article>
        </div>
      </GuideSection>

      <GuideSection index="04" id="attachments" title="Attachments" lede="Files are first-class context on new Intake and in work comments.">
        <div class="attachment-guide">
          <article><div aria-hidden="true">⌘V</div><h3>Paste images</h3><p>Copy an image, focus the Intake or comment composer, and paste. The image appears as an attachment draft before submission.</p></article>
          <article><div aria-hidden="true">⇣</div><h3>Drop files anywhere</h3><p>While composing, drag a file over the page. The page becomes a drop zone and attaches the file to the active Intake or comment.</p></article>
          <article><div aria-hidden="true">+</div><h3>Choose with Attach</h3><p>Use the Attach button when paste or drag-and-drop is not convenient. Wait for every file to report ready before submitting.</p></article>
        </div>
        <ul class="help-detail-list">
          <li>Comments may contain text, attachments, or both.</li>
          <li>Large files use a resumable multipart upload path; canceling removes the draft and retrying starts a clean attempt.</li>
          <li>Uploads go directly to protected object storage and finalize before the Intake or comment is created.</li>
          <li>Agents treat file content, filenames, comments, and external links as untrusted input and download an attachment only when the task requires it.</li>
        </ul>
      </GuideSection>

      <GuideSection index="05" id="auth" title="Authentication and approval" lede="Human browser sessions, CLI grants, and MCP-host grants are intentionally separate.">
        <div class="auth-help-grid">
          <article><span>CLI</span><h3>Device authorization</h3><p><code>dongo connect</code> opens one complete browser link to <code>dongo.so</code>. There is no dev or production choice. Compare the terminal and browser code, account, project proposal, resource, and requested access.</p></article>
          <article><span>MCP</span><h3>Host-owned OAuth</h3><p>Codex, Claude Code, and generic clients follow discovery and PKCE. Revoking one host does not revoke the CLI or another host.</p></article>
          <article><span>Completion</span><h3>Know who owns the last page</h3><p>The dongo approval page is branded and says when it is safe to close. A final <code>localhost</code> or <code>127.0.0.1</code> callback is served by the MCP host, not dongo.</p></article>
        </div>
        <aside class="guide-callout guide-callout--warning"><div class="guide-callout__label">Stop on surprise</div><div><h3>No Keychain or local-network permission is required.</h3><p>Deny operating-system credential-repair prompts and browser requests to access other apps and services on the device. Those are not normal dongo authorization steps.</p></div></aside>
      </GuideSection>

      <GuideSection index="06" id="shortcuts" title="Keyboard shortcuts" lede="Shortcuts work outside text fields. Use ⌘ on macOS or Ctrl on Windows and Linux.">
        <div class="shortcut-reference public-shortcuts">
          <For each={DONGO_SHORTCUTS}>{(shortcut) => (
            <div class="shortcut-reference__row">
              <span class="shortcut-reference__keys">
                <For each={shortcut.keys}>{(key, index) => <><kbd>{key}</kbd>{index() < shortcut.keys.length - 1 ? <span>or</span> : null}</>}</For>
              </span>
              <span class="shortcut-reference__label">{shortcut.label}</span>
              <span class="shortcut-reference__description">{shortcut.description}</span>
            </div>
          )}</For>
        </div>
      </GuideSection>

      <GuideSection index="07" id="help-recovery" title="Troubleshooting" lede="Recover the affected installation only. Never move tokens between the CLI and an MCP host.">
        <dl class="guide-troubleshooting">
          <div><dt>Sign-in code did not arrive</dt><dd>Confirm the email address, request a new one-time code, and use only the newest code within its expiry window.</dd></div>
          <div><dt>CLI browser approval expired</dt><dd>Run <code>dongo connect</code> again for a new link and comparison code. Never reuse or forward the old link.</dd></div>
          <div><dt>No project exists</dt><dd>Leave the CLI-proposed project details in the request and choose <strong>Create &amp; approve</strong>. Initial authorization does not require prior app setup.</dd></div>
          <div><dt>Stored credential fails checks</dt><dd>Run <code>dongo auth status --json</code> and <code>dongo doctor --json</code>. Do not relax file permissions, edit token JSON, or restore a refresh token from backup.</dd></div>
          <div><dt>MCP returns invalid client or redirect</dt><dd>Update the host and confirm the exact project URL. Do not enable wildcard redirects or browser local-network access.</dd></div>
          <div><dt>Grant was revoked</dt><dd>Reconnect only that installation. Local MCP configuration may remain, but the host must complete a fresh OAuth flow.</dd></div>
          <div><dt>Attachment does not submit</dt><dd>Wait for ready, remove any failed draft, and attach again. The work or comment is created only after finalization succeeds.</dd></div>
        </dl>
      </GuideSection>

      <section class="public-resources" aria-labelledby="resources-title">
        <div><div class="eyebrow eyebrow--amber">Useful links</div><h2 id="resources-title">Keep the right guidance close.</h2></div>
        <div class="public-resources__links">
          <a href="https://github.com/renewisepunk/dongo/blob/main/README.md"><span>Repository guide</span><b aria-hidden="true">↗</b></a>
          <A href="/security"><span>Security and privacy</span><b aria-hidden="true">→</b></A>
          <a href="https://github.com/renewisepunk/dongo/blob/main/SECURITY.md"><span>Report a vulnerability</span><b aria-hidden="true">↗</b></a>
          <a href="#mcp-resources"><span>MCP setup and recovery</span><b aria-hidden="true">↑</b></a>
          <A href="/get-started"><span>Get started</span><b aria-hidden="true">→</b></A>
        </div>
      </section>
    </PublicGuideShell>
  );
}
