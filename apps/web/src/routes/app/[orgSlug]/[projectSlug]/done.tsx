import { A, useParams } from "@solidjs/router";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Brand } from "../../../../components/Brand";
import { PageTitle } from "../../../../components/PageTitle";
import { ProjectBreadcrumbs } from "../../../../components/ProjectBreadcrumbs";
import { RequireHumanSession } from "../../../../components/RequireHumanSession";
import type { WorkItem } from "../../../../features/overview/model";
import {
  ProjectDataConnection,
  type ProjectCompletedPage,
} from "../../../../lib/project-data";
import { projectPageTitle } from "../../../../lib/page-title";
import "../../../../features/admin/admin.css";
import "../../../../features/overview/overview.css";

type CompletedConnection = {
  projectName: string;
  listCompleted: (cursor?: string | null) => Promise<ProjectCompletedPage>;
  close: () => Promise<void>;
};

export type CompletedWorkDependencies = {
  connect: (orgSlug: string, projectSlug: string) => Promise<CompletedConnection>;
};

export type CompletedWorkProps = {
  orgSlug: string;
  projectSlug: string;
  dependencies?: Partial<CompletedWorkDependencies>;
};

export function CompletedWork(props: CompletedWorkProps) {
  const [completed, setCompleted] = createSignal<WorkItem[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [nextCursor, setNextCursor] = createSignal<string>();
  const [error, setError] = createSignal("");
  const [projectName, setProjectName] = createSignal(props.projectSlug);
  let connection: CompletedConnection | undefined;
  let disposed = false;
  const connect = props.dependencies?.connect ?? ProjectDataConnection.connect;

  const loadPage = async (cursor: string | null, append: boolean) => {
    if (!connection) return;
    append ? setLoadingMore(true) : setLoading(true);
    setError("");
    try {
      const page = await connection.listCompleted(cursor);
      if (disposed) return;
      setCompleted((items) => {
        if (!append) return page.items;
        const known = new Set(items.map((item) => item.id));
        return [...items, ...page.items.filter((item) => !known.has(item.id))];
      });
      setNextCursor(page.nextCursor);
    } catch {
      if (!disposed) setError("Closed work is temporarily unavailable.");
    } finally {
      if (!disposed) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  onMount(() => {
    void connect(props.orgSlug, props.projectSlug)
      .then((connected) => {
        if (disposed) {
          void connected.close();
          return;
        }
        connection = connected;
        setProjectName(connected.projectName);
        void loadPage(null, false);
      })
      .catch(() => {
        setError("This project could not be loaded for your account.");
        setLoading(false);
      });
  });

  onCleanup(() => {
    disposed = true;
    void connection?.close();
  });

  return (
    <>
      <PageTitle value={projectPageTitle(projectName(), "Completed")} />
      <main class="app-page" style={{ overflow: "auto" }}>
      <header class="app-header project-header">
        <Brand compact href={`/app/${props.orgSlug}/${props.projectSlug}`} />
        <ProjectBreadcrumbs
          orgSlug={props.orgSlug}
          projectSlug={props.projectSlug}
          projectName={projectName()}
          current="completed"
        />
        <div class="project-header__actions">
          <A class="button button--quiet" href={`/app/${props.orgSlug}/${props.projectSlug}?search=1`}>Search</A>
          <A class="button button--quiet" href={`/app/${props.orgSlug}/${props.projectSlug}`}>← Overview</A>
        </div>
      </header>
      <div class="overview-scroll">
        <div class="overview-content" style={{ gap: "26px" }}>
          <div class="settings-title-group"><div class="eyebrow">History</div><h1 class="settings-title">Closed</h1><p class="auth-lede">Completed and cancelled work with its durable history.</p></div>
          <Show when={loading()}><div class="empty-state" role="status">Loading completed work…</div></Show>
          <Show when={error()}>
            <div class="empty-state" role="alert">
              <div>{error()}</div>
              <button class="button" type="button" disabled={loading() || loadingMore()} onClick={() => void loadPage(completed().length ? nextCursor() ?? null : null, completed().length > 0)}>Retry</button>
            </div>
          </Show>
          <section class="work-section" style={{ "margin-top": "0" }}>
            <For each={completed()}>{(item) => (
              <A class="work-row work-row--done" href={`/app/${props.orgSlug}/${props.projectSlug}?work=${encodeURIComponent(item.identifier)}`}>
                <span class="mono" style={{ color: item.state === "done" ? "var(--green)" : "var(--text-faint)" }}>{item.state === "done" ? "✓" : "×"}</span>
                <span class="work-row__title work-row__title--done">{item.title}</span>
                <span class="work-row__identifier mono">{[item.identifier, item.state === "cancelled" ? "cancelled" : item.agent, item.closedAt ?? item.completedAt].filter(Boolean).join(" · ")}</span>
              </A>
            )}</For>
            <Show when={!loading() && !error() && completed().length === 0}>
              <div class="empty-state">No work has been closed yet.</div>
            </Show>
            <Show when={nextCursor() && !error()}>
              <button class="button" type="button" disabled={loadingMore()} onClick={() => void loadPage(nextCursor()!, true)}>
                {loadingMore() ? "Loading…" : "Load more"}
              </button>
            </Show>
          </section>
        </div>
      </div>
      </main>
    </>
  );
}

export default function CompletedRoute() {
  const params = useParams<{ orgSlug: string; projectSlug: string }>();
  return <RequireHumanSession>{(
    <CompletedWork orgSlug={params.orgSlug} projectSlug={params.projectSlug} />
  )}</RequireHumanSession>;
}
