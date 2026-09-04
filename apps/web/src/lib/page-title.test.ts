import { describe, expect, it } from "vitest";

import {
  dongoPageTitle,
  overviewPageSurface,
  projectPageTitle,
  withAttentionCount,
} from "./page-title";

describe("page titles", () => {
  it("formats public and project surfaces with lowercase dongo branding", () => {
    expect(dongoPageTitle("Sign in")).toBe("Sign in — dongo");
    expect(projectPageTitle("My Project", "Overview")).toBe(
      "My Project · Overview — dongo",
    );
    expect(projectPageTitle("  Exact project name  ", "Settings")).toBe(
      "  Exact project name   · Settings — dongo",
    );
  });

  it("adds a bounded live attention count without changing the route title", () => {
    const title = projectPageTitle("My Project", "Work");
    expect(withAttentionCount(title, 2)).toBe("(2) My Project · Work — dongo");
    expect(withAttentionCount(title, -1)).toBe(title);
    expect(withAttentionCount(title, Number.NaN)).toBe(title);
  });

  it("uses generic Overview state labels without accepting private content", () => {
    expect(overviewPageSurface({ workOpen: true, intakeOpen: false, searchOpen: true, composerOpen: true })).toBe("Work");
    expect(overviewPageSurface({ workOpen: false, intakeOpen: true, searchOpen: true, composerOpen: true })).toBe("Intake");
    expect(overviewPageSurface({ workOpen: false, intakeOpen: false, searchOpen: true, composerOpen: true })).toBe("Search");
    expect(overviewPageSurface({ workOpen: false, intakeOpen: false, searchOpen: false, composerOpen: true })).toBe("New Intake");
    expect(overviewPageSurface({ workOpen: false, intakeOpen: false, searchOpen: false, composerOpen: false })).toBe("Overview");
  });
});
