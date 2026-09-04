import { expect, test, type Page } from "@playwright/test";

const TRANSPARENT_PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X1Y4WQAAAABJRU5ErkJggg==",
  "base64",
);

async function serveVendorIcons(page: Page) {
  await page.route("https://a.favicon.im/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: TRANSPARENT_PIXEL,
    });
  });
}

test("each agent run card carries a mark identifying its agent", async ({ page }) => {
  await serveVendorIcons(page);
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

test("vendor favicons load privately as round decorative images", async ({ page }) => {
  await serveVendorIcons(page);
  await page.goto("/app/fixture-studio/dongo?scenario=concurrency-live");
  const icon = page.locator("[data-agent-icon]").first();
  await expect(icon).toHaveAttribute("aria-hidden", "true");
  await expect(icon).toHaveAttribute("data-agent-icon-state", "vendor");
  const image = icon.locator("img");
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("loading", "lazy");
  await expect(image).toHaveAttribute("decoding", "async");
  await expect(image).toHaveAttribute("referrerpolicy", "no-referrer");
  await expect(image).toHaveAttribute("alt", "");
  const presentation = await icon.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      width: style.width,
      height: style.height,
      borderRadius: style.borderRadius,
      overflow: style.overflow,
    };
  });
  expect(presentation).toEqual({
    width: "20px",
    height: "20px",
    borderRadius: "50%",
    overflow: "hidden",
  });
});

test("a failed vendor request falls back to the neutral local mark", async ({ page }) => {
  await page.route("https://a.favicon.im/**", async (route) => {
    await route.fulfill({ status: 404, body: "missing" });
  });
  await page.goto("/app/fixture-studio/dongo?scenario=concurrency-live");
  const codexIcon = page.locator('[data-agent-icon="codex"]').first();
  await expect(codexIcon).toHaveAttribute("data-agent-icon-state", "fallback");
  await expect(codexIcon.locator("svg")).toBeVisible();
  await expect(codexIcon.locator("img")).toHaveCount(0);
  await expect(codexIcon).toHaveAttribute("aria-hidden", "true");
});

test("agent marks survive narrow widths without breaking the card", async ({ page }) => {
  await serveVendorIcons(page);
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto("/app/fixture-studio/dongo?scenario=concurrency-live");
  await expect(page.locator("[data-agent-icon]").first()).toBeVisible();
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("operational agent and runner identities share the registry", async ({ page }) => {
  await serveVendorIcons(page);
  await page.goto("/app/fixture-studio/dongo");

  await expect(page.locator('[data-work-id="work-needs"] [data-agent-icon="codex"]')).toBeVisible();
  await expect(page.locator('[data-work-id="work-working"] [data-agent-icon="claude"]')).toBeVisible();

  await page.locator('[data-work-id="work-done"]').click();
  const conversation = page.locator(".conversation");
  await expect(conversation.locator('[data-agent-icon="codex"]')).toBeVisible();
  await expect(conversation.locator('[data-agent-icon="generic"]')).toBeVisible();

  await page.goto("/app/fixture-studio/dongo/settings?tab=Agent%20access");
  await expect(page.locator('.installation-list [data-agent-icon="generic"]')).toBeVisible();
  await expect(page.locator('.installation-list [data-agent-icon="claude"]')).toBeVisible();

  await page.goto("/app/fixture-studio/dongo/settings?tab=Local%20runner");
  const runner = page.locator(".installation-row").filter({ hasText: "Fixture Mac" });
  await expect(runner.locator('[data-agent-icon="codex"]')).toBeVisible();
  await expect(runner.locator('[data-agent-icon="claude"]')).toBeVisible();

  await page.goto("/connect");
  await expect(page.getByRole("tab", { name: "Codex" }).locator('[data-agent-icon="codex"]')).toBeVisible();
  await expect(page.getByRole("tab", { name: "Claude Code" }).locator('[data-agent-icon="claude"]')).toBeVisible();
  const instruction = page.locator(".instruction__body");
  await expect(instruction).toContainText("dongo connect --agent-host codex");
  await expect(instruction.locator("[data-agent-icon]")).toHaveCount(0);
});
