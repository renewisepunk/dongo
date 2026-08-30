import { A, useParams } from "@solidjs/router";
import { For } from "solid-js";
import { Brand } from "../../../../components/Brand";
import { RequireHumanSession } from "../../../../components/RequireHumanSession";
import { initialWork } from "../../../../features/overview/model";
import "../../../../features/admin/admin.css";
import "../../../../features/overview/overview.css";

export default function CompletedRoute() {
  const params = useParams<{ orgSlug: string; projectSlug: string }>();
  const completed = initialWork.filter((item) => item.state === "done");
  return <RequireHumanSession>{(
    <main class="app-page" style={{ overflow: "auto" }}>
      <header class="app-header">
        <Brand compact href={`/app/${params.orgSlug}/${params.projectSlug}`} />
        <div class="settings-header__title">/ {params.projectSlug} / completed</div>
        <div class="header-spacer" />
        <A class="button button--quiet" href={`/app/${params.orgSlug}/${params.projectSlug}`}>← Overview</A>
      </header>
      <div class="overview-scroll">
        <div class="overview-content" style={{ gap: "26px" }}>
          <div class="settings-title-group"><div class="eyebrow">History</div><h1 class="settings-title">Completed</h1><p class="auth-lede">Finished work and its durable artifacts.</p></div>
          <section class="work-section" style={{ "margin-top": "0" }}>
            <For each={completed}>{(item) => (
              <div class="work-row work-row--done">
                <span class="mono" style={{ color: "var(--green)" }}>✓</span>
                <span class="work-row__title work-row__title--done">{item.title}</span>
                <span class="work-row__identifier mono">{item.identifier} · {item.completedAt}</span>
              </div>
            )}</For>
          </section>
          <button class="button" type="button" style={{ "align-self": "flex-start" }}>Load more</button>
        </div>
      </div>
    </main>
  )}</RequireHumanSession>;
}
