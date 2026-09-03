import { expect, test } from "@playwright/test";

test("reviews and approves the exact terminal and project without technical resource details", async ({ page }) => {
  const requestPath = "/device?user_code=ABCD-EFGH&project_ref=companion-project&project_name=Companion";
  await page.goto(requestPath);
  await expect(page.getByRole("heading", { name: "Authorize dongo CLI" })).toBeVisible();
  await expect(page.getByText("ABCD-EFGH", { exact: true })).toBeVisible();
  await expect(page.getByText("dongo CLI · official client", { exact: true })).toBeVisible();
  await expect(page.getByText("fixture@example.test", { exact: true })).toBeHidden();
  await expect(page.getByText("https://dev.dongo.so/api/agent/v1", { exact: true })).toBeHidden();
  await expect(page.getByText("Read this project’s Intake, work, comments, and artifacts.")).toBeVisible();
  await expect(page.getByText("Stay signed in securely until you revoke this installation.")).toBeVisible();

  await expect(page.getByText("Fixture Studio / Companion", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByText(/Project selected by the dongo CLI/)).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved — you can close this window", { exact: true })).toBeVisible();
  await expect(page.getByText("This page never displays access or refresh tokens.")).toBeVisible();
  const outcome = page.locator('.approved-state[data-state="approved"]');
  await expect(outcome).toBeVisible();
  await expect.poll(async () => outcome.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  await expect(outcome).toHaveCSS("border-top-style", "solid");
  await expect(outcome).toHaveCSS("border-top-width", "1px");

  await expect(page.locator("html")).toHaveAttribute(
    "data-fixture-device-project",
    JSON.stringify({ publicRef: "companion-project", returnTo: requestPath }),
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-fixture-device-decision",
    JSON.stringify({ userCode: "ABCDEFGH", accept: true }),
  );
});

test("shows and records one explicit CLI and Codex approval", async ({ page }) => {
  const requestPath = "/device?user_code=ABCD-EFGH&project_ref=companion-project&project_name=Companion&agent_host=codex";
  await page.goto(requestPath);

  await expect(page.getByRole("heading", { name: "Authorize dongo CLI + Codex" })).toBeVisible();
  await expect(page.getByText(
    "Authorize Codex for the same project so its separate secure login completes without another dongo approval.",
    { exact: true },
  )).toBeVisible();
  await page.getByRole("button", { name: "Approve both" }).click();

  await expect(page.getByText("Approved — you can close this window", { exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-fixture-device-host",
    JSON.stringify({
      projectRef: "companion-project",
      userCode: "ABCDEFGH",
      host: "codex",
      returnTo: requestPath,
    }),
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-fixture-device-decision",
    JSON.stringify({ userCode: "ABCDEFGH", accept: true }),
  );
});

test("matches the agent proposal by repository and fails closed when context is ambiguous", async ({ page }) => {
  await page.goto("/device?user_code=ABCD-EFGH&project_name=dongo&repository_url=https%3A%2F%2Fgithub.com%2Frenewisepunk%2Fdongo.git");
  await expect(page.getByText("Fixture Studio / dongo", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" })).toBeEnabled();

  await page.goto("/device?user_code=ABCD-EFGH");
  await expect(page.getByText("No unambiguous project match", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("could not match this repository");
  await expect(page.getByRole("button", { name: "Approve" })).toBeDisabled();
  await expect(page.getByRole("combobox")).toHaveCount(0);
});

test("denies without binding a project or issuing a token", async ({ page }) => {
  await page.goto("/device?user_code=DENY-0001");
  await page.getByRole("button", { name: "Deny" }).click();
  await expect(page.getByText("Authorization denied", { exact: true })).toBeVisible();
  await expect(page.getByText("No token was issued. You can close this page or restart dongo connect.")).toBeVisible();
  await expect(page.locator('.approved-state[data-state="denied"]')).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Authorize dongo CLI" })).toBeVisible();
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
  const requestPath = "/device?user_code=NOPR-OJ00&project_name=dongo&repository_url=https%3A%2F%2Fgithub.com%2Frenewisepunk%2Fdongo&execution_mode=manual";
  await page.goto(requestPath);
  await expect(page.getByText("New: dongo", { exact: true })).toBeVisible();
  await expect(page.getByText("CLI project proposal", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Organization name")).toHaveValue("Fixture Owner");
  await page.getByLabel("Organization name").fill("Fixture Labs");
  await expect(page.getByText("fixture-labs", { exact: true })).toBeVisible();
  await expect(page.getByText("https://github.com/renewisepunk/dongo", { exact: true })).toBeHidden();
  await expect(page.getByText("Create “dongo” as this account’s first project and bind this terminal to it.")).toBeVisible();
  await page.getByLabel("Allow parallel work").check();
  await page.getByLabel("Maximum concurrent runs").selectOption("5");

  await page.getByRole("button", { name: "Create & approve" }).click();
  await expect(page.getByText("Approved — you can close this window", { exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-fixture-device-created-project",
    JSON.stringify({
      user: { id: "user-fixture", name: "Fixture Owner", email: "fixture@example.test" },
      organizationName: "Fixture Labs",
      name: "dongo",
      slug: "dongo",
      repositoryUrl: "https://github.com/renewisepunk/dongo",
      executionMode: "manual",
      parallelExecution: {
        enabled: true,
        maxConcurrentRuns: 5,
        requiresIsolatedWorkspaces: true,
      },
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

test("creates another paid-plan project instead of rebinding an existing match", async ({ page }) => {
  const requestPath = "/device?user_code=NEWP-RJ01&project_action=create&project_name=Companion%20API&repository_url=https%3A%2F%2Fgithub.com%2Frenewisepunk%2Fcompanion-api&execution_mode=autonomous";
  await page.goto(requestPath);

  await expect(page.getByText("New: Companion API", { exact: true })).toBeVisible();
  await expect(page.getByText("Create “Companion API” as another project and bind this terminal to it.", { exact: true })).toBeVisible();
  await expect(page.getByText("Paid plan · 2 active projects; no project limit.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create & approve" }).click();

  await expect(page.getByText("Approved — you can close this window")).toBeVisible();
  const created = await page.locator("html").getAttribute("data-fixture-device-created-project");
  expect(created).toContain('"organizationId":"organization-fixture"');
  expect(created).toContain('"name":"Companion API"');
  expect(await page.locator("html").getAttribute("data-fixture-device-project")).toContain(
    '"publicRef":"fixture-created"',
  );
});

test("creates another project from CLI when Free capacity was granted", async ({ page }) => {
  const requestPath = "/device?user_code=OVRD-0001&project_action=create&project_name=Capacity%20API&execution_mode=manual";
  await page.goto(requestPath);

  await expect(page.getByText(
    "Free plan · 2 of 5 active projects used. Additional capacity granted.",
    { exact: true },
  )).toBeVisible();
  await page.getByRole("button", { name: "Create & approve" }).click();

  await expect(page.getByText("Approved — you can close this window")).toBeVisible();
  expect(await page.locator("html").getAttribute("data-fixture-device-created-project")).toContain(
    '"name":"Capacity API"',
  );
});

test("explains the free-plan limit for an explicit CLI project creation request", async ({ page }) => {
  await page.goto("/device?user_code=LIMI-T001&project_action=create&project_name=Another&execution_mode=manual");

  await expect(page.getByText("Free plan · 1 of 1 active projects used.", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Free plan project limit reached.");
  await expect(page.getByRole("alert")).toContainText("Your account is signed in");
  await expect(page.getByRole("button", { name: "Create & approve" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Use existing project" })).toHaveAttribute("href", "/app/fixture-studio/dongo");
  await expect(page.getByRole("link", { name: "Upgrade to add projects" })).toHaveAttribute(
    "href",
    "/app/fixture-studio/dongo/upgrade",
  );
  await expect(page).toHaveURL(/\/device\?user_code=LIMI-T001/);
});

test("keeps approval closed when a legacy device request has no project proposal", async ({ page }) => {
  await page.goto("/device?user_code=NOPR-OJ00");
  await expect(page.getByText("No project yet", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Create project" })).toHaveAttribute(
    "href",
    "/onboarding?returnTo=%2Fdevice%3Fuser_code%3DNOPR-OJ00",
  );

  await page.goto("/device?user_code=NOPR-OJ00&project_name=dongo&repository_url=javascript%3Aalert(1)&execution_mode=manual");
  await expect(page.getByText("CLI project proposal", { exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Approve" })).toBeDisabled();
});

test("returns an unauthenticated terminal request to sign-in with its code", async ({ page }) => {
  await page.goto("/device?user_code=NOSS-N000");
  await expect(page).toHaveURL(
    /\/login\?returnTo=%2Fdevice%3Fuser_code%3DNOSS-N000$/,
  );
});
