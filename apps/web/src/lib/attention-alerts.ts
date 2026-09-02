export type DesktopAlertPermission = NotificationPermission | "unsupported";

const PREFERENCE_PREFIX = "dongo:desktop-attention-alerts:v1";
const SEEN_PREFIX = "dongo:seen-attention-alerts:v1";

function scopedKey(prefix: string, orgSlug: string, projectSlug: string): string {
  return `${prefix}:${encodeURIComponent(orgSlug)}/${encodeURIComponent(projectSlug)}`;
}

export function desktopAlertPreferenceKey(orgSlug: string, projectSlug: string): string {
  return scopedKey(PREFERENCE_PREFIX, orgSlug, projectSlug);
}

export function seenAttentionStorageKey(orgSlug: string, projectSlug: string): string {
  return scopedKey(SEEN_PREFIX, orgSlug, projectSlug);
}

export function attentionPageTitle(count: number): string {
  return count > 0 ? `(${count}) needs you — dongo` : "overview — dongo";
}

export function attentionNotificationBody(count: number): string {
  return count === 1
    ? "A new action is waiting. Open dongo to review it."
    : `${count} new actions are waiting. Open dongo to review them.`;
}

export function readDesktopAlertPreference(storage: Storage, key: string): boolean {
  try {
    return storage.getItem(key) === "enabled";
  } catch {
    return false;
  }
}

export function writeDesktopAlertPreference(
  storage: Storage,
  key: string,
  enabled: boolean,
): void {
  try {
    if (enabled) storage.setItem(key, "enabled");
    else storage.removeItem(key);
  } catch {
    // Browser privacy modes may make storage unavailable. The in-memory state
    // remains useful for the current page without weakening the permission gate.
  }
}

export function readSeenAttentionIds(storage: Storage, key: string): Set<string> {
  try {
    const stored = JSON.parse(storage.getItem(key) ?? "[]") as unknown;
    return new Set(
      Array.isArray(stored)
        ? stored.filter((value): value is string => typeof value === "string").slice(-100)
        : [],
    );
  } catch {
    return new Set();
  }
}

export function writeSeenAttentionIds(
  storage: Storage,
  key: string,
  ids: Iterable<string>,
): void {
  try {
    storage.setItem(key, JSON.stringify([...ids].slice(-100)));
  } catch {
    // Deduplication still works in memory if session storage is unavailable.
  }
}

export function newlyObservedAttentionIds(
  currentIds: readonly string[],
  previousIds: ReadonlySet<string>,
  seenIds: ReadonlySet<string>,
): string[] {
  return currentIds.filter((id) => !previousIds.has(id) && !seenIds.has(id));
}
