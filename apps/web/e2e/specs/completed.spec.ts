import { expect, test } from "@playwright/test";

test("paginates completed work without duplicates and opens route-backed detail", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo/done");
  await expect(page.getByRole("heading", { name: "Completed" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-fixture-completed-target",
    "fixture-studio/dongo",
  );

  const first = page.getByRole("link", { name: /Complete the agent golden journey/ });
  await expect(first).toContainText("DONGO-6 · Codex · 1h");
  await expect(page.getByRole("link", { name: /Freeze the operation contract/ })).toContainText(
    "DONGO-5 · Claude · 2h",
  );
  await expect(page.getByRole("link", { name: "Search" })).toHaveAttribute(
    "href",
    "/app/fixture-studio/dongo?search=1",
  );

  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByText("Verify tenant isolation", { exact: true })).toBeVisible();
  await expect(page.getByText("Freeze the operation contract", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Load more" })).toBeHidden();

  await first.click();
  await expect(page).toHaveURL(/\/app\/fixture-studio\/dongo\?work=work-done$/);
  await expect(
    page.getByRole("dialog", { name: "Complete the agent golden journey" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-fixture-completed-closed", "true");
});

test("shows an honest empty completed-work state on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/app/fixture-studio/dongo/done?scenario=completed-empty");
  await expect(page.getByText("No work has been completed yet.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Load more" })).toBeHidden();
  await expect.poll(async () => page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )).toBe(true);
});

test("retries an unavailable first completed-work page without exposing details", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo/done?scenario=completed-retry");
  await expect(page.getByRole("alert")).toHaveText(
    "Completed work is temporarily unavailable.Retry",
  );
  await expect(page.getByText("fixture completed retry detail must stay hidden")).toBeHidden();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("alert")).toBeHidden();
  await expect(page.getByText("Complete the agent golden journey", { exact: true })).toBeVisible();
});

test("preserves loaded history when pagination fails", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo/done?scenario=completed-more-error");
  await expect(page.getByText("Complete the agent golden journey", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Completed work is temporarily unavailable.",
  );
  await expect(page.getByText("Complete the agent golden journey", { exact: true })).toBeVisible();
  await expect(page.getByText("fixture completed pagination detail must stay hidden")).toBeHidden();
});

test("bounds completed-work project connection failures", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo/done?scenario=completed-connect-error");
  await expect(page.getByRole("alert")).toContainText(
    "This project could not be loaded for your account.",
  );
  await expect(page.getByText("fixture completed connection detail must stay hidden")).toBeHidden();
});
