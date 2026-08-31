import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync(new URL("../app.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./global.css", import.meta.url), "utf8");

describe("font delivery", () => {
  it("keeps first paint independent of third-party font stylesheets", () => {
    expect(app).not.toMatch(/fontshare|fonts\.googleapis|use\.typekit/i);
    expect(app).not.toMatch(/<Link\s+rel=["']stylesheet["']/i);
  });

  it("uses a local system font stack", () => {
    expect(css).toMatch(/--font:\s*system-ui,/);
    expect(css).not.toMatch(/@font-face|url\(/i);
  });
});
