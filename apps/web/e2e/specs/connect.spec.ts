import { expect, test } from "@playwright/test";

test("explains one-link authorization and copies host-specific instructions", async ({ page }) => {
  await page.goto("/connect");
  await expect(page.getByRole("heading", { name: "Connect a coding agent" })).toBeVisible();
  await expect(page.getByText(/opens one approval link/)).toBeVisible();
  await expect(page.getByText(/nothing to copy or enter/)).toBeVisible();
  await expect(page.getByText("Waiting for browser approval", { exact: true })).toBeVisible();

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
    "Install Dongo in this repository and run dongo connect. Configure the Claude Code MCP connection when prompted.",
  );
});

test("uses the preferred project and renders a live connected installation", async ({ page }) => {
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
  await expect(page.getByText("Agent connected", { exact: true })).toBeVisible();
  await expect(page.getByText("Dongo CLI · Fixture Mac.", { exact: true })).toBeVisible();
  await expect(page.getByText("project · Dongo", { exact: true })).toBeVisible();
  await expect(page.getByText("grant · cli · active", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue to Overview" })).toHaveAttribute(
    "href",
    "/app/fixture-studio/dongo",
  );
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
    "Agent connection status is temporarily unavailable.",
  );
  await expect(page.getByText("fixture status detail must stay hidden")).toBeHidden();

  await page.goto("/connect?scenario=connect-error");
  await expect(page.getByRole("alert")).toHaveText(
    "Create a project before connecting an agent.",
  );
  await expect(page.getByText("fixture connection detail must stay hidden")).toBeHidden();
});

test("returns an unauthenticated connect request to sign-in", async ({ page }) => {
  await page.goto("/connect?scenario=missing-session");
  await expect(page).toHaveURL(
    /\/login\?returnTo=%2Fconnect%3Fscenario%3Dmissing-session$/,
  );
});
