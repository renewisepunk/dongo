import { expect, test } from "@playwright/test";

test("opens the cross-project overview from the existing project selector", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 760 });
  await page.goto("/app/fixture-studio/dongo");
  await page.getByRole("button", { name: "Select organization or project" }).click();
  await page.getByRole("menuitem", { name: "All projects" }).click();

  await expect(page).toHaveURL(/\/app\/projects$/);
  await expect(page).toHaveTitle("all projects — dongo");
  await expect(page.getByRole("heading", { name: "What needs attention now" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fixture Studio" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Personal workspace" })).toBeVisible();
  await expect(page.getByText("Paid · live status", { exact: true })).toBeVisible();

  const dongo = page.locator('[data-project-id="project-fixture"]');
  const companion = page.locator('[data-project-id="project-companion"]');
  await expect(dongo.getByText("needs you", { exact: true })).toBeVisible();
  await expect(dongo.getByText("dong007", { exact: true })).toBeVisible();
  await expect(companion.getByText("ready", { exact: true })).toBeVisible();
  await expect(dongo.getByRole("link", { name: /Approve the release candidate/ })).toHaveAttribute(
    "href",
    "/app/fixture-studio/dongo?work=dong007",
  );
  await expect.poll(async () => {
    const [first, second] = await Promise.all([dongo.boundingBox(), companion.boundingBox()]);
    return Boolean(first && second && Math.abs(first.y - second.y) < 4 && second.x > first.x);
  }).toBe(true);
});

test("keeps Free organizations navigable without exposing aggregated live state", async ({ page }) => {
  await page.goto("/app/projects");

  const freeProject = page.locator('[data-project-id="project-private"]');
  await expect(page.getByText("Free · project navigation", { exact: true })).toBeVisible();
  await expect(page.getByText("Cross-project live status is available on Paid.", { exact: true })).toBeVisible();
  await expect(freeProject).toContainText("Open this project to view its live work.");
  await expect(freeProject.getByRole("link", { name: "Open Private notes Overview" })).toHaveAttribute(
    "href",
    "/app/personal-workspace/private-notes",
  );
  await expect(freeProject.getByText("needs you", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Review plan" })).toHaveAttribute(
    "href",
    "/app/personal-workspace/private-notes/upgrade",
  );
});

test("stacks project columns accessibly on narrow screens without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 812 });
  await page.goto("/app/projects");

  const dongo = page.locator('[data-project-id="project-fixture"]');
  const companion = page.locator('[data-project-id="project-companion"]');
  await expect.poll(async () => {
    const [first, second] = await Promise.all([dongo.boundingBox(), companion.boundingBox()]);
    return Boolean(first && second && Math.abs(first.x - second.x) < 4 && second.y > first.y);
  }).toBe(true);
  await expect.poll(async () => await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )).toBe(true);
  await expect(dongo.getByRole("link", { name: /Approve the release candidate/ })).toBeVisible();
});

test("shows a truthful retryable failure without leaking connection detail", async ({ page }) => {
  await page.goto("/app/projects?scenario=all-projects-connect-error");

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Cross-project status is temporarily unavailable.");
  await expect(alert).toContainText("Your project Overviews are still available.");
  await expect(alert).not.toContainText("fixture cross-project connection detail");
  await expect(alert.getByRole("button", { name: "Retry" })).toBeVisible();
});
