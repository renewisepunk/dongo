import { createResource, createSignal, For, Show } from "solid-js";
import { ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { convexAccessToken } from "../../lib/auth-client";
import { convexDeploymentUrl } from "../../lib/auth-config";

export type PublishableWorkRow = {
  workItemId: string;
  identifier: string;
  title: string;
  completedAt?: number;
  published?: {
    entryId: string;
    title: string;
    summary: string;
    publishedAt: number;
  };
};

export type ChangelogPublisherProps = {
  projectId: string;
  load?: (projectId: string) => Promise<PublishableWorkRow[]>;
  publish?: (input: {
    projectId: string;
    workItemId: string;
    title: string;
    summary: string;
  }) => Promise<void>;
  unpublish?: (input: { projectId: string; entryId: string }) => Promise<void>;
};

const publishableWorkReference = makeFunctionReference<
  "query",
  { projectId: string },
  { rows: PublishableWorkRow[]; truncated: boolean }
>("domains/changelog/index:publishableWork");

const publishEntryReference = makeFunctionReference<
  "mutation",
  { projectId: string; workItemId: string; title: string; summary: string },
  { entryId: string; publishedAt: number }
>("domains/changelog/index:publishEntry");

const unpublishEntryReference = makeFunctionReference<
  "mutation",
  { projectId: string; entryId: string },
  { entryId: string }
>("domains/changelog/index:unpublishEntry");

function authorizedClient(): ConvexClient {
  const client = new ConvexClient(convexDeploymentUrl);
  client.setAuth(async () => await convexAccessToken());
  return client;
}

async function loadPublishableWork(projectId: string): Promise<PublishableWorkRow[]> {
  const client = authorizedClient();
  try {
    const { rows } = await client.query(publishableWorkReference, { projectId });
    return rows;
  } finally {
    void client.close();
  }
}

export function ChangelogPublisher(props: ChangelogPublisherProps) {
  const [reloadToken, setReloadToken] = createSignal(0);
  const [busy, setBusy] = createSignal<string>();
  const [status, setStatus] = createSignal("");
  const [drafts, setDrafts] = createSignal<Record<string, { title: string; summary: string }>>({});

  const [rows, { refetch }] = createResource(
    () => [props.projectId, reloadToken()] as const,
    async ([projectId]) => {
      try {
        return await (props.load ?? loadPublishableWork)(projectId);
      } catch {
        setStatus("Completed Work could not be loaded.");
        return [] as PublishableWorkRow[];
      }
    },
  );

  const draftFor = (row: PublishableWorkRow) =>
    drafts()[row.workItemId] ?? {
      title: row.published?.title ?? row.title,
      summary: row.published?.summary ?? "",
    };

  const setDraft = (row: PublishableWorkRow, patch: { title?: string; summary?: string }) =>
    setDrafts((current) => ({
      ...current,
      [row.workItemId]: { ...draftFor(row), ...patch },
    }));

  const publish = async (row: PublishableWorkRow) => {
    const draft = draftFor(row);
    if (draft.title.trim() === "" || draft.summary.trim() === "") {
      setStatus("A published entry needs a headline and a summary.");
      return;
    }
    setBusy(row.workItemId);
    try {
      if (props.publish) {
        await props.publish({
          projectId: props.projectId,
          workItemId: row.workItemId,
          title: draft.title.trim(),
          summary: draft.summary.trim(),
        });
      } else {
        const client = authorizedClient();
        try {
          await client.mutation(publishEntryReference, {
            projectId: props.projectId,
            workItemId: row.workItemId,
            title: draft.title.trim(),
            summary: draft.summary.trim(),
          });
        } finally {
          void client.close();
        }
      }
      setStatus(`Published “${draft.title.trim()}”.`);
      setReloadToken((value) => value + 1);
      void refetch();
    } catch {
      setStatus("That entry could not be published.");
    } finally {
      setBusy(undefined);
    }
  };

  const unpublish = async (row: PublishableWorkRow) => {
    const entryId = row.published?.entryId;
    if (!entryId) return;
    setBusy(row.workItemId);
    try {
      if (props.unpublish) {
        await props.unpublish({ projectId: props.projectId, entryId });
      } else {
        const client = authorizedClient();
        try {
          await client.mutation(unpublishEntryReference, {
            projectId: props.projectId,
            entryId,
          });
        } finally {
          void client.close();
        }
      }
      setStatus("Entry removed from the public changelog.");
      setReloadToken((value) => value + 1);
      void refetch();
    } catch {
      setStatus("That entry could not be removed.");
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <section class="settings-section changelog-publisher">
      <div class="settings-section__title">Public changelog</div>
      <p class="note">Completed Work stays private until you publish it. You write the headline and summary that appear publicly; the Work title is only a starting point.</p>
      <p class="visually-hidden" aria-live="polite">{status()}</p>
      <Show when={status()}><p class="note changelog-publisher__status">{status()}</p></Show>

      <Show
        when={(rows() ?? []).length > 0}
        fallback={<p class="note">No completed Work yet. Finish an item and it becomes publishable here.</p>}
      >
        <ul class="changelog-publisher__list">
          <For each={rows()}>{(row) => (
            <li class="changelog-publisher__item">
              <div class="changelog-publisher__work">
                <span class="mono">{row.identifier}</span>
                <span>{row.title}</span>
                <Show when={row.published}>
                  <span class="changelog-publisher__badge">Published</span>
                </Show>
              </div>
              <div class="field-group">
                <label class="field-label" for={`changelog-title-${row.workItemId}`}>Public headline</label>
                <input
                  class="input"
                  id={`changelog-title-${row.workItemId}`}
                  maxlength="240"
                  value={draftFor(row).title}
                  disabled={busy() === row.workItemId}
                  onInput={(event) => setDraft(row, { title: event.currentTarget.value })}
                />
              </div>
              <div class="field-group">
                <label class="field-label" for={`changelog-summary-${row.workItemId}`}>Public summary</label>
                <textarea
                  class="textarea"
                  id={`changelog-summary-${row.workItemId}`}
                  rows="2"
                  maxlength="2000"
                  value={draftFor(row).summary}
                  disabled={busy() === row.workItemId}
                  onInput={(event) => setDraft(row, { summary: event.currentTarget.value })}
                />
              </div>
              <div class="changelog-publisher__actions">
                <button
                  class="button button--primary"
                  type="button"
                  disabled={busy() === row.workItemId}
                  onClick={() => void publish(row)}
                >
                  {row.published ? "Update entry" : "Publish entry"}
                </button>
                <Show when={row.published}>
                  <button
                    class="button button--quiet"
                    type="button"
                    disabled={busy() === row.workItemId}
                    onClick={() => void unpublish(row)}
                  >
                    Unpublish
                  </button>
                </Show>
              </div>
            </li>
          )}</For>
        </ul>
      </Show>
    </section>
  );
}
