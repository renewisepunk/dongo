import { describe, expect, it } from "vitest";
import { safeMarkdownHref } from "../lib/markdown";

describe("safeMarkdownHref", () => {
  it("allows review links without allowing executable schemes", () => {
    expect(safeMarkdownHref("https://linear.app/example")).toBe("https://linear.app/example");
    expect(safeMarkdownHref("http://127.0.0.1:8787/report")).toBe("http://127.0.0.1:8787/report");
    expect(safeMarkdownHref("/app/studio/dongo")).toBe("/app/studio/dongo");
    expect(safeMarkdownHref("#evidence")).toBe("#evidence");
    expect(safeMarkdownHref("javascript:alert(1)")).toBeUndefined();
    expect(safeMarkdownHref("data:text/html,unsafe")).toBeUndefined();
    expect(safeMarkdownHref("//attacker.example/path")).toBeUndefined();
  });
});
