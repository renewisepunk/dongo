import { expect, test } from "@playwright/test";

test("an owner publishes completed Work with their own wording", async ({ page }) => {
  await page.goto("/changelog-publisher");
  await expect(page.getByText("Completed Work stays private until you publish it.").first()).toBeVisible();

  const unpublished = page.locator(".changelog-publisher__item").filter({ hasText: "FIX-1" });
  await expect(unpublished.getByRole("button", { name: "Publish entry" })).toBeVisible();
  await expect(unpublished.locator(".changelog-publisher__badge")).toHaveCount(0);

  await unpublished.getByLabel("Public headline").fill("A clearer admin");
  await unpublished.getByLabel("Public summary").fill("Owner-authored wording.");
  await unpublished.getByRole("button", { name: "Publish entry" }).click();

  await expect(unpublished.locator(".changelog-publisher__badge")).toHaveText("Published");
  await expect(unpublished.getByRole("button", { name: "Update entry" })).toBeVisible();
});

test("publishing is refused until both fields are written", async ({ page }) => {
  await page.goto("/changelog-publisher");
  const unpublished = page.locator(".changelog-publisher__item").filter({ hasText: "FIX-1" });
  await unpublished.getByLabel("Public summary").fill("");
  await unpublished.getByRole("button", { name: "Publish entry" }).click();
  await expect(page.locator(".changelog-publisher__status"))
    .toHaveText("A published entry needs a headline and a summary.");
  await expect(unpublished.locator(".changelog-publisher__badge")).toHaveCount(0);
});

test("an owner can take a published entry back down", async ({ page }) => {
  await page.goto("/changelog-publisher");
  const published = page.locator(".changelog-publisher__item").filter({ hasText: "FIX-2" });
  await expect(published.locator(".changelog-publisher__badge")).toHaveText("Published");
  await published.getByRole("button", { name: "Unpublish" }).click();
  await expect(published.locator(".changelog-publisher__badge")).toHaveCount(0);
  await expect(published.getByRole("button", { name: "Publish entry" })).toBeVisible();
});

test("publisher errors preserve drafts and never claim there is no completed Work", async ({ page }) => {
  await page.goto("/changelog-publisher?scenario=changelog-error");
  await expect(page.locator(".changelog-publisher__status")).toHaveText("Completed Work could not be loaded.");
  await expect(page.getByText("No completed Work yet.")).toHaveCount(0);
  await page.goto("/changelog-publisher?scenario=changelog-conflict");
  const row = page.locator(".changelog-publisher__item").filter({ hasText: "FIX-1" });
  await row.getByLabel("Public headline").fill("My preserved headline");
  await row.getByLabel("Public summary").fill("My preserved summary");
  await row.getByRole("button", { name: "Publish entry" }).click();
  await expect(page.locator(".changelog-publisher__status")).toContainText("Your draft is preserved");
  await expect(row.getByLabel("Public headline")).toHaveValue("My preserved headline");
  await expect(row.locator(".changelog-publisher__badge")).toHaveCount(0);
});

test("publisher keeps older public entries manageable through bounded pages", async ({ page }) => {
  await page.goto("/changelog-publisher?scenario=changelog-truncated");
  await expect(page.getByText("More completed Work is available.")).toBeVisible();
  await page.getByRole("button", { name: "Load older completed Work" }).click();
  const older = page.locator(".changelog-publisher__item").filter({ hasText: "FIX-2" });
  await expect(older.getByRole("button", { name: "Unpublish" })).toBeVisible();
  await older.getByRole("button", { name: "Unpublish" }).click();
  await page.getByRole("button", { name: "Load older completed Work" }).click();
  await expect(older.locator(".changelog-publisher__badge")).toHaveCount(0);
});
