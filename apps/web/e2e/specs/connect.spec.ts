import { expect, test } from "@playwright/test";

test("explains required CLI approval, optional MCP, and copies host-specific instructions", async ({ page }) => {
  await page.goto("/connect");
  await expect(page.getByRole("heading", { name: "Connect a coding agent" })).toBeVisible();
  await expect(page.getByText(/There is no need to reopen it/)).toBeVisible();
  await expect(page.getByText(/CLI connection is required.*MCP is optional/)).toBeVisible();
  const sequence = page.getByRole("list", { name: "Setup sequence" });
  await expect(sequence.getByText("Apply the configuration.", { exact: true })).toBeVisible();
  await expect(sequence.getByText("Approve the project-scoped server only if required.", { exact: true })).toBeVisible();
  await expect(sequence.getByText("Complete login only if required.", { exact: true })).toBeVisible();
  await expect(sequence.getByText("Restart only when necessary.", { exact: true })).toBeVisible();
  await expect(sequence.getByText("Verify the connection.", { exact: true })).toBeVisible();
  await expect(page.getByText("Waiting for setup", { exact: true })).toBeVisible();

  const tabs = page.getByRole("tablist", { name: "Coding agent host" });
  const codex = tabs.getByRole("tab", { name: "Codex" });
  await expect(codex).toHaveAttribute("aria-selected", "true");
  await codex.focus();
  await page.keyboard.press("ArrowRight");
  const claude = tabs.getByRole("tab", { name: "Claude Code" });
  await expect(claude).toBeFocused();
  await expect(claude).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "copy" }).click();
  await expect(page.getByRole("button", { name: "copied" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-fixture-clipboard",
    "Set up dongo for this repository in this current Claude Code session. In order: 1) apply the project-scoped configuration; 2) approve the project-scoped server only if required; 3) complete login only if required; 4) restart Claude Code only when necessary; 5) verify the connection with dongo_session_start. Keep using this repository session.",
  );
});

test("does not mistake a CLI grant for a live Claude Code connection", async ({ page }) => {
  await page.goto("/login");
  await page.evaluate(() => sessionStorage.setItem(
    "dongo:project",
    JSON.stringify({ projectId: "preferred-project" }),
  ));
  await page.goto("/connect?scenario=connected");

  await expect(page.locator("html")).toHaveAttribute(
    "data-fixture-connect-preferred-project",
    "preferred-project",
  );
  await page.getByRole("tab", { name: "Claude Code" }).click();
  await expect(page.getByText("Claude Code setup not verified", { exact: true })).toBeVisible();
  await expect(page.getByText(/CLI is ready, but no live Claude Code MCP connection/)).toBeVisible();
  await expect(page.getByText("Setup complete", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/grant · cli · active/)).toHaveCount(0);
  await expect(page.getByText(/Fixture Mac/)).toHaveCount(0);
});

test("shows success only after the selected Claude Code connection verifies", async ({ page }) => {
  await page.goto("/connect?scenario=claude-connected");
  await page.getByRole("tab", { name: "Claude Code" }).click();

  await expect(page.getByText("Claude Code connection verified", { exact: true })).toBeVisible();
  await expect(page.getByText("Setup complete", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "dongo is ready for dongo" })).toBeVisible();
  await expect(page.getByText("Claude Code can reach this dongo project and passed verification.", { exact: true })).toBeVisible();
  await expect(page.getByText("Open Overview and add the first piece of work you want your agent to track.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open dongo Overview" })).toHaveAttribute(
    "href",
    "/app/fixture-studio/dongo",
  );
});

test("keeps an approved Claude Code grant pending until session verification", async ({ page }) => {
  await page.goto("/connect?scenario=claude-approved");
  await page.getByRole("tab", { name: "Claude Code" }).click();

  await expect(page.getByText("Claude Code verification required", { exact: true })).toBeVisible();
  await expect(page.getByText("Access is approved. Complete step 5 from Claude Code to verify the connection.", { exact: true })).toBeVisible();
  await expect(page.getByText("Setup complete", { exact: true })).toHaveCount(0);
});

test("gives an actionable recovery when Claude Code needs login", async ({ page }) => {
  await page.goto("/connect?scenario=claude-needs-reauth");
  await page.getByRole("tab", { name: "Claude Code" }).click();

  await expect(page.getByText("Claude Code needs login", { exact: true })).toBeVisible();
  await expect(page.getByText("Complete step 3 to sign Claude Code in again, then verify the connection.", { exact: true })).toBeVisible();
  await expect(page.getByText("Setup complete", { exact: true })).toHaveCount(0);
});

test("gives an actionable recovery when Claude Code access was revoked", async ({ page }) => {
  await page.goto("/connect?scenario=claude-revoked");
  await page.getByRole("tab", { name: "Claude Code" }).click();

  await expect(page.getByText("Claude Code access was revoked", { exact: true })).toBeVisible();
  await expect(page.getByText("Apply the configuration again, complete a fresh login, and verify. The previous access can no longer be used.", { exact: true })).toBeVisible();
  await expect(page.getByText("Setup complete", { exact: true })).toHaveCount(0);
});

test("presents bounded clipboard, status, and connection failures", async ({ page }) => {
  await page.goto("/connect?scenario=copy-error");
  await page.getByRole("button", { name: "copy" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Clipboard access was unavailable. Select and copy the instruction manually.",
  );
  await expect(page.getByText("fixture clipboard detail must stay hidden")).toBeHidden();

  await page.goto("/connect?scenario=status-error");
  await expect(page.getByRole("alert")).toHaveText(
    "Connection status is unavailable. Verify from the current agent session, or refresh this page to retry.",
  );
  await expect(page.getByText("fixture status detail must stay hidden")).toBeHidden();

  await page.goto("/connect?scenario=connect-error");
  await expect(page.getByRole("alert")).toHaveText(
    "No project is available. Create or select a project, then return to connect this agent.",
  );
  await expect(page.getByText("fixture connection detail must stay hidden")).toBeHidden();
});

test("returns an unauthenticated connect request to sign-in", async ({ page }) => {
  await page.goto("/connect?scenario=missing-session");
  await expect(page).toHaveURL(
    /\/login\?returnTo=%2Fconnect%3Fscenario%3Dmissing-session$/,
  );
});
