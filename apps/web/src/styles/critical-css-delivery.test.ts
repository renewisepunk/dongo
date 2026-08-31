import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync(new URL("../app.tsx", import.meta.url), "utf8");
const marketingHome = readFileSync(
  new URL("../features/marketing/MarketingHome.tsx", import.meta.url),
  "utf8",
);
const viteConfig = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");

describe("public homepage critical CSS", () => {
  it("inlines the shared and marketing styles into the server-rendered head", () => {
    expect(app).toContain('import globalStyles from "./styles/global.css?inline"');
    expect(app).toContain("<style>{globalStyles}</style>");
    expect(marketingHome).toContain('import marketingStyles from "./marketing.css?inline"');
    expect(marketingHome).toContain("<style>{marketingStyles}</style>");
  });

  it("does not side-effect import either render-critical stylesheet", () => {
    expect(app).not.toContain('import "./styles/global.css"');
    expect(marketingHome).not.toContain('import "./marketing.css"');
  });

  it("keeps the SolidStart overlay in local development but out of builds", () => {
    expect(viteConfig).toContain('devOverlay: command === "serve"');
    expect(viteConfig).toContain("stripBuildOnlyDevToolbarCss()");
    expect(viteConfig).toContain('apply: "build"');
  });
});
