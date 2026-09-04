import { A } from "@solidjs/router";
import { createSignal, onCleanup } from "solid-js";
import { Brand } from "../../components/Brand";
import marketingStyles from "./marketing.css?inline";

const SETUP_PROMPT = `Install the dongo-onboarding and dongo-workflow skills from
https://github.com/renewisepunk/dongo-skills

Then set up dongo for this repository. Install the CLI if needed, connect the
repository, configure this agent’s dongo connection, and tell me when browser
approval is ready.`;

function AgentRun(props: { agent: string; identifier: string; title: string; update: string; branch: string; tone?: "amber" | "green" }) {
  return (
    <div class="agent-run" data-tone={props.tone ?? "green"}>
      <span class="agent-run__rail" aria-hidden="true" />
      <div class="agent-run__top"><b>{props.agent}</b><span><i aria-hidden="true" /> running</span></div>
      <strong><small>{props.identifier}</small>{props.title}</strong>
      <p>{props.update}</p>
      <div class="agent-run__meta"><span>Worktree · {props.branch}</span><span>now</span></div>
    </div>
  );
}

function HeroProductVisual() {
  return (
    <figure class="hero-product" aria-labelledby="hero-product-caption">
      <div class="hero-product__frame">
        <div class="hero-product__fallback" aria-hidden="true">
          <div class="product-chrome">
            <span class="product-chrome__brand"><i /> dongo</span><span>rene / website</span><span class="product-chrome__live"><i /> live</span>
          </div>
          <div class="hero-product__body">
            <div class="activity-heading"><div><span class="eyebrow eyebrow--green">agent activity</span><strong>2 agents are moving work</strong></div><span>02 active</span></div>
            <div class="agent-grid">
              <AgentRun agent="Codex" identifier="dong075" title="Reframe the homepage" update="Building the product story and checking the responsive layout." branch="codex/dong075" />
              <AgentRun agent="Claude Code" identifier="dong076" title="Tighten release notes" update="Focused checks are green. Preparing the exact revision." branch="claude/dong076" tone="amber" />
            </div>
            <div class="signal-grid">
              <div class="signal-card signal-card--attention"><span>Needs you</span><b>1</b><strong>Choose the launch note</strong><small>Codex needs a decision</small></div>
              <div class="signal-card"><span>Recently done</span><b>8</b><strong>Mobile review shipped</strong><small>Production · 4 min ago</small></div>
            </div>
          </div>
        </div>
        <video class="hero-product__motion" src="/marketing/homepage-agent-work.mp4" poster="/marketing/homepage-agent-work-poster.jpg" autoplay loop muted playsinline preload="metadata" aria-hidden="true" />
      </div>
      <figcaption id="hero-product-caption"><span><i aria-hidden="true" /> two agents active</span><span>one decision waiting</span><span>eight shipped</span></figcaption>
    </figure>
  );
}

function InstallMockup() {
  return (
    <div class="story-screen story-screen--terminal" aria-hidden="true">
      <div class="terminal-bar"><span /><span /><span /><b>repository / terminal</b></div>
      <code><i>$</i> Paste the dongo setup prompt</code><code><span>✓</span> dongo skills installed</code><code><span>✓</span> repository connected</code><code class="terminal-ready"><span>→</span> browser approval ready<i /></code>
    </div>
  );
}

function FirstWorkMockup() {
  return (
    <div class="story-screen" aria-hidden="true">
      <div class="story-screen__bar"><span>Ready</span><b>03</b></div>
      <div class="mini-work"><small>dong001</small><strong>Map the first release</strong><span>Goal and checks added by agent</span></div>
      <div class="mini-work"><small>dong002</small><strong>Connect the production domain</strong><span>Ready for an agent</span></div>
      <div class="mini-work"><small>dong003</small><strong>Prove the sign-in journey</strong><span>Ready for an agent</span></div>
    </div>
  );
}

function CaptureMockup() {
  return (
    <div class="story-screen story-screen--capture" aria-hidden="true">
      <div class="capture-phone"><div class="capture-phone__top"><i /> dongo <span>+</span></div><b>New Intake</b><strong>Add mobile review for release approvals</strong><p>Capture a note, paste a screenshot, or drop a file.</p><button type="button" tabIndex={-1}>Add to Inbox</button></div>
      <div class="capture-arrow">→</div>
      <div class="capture-inbox"><span>Inbox</span><b>01</b><strong>Mobile review for releases</strong><small>added from phone · now</small></div>
    </div>
  );
}

function PickupMockup() {
  return (
    <div class="story-screen story-screen--pickup" aria-hidden="true">
      <div class="runner-status"><span><i /> local runner</span><b>online</b></div>
      <div class="pickup-path"><span>New Inbox</span><i>→</i><span>repository job</span><i>→</i><span>claimed Work</span></div>
      <p>Automatic mode · Codex · this repository</p>
    </div>
  );
}

function ParallelMockup() {
  return (
    <div class="story-screen story-screen--parallel" aria-hidden="true">
      <div class="story-screen__bar"><span>agent activity</span><b>02</b></div>
      <div class="parallel-mini-grid">
        <AgentRun agent="Codex" identifier="dong014" title="Build the API" update="Running focused tests." branch="codex/api" />
        <AgentRun agent="Claude Code" identifier="dong015" title="Polish onboarding" update="Checking mobile states." branch="claude/onboarding" tone="amber" />
      </div>
      <p class="parallel-truth">dongo coordinates claims. Your agent host creates the isolated worktrees.</p>
    </div>
  );
}

function AttentionMockup() {
  return (
    <div class="story-screen story-screen--attention" aria-hidden="true">
      <div class="attention-alert"><span>Needs you</span><b>1</b></div><strong>Which release message should we ship?</strong><p>The implementation is ready. Pick the message while the agent keeps the Run attached.</p>
      <div class="attention-options"><span>Lead with speed</span><span>Lead with control</span></div><div class="attention-reply">Add context for the agent…<b>Send</b></div>
    </div>
  );
}

function ShipMockup() {
  return (
    <div class="story-screen story-screen--ship" aria-hidden="true">
      <div class="ship-line"><i>✓</i><span><b>Focused checks</b><small>24 / 24 passed</small></span></div>
      <div class="ship-line"><i>✓</i><span><b>Integrated into main</b><small>commit 7da28f1</small></span></div>
      <div class="ship-line"><i>✓</i><span><b>Development accepted</b><small>exact revision verified</small></span></div>
      <div class="ship-line ship-line--live"><i>→</i><span><b>Production</b><small>live and healthy</small></span></div>
    </div>
  );
}

function AnywhereMockup() {
  return (
    <div class="story-screen story-screen--anywhere" aria-hidden="true">
      <div class="desktop-mini"><div class="product-chrome"><span class="product-chrome__brand"><i /> dongo</span><span>overview</span><span class="product-chrome__live"><i /> live</span></div><div class="desktop-mini__work"><span>Needs you <b>1</b></span><strong>Approve the release note</strong><small>Open from any browser</small></div></div>
      <div class="phone-mini"><span class="phone-mini__bar" /><b>dongo</b><small>Needs you</small><strong>Approve the release note</strong><button type="button" tabIndex={-1}>Open decision</button></div>
    </div>
  );
}

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
          <nav class="marketing-nav" aria-label="Main navigation"><a href="#how-it-works">How it works</a><A href="/get-started">Setup</A><A href="/changelog">Changelog</A><A href="/security">Security</A></nav>
          <div class="marketing-header__actions"><A class="marketing-sign-in" href="/login">Sign in</A><A class="button marketing-open-app" href="/open">Open dongo <span aria-hidden="true">↗</span></A></div>
        </div>
      </header>

      <main id="marketing-content">
        <section class="marketing-hero" aria-labelledby="marketing-title">
          <div class="marketing-hero__copy">
            <p class="eyebrow eyebrow--amber">The work tracker for coding agents</p>
            <h1 id="marketing-title">dongo is Linear if it were built for agents, not humans.</h1>
            <p class="marketing-hero__standfirst">Stop following agent work across terminals and endless chats.</p>
            <p class="marketing-hero__lede">See what your agents are working on, what’s done, and when they need you. Add work, answer questions, and give feedback from your phone or browser — while your agents keep working.</p>
            <div class="marketing-hero__actions"><button class="button button--primary" type="button" onClick={() => void copySetupPrompt()}>{copied() ? "Setup prompt copied" : "Copy setup prompt"}</button><A class="button" href="/get-started">See the setup</A></div>
            <p class="marketing-hero__note">Paste the prompt into Codex, Claude Code, or another Agent Skills host.</p>
          </div>
          <HeroProductVisual />
        </section>

        <div class="marketing-proof" aria-label="What dongo keeps visible"><span><b>01</b> what agents are doing</span><span><b>02</b> what already shipped</span><span><b>03</b> what needs your judgment</span></div>

        <section class="workflow" id="how-it-works" aria-labelledby="workflow-title">
          <div class="workflow__heading"><p class="eyebrow eyebrow--amber">How it works</p><h2 id="workflow-title">From one prompt to shipped work.</h2><p>Set up dongo once. Your agents can structure the first work, pick up new Intake, work concurrently, ask for judgment, and carry the result through release.</p></div>
          <ol class="workflow-steps">
            <li class="workflow-step"><div class="workflow-step__copy"><span>01 / connect</span><h3>Install from the agent you already use.</h3><p>Paste one setup prompt. Your agent installs the dongo skills, connects this repository, and brings you to the browser for explicit approval.</p></div><InstallMockup /></li>
            <li class="workflow-step"><div class="workflow-step__copy"><span>02 / structure</span><h3>Let the agent create the first focused issues.</h3><p>Give it the outcome. The agent turns that brief into clear WorkItems with goals, checks for duplicates, and makes the next executable work visible.</p></div><FirstWorkMockup /></li>
            <li class="workflow-step"><div class="workflow-step__copy"><span>03 / add</span><h3>Add new work from your phone or browser.</h3><p>Drop in a note, screenshot, link, or file. It lands in Inbox as durable Intake instead of disappearing inside another chat.</p></div><CaptureMockup /></li>
            <li class="workflow-step"><div class="workflow-step__copy"><span>04 / pick up</span><h3>New Intake can start automatically.</h3><p>When your opted-in local runner is online in automatic mode, it can launch a separate repository-scoped agent job for new Inbox items. Offline work waits safely.</p></div><PickupMockup /></li>
            <li class="workflow-step"><div class="workflow-step__copy"><span>05 / parallel</span><h3>Several agents can move separate issues at once.</h3><p>dongo coordinates atomic claims and active Runs. A supported agent host gives each job its own isolated worktree, up to the limit you set.</p></div><ParallelMockup /></li>
            <li class="workflow-step"><div class="workflow-step__copy"><span>06 / decide</span><h3>Step in when human judgment is actually needed.</h3><p>A Needs you alert keeps the question attached to the work. Answer, choose an option, or add feedback from any browser without taking over the agent’s session.</p></div><AttentionMockup /></li>
            <li class="workflow-step"><div class="workflow-step__copy"><span>07 / ship</span><h3>Follow the exact change all the way to production.</h3><p>Commits, checks, deployments, acceptance, and the final outcome stay on the Run. Done means the requested result is integrated and verified — not merely committed somewhere.</p></div><ShipMockup /></li>
            <li class="workflow-step"><div class="workflow-step__copy"><span>08 / anywhere</span><h3>The same truth, on desktop or mobile.</h3><p>Open dongo from your phone or browser to add work, see progress, review what shipped, and respond when an agent needs you.</p></div><AnywhereMockup /></li>
          </ol>
        </section>

        <section class="marketing-final" aria-labelledby="marketing-final-title">
          <div><p class="eyebrow eyebrow--amber">Start with one repository</p><h2 id="marketing-final-title">Leave the terminals to your agents.</h2><p>Keep the work, decisions, and shipped result in dongo.</p></div>
          <div class="marketing-final__actions"><button class="button button--primary" type="button" onClick={() => void copySetupPrompt()}>{copied() ? "Setup prompt copied" : "Copy setup prompt"}</button><A class="button" href="/login">Sign in</A></div>
        </section>
      </main>

      <footer class="marketing-footer">
        <div class="marketing-footer__inner"><Brand compact /><p>Agent work, visible.</p><nav aria-label="Footer navigation"><A href="/get-started">Get started</A><A href="/help">Help</A><A href="/changelog">Changelog</A><A href="/security">Security</A><a href="https://github.com/renewisepunk/dongo" rel="external">Source</a></nav></div>
      </footer>
    </div>
  );
}
