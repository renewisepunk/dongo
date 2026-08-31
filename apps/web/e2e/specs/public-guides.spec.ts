import { expect, test } from "@playwright/test";

test("keeps get started public and preserves routes into help, sign-in, and the app", async ({ page }) => {
  await page.goto("/get-started");
  await expect(page).toHaveURL(/\/get-started$/);
  await expect(page.getByRole("heading", { name: "Your agent can set up dongo." })).toBeVisible();
  await expect(page.getByText("No project yet?")).toBeVisible();
  await expect(page.getByText("The CLI does not invoke macOS Keychain", { exact: false })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Dongo");

  await page.getByRole("link", { name: "Help", exact: true }).first().click();
  await expect(page).toHaveURL(/\/help$/);
  await expect(page.getByRole("heading", { name: "Keep the human–agent loop moving." })).toBeVisible();

  await page.getByRole("link", { name: "Sign in", exact: true }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();

  await page.goto("/get-started");
  await page.getByRole("link", { name: /Open app/ }).first().click();
  await expect(page.getByRole("region", { name: "Add something" })).toBeVisible();
});

test("keeps the complete help guide public without a project session", async ({ page }) => {
  await page.goto("/help");
  await expect(page).toHaveURL(/\/help$/);
  await expect(page.getByRole("heading", { name: "Attachments" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Keyboard shortcuts" })).toBeVisible();
  await expect(page.getByText("Paste images")).toBeVisible();
  await expect(page.getByText("Drop files anywhere")).toBeVisible();
  await expect(page.getByText("Command menu", { exact: true })).toBeVisible();
  await expect(page.getByText("dongo_session_start", { exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Dongo");
});
