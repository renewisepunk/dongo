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

test("creates the CLI-proposed first project and approves the same terminal request", async ({ page }) => {
  const requestPath = "/device?user_code=NOPR-OJ00&project_name=Dongo&repository_url=https%3A%2F%2Fgithub.com%2Frenewisepunk%2Fdongo&execution_mode=manual";
  await page.goto(requestPath);
  await expect(page.getByText("New: Dongo", { exact: true })).toBeVisible();
  await expect(page.getByText("CLI project proposal", { exact: true })).toBeVisible();
  await expect(page.getByText("https://github.com/renewisepunk/dongo", { exact: true })).toBeVisible();
  await expect(page.getByText("Create “Dongo” as this account’s first project and bind this terminal to it.")).toBeVisible();

  await page.getByRole("button", { name: "Create & approve" }).click();
  await expect(page.getByText("Approved — return to your terminal", { exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-fixture-device-created-project",
    JSON.stringify({
      user: { id: "user-fixture", name: "Fixture Owner", email: "fixture@example.test" },
      name: "Dongo",
      slug: "dongo",
      repositoryUrl: "https://github.com/renewisepunk/dongo",
      executionMode: "manual",
    }),
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-fixture-device-project",
    JSON.stringify({ publicRef: "fixture-created", returnTo: requestPath }),
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-fixture-device-decision",
    JSON.stringify({ userCode: "NOPROJ00", accept: true }),
  );
});

test("keeps approval closed when a legacy device request has no project proposal", async ({ page }) => {
  await page.goto("/device?user_code=NOPR-OJ00");
  await expect(page.getByText("No project yet", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Create project" })).toHaveAttribute(
    "href",
    "/onboarding?returnTo=%2Fdevice%3Fuser_code%3DNOPR-OJ00",
  );

  await page.goto("/device?user_code=NOPR-OJ00&project_name=Dongo&repository_url=javascript%3Aalert(1)&execution_mode=manual");
  await expect(page.getByText("CLI project proposal", { exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Approve" })).toBeDisabled();
});

test("returns an unauthenticated terminal request to sign-in with its code", async ({ page }) => {
  await page.goto("/device?user_code=NOSS-N000");
  await expect(page).toHaveURL(
    /\/login\?returnTo=%2Fdevice%3Fuser_code%3DNOSS-N000$/,
  );
});
