import { A } from "@solidjs/router";
import { createSignal, onCleanup } from "solid-js";
import { Brand } from "../../components/Brand";
import marketingStyles from "./marketing.css?inline";

const SETUP_PROMPT = `Install the dongo-onboarding and dongo-workflow skills from
https://github.com/renewisepunk/dongo-skills

Then set up dongo for this repository. Install the CLI if needed, connect the
repository, configure this agent’s dongo connection, and tell me when browser
approval is ready.`;

type ProductScreen = "ideas" | "overview" | "work";

export function MarketingHome() {
  const [copied, setCopied] = createSignal(false);
  const [productScreen, setProductScreen] = createSignal<ProductScreen>("ideas");
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
            <a href="#product">Product</a>
            <a href="#ideas">Ideas</a>
            <a href="#collaboration">Collaboration</a>
            <A href="/changelog">Changelog</A>
            <A href="/security">Security</A>
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
            <p class="eyebrow eyebrow--amber">For people working with coding agents</p>
            <h1 id="marketing-title">Ideas become visible work.</h1>
            <p class="marketing-hero__lede">Capture an idea. Send it to Inbox when it is ready. Follow the work with agents.</p>
            <div class="marketing-hero__actions">
              <button class="button button--primary" type="button" onClick={() => void copySetupPrompt()}>{copied() ? "Setup prompt copied" : "Copy setup prompt"}</button>
              <A class="button" href="/get-started">See the setup</A>
            </div>
            <p class="marketing-hero__note">Paste the prompt into Codex, Claude Code, or another Agent Skills host.</p>
          </div>

          <article class="marketing-product" id="product" aria-label="dongo product tour">
            <div class="marketing-product__chrome">
              <span class="marketing-product__mark"><i aria-hidden="true" /> dongo</span>
              <span>rene / website</span>
              <span class="marketing-product__presence"><i aria-hidden="true" /> agent activity</span>
            </div>
            <div class="marketing-product__tabs" role="tablist" aria-label="Product screens">
              <button id="marketing-tab-ideas" type="button" role="tab" aria-controls="marketing-screen-ideas" aria-selected={productScreen() === "ideas"} onClick={() => setProductScreen("ideas")}>Ideas <span>03</span></button>
              <button id="marketing-tab-overview" type="button" role="tab" aria-controls="marketing-screen-overview" aria-selected={productScreen() === "overview"} onClick={() => setProductScreen("overview")}>Overview <span>04</span></button>
              <button id="marketing-tab-work" type="button" role="tab" aria-controls="marketing-screen-work" aria-selected={productScreen() === "work"} onClick={() => setProductScreen("work")}>Work <span>01</span></button>
            </div>

            <section id="marketing-screen-ideas" class="marketing-screen marketing-screen--ideas" role="tabpanel" aria-label="Ideas screen" hidden={productScreen() !== "ideas"}>
              <div class="marketing-screen__head">
                <div><span>Notebook</span><h2>Ideas</h2></div>
                <span class="marketing-screen__action">Capture idea</span>
              </div>
              <p class="marketing-screen__note">Possible future work. Agents cannot see or claim Ideas.</p>
              <div class="marketing-idea-list">
                <div class="marketing-idea-row" data-selected="true"><b>01</b><span><strong>Let agents surface release notes</strong><small>rene · updated today</small></span><i>open</i><em>↑<br />↓</em></div>
                <div class="marketing-idea-row"><b>02</b><span><strong>Review work from the phone</strong><small>rene · updated yesterday</small></span><i>open</i><em>↑<br />↓</em></div>
                <div class="marketing-idea-row"><b>03</b><span><strong>Keep decisions close to the work</strong><small>mara · updated monday</small></span><i>open</i><em>↑<br />↓</em></div>
              </div>
              <div class="marketing-promotion"><span>Human-only until you send it</span><i aria-hidden="true">→</i><strong>Send to Inbox</strong></div>
            </section>

            <section id="marketing-screen-overview" class="marketing-screen marketing-screen--overview" role="tabpanel" aria-label="Overview screen" hidden={productScreen() !== "overview"}>
              <div class="marketing-capture"><span>Add something…</span><small>paste or drop a file <b aria-hidden="true">↵</b></small></div>
              <div class="marketing-run">
                <span class="marketing-run__rail" aria-hidden="true" />
                <div class="marketing-run__top"><b>Codex</b><i><span aria-hidden="true" /> running</i></div>
                <strong><small>dong051</small> Refresh the marketing site</strong>
                <p>Refreshing the Ideas story and product tour.</p>
                <div><span>Worktree · codex/dong051</span><span>updated now</span></div>
              </div>
              <div class="marketing-work-groups">
                <div class="marketing-work-group marketing-work-group--attention">
                  <div class="marketing-work-group__heading"><span>Needs you</span><b>1</b></div>
                  <div class="marketing-work-item"><i aria-hidden="true">!</i><div><strong>Choose the release order</strong><span>Claude Code needs a decision</span></div></div>
                </div>
                <div class="marketing-work-group">
                  <div class="marketing-work-group__heading"><span>Ready</span><b>2</b></div>
                  <div class="marketing-work-item"><i aria-hidden="true">›</i><div><strong>Add mobile review</strong><span>Ready for an agent</span></div></div>
                </div>
              </div>
            </section>

            <section id="marketing-screen-work" class="marketing-screen marketing-screen--work" role="tabpanel" aria-label="Work detail screen" hidden={productScreen() !== "work"}>
              <div class="marketing-work-detail__top"><span>dong051</span><b><i aria-hidden="true" /> Working</b></div>
              <h2>Refresh the marketing site</h2>
              <p>Show Ideas and people working with agents.</p>
              <div class="marketing-work-detail__event"><span>Codex</span><div><strong>Started work</strong><small>Isolated worktree · now</small></div></div>
              <div class="marketing-work-detail__event"><span>CC</span><div><strong>Copy review requested</strong><small>Clarity and voice · now</small></div></div>
              <div class="marketing-work-detail__composer"><span>Add a comment…</span><i>Send</i></div>
            </section>
          </article>
        </section>

        <div class="marketing-answer-strip" aria-label="What dongo keeps clear">
          <span><b>01</b> Keep early ideas human-only</span>
          <span><b>02</b> See agents move the work</span>
          <span><b>03</b> Make the decisions that matter</span>
        </div>

        <section class="marketing-section marketing-section--ideas" id="ideas" aria-labelledby="ideas-title">
          <div class="marketing-section__intro">
            <p class="eyebrow eyebrow--amber">Ideas</p>
            <h2 id="ideas-title">Not every thought is ready for an agent.</h2>
            <p class="marketing-section__lede">Shape it first. Send it to Inbox when it is ready.</p>
          </div>
          <div class="marketing-idea-path" aria-label="How an idea becomes work">
            <article><span>01</span><div><b>Capture</b><p>Save the thought, links, and files.</p></div><em>human-only</em></article>
            <article><span>02</span><div><b>Shape</b><p>Order it. Edit it. Leave it open.</p></div><em>your call</em></article>
            <article><span>03</span><div><b>Promote</b><p>Create one Intake item for agents.</p></div><em>when ready</em></article>
          </div>
        </section>

        <section class="marketing-section marketing-section--collaboration" id="collaboration" aria-labelledby="collaboration-title">
          <div class="marketing-section__intro">
            <p class="eyebrow">Collaboration</p>
            <h2 id="collaboration-title">People set direction. Agents move the work.</h2>
            <p class="marketing-section__lede">Claims, progress, reviews, and decisions stay with the work.</p>
          </div>
          <div class="marketing-collaboration" aria-label="Human and agent collaboration flow">
            <article data-owner="human"><span>you</span><div><strong>Set the goal</strong><p>Capture the intent and choose what matters.</p></div><i>01</i></article>
            <article data-owner="agent"><span>agent</span><div><strong>Claim the work</strong><p>Claim it, build it, and record progress.</p></div><i>02</i></article>
            <article data-owner="agent"><span>reviewer</span><div><strong>Check the result</strong><p>Review the change and record the result.</p></div><i>03</i></article>
            <article data-owner="human"><span>you</span><div><strong>Make the call</strong><p>Answer only when judgment is needed.</p></div><i>04</i></article>
          </div>
        </section>

        <section class="marketing-section" id="how-it-works" aria-labelledby="how-it-works-title">
          <div class="marketing-section__intro">
            <p class="eyebrow">Start here</p>
            <h2 id="how-it-works-title">Start in the agent you already use.</h2>
          </div>
          <ol class="marketing-steps">
            <li><span>01 / install</span><h3>Install the dongo skills</h3><p>Add the two skills to your agent.</p></li>
            <li><span>02 / connect</span><h3>Paste the setup prompt</h3><p>Your agent connects the repository.</p></li>
            <li><span>03 / approve</span><h3>Approve in the browser</h3><p>Your agent verifies the connection.</p></li>
          </ol>
        </section>

        <section class="marketing-final" aria-labelledby="marketing-final-title">
          <div>
            <p class="eyebrow eyebrow--amber">Start with one repository</p>
            <h2 id="marketing-final-title">Bring the next idea.</h2>
            <p>dongo keeps the work clear from there.</p>
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
          <p>Capture ideas. Work with agents.</p>
          <nav aria-label="Footer navigation">
            <A href="/get-started">Get started</A>
            <A href="/help">Help</A>
            <A href="/changelog">Changelog</A>
            <A href="/security">Security</A>
            <A href="/changelog">Changelog</A>
            <a href="https://github.com/renewisepunk/dongo" rel="external">Source</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
