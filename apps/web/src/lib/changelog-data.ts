import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { convexDeploymentUrl } from "./auth-config";

export type ChangelogEntry = {
  entryId: string;
  title: string;
  summary: string;
  publishedAt: number;
};

export type ChangelogMonth = {
  key: string;
  label: string;
  entries: ChangelogEntry[];
};

const publishedEntriesReference = makeFunctionReference<
  "query",
  { publicRef: string },
  { entries: ChangelogEntry[] }
>("domains/changelog/index:publishedEntries");

// The site's own project. Unset in an environment that has no published
// changelog, which renders the empty state rather than failing the page.
export function siteProjectRef(): string | undefined {
  const value = import.meta.env.VITE_DONGO_SITE_PROJECT_REF;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export function groupEntriesByMonth(entries: ChangelogEntry[]): ChangelogMonth[] {
  const months = new Map<string, ChangelogMonth>();
  for (const entry of [...entries].sort((a, b) => b.publishedAt - a.publishedAt)) {
    const date = new Date(entry.publishedAt);
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    const existing = months.get(key);
    if (existing) {
      existing.entries.push(entry);
      continue;
    }
    months.set(key, {
      key,
      label: new Intl.DateTimeFormat(undefined, {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(date),
      entries: [entry],
    });
  }
  return [...months.values()];
}

export function entryDate(publishedAt: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(publishedAt));
}

export async function loadPublishedChangelog(): Promise<ChangelogEntry[]> {
  const publicRef = siteProjectRef();
  if (!publicRef) return [];
  const client = new ConvexHttpClient(convexDeploymentUrl);
  const { entries } = await client.query(publishedEntriesReference, { publicRef });
  return entries;
}
