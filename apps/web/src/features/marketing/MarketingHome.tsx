import { A } from "@solidjs/router";
import { createSignal, onCleanup } from "solid-js";
import { Brand } from "../../components/Brand";
import marketingStyles from "./marketing.css?inline";

const SETUP_PROMPT = `Install the dongo-onboarding and dongo-workflow skills from
https://github.com/renewisepunk/dongo-skills

Then set up dongo for this repository. Install anything needed, connect dongo,
configure the agent connection, and tell me when you need browser approval.`;

export function MarketingHome() {
  const [copied, setCopied] = createSignal(false);
  let copyTimer: number | undefined;

  onCleanup(() => window.clearTimeout(copyTimer));

  const copySetupPrompt = async () => {
    try {
      await navigator.clipboard.writeText(SETUP_PROMPT);
      setCopied(true);
      window.clearTimeout(copyTimer);
      copyTimer = window.setTimeout(() => setCopied(false), 2400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div class="marketing-page">
      <style>{marketingStyles}</style>
      <a class="marketing-skip" href="#marketing-content">Skip to content</a>

      <header class="marketing-header">
        <div class="marketing-header__inner">
          <Brand compact />
          <nav class="marketing-nav" aria-label="Main navigation">
            <a href="#how-it-works">How it works</a>
            <a href="#why-dongo">Why dongo</a>
            <a href="#who-its-for">Who it’s for</a>
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
            <p class="eyebrow eyebrow--amber">The work tracker for coding agents</p>
            <h1 id="marketing-title">Like Linear, but for coding agents.</h1>
            <p class="marketing-hero__lede">
              Give a coding agent work. See what it is doing. Step in only when it needs a decision. dongo is the shared place for you and your agents to keep development moving.
            </p>
            <div class="marketing-hero__actions">
              <button class="button button--primary" type="button" onClick={() => void copySetupPrompt()}>{copied() ? "Setup prompt copied" : "Copy setup prompt"}</button>
            </div>
            <p class="marketing-hero__note">Works with any agent that supports Agent Skills. Paste the prompt into your agent, then approve dongo in the browser when it asks.</p>
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
          <span><b>01</b> Give an agent a task</span>
          <span><b>02</b> See work as it happens</span>
          <span><b>03</b> Answer decisions, not status pings</span>
        </div>

        <section class="marketing-section" id="how-it-works" aria-labelledby="how-it-works-title">
          <div class="marketing-section__intro">
            <p class="eyebrow">Start here</p>
            <h2 id="how-it-works-title">Start with the agent you already use.</h2>
          </div>
          <ol class="marketing-steps">
            <li>
              <span>01 / install</span>
              <h3>Install the dongo skills</h3>
              <p>Add the skills to Codex, Claude Code, or another compatible agent. This is the only setup step you need to do yourself.</p>
            </li>
            <li>
              <span>02 / connect</span>
              <h3>Ask your agent to set up dongo</h3>
              <p>It installs the CLI when needed, connects the repository, and configures its own MCP connection.</p>
            </li>
            <li>
              <span>03 / approve</span>
              <h3>Approve once in the browser</h3>
              <p>dongo asks for your approval. Then the agent verifies its connection and starts keeping work visible.</p>
            </li>
          </ol>
        </section>

        <section class="marketing-section marketing-section--agents" id="why-dongo" aria-labelledby="why-dongo-title">
          <div class="marketing-section__intro">
            <p class="eyebrow">Why dongo</p>
            <h2 id="why-dongo-title">Development changed. The tracker did not.</h2>
            <p class="marketing-section__lede">
              Coding agents now plan, write, and ship real work. But most trackers still assume people create tickets, write updates, and carry context between chats. dongo gives agent work a record you can actually follow.
            </p>
          </div>

          <div class="marketing-agent-grid">
            <article class="marketing-terminal">
              <div class="marketing-terminal__top"><span>work</span><span>in progress</span></div>
              <pre aria-label="Example dongo work update"><code><span>agent</span>   Codex{`\n`}<span>work</span>    Improve sign-in recovery{`\n`}<span>status</span>  waiting on you{`\n`}{`\n`}<span>question</span> Ship email recovery first?{`\n`}<b>✓</b> context and progress are attached</code></pre>
            </article>

            <div class="marketing-agent-points">
              <article>
                <span>Chat loses the thread</span>
                <h3>Work needs a record</h3>
                <p>Prompts, progress, decisions, files, and outcomes stay with the work instead of disappearing into a long agent conversation.</p>
              </article>
              <article>
                <span>Agents are not a black box</span>
                <h3>See what is happening</h3>
                <p>Each agent updates work under its own identity. You can see what it picked up, where it is blocked, and what it finished.</p>
              </article>
              <article>
                <span>People should decide</span>
                <h3>Only get pulled in when it matters</h3>
                <p>Reviews, choices, and blockers rise to you. Answer once, and the agent continues with that decision attached to the work.</p>
              </article>
            </div>
          </div>
        </section>

        <section class="marketing-section" id="who-its-for" aria-labelledby="who-its-for-title">
          <div class="marketing-section__intro">
            <p class="eyebrow">Who it’s for</p>
            <h2 id="who-its-for-title">For people who lead development with agents.</h2>
            <p class="marketing-section__lede">dongo is for anyone who has moved beyond one-off coding prompts and wants agent work to be clear, durable, and easy to steer.</p>
          </div>
          <ol class="marketing-steps">
            <li>
              <span>01 / builders</span>
              <h3>Solo developers shipping with agents</h3>
              <p>Keep a reliable view of the work without turning every prompt into a ticket or a status update.</p>
            </li>
            <li>
              <span>02 / leads</span>
              <h3>Technical leaders directing parallel work</h3>
              <p>See what each agent is doing, answer the decisions that need you, and keep context from getting lost between sessions.</p>
            </li>
            <li>
              <span>03 / teams</span>
              <h3>Teams adding agents to their development process</h3>
              <p>Give people and agents one shared view of requests, progress, decisions, and finished work.</p>
            </li>
          </ol>
        </section>

        <section class="marketing-final" aria-labelledby="marketing-final-title">
          <div>
            <p class="eyebrow eyebrow--amber">Start with one repository</p>
            <h2 id="marketing-final-title">Put agent work where you can see it.</h2>
            <p>Copy the setup prompt, paste it into your agent, approve in the browser, then get back to the work.</p>
          </div>
          <div class="marketing-final__actions">
            <button class="button button--primary" type="button" onClick={() => void copySetupPrompt()}>{copied() ? "Setup prompt copied" : "Copy setup prompt"}</button>
            <A class="button" href="/login">Sign in</A>
          </div>
        </section>
      </main>

      <footer class="marketing-footer">
        <div class="marketing-footer__inner">
          <Brand compact />
          <p>Development work, led by agents. Kept clear for you.</p>
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
