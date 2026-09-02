import { describe, expect, it } from "vitest";
import {
  groupEntriesByMonth,
  type ChangelogEntry,
} from "./changelog-data";

function entry(id: string, publishedAt: number): ChangelogEntry {
  return { entryId: id, title: id, summary: `${id} summary`, publishedAt };
}

const march = Date.UTC(2026, 2, 4);
const marchLater = Date.UTC(2026, 2, 19);
const february = Date.UTC(2026, 1, 27);

describe("changelog grouping", () => {
  it("groups entries by month, newest month and entry first", () => {
    const months = groupEntriesByMonth([
      entry("older", february),
      entry("newest", marchLater),
      entry("middle", march),
    ]);
    expect(months.map((month) => month.key)).toEqual(["2026-03", "2026-02"]);
    expect(months[0].entries.map((row) => row.entryId)).toEqual(["newest", "middle"]);
    expect(months[1].entries.map((row) => row.entryId)).toEqual(["older"]);
  });

  it("returns nothing for an empty changelog", () => {
    expect(groupEntriesByMonth([])).toEqual([]);
  });

  it("does not mutate the caller's array", () => {
    const entries = [entry("a", february), entry("b", marchLater)];
    groupEntriesByMonth(entries);
    expect(entries.map((row) => row.entryId)).toEqual(["a", "b"]);
  });
});
