import { expect, test } from "@playwright/test";

test("keeps the marketing homepage public when there is no human session", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("html")).not.toHaveAttribute("data-fixture-human-session-checked");
  await expect(page.locator("html")).not.toHaveAttribute("data-fixture-open-session-checked");
  await expect(page.locator("html")).toHaveAttribute("data-fixture-index-session-checked", "true");
  await expect(page.getByRole("heading", { name: "Like Linear, but for coding agents." })).toBeVisible();
  await expect(page.getByText("the shared place for you and your agents", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Start with the agent you already use." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in", exact: true }).first()).toHaveAttribute("href", "/login");
  await expect(page.getByRole("link", { name: /Open dongo/ })).toHaveAttribute("href", "/open");
  await expect(page.getByRole("link", { name: "Source" })).toHaveAttribute("rel", "external");
});

test("opens the app directly for a signed-in human", async ({ page }) => {
  await page.goto("/?scenario=signed-in");

  await expect(page.locator("html")).toHaveAttribute("data-fixture-index-session-checked", "true");
  await expect(page.locator("html")).toHaveAttribute("data-fixture-index-identity-bootstrapped", "true");
  await expect(page).toHaveURL(/\/app\/fixture-studio\/dongo$/);
});

test("resolves Open dongo to sign-in without a human session", async ({ page }) => {
  await page.goto("/open?scenario=missing-session");

  await expect(page.locator("html")).toHaveAttribute("data-fixture-open-session-checked", "true");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
});

test("resolves Open dongo to the last safe app route for a signed-in human", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => sessionStorage.setItem(
    "dongo:last-app-route",
    "/app/fixture-studio/dongo?work=work-done",
  ));
  await page.goto("/open");

  await expect(page.locator("html")).toHaveAttribute("data-fixture-open-identity-bootstrapped", "true");
  await expect(page).toHaveURL(/\/app\/fixture-studio\/dongo\?work=work-done$/);
  await expect(page.getByRole("region", { name: "Complete the agent golden journey" })).toBeVisible();
});

test("keeps the essential product story readable at a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Like Linear, but for coding agents." })).toBeVisible();
  await expect(page.getByLabel("Example dongo overview")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Development changed. The tracker did not." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Put agent work where you can see it." })).toBeVisible();
});
