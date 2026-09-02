import { expect, test } from "@playwright/test";

test("each agent run card carries a mark identifying its agent", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo?scenario=concurrency-live");
  await expect(page.locator(".agent-run-card").first()).toBeVisible();

  // pair each card's visible agent name with the mark rendered beside it
  const pairs = await page.locator(".agent-run-card__identity").evaluateAll((nodes) =>
    nodes.map((node) => ({
      name: node.querySelector(".agent-run-card__agent")?.textContent?.trim() ?? "",
      icon: node.querySelector("[data-agent-icon]")?.getAttribute("data-agent-icon") ?? "",
    })));

  expect(pairs.length).toBeGreaterThan(1);
  expect(pairs).toContainEqual({ name: "Claude", icon: "claude" });
  expect(pairs).toContainEqual({ name: "Codex", icon: "codex" });
  for (const pair of pairs) {
    expect(["claude", "codex", "generic"]).toContain(pair.icon);
  }
});

test("the mark stays decorative so the agent name is announced once", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo?scenario=concurrency-live");
  const icon = page.locator("[data-agent-icon]").first();
  await expect(icon).toHaveAttribute("aria-hidden", "true");
  await expect(icon.locator("svg")).toBeVisible();
});

test("agent marks survive narrow widths without breaking the card", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto("/app/fixture-studio/dongo?scenario=concurrency-live");
  await expect(page.locator("[data-agent-icon]").first()).toBeVisible();
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
