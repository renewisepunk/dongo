import { describe, expect, it } from "vitest";

import { organizationSlugify, slugify } from "./slug";

describe("slug helpers", () => {
  it("keeps project fallback behavior", () => {
    expect(slugify("   ")).toBe("untitled-project");
  });

  it("derives a bounded organization slug without inventing a blank name", () => {
    expect(organizationSlugify("  René's Studio  ")).toBe("rene-s-studio");
    expect(organizationSlugify("你好")).toBe("");
    expect(organizationSlugify("A".repeat(100))).toHaveLength(80);
  });
});
