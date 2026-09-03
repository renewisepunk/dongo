import { ConvexClient, ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { convexDeploymentUrl } from "./auth-config";
import { convexAccessToken } from "./auth-client";

export type PublishableWorkRow = {
  workItemId: string;
  revision: number;
  identifier: string;
  title: string;
  completedAt?: number;
  published?: ChangelogEntry;
};

export type PublishableWorkPage = { rows: PublishableWorkRow[]; truncated: boolean; cursor?: string };
export type PublishChangelogInput = {
  projectId: string; workItemId: string; title: string; summary: string;
  expectedRevision: number; idempotencyKey: string;
};
export type UnpublishChangelogInput = {
  projectId: string; entryId: string; expectedRevision: number; idempotencyKey: string;
};

const publishableWorkReference = makeFunctionReference<"query", { projectId: string; cursor?: string }, PublishableWorkPage>("domains/changelog/index:publishableWork");
const publishEntryReference = makeFunctionReference<"mutation", PublishChangelogInput, unknown>("domains/changelog/index:publishEntry");
const unpublishEntryReference = makeFunctionReference<"mutation", UnpublishChangelogInput, unknown>("domains/changelog/index:unpublishEntry");

async function withAuthorizedClient<T>(operation: (client: ConvexClient) => Promise<T>): Promise<T> {
  const client = new ConvexClient(convexDeploymentUrl);
  client.setAuth(async () => await convexAccessToken());
  try { return await operation(client); } finally { await client.close(); }
}

export async function loadPublishableWork(projectId: string, cursor?: string): Promise<PublishableWorkPage> {
  return await withAuthorizedClient(async (client) => await client.query(publishableWorkReference, { projectId, cursor }));
}
export async function publishChangelogEntry(input: PublishChangelogInput): Promise<void> {
  await withAuthorizedClient(async (client) => await client.mutation(publishEntryReference, input));
}
export async function unpublishChangelogEntry(input: UnpublishChangelogInput): Promise<void> {
  await withAuthorizedClient(async (client) => await client.mutation(unpublishEntryReference, input));
}

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
