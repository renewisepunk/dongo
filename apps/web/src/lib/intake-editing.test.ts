import { describe, expect, it } from "vitest";

import {
  intakeDisplayLabel,
  intakeUpdateErrorCode,
  parseIntakeLinks,
} from "./intake-editing";

describe("Inbox editing helpers", () => {
  it("uses normalized text, then a filename, then a stable neutral fallback", () => {
    expect(intakeDisplayLabel("  Keep the exact report  ", [])).toBe("Keep the exact report");
    expect(intakeDisplayLabel("\n First line \nSecond line", [])).toBe("First line");
    expect(intakeDisplayLabel("  ", [{ filename: "evidence.png" }])).toBe("evidence.png");
    expect(intakeDisplayLabel(undefined, [], "capture.png")).toBe("capture.png");
    expect(intakeDisplayLabel("Raw text\nMore", [{ filename: "local.png" }], "Server label"))
      .toBe("Server label");
    expect(intakeDisplayLabel(undefined, [])).toBe("Untitled intake");
  });

  it("normalizes, deduplicates, and validates HTTP links", () => {
    expect(parseIntakeLinks("https://example.test/a\nhttps://example.test/a\nhttp://example.test/b"))
      .toEqual({ links: ["https://example.test/a", "http://example.test/b"] });
    expect(parseIntakeLinks("not-a-link").error).toContain("complete link");
    expect(parseIntakeLinks("file:///tmp/context").error).toContain("http:// or https://");
  });

  it("identifies structured conflict and transition errors without exposing details", () => {
    expect(intakeUpdateErrorCode({ data: { code: "revision_conflict" } })).toBe("revision_conflict");
    expect(intakeUpdateErrorCode(new Error("invalid_transition"))).toBe("invalid_transition");
    expect(intakeUpdateErrorCode(new Error("network unavailable"))).toBeUndefined();
  });
});
