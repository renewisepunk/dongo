import { expect, test } from "@playwright/test";

test("keeps the marketing homepage public when there is no human session", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("html")).not.toHaveAttribute("data-fixture-human-session-checked");
  await expect(page.locator("html")).not.toHaveAttribute("data-fixture-open-session-checked");
  await expect(page.locator("html")).toHaveAttribute("data-fixture-index-session-checked", "true");
  await expect(page.getByRole("heading", { name: "Ideas become visible work." })).toBeVisible();
  await expect(page.getByText("Capture an idea. Send it to Inbox when it is ready. Follow the work with agents.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Not every thought is ready for an agent." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "People set direction. Agents move the work." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in", exact: true }).first()).toHaveAttribute("href", "/login");
  await expect(page.getByRole("link", { name: /Open dongo/ })).toHaveAttribute("href", "/open");
  await expect(page.getByRole("link", { name: "Changelog" }).first()).toHaveAttribute("href", "/changelog");
  await expect(page.getByRole("link", { name: "Source" })).toHaveAttribute("rel", "external");
});

test("shows real product patterns across the Ideas, Overview, and Work screens", async ({ page }) => {
  await page.goto("/");

  const tour = page.getByRole("article", { name: "dongo product tour" });
  const ideasTab = tour.getByRole("tab", { name: /Ideas/ });
  const overviewTab = tour.getByRole("tab", { name: /Overview/ });
  const workTab = tour.getByRole("tab", { name: /Work/ });

  await expect(ideasTab).toHaveAttribute("aria-selected", "true");
  await expect(tour.getByRole("tabpanel", { name: "Ideas screen" })).toBeVisible();
  await expect(tour.getByText("Possible future work. Agents cannot see or claim Ideas.")).toBeVisible();

  await overviewTab.click();
  await expect(overviewTab).toHaveAttribute("aria-selected", "true");
  const overviewScreen = tour.getByRole("tabpanel", { name: "Overview screen" });
  await expect(overviewScreen).toBeVisible();
  await expect(overviewScreen.getByText("Refresh the marketing site")).toBeVisible();
  await expect(overviewScreen.getByText("Choose the release order")).toBeVisible();

  await workTab.click();
  await expect(workTab).toHaveAttribute("aria-selected", "true");
  const workScreen = tour.getByRole("tabpanel", { name: "Work detail screen" });
  await expect(workScreen).toBeVisible();
  await expect(workScreen.getByText("Copy review requested")).toBeVisible();
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

  await expect(page.getByRole("heading", { name: "Ideas become visible work." })).toBeVisible();
  await expect(page.getByRole("article", { name: "dongo product tour" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "People set direction. Agents move the work." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bring the next idea." })).toBeVisible();
});
