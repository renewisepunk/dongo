import { expect, test } from "@playwright/test";

test("keeps get started public and preserves routes into help, sign-in, and the app", async ({ page }) => {
  await page.goto("/get-started");
  await expect(page).toHaveURL(/\/get-started$/);
  await expect(page.locator("html")).not.toHaveAttribute("data-fixture-human-session-checked", "true");
  await expect(page.getByRole("heading", { name: "Your agent can set up dongo." })).toBeVisible();
  await expect(page.getByText("No project yet?")).toBeVisible();
  await expect(page.getByText("The CLI does not invoke macOS Keychain", { exact: false })).toBeVisible();
  await expect(page.getByText("Re-authenticate", { exact: true })).toBeVisible();
  await expect(page.getByText("Revoke or remove", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Help", exact: true }).first().click();
  await expect(page).toHaveURL(/\/help$/);
  await expect(page.getByRole("heading", { name: "Keep the human–agent loop moving." })).toBeVisible();

  await page.getByRole("link", { name: "Sign in", exact: true }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();

  await page.goto("/get-started");
  await page.getByRole("link", { name: /Open app/ }).first().click();
  await expect(page.getByRole("region", { name: "Add something" })).toBeVisible();
});

test("keeps the complete help guide public without a project session", async ({ page }) => {
  await page.goto("/help");
  await expect(page).toHaveURL(/\/help$/);
  await expect(page.locator("html")).not.toHaveAttribute("data-fixture-human-session-checked", "true");
  await expect(page.getByRole("heading", { name: "Attachments" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Keyboard shortcuts" })).toBeVisible();
  await expect(page.getByText("Paste images")).toBeVisible();
  await expect(page.getByText("Drop files anywhere")).toBeVisible();
  await expect(page.getByText("Command menu", { exact: true })).toBeVisible();
  await expect(page.getByText("dongo_session_start", { exact: true })).toBeVisible();
  await expect(page.getByText("Re-authenticate this host", { exact: true })).toBeVisible();
  await expect(page.getByText("Revoke server access", { exact: true })).toBeVisible();
  await expect(page.locator(".shortcut-reference__row")).toHaveCount(15);
  await expect(page.getByRole("link", { name: /Security and privacy/ })).toHaveAttribute("href", "/security");
  await expect(page.getByRole("link", { name: /Report a vulnerability/ })).toHaveAttribute("href", /SECURITY\.md$/);
  await expect(page.getByRole("link", { name: /Auth recovery runbook/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Credential storage decision/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /CLI and MCP architecture/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /MCP setup and recovery/ })).toHaveAttribute("href", "#mcp-resources");
});

test("publishes a clear security boundary without exposing implementation details", async ({ page }) => {
  await page.goto("/security");

  await expect(page).toHaveURL(/\/security$/);
  await expect(page.locator("html")).not.toHaveAttribute("data-fixture-human-session-checked", "true");
  await expect(page.getByRole("heading", { name: "Your work stays yours." })).toBeVisible();
  await expect(page.getByText("repository and Git state", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Security without broad repository access." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Collect less. Share intentionally." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Claims you can trust." })).toBeVisible();
  await expect(page.getByText("dongo does not currently claim SOC 2 or ISO 27001 certification.", { exact: true })).toBeVisible();
  await expect(page.getByText("Cloudflare Workers + D1", { exact: true })).toHaveCount(0);
  await expect(page.getByText("OAuth + PKCE", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Open a private report/ })).toHaveAttribute("href", /security\/advisories\/new$/);
});

test("keeps the security boundary readable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/security");

  await expect(page.getByRole("heading", { name: "Your work stays yours." })).toBeVisible();
  await expect(page.getByLabel("dongo data boundary")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Security without broad repository access." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Claims you can trust." })).toBeVisible();
});
