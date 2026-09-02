import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("presents the $19 Unlimited plan without offering a fake checkout", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo/upgrade?scenario=free-limit-owner");

  await expect(page.getByRole("heading", { name: "Make room for every project." })).toBeVisible();
  await expect(page.getByText("$19", { exact: true })).toBeVisible();
  await expect(page.getByText("planned price", { exact: true })).toBeVisible();
  await expect(page.getByText("Unlimited active projects", { exact: true })).toBeVisible();
  await expect(page.getByText("Unlimited collaborators", { exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Billing isn’t connected yet.");
  await expect(page.getByRole("button", { name: /checkout|upgrade|buy/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Create another project" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Archive an active project instead" })).toHaveAttribute(
    "href",
    "/app/fixture-studio/dongo/settings?tab=General",
  );
});

test("keeps owner and capacity states honest", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo/upgrade?scenario=member");
  await expect(page.getByText("Only an organization owner can manage a future paid plan.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Create another project" })).toHaveCount(0);

  await page.goto("/app/fixture-studio/dongo/upgrade?scenario=capacity-override");
  await expect(page.getByText(/remains a Free organization with additional project capacity/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Create another project" })).toHaveAttribute(
    "href",
    "/onboarding?organization=fixture-studio",
  );

  await page.goto("/app/fixture-studio/dongo/upgrade");
  await expect(page.getByText("This organization already has unlimited active projects.")).toBeVisible();
});

test("bounds plan-loading failures without exposing internal detail", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo/upgrade?scenario=load-error");

  await expect(page.getByRole("alert")).toHaveText(
    "This organization’s plan could not be loaded for your account.",
  );
  await expect(page.getByText("fixture settings detail must stay hidden")).toBeHidden();
  await expect(page.getByText("Make room for every project.")).toBeHidden();
});

test("is responsive and has no detectable WCAG A/AA violations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/fixture-studio/dongo/upgrade?scenario=free-limit-owner");
  await expect(page.getByRole("heading", { name: "Make room for every project." })).toBeVisible();
  await expect.poll(async () => page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )).toBe(true);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
