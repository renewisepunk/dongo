import { describe, expect, it } from "vitest";
import {
  attentionNotificationBody,
  attentionPageTitle,
  desktopAlertPreferenceKey,
  newlyObservedAttentionIds,
  readDesktopAlertPreference,
  readSeenAttentionIds,
  seenAttentionStorageKey,
  writeDesktopAlertPreference,
  writeSeenAttentionIds,
} from "./attention-alerts";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe("owner Attention alerts", () => {
  it("keeps the page title truthful", () => {
    expect(attentionPageTitle(0)).toBe("Overview — dongo");
    expect(attentionPageTitle(1)).toBe("(1) Overview — dongo");
    expect(attentionPageTitle(3, "Project · Search — dongo")).toBe(
      "(3) Project · Search — dongo",
    );
  });

  it("uses generic native notification copy that does not expose Work content", () => {
    expect(attentionNotificationBody(1)).toBe(
      "A new action is waiting. Open dongo to review it.",
    );
    expect(attentionNotificationBody(2)).toBe(
      "2 new actions are waiting. Open dongo to review them.",
    );
  });

  it("stores opt-in and bounded per-session deduplication by project", () => {
    const local = memoryStorage();
    const session = memoryStorage();
    const preferenceKey = desktopAlertPreferenceKey("studio", "private work");
    const seenKey = seenAttentionStorageKey("studio", "private work");

    expect(preferenceKey).toContain("private%20work");
    expect(readDesktopAlertPreference(local, preferenceKey)).toBe(false);
    writeDesktopAlertPreference(local, preferenceKey, true);
    expect(readDesktopAlertPreference(local, preferenceKey)).toBe(true);
    writeDesktopAlertPreference(local, preferenceKey, false);
    expect(readDesktopAlertPreference(local, preferenceKey)).toBe(false);

    writeSeenAttentionIds(session, seenKey, Array.from({ length: 105 }, (_, index) => `attention-${index}`));
    const seen = readSeenAttentionIds(session, seenKey);
    expect(seen.size).toBe(100);
    expect(seen.has("attention-0")).toBe(false);
    expect(seen.has("attention-104")).toBe(true);
  });

  it("returns only newly observed and not-yet-notified Attention", () => {
    expect(newlyObservedAttentionIds(
      ["existing", "already-seen", "new"],
      new Set(["existing"]),
      new Set(["already-seen"]),
    )).toEqual(["new"]);
  });
});
