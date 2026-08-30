import { expect, test } from "@playwright/test";

test("creates a project with normalized repository and explicit execution mode", async ({ page }) => {
  await page.goto("/onboarding?returnTo=%2Fconnect%3Frequest%3Dfixture");
  await expect(page.getByText("dev.dongo.so/fixture-owner-serfixture/", { exact: false })).toBeVisible();

  await page.getByLabel("Project name").fill("Checkout Service");
  await expect(page.getByText(
    "dev.dongo.so/fixture-owner-serfixture/checkout-service",
    { exact: true },
  )).toBeVisible();
  await page.getByLabel("Repository URL").fill("github.com/renewisepunk/dongo");
  await page.getByRole("radio", { name: /Autonomous/ }).click();
  await page.getByRole("button", { name: "Create project" }).click();

  await expect(page).toHaveURL(/\/connect\?request=fixture$/);
  const project = await page.evaluate(() => JSON.parse(sessionStorage.getItem("dongo:project") ?? "null"));
  expect(project).toMatchObject({
    name: "Checkout Service",
    slug: "checkout-service",
    repositoryUrl: "https://github.com/renewisepunk/dongo",
    mode: "autonomous",
    publicRef: "fixture-created",
    projectId: "project-created",
    organizationId: "organization-fixture",
    organizationSlug: "fixture-owner-serfixture",
  });
});

test("rejects unsafe repository URLs before provisioning", async ({ page }) => {
  await page.goto("/onboarding");
  await page.getByLabel("Project name").fill("Unsafe repository");
  await page.getByLabel("Repository URL").fill("javascript:alert(1)");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Enter a valid HTTP or HTTPS repository URL.",
  );
  await expect(page).toHaveURL(/\/onboarding$/);
  expect(await page.evaluate(() => sessionStorage.getItem("dongo:project"))).toBeNull();
});

test("ignores an external return path and uses the connect default", async ({ page }) => {
  await page.goto("/onboarding?returnTo=https%3A%2F%2Fevil.example%2Fsteal");
  await page.getByLabel("Project name").fill("Safe default");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/connect$/);
});

test("bounds provisioning and session failures", async ({ page }) => {
  await page.goto("/onboarding");
  await page.getByLabel("Project name").fill("Fail safely");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "The project could not be created. Try again.",
  );
  await expect(page.getByText("fixture provisioning detail must stay hidden")).toBeHidden();

  await page.goto("/onboarding?scenario=session-error");
  await expect(page.getByRole("heading", { name: "We couldn’t check your session" })).toBeVisible();
  await expect(page.getByText("fixture session detail must stay hidden")).toBeHidden();
});

test("returns an unauthenticated onboarding request to sign-in", async ({ page }) => {
  await page.goto("/onboarding?scenario=missing-session");
  await expect(page).toHaveURL(
    /\/login\?returnTo=%2Fonboarding%3Fscenario%3Dmissing-session$/,
  );
});
