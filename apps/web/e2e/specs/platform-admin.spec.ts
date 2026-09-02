import { expect, test } from "@playwright/test";

test("super admins can review privacy-safe usage and update bounded allowances", async ({ page }) => {
  await page.goto("/admin");

  await expect(page.getByRole("heading", { name: "platform administration" })).toBeVisible();
  await expect(page.getByText("owner@example.test")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Created" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Closed" })).toBeVisible();
  await expect(page.getByText("Work titles, comments, attachments, and raw billing data are not included.")).toBeVisible();

  await page.getByRole("tab", { name: "Organization limits" }).click();
  await expect(page.getByRole("heading", { name: "Fixture Studio" })).toBeVisible();
  await expect(page.getByText("Not configured")).toBeVisible();
  await page.getByLabel("Active projects").fill("6");
  await page.getByLabel("Total Work items").fill("400");
  await page.getByLabel("Audit reason").fill("Approved pilot capacity");
  await page.getByRole("button", { name: "Save limits" }).click();
  await expect(page.getByText("Saved limits for Fixture Studio.")).toHaveClass(/visually-hidden/);

  const update = await page.locator("html").getAttribute("data-fixture-admin-update");
  expect(JSON.parse(update ?? "{}")).toMatchObject({
    organizationId: "organization-fixture",
    activeProjectLimit: 6,
    totalWorkItemLimit: 400,
    expectedProjectCapacityRevision: 2,
    expectedWorkCapacityRevision: 3,
    reason: "Approved pilot capacity",
  });
});

test("platform administration fails closed without exposing backend details", async ({ page }) => {
  await page.goto("/admin?scenario=admin-error");
  await expect(page.getByRole("heading", { name: "Administration unavailable" })).toBeVisible();
  await expect(page.getByText("private fixture detail")).toHaveCount(0);
});

test("platform administration remains usable at narrow mobile widths", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto("/admin");
  await page.getByRole("tab", { name: "Organization limits" }).click();
  await expect(page.getByLabel("Active projects")).toBeVisible();
  await expect(page.getByLabel("Total Work items")).toBeVisible();
  const geometry = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    overflow: [...document.querySelectorAll("*")].flatMap((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.left >= 0 && rect.right <= window.innerWidth) return [];
      return [{
        element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${typeof element.className === "string" && element.className ? `.${element.className.trim().replace(/\s+/g, ".")}` : ""}`,
        left: Math.round(rect.left * 100) / 100,
        right: Math.round(rect.right * 100) / 100,
        width: Math.round(rect.width * 100) / 100,
      }];
    }),
  }));
  expect(geometry.scrollWidth, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.viewportWidth);
});

test("only super admins receive the platform administration navigation item", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo?scenario=overview-super-admin");
  await page.getByRole("button", { name: "Profile and settings" }).click();
  await expect(page.getByRole("menuitem", { name: "Platform administration" })).toBeVisible();

  await page.goto("/app/fixture-studio/dongo");
  await page.getByRole("button", { name: "Profile and settings" }).click();
  await expect(page.getByRole("menuitem", { name: "Platform administration" })).toHaveCount(0);
});

test("older accounts and organizations remain reachable through bounded pages", async ({ page }) => {
  await page.goto("/admin?scenario=admin-pagination");
  await page.getByRole("button", { name: "Load more accounts" }).click();
  await expect(page.getByText("older@example.test")).toBeVisible();

  await page.getByRole("tab", { name: "Organization limits" }).click();
  await page.getByRole("button", { name: "Load more organizations" }).click();
  await expect(page.getByRole("heading", { name: "Older Studio" })).toBeVisible();
});
