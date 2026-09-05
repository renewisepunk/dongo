import { expect, test } from "@playwright/test";

test("keeps the marketing homepage public when there is no human session", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("html")).not.toHaveAttribute("data-fixture-human-session-checked");
  await expect(page.locator("html")).not.toHaveAttribute("data-fixture-open-session-checked");
  await expect(page.locator("html")).toHaveAttribute("data-fixture-index-session-checked", "true");
  await expect(page.getByRole("heading", { name: "dongo is Linear for coding agents." })).toBeVisible();
  await expect(page.getByText("Stop tracking work across terminals and endless chats.")).toBeVisible();
  await expect(page.getByText("See what your agents are doing, what’s done, and what needs you. Add work, answer questions, and give feedback while they keep working.")).toBeVisible();
  await expect(page.getByRole("link", { name: "See how it works" })).toHaveAttribute("href", "#how-it-works");
  await expect(page.getByText("Works with Codex, Claude Code and other agents that use skills.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "From one prompt to shipped work." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in", exact: true }).first()).toHaveAttribute("href", "/login");
  await expect(page.getByRole("link", { name: /Open dongo/ })).toHaveAttribute("href", "/open");
  await expect(page.getByRole("link", { name: "Changelog" }).first()).toHaveAttribute("href", "/changelog");
  await expect(page.getByRole("link", { name: "Source" })).toHaveAttribute("rel", "external");
});

test("shows the agent work loop in the hero and the complete workflow below it", async ({ page }) => {
  await page.goto("/");

  const visual = page.getByRole("figure", { name: /two agents active.*one decision waiting.*eight shipped/i });
  await expect(visual).toBeVisible();

  const workflow = page.getByRole("heading", { name: "From one prompt to shipped work." }).locator("..");
  for (const heading of [
    "Install from the agent you already use.",
    "Let the agent create the first focused issues.",
    "Add new work from your phone or browser.",
    "New Intake can start automatically.",
    "Several agents can move separate issues at once.",
    "Step in when human judgment is actually needed.",
    "Follow the exact change all the way to production.",
    "The same truth, on desktop or mobile.",
  ]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  await expect(workflow).toContainText("Set up dongo once.");
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

  await expect(page.getByRole("heading", { name: "dongo is Linear for coding agents." })).toBeVisible();
  await expect(page.getByRole("figure", { name: /two agents active/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "From one prompt to shipped work." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Leave the terminals to your agents." })).toBeVisible();
});
