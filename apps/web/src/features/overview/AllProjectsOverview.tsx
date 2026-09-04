import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";

import { Brand } from "../../components/Brand";
import { SignOutButton } from "../../components/SignOutButton";
import {
  CrossProjectDataConnection,
  type CrossProjectOverviewSnapshot,
  type CrossProjectPriority,
} from "../../lib/project-data";
import "./all-projects.css";

export type CrossProjectOverviewConnection = Pick<
  CrossProjectDataConnection,
  "subscribe" | "close"
>;

type AllProjectsOverviewProps = {
  connect?: () => Promise<CrossProjectOverviewConnection>;
};

function projectPath(organizationSlug: string, projectSlug: string): string {
  return `/app/${encodeURIComponent(organizationSlug)}/${encodeURIComponent(projectSlug)}`;
}

function priorityPath(
  organizationSlug: string,
  projectSlug: string,
  priority: CrossProjectPriority,
): string {
  const path = projectPath(organizationSlug, projectSlug);
  if (priority.target.kind === "work") {
    return `${path}?work=${encodeURIComponent(priority.target.identifier)}`;
  }
  if (priority.target.kind === "intake") {
    return `${path}?intake=${encodeURIComponent(priority.target.id)}`;
  }
  return path;
}

function priorityLabel(priority: CrossProjectPriority): string {
  switch (priority.kind) {
    case "needs_you": return "needs you";
    case "working": return "working";
    case "ready": return "ready";
    case "inbox": return "inbox";
  }
}

export function AllProjectsOverview(props: AllProjectsOverviewProps) {
  const [snapshot, setSnapshot] = createSignal<CrossProjectOverviewSnapshot>();
  const [status, setStatus] = createSignal<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = createSignal(0);
  const firstProjectPath = createMemo<string | undefined>(() => {
    const firstOrganization = snapshot()?.organizations.find(
      (organization) => organization.projects.length > 0,
    );
    const firstProject = firstOrganization?.projects[0]?.project;
    return firstOrganization && firstProject
      ? projectPath(firstOrganization.organization.slug, firstProject.slug)
      : undefined;
  });

  createEffect(() => {
    retry();
    let disposed = false;
    let connected: CrossProjectOverviewConnection | undefined;
    let unsubscribe: (() => void) | undefined;
    setStatus("loading");
    void (props.connect ?? CrossProjectDataConnection.connect)().then(
      (connection) => {
        if (disposed) {
          void connection.close();
          return;
        }
        connected = connection;
        unsubscribe = connection.subscribe(
          (nextSnapshot) => {
            if (disposed) return;
            setSnapshot(nextSnapshot);
            setStatus("ready");
          },
          () => {
            if (!disposed) setStatus("error");
          },
        );
      },
      () => {
        if (!disposed) setStatus("error");
      },
    );
    onCleanup(() => {
      disposed = true;
      unsubscribe?.();
      if (connected) void connected.close();
    });
  });

  const originalTitle = typeof document === "undefined" ? undefined : document.title;
  if (typeof document !== "undefined") document.title = "all projects — dongo";
  onCleanup(() => {
    if (originalTitle !== undefined) document.title = originalTitle;
  });

  return (
    <div class="app-page all-projects-page">
      <header class="app-header all-projects-header">
        <Brand compact href={firstProjectPath() ?? "/"} />
        <span class="all-projects-header__title">all projects</span>
        <div class="header-spacer" />
        <SignOutButton />
      </header>

      <main class="all-projects-main" aria-labelledby="all-projects-title">
        <div class="all-projects-intro">
          <div>
            <p class="all-projects-eyebrow">cross-project overview</p>
            <h1 id="all-projects-title">What needs attention now</h1>
            <p>Move between every accessible active project. Paid organizations show one priority signal per project with direct access to complete detail.</p>
          </div>
          <Show when={firstProjectPath()}>{(path) => (
            <a class="button button--quiet" href={path()}>Open project Overview</a>
          )}</Show>
        </div>

        <Show when={status() === "loading" && !snapshot()}>
          <div class="all-projects-state" role="status" aria-live="polite">
            <span class="spinner" aria-hidden="true" />
            <span>Loading accessible projects…</span>
          </div>
        </Show>

        <Show when={status() === "error"}>
          <div class="all-projects-state all-projects-state--error" role="alert">
            <div>
              <strong>Cross-project status is temporarily unavailable.</strong>
              <p>Your project Overviews are still available.</p>
            </div>
            <button class="button button--quiet" type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button>
          </div>
        </Show>

        <Show when={snapshot()}>{(current) => (
          <>
            <Show
              when={current().organizations.some((organization) => organization.projects.length > 0)}
              fallback={(
                <div class="all-projects-empty">
                  <strong>No active projects</strong>
                  <p>Create or restore a project to see it here.</p>
                </div>
              )}
            >
              <div class="all-projects-organizations">
                <For each={current().organizations}>{(organization) => (
                  <Show when={organization.projects.length > 0}>
                    <section
                      class="all-projects-organization"
                      aria-labelledby={`organization-${organization.organization.id}`}
                    >
                      <div class="all-projects-organization__heading">
                        <div>
                          <p class="all-projects-eyebrow">organization</p>
                          <h2 id={`organization-${organization.organization.id}`}>{organization.organization.name}</h2>
                        </div>
                        <span class="all-projects-plan">
                          {organization.crossProjectOverview.enabled ? "Paid · live status" : "Free · project navigation"}
                        </span>
                      </div>

                      <Show when={!organization.crossProjectOverview.enabled}>
                        <div class="all-projects-entitlement">
                          <div>
                            <strong>Cross-project live status is available on Paid.</strong>
                            <p>Project names remain here for navigation. Open one to see its full project-scoped Overview.</p>
                          </div>
                          <Show when={organization.membershipRole === "owner" && organization.projects[0]}>{(project) => (
                            <a
                              class="button button--quiet"
                              href={`${projectPath(organization.organization.slug, project().project.slug)}/upgrade`}
                            >Review plan</a>
                          )}</Show>
                        </div>
                      </Show>

                      <div class="all-projects-grid">
                        <For each={organization.projects}>{(entry) => {
                          const href = () => projectPath(organization.organization.slug, entry.project.slug);
                          return (
                            <article class="all-project-card" data-project-id={entry.project.id}>
                              <div class="all-project-card__heading">
                                <div>
                                  <p class="all-project-card__meta">project</p>
                                  <h3>{entry.project.name}</h3>
                                </div>
                                <a class="all-project-card__open" href={href()} aria-label={`Open ${entry.project.name} Overview`}>↗</a>
                              </div>

                              <Show
                                when={organization.crossProjectOverview.enabled}
                                fallback={<p class="all-project-card__locked">Open this project to view its live work.</p>}
                              >
                                <Show
                                  when={entry.priority}
                                  fallback={(
                                    <div class="all-project-card__quiet">
                                      <span class="all-project-card__signal" aria-hidden="true" />
                                      <div><strong>No active priority</strong><span>Nothing is waiting in the live lanes.</span></div>
                                    </div>
                                  )}
                                >{(priority) => (
                                  <a
                                    class={`all-project-priority all-project-priority--${priority().kind}`}
                                    href={priorityPath(organization.organization.slug, entry.project.slug, priority())}
                                    aria-label={`Open ${priorityLabel(priority())} item in ${entry.project.name}: ${priority().title}`}
                                  >
                                    <span class="all-project-priority__label">{priorityLabel(priority())}</span>
                                    <strong>{priority().title}</strong>
                                    <Show when={priority().target.kind === "work"}>
                                      <span class="all-project-priority__identifier">
                                        {(priority().target as { kind: "work"; identifier: string }).identifier}
                                      </span>
                                    </Show>
                                  </a>
                                )}</Show>
                              </Show>

                              <a class="all-project-card__overview" href={href()}>Project Overview</a>
                            </article>
                          );
                        }}</For>
                      </div>
                    </section>
                  </Show>
                )}</For>
              </div>
            </Show>

            <Show when={current().truncated}>
              <p class="all-projects-truncated" role="status">
                Showing the first {current().limits.projects} active projects. Use the project selector to open another project.
              </p>
            </Show>
          </>
        )}</Show>
      </main>
    </div>
  );
}
