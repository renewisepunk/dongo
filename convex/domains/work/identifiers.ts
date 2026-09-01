import type { Doc } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";

export const MAX_WORK_SEQUENCE = 999;

type ProjectIdentifierSource = Pick<
  Doc<"projects">,
  "slug" | "identifierPrefix" | "compactIdentifierPrefix"
>;

type WorkIdentifierSource = Pick<Doc<"workItems">, "number" | "identifier">;

function asciiLetters(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/gu, "");
}

export function derivedCompactIdentifierPrefix(
  project: Pick<ProjectIdentifierSource, "slug" | "identifierPrefix">,
): string {
  return `${asciiLetters(project.slug)}${asciiLetters(project.identifierPrefix)}xxxx`.slice(
    0,
    4,
  );
}

export function compactIdentifierPrefix(
  project: ProjectIdentifierSource,
): string {
  const prefix = project.compactIdentifierPrefix
    ?? derivedCompactIdentifierPrefix(project);
  if (!/^[a-z]{4}$/u.test(prefix)) {
    throw new Error("Project compact identifier prefix is invalid");
  }
  return prefix;
}

export function canonicalWorkIdentifier(
  project: ProjectIdentifierSource,
  sequence: number,
): string {
  if (
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    sequence > MAX_WORK_SEQUENCE
  ) {
    throw new Error("Work sequence is outside the compact identifier range");
  }
  return `${compactIdentifierPrefix(project)}${String(sequence).padStart(3, "0")}`;
}

export function legacyWorkIdentifier(
  project: Pick<ProjectIdentifierSource, "identifierPrefix">,
  sequence: number,
): string {
  return `${project.identifierPrefix}-${sequence}`;
}

export function legacyWorkIdentifiers(
  project: ProjectIdentifierSource,
  work: WorkIdentifierSource,
): string[] {
  const canonical = displayWorkIdentifier(project, work);
  return [
    ...new Set([
      work.identifier,
      legacyWorkIdentifier(project, work.number),
    ]),
  ].filter((identifier) => identifier !== canonical);
}

export function displayWorkIdentifier(
  project: ProjectIdentifierSource,
  work: WorkIdentifierSource,
): string {
  return Number.isSafeInteger(work.number) &&
    work.number >= 1 &&
    work.number <= MAX_WORK_SEQUENCE
    ? canonicalWorkIdentifier(project, work.number)
    : work.identifier;
}

export function workSequenceFromIdentifier(
  project: ProjectIdentifierSource,
  identifier: string,
): number | undefined {
  const compactPrefix = compactIdentifierPrefix(project);
  const compact = identifier.match(
    new RegExp(`^${compactPrefix}([0-9]{3})$`, "u"),
  );
  if (compact) {
    const sequence = Number(compact[1]);
    return sequence >= 1 && sequence <= MAX_WORK_SEQUENCE
      ? sequence
      : undefined;
  }
  const legacy = identifier.match(
    new RegExp(`^${project.identifierPrefix}-([1-9][0-9]{0,2})$`, "u"),
  );
  if (!legacy) return undefined;
  const sequence = Number(legacy[1]);
  return sequence <= MAX_WORK_SEQUENCE ? sequence : undefined;
}

export async function workByIdentifier(
  ctx: Pick<QueryCtx, "db">,
  project: Doc<"projects">,
  identifier: string,
): Promise<Doc<"workItems"> | null> {
  const exact = await ctx.db
    .query("workItems")
    .withIndex("by_project_identifier", (q) =>
      q.eq("projectId", project._id).eq("identifier", identifier),
    )
    .unique();
  if (exact) return exact;
  const sequence = workSequenceFromIdentifier(project, identifier);
  if (sequence === undefined) return null;
  return await ctx.db
    .query("workItems")
    .withIndex("by_project_number", (q) =>
      q.eq("projectId", project._id).eq("number", sequence),
    )
    .unique();
}
