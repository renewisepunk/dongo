import { expect, test } from "@playwright/test";

test("keeps the marketing homepage static and public without checking a human session", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("html")).not.toHaveAttribute("data-fixture-human-session-checked");
  await expect(page.locator("html")).not.toHaveAttribute("data-fixture-open-session-checked");
  await expect(page.getByRole("heading", { name: "Give agents work. See what they’re doing. Answer when they need you." })).toBeVisible();
  await expect(page.getByText("Your local agent turns it into structured work", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "The agent acts like itself" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in", exact: true }).first()).toHaveAttribute("href", "/login");
  await expect(page.getByRole("link", { name: "Connect a repository", exact: true }).first()).toHaveAttribute("href", "/get-started");
  await expect(page.getByRole("link", { name: /Open dongo/ })).toHaveAttribute("href", "/open");
  await expect(page.getByRole("link", { name: "Source" })).toHaveAttribute("rel", "external");
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
  await expect(page.getByRole("dialog", { name: "Complete the agent golden journey" })).toBeVisible();
});

test("keeps the essential product story readable at a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Give agents work. See what they’re doing. Answer when they need you." })).toBeVisible();
  await expect(page.getByLabel("Example dongo overview")).toBeVisible();
  await expect(page.getByRole("heading", { name: "You add intent. The agent handles the tracker." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "A tool for agents. A clear view for humans." })).toBeVisible();
});
