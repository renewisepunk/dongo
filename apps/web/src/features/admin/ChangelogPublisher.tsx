import { createResource, createSignal, For, Show } from "solid-js";
import {
  loadPublishableWork, publishChangelogEntry, unpublishChangelogEntry,
  type PublishableWorkRow, type PublishableWorkPage,
  type PublishChangelogInput, type UnpublishChangelogInput,
} from "../../lib/changelog-data";
export type { PublishableWorkRow } from "../../lib/changelog-data";

export type ChangelogPublisherProps = {
  projectId: string;
  load?: (projectId: string) => Promise<PublishableWorkPage>;
  publish?: (input: PublishChangelogInput) => Promise<void>;
  unpublish?: (input: UnpublishChangelogInput) => Promise<void>;
};

export function ChangelogPublisher(props: ChangelogPublisherProps) {
  const [busy, setBusy] = createSignal<string>();
  const [status, setStatus] = createSignal("");
  const [loadFailed, setLoadFailed] = createSignal(false);
  const [drafts, setDrafts] = createSignal<Record<string, { title: string; summary: string }>>({});
  const pending = new Map<string, { payload: string; key: string }>();
  const keyFor = (id: string, input: unknown) => {
    const payload = JSON.stringify(input);
    const previous = pending.get(id);
    if (previous?.payload === payload) return previous.key;
    const key = crypto.randomUUID();
    pending.set(id, { payload, key });
    return key;
  };

  const [page, { refetch }] = createResource(
    () => props.projectId,
    async (projectId) => {
      setLoadFailed(false);
      try {
        return await (props.load ?? loadPublishableWork)(projectId);
      } catch {
        setLoadFailed(true);
        setStatus("Completed Work could not be loaded.");
        return { rows: [], truncated: false };
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
    const input = {
      projectId: props.projectId, workItemId: row.workItemId,
      title: draft.title.trim(), summary: draft.summary.trim(), expectedRevision: row.revision,
    };
    try {
      await (props.publish ?? publishChangelogEntry)({ ...input, idempotencyKey: keyFor(row.workItemId, input) });
      pending.delete(row.workItemId);
      setStatus(`Published “${draft.title.trim()}”.`);
      await refetch();
    } catch {
      setStatus("That entry could not be published. Your draft is preserved. Retry, or reload completed Work and review the latest entry before saving again.");
    } finally {
      setBusy(undefined);
    }
  };

  const unpublish = async (row: PublishableWorkRow) => {
    const entryId = row.published?.entryId;
    if (!entryId) return;
    setBusy(row.workItemId);
    const input = { projectId: props.projectId, entryId, expectedRevision: row.revision };
    try {
      await (props.unpublish ?? unpublishChangelogEntry)({ ...input, idempotencyKey: keyFor(row.workItemId, input) });
      pending.delete(row.workItemId);
      setStatus("Entry removed from the public changelog.");
      await refetch();
    } catch {
      setStatus("That entry could not be removed. Retry, or reload completed Work and review the latest entry before trying again.");
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
      <button class="button button--quiet" type="button" disabled={Boolean(busy()) || page.loading} onClick={() => void refetch()}>Reload completed Work</button>
      <Show when={page()?.truncated}><p class="note">Showing the 50 most recently completed items. Older Work is not included in this view.</p></Show>

      <Show when={!page.loading} fallback={<p class="note" role="status">Loading completed Work…</p>}>
      <Show when={!loadFailed()}>
      <Show
        when={(page()?.rows ?? []).length > 0}
        fallback={<p class="note">No completed Work yet. Finish an item and it becomes publishable here.</p>}
      >
        <ul class="changelog-publisher__list">
          <For each={page()?.rows}>{(row) => (
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
                  disabled={Boolean(busy())}
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
                  disabled={Boolean(busy())}
                  onInput={(event) => setDraft(row, { summary: event.currentTarget.value })}
                />
              </div>
              <div class="changelog-publisher__actions">
                <button
                  class="button button--primary"
                  type="button"
                  disabled={Boolean(busy())}
                  onClick={() => void publish(row)}
                >
                  {row.published ? "Update entry" : "Publish entry"}
                </button>
                <Show when={row.published}>
                  <button
                    class="button button--quiet"
                    type="button"
                    disabled={Boolean(busy())}
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
      </Show>
      </Show>
    </section>
  );
}
