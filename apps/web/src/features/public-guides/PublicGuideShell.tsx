import { A } from "@solidjs/router";
import type { ParentProps } from "solid-js";
import { Brand } from "../../components/Brand";
import "./public-guides.css";

export type PublicGuidePage = "get-started" | "help";

export type PublicGuideShellProps = ParentProps<{
  page: PublicGuidePage;
}>;

export function PublicGuideShell(props: PublicGuideShellProps) {
  return (
    <div class="public-guide-page">
      <a class="public-guide-skip" href="#public-guide-content">Skip to content</a>
      <header class="public-guide-header">
        <div class="public-guide-header__inner">
          <Brand compact href="/" />
          <nav class="public-guide-nav" aria-label="Public navigation">
            <A href="/get-started" aria-current={props.page === "get-started" ? "page" : undefined}>Get started</A>
            <A href="/help" aria-current={props.page === "help" ? "page" : undefined}>Help</A>
          </nav>
          <div class="public-guide-header__actions">
            <A class="public-guide-sign-in" href="/login">Sign in</A>
            <A class="button public-guide-open" href="/open">Open app <span aria-hidden="true">↗</span></A>
          </div>
        </div>
      </header>

      <main id="public-guide-content" class="public-guide-main">
        {props.children}
      </main>

      <footer class="public-guide-footer">
        <div class="public-guide-footer__inner">
          <div class="public-guide-footer__brand"><span aria-hidden="true">›</span> dongo</div>
          <p>Agent-first work, with a clear human review surface.</p>
          <nav aria-label="Footer navigation">
            <A href="/get-started">Get started</A>
            <A href="/help">Help</A>
            <A href="/login">Sign in</A>
            <a href="https://github.com/renewisepunk/dongo">Source</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

export function GuideCode(props: { label: string; children: string }) {
  return (
    <div class="guide-code">
      <div class="guide-code__head">
        <span>{props.label}</span>
        <span aria-hidden="true">terminal</span>
      </div>
      <pre tabindex="0"><code>{props.children}</code></pre>
    </div>
  );
}

export function GuideSection(props: ParentProps<{ index: string; title: string; id: string; lede?: string }>) {
  return (
    <section class="guide-section" id={props.id} aria-labelledby={`${props.id}-title`}>
      <div class="guide-section__marker" aria-hidden="true">{props.index}</div>
      <div class="guide-section__body">
        <div class="guide-section__head">
          <h2 id={`${props.id}-title`}>{props.title}</h2>
          {props.lede ? <p>{props.lede}</p> : null}
        </div>
        {props.children}
      </div>
    </section>
  );
}
