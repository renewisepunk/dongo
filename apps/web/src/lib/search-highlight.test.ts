import { describe, expect, it } from "vitest";

import { searchHighlightSegments } from "./search-highlight";

describe("safe search highlighting", () => {
  it("matches case-insensitively without interpreting markup or regex", () => {
    expect(searchHighlightSegments("Fix <script>PAY</script> flow", "pay"))
      .toEqual([
        { text: "Fix <script>", match: false },
        { text: "PAY", match: true },
        { text: "</script> flow", match: false },
      ]);
    expect(searchHighlightSegments("literal [value]", "[value]"))
      .toEqual([
        { text: "literal ", match: false },
        { text: "[value]", match: true },
      ]);
  });
});
