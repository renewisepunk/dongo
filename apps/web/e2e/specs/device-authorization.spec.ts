import { expect, test } from "@playwright/test";

test("reviews and approves the exact terminal, project, resource, and scopes", async ({ page }) => {
  await page.goto("/device?user_code=ABCD-EFGH");
  await expect(page.getByRole("heading", { name: "Authorize Dongo CLI" })).toBeVisible();
  await expect(page.getByText("ABCD-EFGH", { exact: true })).toBeVisible();
  await expect(page.getByText("Dongo CLI · official client", { exact: true })).toBeVisible();
  await expect(page.getByText("fixture@example.test", { exact: true })).toBeVisible();
  await expect(page.getByText("https://dev.dongo.so/api/agent/v1", { exact: true })).toBeVisible();
  await expect(page.getByText("Read this project’s Intake, work, comments, and artifacts.")).toBeVisible();
  await expect(page.getByText("Stay signed in securely until you revoke this installation.")).toBeVisible();

  await page.getByLabel("project").selectOption("companion-project");
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved — return to your terminal", { exact: true })).toBeVisible();
  await expect(page.getByText("This page never displays access or refresh tokens.")).toBeVisible();

  await expect(page.locator("html")).toHaveAttribute(
    "data-fixture-device-project",
    JSON.stringify({ publicRef: "companion-project", returnTo: "/device?user_code=ABCD-EFGH" }),
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-fixture-device-decision",
    JSON.stringify({ userCode: "ABCDEFGH", accept: true }),
  );
});

test("denies without binding a project or issuing a token", async ({ page }) => {
  await page.goto("/device?user_code=DENY-0001");
  await page.getByRole("button", { name: "Deny" }).click();
  await expect(page.getByText("Authorization denied", { exact: true })).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-fixture-device-project", /./);
  await expect(page.locator("html")).toHaveAttribute(
    "data-fixture-device-decision",
    JSON.stringify({ userCode: "DENY0001", accept: false }),
  );
});

test("supports manual comparison-code entry and formatting", async ({ page }) => {
  await page.goto("/device");
  const code = page.getByLabel("Comparison code");
  await code.fill("abcd-efgh");
  await expect(code).toHaveValue("ABCD-EFGH");
  await page.getByRole("button", { name: "Review request" }).click();
  await expect(page.getByRole("heading", { name: "Authorize Dongo CLI" })).toBeVisible();
});

test("fails closed for completed and invalid requests", async ({ page }) => {
  await page.goto("/device?user_code=USED-0001");
  await expect(page.getByRole("heading", { name: "This request can’t be authorized" })).toBeVisible();
  await expect(page.getByText("This authorization request has already been completed.")).toBeVisible();

  await page.goto("/device?user_code=ERROR-001");
  await expect(page.getByRole("heading", { name: "This request can’t be authorized" })).toBeVisible();
  await expect(page.getByText("This authorization request could not be loaded.")).toBeVisible();
  await expect(page.getByText("fixture request detail must stay hidden")).toBeHidden();
});

test("creates the first project and returns to the exact pending terminal request", async ({ page }) => {
  await page.goto("/device?user_code=NOPR-OJ00");
  await expect(page.getByText("No project yet", { exact: true })).toBeVisible();
  await expect(page.getByText("Create your first project to continue this terminal authorization.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" })).toBeDisabled();

  const createProject = page.getByRole("link", { name: "Create project" });
  await expect(createProject).toHaveAttribute(
    "href",
    "/onboarding?returnTo=%2Fdevice%3Fuser_code%3DNOPR-OJ00",
  );
  await createProject.click();
  await page.getByLabel("Project name").fill("Dongo");
  await page.getByLabel("Repository URL").fill("github.com/renewisepunk/dongo");
  await page.getByRole("button", { name: "Create project" }).click();

  await expect(page).toHaveURL(/\/device\?user_code=NOPR-OJ00$/);
  await expect(page.getByLabel("project")).toHaveValue("fixture-created");
  await expect(page.getByRole("button", { name: "Approve" })).toBeEnabled();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved — return to your terminal", { exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-fixture-device-project",
    JSON.stringify({ publicRef: "fixture-created", returnTo: "/device?user_code=NOPR-OJ00" }),
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-fixture-device-decision",
    JSON.stringify({ userCode: "NOPROJ00", accept: true }),
  );
});

test("returns an unauthenticated terminal request to sign-in with its code", async ({ page }) => {
  await page.goto("/device?user_code=NOSS-N000");
  await expect(page).toHaveURL(
    /\/login\?returnTo=%2Fdevice%3Fuser_code%3DNOSS-N000$/,
  );
});
