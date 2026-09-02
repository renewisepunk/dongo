import { expect, test } from "@playwright/test";

test("the public changelog lists published entries newest first", async ({ page }) => {
  await page.goto("/changelog");
  await expect(page.getByRole("heading", { name: "What shipped, as it shipped." })).toBeVisible();

  const entries = page.locator(".changelog-entry__body h3");
  await expect(entries).toHaveText([
    "Owners can name their organization",
    "Administration shows who owns what",
  ]);
  await expect(page.getByText("Pick the name during setup and rename it later without breaking links.")).toBeVisible();

  const months = page.locator(".changelog-month__label");
  await expect(months).toHaveCount(2);
});

test("the changelog explains itself when nothing has been published", async ({ page }) => {
  await page.goto("/changelog?scenario=changelog-empty");
  await expect(page.getByText("Nothing has been published yet.")).toBeVisible();
  await expect(page.locator(".changelog-entry")).toHaveCount(0);
});

test("the changelog is reachable from public navigation", async ({ page }) => {
  await page.goto("/help");
  await page.getByRole("navigation", { name: "Public navigation" })
    .getByRole("link", { name: "Changelog" }).click();
  await expect(page).toHaveURL(/\/changelog$/);
  await expect(page.getByRole("heading", { name: "What shipped, as it shipped." })).toBeVisible();
});

test("the changelog remains readable at narrow mobile widths", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto("/changelog");
  await expect(page.getByRole("heading", { name: "Owners can name their organization" })).toBeVisible();
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
