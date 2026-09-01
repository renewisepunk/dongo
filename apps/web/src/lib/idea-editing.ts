import type { IdeaAttribution, IdeaState, IdeaSummary } from "./project-data";

export const IDEA_FILTERS = ["open", "archived", "promoted"] as const satisfies readonly IdeaState[];

export function ideaAttributionLabel(attribution: IdeaAttribution | undefined): string {
  return attribution?.displayName?.trim() || attribution?.name?.trim() || "Member";
}

export function ideaErrorCode(error: unknown): string | undefined {
  const data = typeof error === "object" && error !== null && "data" in error
    ? (error as { data?: unknown }).data
    : undefined;
  if (typeof data === "object" && data !== null && "code" in data) {
    const code = (data as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  if (error instanceof Error && /revision_conflict/iu.test(error.message)) return "revision_conflict";
  if (error instanceof Error && /invalid_transition/iu.test(error.message)) return "invalid_transition";
  return undefined;
}

export function ideasForFilter(ideas: readonly IdeaSummary[], filter: IdeaState): IdeaSummary[] {
  return ideas
    .filter((idea) => idea.state === filter)
    .sort((left, right) => filter === "open"
      ? left.position - right.position || left.createdAt - right.createdAt
      : (right.promotedAt ?? right.archivedAt ?? right.updatedAt) -
        (left.promotedAt ?? left.archivedAt ?? left.updatedAt));
}

export function reorderedIdeas(
  ideas: readonly IdeaSummary[],
  ideaId: string,
  direction: -1 | 1,
): IdeaSummary[] {
  const index = ideas.findIndex((idea) => idea._id === ideaId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ideas.length) return [...ideas];
  const next = [...ideas];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

export function ideaDraftKey(projectId: string, ideaId?: string): string {
  return `idea:${projectId}:${ideaId ?? "new"}`;
}
