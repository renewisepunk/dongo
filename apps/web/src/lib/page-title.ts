const DONGO_TITLE_SUFFIX = " — dongo";

export function dongoPageTitle(surface: string): string {
  return `${surface}${DONGO_TITLE_SUFFIX}`;
}

export function projectPageTitle(
  projectName: string | undefined,
  surface: string,
): string {
  return dongoPageTitle(`${projectName || "Project"} · ${surface}`);
}

export function withAttentionCount(title: string, count: number): string {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return safeCount > 0 ? `(${safeCount}) ${title}` : title;
}

export function overviewPageSurface(state: {
  workOpen: boolean;
  intakeOpen: boolean;
  searchOpen: boolean;
  composerOpen: boolean;
}): "Work" | "Intake" | "Search" | "New Intake" | "Overview" {
  if (state.workOpen) return "Work";
  if (state.intakeOpen) return "Intake";
  if (state.searchOpen) return "Search";
  if (state.composerOpen) return "New Intake";
  return "Overview";
}
