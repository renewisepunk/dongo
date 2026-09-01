import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

function summarize(
  violations: Array<{
    help: string;
    id: string;
    impact?: string | null;
    nodes: Array<{ failureSummary?: string; target: Array<unknown> }>;
  }>,
): string {
  return violations
    .map((violation) => {
      const nodes = violation.nodes
        .map((node) => `${node.target.join(" ")}: ${node.failureSummary ?? "no failure summary"}`)
        .join("\n    ");
      return `${violation.id} (${violation.impact ?? "unknown"}): ${violation.help}\n    ${nodes}`;
    })
    .join("\n");
}

async function expectWcagConformance(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
  expect(results.violations, summarize(results.violations)).toEqual([]);
}

test("keeps the authenticated overview and work detail free of detectable WCAG A/AA violations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/app/fixture-studio/dongo");
  await expect(page.getByRole("region", { name: "Add something" })).toBeVisible();
  await expectWcagConformance(page);

  await page.locator('[data-work-id="work-ready-a"]').click();
  await expect(page.getByRole("region", { name: "Verify fixture search" })).toBeVisible();
  await expectWcagConformance(page);
});

test("keeps the public homepage and guides free of detectable WCAG A/AA violations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const route of ["/", "/get-started", "/help", "/security"]) {
    await page.goto(route);
    await expect(page.locator("main")).toBeVisible();
    await expectWcagConformance(page);
  }
});
