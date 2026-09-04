import { expect, test } from "@playwright/test";

const secondaryRoutes = [
  { path: "ideas?filter=archived&scenario=breadcrumb-project-name", current: "ideas" },
  { path: "done?scenario=breadcrumb-project-name", current: "completed" },
  { path: "help?scenario=breadcrumb-project-name", current: "help" },
  { path: "settings?tab=Agent%20access&scenario=breadcrumb-project-name", current: "settings" },
  { path: "upgrade?scenario=breadcrumb-project-name", current: "upgrade" },
] as const;

test("exposes every authenticated header trail as a semantic project breadcrumb", async ({ page }) => {
  for (const route of secondaryRoutes) {
    await page.goto(`/app/fixture-studio/dongo/${route.path}`);

    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(breadcrumb).toBeVisible();
    await expect(breadcrumb.getByRole("list")).toBeVisible();

    const project = breadcrumb.getByRole("link", { name: "R&D / Launch", exact: true });
    await expect(project).toHaveAttribute("href", "/app/fixture-studio/dongo");
    await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText(route.current);

    await project.focus();
    await expect(project).toBeFocused();
  }
});

test("navigates the project ancestor by keyboard and restores query-backed route state", async ({ page }) => {
  const settingsUrl = "/app/fixture-studio/dongo/settings?tab=Agent%20access&scenario=breadcrumb-project-name";
  await page.goto(settingsUrl);

  const project = page.getByRole("navigation", { name: "Breadcrumb" })
    .getByRole("link", { name: "R&D / Launch", exact: true });
  await project.focus();
  await project.press("Enter");
  await expect(page).toHaveURL("/app/fixture-studio/dongo");

  await page.goBack();
  await expect(page).toHaveURL(settingsUrl);
  await expect(page.getByRole("button", { name: "Agent access" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })
    .locator('[aria-current="page"]')).toHaveText("settings");
});

test("keeps breadcrumbs visible without horizontal overflow on compact mobile layouts", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });

  for (const route of secondaryRoutes) {
    await page.goto(`/app/fixture-studio/dongo/${route.path}`);
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible();
    await expect.poll(() => page.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )).toBe(true);
  }
});
