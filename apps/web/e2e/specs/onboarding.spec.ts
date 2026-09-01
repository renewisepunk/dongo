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
  await expect(page.getByText("Single-agent", { exact: true })).toBeVisible();
  await page.getByLabel("Allow parallel work").check();
  await expect(page.getByText("Parallel work enabled", { exact: true })).toBeVisible();
  await page.getByLabel("Maximum concurrent runs").selectOption("6");
  await page.getByRole("button", { name: "Create project" }).click();

  await expect(page).toHaveURL(/\/connect\?request=fixture$/);
  const project = await page.evaluate(() => JSON.parse(sessionStorage.getItem("dongo:project") ?? "null"));
  expect(project).toMatchObject({
    name: "Checkout Service",
    slug: "checkout-service",
    repositoryUrl: "https://github.com/renewisepunk/dongo",
    mode: "autonomous",
    parallelExecution: {
      enabled: true,
      maxConcurrentRuns: 6,
      requiresIsolatedWorkspaces: true,
    },
    publicRef: "fixture-created",
    projectId: "project-created",
    organizationId: "organization-fixture",
    organizationSlug: "fixture-owner-serfixture",
  });
  expect(await page.locator("html").getAttribute("data-fixture-onboarding-project")).toContain(
    '"parallelExecution":{"enabled":true,"maxConcurrentRuns":6,"requiresIsolatedWorkspaces":true}',
  );
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
  await expect(page).toHaveURL(/\/connect\?created=1$/);
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

test("creates another project on a paid plan and selects it for setup", async ({ page }) => {
  await page.goto("/onboarding?scenario=paid&organization=fixture-studio");

  await expect(page.getByRole("heading", { name: "Create another project" })).toBeVisible();
  await expect(page.getByText("Signed in as fixture@example.test.", { exact: true })).toBeVisible();
  await expect(page.getByText("Paid plan · 1 active projects; no project limit.", { exact: true })).toBeVisible();
  await expect(page.getByText(
    "Creating one is separate from signing in and from connecting this repository or agent.",
    { exact: false },
  )).toBeVisible();

  await page.getByLabel("Project name").fill("Second project");
  await page.getByRole("button", { name: "Create project" }).click();

  await expect(page).toHaveURL(/\/connect\?created=1$/);
  expect(await page.locator("html").getAttribute("data-fixture-onboarding-project")).toContain(
    '"organizationId":"organization-fixture"',
  );
  const project = await page.evaluate(() => JSON.parse(sessionStorage.getItem("dongo:project") ?? "null"));
  expect(project).toMatchObject({
    name: "Second project",
    projectId: "project-created",
    organizationId: "organization-fixture",
    organizationSlug: "fixture-studio",
  });
});

test("creates another Free project when additional capacity was granted", async ({ page }) => {
  await page.goto("/onboarding?scenario=free-override&organization=fixture-studio");

  await expect(page.getByText(
    "Free plan · 1 of 4 active projects used. Additional capacity granted.",
    { exact: true },
  )).toBeVisible();
  await page.getByLabel("Project name").fill("Capacity project");
  await page.getByRole("button", { name: "Create project" }).click();

  await expect(page).toHaveURL(/\/connect\?created=1$/);
  expect(await page.locator("html").getAttribute("data-fixture-onboarding-project")).toContain(
    '"organizationId":"organization-fixture"',
  );
});

test("explains a free-plan project limit without sending the account back to login", async ({ page }) => {
  await page.goto("/onboarding?scenario=free-limit&organization=fixture-studio");

  await expect(page.getByText("Free plan · 1 of 1 active projects used.", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Free plan project limit reached.");
  await expect(page.getByRole("alert")).toContainText("Signing in again will not change this allowance.");
  await expect(page.getByRole("button", { name: "Create project" })).toBeHidden();
  await expect(page.getByRole("link", { name: "Use existing project" })).toHaveAttribute(
    "href",
    "/app/fixture-studio/dongo",
  );
  await expect(page.getByRole("link", { name: "Archive an active project" })).toHaveAttribute(
    "href",
    "/app/fixture-studio/dongo/settings?tab=General",
  );
  await expect(page.getByRole("link", { name: "Plan and upgrade options" })).toHaveAttribute(
    "href",
    "/app/fixture-studio/dongo/settings?tab=Plan%20%26%20storage",
  );
  await expect(page).toHaveURL(/\/onboarding\?scenario=free-limit/);
});
