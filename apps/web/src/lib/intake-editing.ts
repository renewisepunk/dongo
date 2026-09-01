import type { AttachmentSummary } from "../features/overview/model";

export const EMPTY_INTAKE_LABEL = "Untitled intake";

export function intakeDisplayLabel(
  text: string | undefined,
  attachments: readonly Pick<AttachmentSummary, "filename">[],
  serverDisplayLabel?: string,
): string {
  const firstTextLine = text
    ?.split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
  return serverDisplayLabel?.trim() ||
    firstTextLine?.slice(0, 240) ||
    attachments[0]?.filename.trim().slice(0, 240) ||
    EMPTY_INTAKE_LABEL;
}

export function parseIntakeLinks(value: string): { links: string[]; error?: string } {
  const candidates = [...new Set(value.split(/\r?\n/u).map((link) => link.trim()).filter(Boolean))];
  if (candidates.length > 100) {
    return { links: candidates, error: "Add no more than 100 links." };
  }
  for (const candidate of candidates) {
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      return { links: candidates, error: `Enter a complete link for ${candidate}.` };
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return { links: candidates, error: "Links must start with http:// or https://." };
    }
  }
  return { links: candidates };
}

export function intakeUpdateErrorCode(error: unknown): string | undefined {
  const data = typeof error === "object" && error !== null && "data" in error
    ? (error as { data?: unknown }).data
    : undefined;
  return typeof data === "object" && data !== null && "code" in data &&
      typeof (data as { code?: unknown }).code === "string"
    ? (data as { code: string }).code
    : error instanceof Error && /revision_conflict/i.test(error.message)
      ? "revision_conflict"
      : error instanceof Error && /invalid_transition/i.test(error.message)
        ? "invalid_transition"
        : undefined;
}
