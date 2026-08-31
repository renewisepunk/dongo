import { describe, expect, it } from "vitest";
import { canonicalRedirectUrl } from "./canonical-origin";

describe("canonical dongo origin", () => {
  it("redirects www paths and queries to the apex origin", () => {
    expect(canonicalRedirectUrl(
      "https://www.dongo.so/help?from=docs",
      "https://dongo.so",
    )).toBe("https://dongo.so/help?from=docs");
  });

  it("leaves the canonical and development origins unchanged", () => {
    expect(canonicalRedirectUrl("https://dongo.so/help", "https://dongo.so"))
      .toBeUndefined();
    expect(canonicalRedirectUrl("https://dev.dongo.so/help", "https://dongo.so"))
      .toBeUndefined();
  });

  it("rejects an unsafe canonical origin", () => {
    expect(() => canonicalRedirectUrl(
      "https://www.dongo.so/",
      "https://dongo.so/unsafe",
    )).toThrow(/canonical dongo origin is invalid/);
  });
});
