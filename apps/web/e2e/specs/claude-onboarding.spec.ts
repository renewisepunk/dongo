import { expect, test } from "@playwright/test";

test("keeps every Claude Code setup phase truthful and independently recoverable", async ({ page }) => {
  await page.goto("/get-started");
  await expect(page.getByText("An absent CLI is installed and a current CLI is left alone.", { exact: false })).toBeVisible();
  await expect(page.getByText("asks before upgrading", { exact: false })).toBeVisible();

  const phases = [
    {
      scenario: "connected",
      title: "Claude Code setup not verified",
      detail: "The dongo CLI is ready, but no live Claude Code MCP connection has passed verification.",
    },
    {
      scenario: "claude-approved",
      title: "Claude Code verification required",
      detail: "Access is approved. Complete step 5 from Claude Code to verify the connection.",
    },
    {
      scenario: "claude-needs-reauth",
      title: "Claude Code needs login",
      detail: "Complete step 3 to sign Claude Code in again, then verify the connection.",
    },
    {
      scenario: "claude-revoked",
      title: "Claude Code access was revoked",
      detail: "Apply the configuration again, complete a fresh login, and verify. The previous access can no longer be used.",
    },
  ] as const;

  for (const phase of phases) {
    await page.goto(`/connect?scenario=${phase.scenario}`);
    await page.getByRole("tab", { name: "Claude Code" }).click();
    await expect(page.getByText(phase.title, { exact: true })).toBeVisible();
    await expect(page.getByText(phase.detail, { exact: false })).toBeVisible();
    await expect(page.getByText("Setup complete", { exact: true })).toHaveCount(0);
  }

  await page.goto("/connect?scenario=claude-connected");
  await page.getByRole("tab", { name: "Claude Code" }).click();
  await expect(page.getByText("Claude Code connection verified", { exact: true })).toBeVisible();
  await expect(page.getByText("Setup complete", { exact: true })).toBeVisible();
  await expect(page.getByText("Claude Code can reach this dongo project and passed verification.", { exact: true })).toBeVisible();
});

test("reuses the current browser account and supports its first project without retrying sign-in", async ({ page }) => {
  const requestPath = "/device?user_code=ALTA-CCT1&project_name=Cross%20Account&repository_url=https%3A%2F%2Fgithub.com%2Frenewisepunk%2Fcross-account&execution_mode=manual";
  await page.goto(requestPath);

  await expect(page.getByText("New: Cross Account", { exact: true })).toBeVisible();
  await expect(page.getByText("CLI project proposal", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Organization name")).toHaveValue("Alternate Owner");
  await expect(page.getByRole("link", { name: /sign in/i })).toHaveCount(0);
  await page.getByRole("button", { name: "Create & approve" }).click();

  await expect(page.getByText("Approved — you can close this window", { exact: true })).toBeVisible();
  const creation = JSON.parse(
    await page.locator("html").getAttribute("data-fixture-device-created-project") ?? "null",
  );
  expect(creation).toMatchObject({
    user: { id: "user-alternate", email: "alternate@example.test" },
    name: "Cross Account",
    repositoryUrl: "https://github.com/renewisepunk/cross-account",
  });
});

test("keeps first-project and additional-repository approvals distinct", async ({ page }) => {
  await page.goto("/device?user_code=NOPR-OJ00&project_name=First&execution_mode=manual");
  await expect(page.getByText("Create “First” as this account’s first project and bind this terminal to it.", { exact: true })).toBeVisible();

  await page.goto("/device?user_code=NEWP-RJ01&project_action=create&project_name=Additional&execution_mode=autonomous");
  await expect(page.getByText("Create “Additional” as another project and bind this terminal to it.", { exact: true })).toBeVisible();
  await expect(page.getByText("Signing in again", { exact: false })).toHaveCount(0);
});
