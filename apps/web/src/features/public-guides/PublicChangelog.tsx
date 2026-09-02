import { createResource, For, Show } from "solid-js";
import { PublicGuideShell } from "./PublicGuideShell";
import {
  entryDate,
  groupEntriesByMonth,
  loadPublishedChangelog,
  type ChangelogEntry,
} from "../../lib/changelog-data";

export type PublicChangelogProps = {
  load?: () => Promise<ChangelogEntry[]>;
};

export function PublicChangelog(props: PublicChangelogProps) {
  const [entries] = createResource(async () => {
    try {
      return await (props.load ?? loadPublishedChangelog)();
    } catch {
      return [];
    }
  });
  const months = () => groupEntriesByMonth(entries() ?? []);

  return (
    <PublicGuideShell page="changelog">
      <section class="public-guide-hero" aria-labelledby="public-changelog-title">
        <div class="public-guide-hero__copy">
          <div class="eyebrow eyebrow--amber">Changelog</div>
          <h1 id="public-changelog-title">What shipped, as it shipped.</h1>
          <p>Every entry below comes from work dongo tracked and someone chose to publish. Nothing appears here automatically.</p>
        </div>
      </section>

      <Show when={!entries.loading} fallback={<p class="changelog-note" role="status">Loading the changelog…</p>}>
        <Show
          when={months().length > 0}
          fallback={<p class="changelog-note">Nothing has been published yet. Check back once the first entry goes out.</p>}
        >
          <div class="changelog">
            <For each={months()}>{(month) => (
              <section class="changelog-month" aria-label={month.label}>
                <h2 class="changelog-month__label">{month.label}</h2>
                <ol class="changelog-entries">
                  <For each={month.entries}>{(entry) => (
                    <li class="changelog-entry">
                      <time class="changelog-entry__date" datetime={new Date(entry.publishedAt).toISOString()}>
                        {entryDate(entry.publishedAt)}
                      </time>
                      <div class="changelog-entry__body">
                        <h3>{entry.title}</h3>
                        <p>{entry.summary}</p>
                      </div>
                    </li>
                  )}</For>
                </ol>
              </section>
            )}</For>
          </div>
        </Show>
      </Show>
    </PublicGuideShell>
  );
}
