import { A, useParams } from "@solidjs/router";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Brand } from "../../../../components/Brand";
import { RequireHumanSession } from "../../../../components/RequireHumanSession";
import type { WorkItem } from "../../../../features/overview/model";
import { ProjectDataConnection } from "../../../../lib/project-data";
import "../../../../features/admin/admin.css";
import "../../../../features/overview/overview.css";

export default function CompletedRoute() {
  const params = useParams<{ orgSlug: string; projectSlug: string }>();
  const [completed, setCompleted] = createSignal<WorkItem[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  let connection: ProjectDataConnection | undefined;
  let unsubscribe: (() => void) | undefined;
  let disposed = false;

  onMount(() => {
    void ProjectDataConnection.connect(params.orgSlug, params.projectSlug)
      .then((connected) => {
        if (disposed) {
          void connected.close();
          return;
        }
        connection = connected;
        unsubscribe = connected.subscribeOverview(
          (overview) => {
            setCompleted(overview.work.filter((item) => item.state === "done"));
            setError("");
            setLoading(false);
          },
          () => {
            setError("Completed work is temporarily unavailable.");
            setLoading(false);
          },
        );
      })
      .catch(() => {
        setError("This project could not be loaded for your account.");
        setLoading(false);
      });
  });

  onCleanup(() => {
    disposed = true;
    unsubscribe?.();
    void connection?.close();
  });

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
          <Show when={loading()}><div class="empty-state" role="status">Loading completed work…</div></Show>
          <Show when={error()}><div class="empty-state" role="alert">{error()}</div></Show>
          <section class="work-section" style={{ "margin-top": "0" }}>
            <For each={completed()}>{(item) => (
              <div class="work-row work-row--done">
                <span class="mono" style={{ color: "var(--green)" }}>✓</span>
                <span class="work-row__title work-row__title--done">{item.title}</span>
                <span class="work-row__identifier mono">{item.identifier} · {item.completedAt}</span>
              </div>
            )}</For>
            <Show when={!loading() && !error() && completed().length === 0}>
              <div class="empty-state">No work has been completed yet.</div>
            </Show>
          </section>
        </div>
      </div>
    </main>
  )}</RequireHumanSession>;
}
