import { A } from "@solidjs/router";
import { Brand } from "../../components/Brand";
import marketingStyles from "./marketing.css?inline";

export function MarketingHome() {
  return (
    <div class="marketing-page">
      <style>{marketingStyles}</style>
      <a class="marketing-skip" href="#marketing-content">Skip to content</a>

      <header class="marketing-header">
        <div class="marketing-header__inner">
          <Brand compact />
          <nav class="marketing-nav" aria-label="Main navigation">
            <a href="#how-it-works">How it works</a>
            <a href="#for-agents">For agents</a>
            <A href="/security">Security</A>
            <A href="/get-started">Get started</A>
            <A href="/help">Help</A>
          </nav>
          <div class="marketing-header__actions">
            <A class="marketing-sign-in" href="/login">Sign in</A>
            <A class="button marketing-open-app" href="/open">Open dongo <span aria-hidden="true">↗</span></A>
          </div>
        </div>
      </header>

      <main id="marketing-content">
        <section class="marketing-hero" aria-labelledby="marketing-title">
          <div class="marketing-hero__copy">
            <p class="eyebrow eyebrow--amber">Work tracking for humans + agents</p>
            <h1 id="marketing-title">Install the skills. Let your agent set up dongo.</h1>
            <p class="marketing-hero__lede">
              dongo gives you and your coding agents one shared work queue. Install the dongo skills in the agent you already use, ask it to set up this repository, then approve the connection in your browser.
            </p>
            <div class="marketing-hero__actions">
              <a class="button button--primary" href="https://github.com/renewisepunk/dongo-skills" rel="external">Install dongo skills <span aria-hidden="true">↗</span></a>
              <A class="button" href="/get-started">See the setup</A>
              <a class="button" href="#how-it-works">See how it works</a>
            </div>
          </div>

          <div class="marketing-overview" aria-label="Example dongo overview">
            <div class="marketing-overview__top">
              <span>overview</span>
              <span>rene / website</span>
            </div>
            <div class="marketing-capture">
              <span>Add something…</span>
              <span>paste or drop a file <b aria-hidden="true">↵</b></span>
            </div>
            <div class="marketing-work-group marketing-work-group--attention">
              <div class="marketing-work-group__heading"><span>Needs you</span><b>1</b></div>
              <div class="marketing-work-item">
                <i aria-hidden="true">!</i>
                <div><strong>Choose the sign-in recovery path</strong><span>Claude Code needs a decision</span></div>
              </div>
            </div>
            <div class="marketing-work-group">
              <div class="marketing-work-group__heading"><span>Working</span><b>1</b></div>
              <div class="marketing-work-item">
                <i aria-hidden="true">›</i>
                <div><strong>Add image paste to comments</strong><span>Codex · updated now</span></div>
              </div>
            </div>
          </div>
        </section>

        <div class="marketing-answer-strip" aria-label="Questions dongo answers">
          <span><b>01</b> What needs me?</span>
          <span><b>02</b> What is happening?</span>
          <span><b>03</b> What is waiting?</span>
        </div>

        <section class="marketing-section" id="how-it-works" aria-labelledby="how-it-works-title">
          <div class="marketing-section__intro">
            <p class="eyebrow">How it works</p>
            <h2 id="how-it-works-title">You add intent.<br />The agent handles the tracker.</h2>
          </div>
          <ol class="marketing-steps">
            <li>
              <span>01 / capture</span>
              <h3>Say what you need</h3>
              <p>Write naturally. Paste an image into the composer or drop a file anywhere on the page. No issue type, status, assignee, or acceptance criteria required.</p>
            </li>
            <li>
              <span>02 / work</span>
              <h3>Your agent takes it from there</h3>
              <p>The agent reads the repository, turns raw Intake into work, claims it, and leaves useful updates while it works.</p>
            </li>
            <li>
              <span>03 / attention</span>
              <h3>You decide when it matters</h3>
              <p>Questions and reviews move into Needs you. Answer once, then the agent continues with the decision attached to the work.</p>
            </li>
          </ol>
        </section>

        <section class="marketing-section marketing-section--agents" id="for-agents" aria-labelledby="for-agents-title">
          <div class="marketing-section__intro">
            <p class="eyebrow">Agent-first by design</p>
            <h2 id="for-agents-title">One prompt gets you connected.</h2>
            <p class="marketing-section__lede">
              The skills teach your local agent how to install the CLI, connect dongo, configure its MCP host, and work safely. You only approve the browser prompts.
            </p>
          </div>

          <div class="marketing-agent-grid">
            <article class="marketing-terminal">
              <div class="marketing-terminal__top"><span>agent</span><span>setup brief</span></div>
              <pre aria-label="Example dongo agent setup"><code><span>›</span> Install the dongo skills{`\n`}<b>✓</b> skills available{`\n`}{`\n`}<span>›</span> Set up dongo for this repository{`\n`}<span>status</span>  waiting for browser approval{`\n`}<span>next</span>    agent connects and verifies</code></pre>
            </article>

            <div class="marketing-agent-points">
              <article>
                <span>Skills first</span>
                <h3>The agent handles setup</h3>
                <p>It installs dongo, connects the repository, configures its own MCP host, and checks the result. You approve each scoped installation in the browser.</p>
              </article>
              <article>
                <span>Separate identity</span>
                <h3>The agent acts like itself</h3>
                <p>Agent comments, claims, and updates are attributed to its own installation—not posted under the human who authorized it.</p>
              </article>
              <article>
                <span>Manual when useful</span>
                <h3>CLI and MCP stay available</h3>
                <p>Prefer the direct commands when you want to inspect or control setup yourself. Every installation still has its own project-scoped grant.</p>
              </article>
            </div>
          </div>
        </section>

        <section class="marketing-final" aria-labelledby="marketing-final-title">
          <div>
            <p class="eyebrow eyebrow--amber">Start with one repository</p>
            <h2 id="marketing-final-title">Let the agent set it up.</h2>
            <p>Install the skills, tell your agent to set up dongo, approve in the browser, then get back to the work.</p>
          </div>
          <div class="marketing-final__actions">
            <a class="button button--primary" href="https://github.com/renewisepunk/dongo-skills" rel="external">Install dongo skills <span aria-hidden="true">↗</span></a>
            <A class="button" href="/login">Sign in</A>
          </div>
        </section>
      </main>

      <footer class="marketing-footer">
        <div class="marketing-footer__inner">
          <Brand compact />
          <p>Agent work, without the project management.</p>
          <nav aria-label="Footer navigation">
            <A href="/get-started">Get started</A>
            <A href="/help">Help</A>
            <A href="/security">Security</A>
            <a href="https://github.com/renewisepunk/dongo" rel="external">Source</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
