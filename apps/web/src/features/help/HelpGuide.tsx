import { A } from "@solidjs/router";
import { For } from "solid-js";
import { Brand } from "../../components/Brand";
import { DONGO_SHORTCUTS } from "./shortcuts";
import "./help.css";

export type HelpGuideProps = {
  orgSlug: string;
  projectSlug: string;
};

const GUIDE_STEPS = [
  {
    number: "01",
    title: "Capture the intent",
    body: "Add a rough request, paste a screenshot, or drop a file anywhere on Overview. dongo keeps it in Inbox until a connected agent claims it.",
  },
  {
    number: "02",
    title: "Let the agent structure the work",
    body: "The agent turns Intake into Ready work, claims what it can execute, and reports live progress under Working.",
  },
  {
    number: "03",
    title: "Answer Needs You",
    body: "Decisions, questions, blockers, and reviews rise to the top. Your response arrives on the next explicit pull; an active dongo waiter checks with backoff for up to five minutes, while a stopped agent stays stopped.",
  },
  {
    number: "04",
    title: "Review the result",
    body: "Open completed work to inspect the final update, conversation, source Intake, attachments, and durable artifacts.",
  },
] as const;

export function HelpGuide(props: HelpGuideProps) {
  const overviewHref = `/app/${encodeURIComponent(props.orgSlug)}/${encodeURIComponent(props.projectSlug)}`;

  return (
    <main class="help-page">
      <header class="app-header">
        <Brand compact href={overviewHref} />
        <div class="help-header__path">/ {props.projectSlug} / help</div>
        <div class="header-spacer" />
        <A class="button button--quiet" href={overviewHref}>← Overview</A>
      </header>

      <div class="help-scroll">
        <div class="help-content">
          <section class="help-intro" aria-labelledby="help-title">
            <div class="eyebrow eyebrow--amber">Help guide</div>
            <h1 class="help-title" id="help-title">Keep the loop moving</h1>
            <p class="help-lede">dongo is the shared surface between you and your coding agents: capture intent, see what is moving, and answer only when your judgment is needed.</p>
          </section>

          <section class="help-section" aria-labelledby="help-flow-title">
            <div class="help-section__head">
              <span class="help-section__index">01</span>
              <h2 id="help-flow-title">The core loop</h2>
            </div>
            <div class="help-guide-grid">
              <For each={GUIDE_STEPS}>{(step) => (
                <article class="help-guide-card">
                  <span class="help-guide-card__number">{step.number}</span>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </article>
              )}</For>
            </div>
          </section>

          <section class="help-section" aria-labelledby="help-agent-title">
            <div class="help-section__head">
              <span class="help-section__index">02</span>
              <h2 id="help-agent-title">Connect an agent</h2>
            </div>
            <div class="help-callout">
              <div>
                <h3>Start in the repository</h3>
                <p>Run <code>dongo connect</code>. The CLI opens one secure browser approval, stores its own credential, and binds this repository to one project.</p>
              </div>
              <A class="button" href={`${overviewHref}/settings?tab=Access`}>Review access</A>
            </div>
            <ol class="help-setup-sequence" aria-label="Agent setup sequence">
              <li><strong>Apply configuration.</strong><span>Review and apply the project-scoped change.</span></li>
              <li><strong>Approve only if required.</strong><span>Trust the project-scoped server when your host asks.</span></li>
              <li><strong>Log in only if required.</strong><span>Complete the host login when authentication is still needed.</span></li>
              <li><strong>Restart only when necessary.</strong><span>Keep using the current repository session when it can reload the connection.</span></li>
              <li><strong>Verify.</strong><span>Finish only after the selected agent connection passes its check.</span></li>
            </ol>
            <p class="help-note">Codex, Claude Code, and other MCP hosts authorize independently. Revoking one installation does not revoke the others.</p>
          </section>

          <section class="help-section" aria-labelledby="help-shortcuts-title">
            <div class="help-section__head">
              <span class="help-section__index">03</span>
              <h2 id="help-shortcuts-title">Keyboard shortcuts</h2>
            </div>
            <p class="help-section__lede">Shortcuts work outside text fields. Use <kbd>⌘</kbd> on macOS or <kbd>Ctrl</kbd> on Windows and Linux.</p>
            <div class="shortcut-reference">
              <For each={DONGO_SHORTCUTS}>{(shortcut) => (
                <div class="shortcut-reference__row">
                  <span class="shortcut-reference__keys">
                    <For each={shortcut.keys}>{(key, index) => (
                      <><kbd>{key}</kbd>{index() < shortcut.keys.length - 1 ? <span>or</span> : null}</>
                    )}</For>
                  </span>
                  <span class="shortcut-reference__label">{shortcut.label}</span>
                  <span class="shortcut-reference__description">{shortcut.description}</span>
                </div>
              )}</For>
            </div>
          </section>

          <footer class="help-footer">
            <span class="help-footer__prompt" aria-hidden="true">›</span>
            <span>Return to Overview and press <kbd>?</kbd> any time for the compact shortcut reference.</span>
          </footer>
        </div>
      </div>
    </main>
  );
}
