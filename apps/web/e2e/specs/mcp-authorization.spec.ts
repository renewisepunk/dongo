import { expect, test } from "@playwright/test";

const signedProjectQuery = [
  "client_id=codex",
  "state=fixture-state",
  "resource=https%3A%2F%2Fdev.dongo.so%2Fp%2Ffixture-project%2Fmcp",
  "sig=signed",
  "ba_param=client_id",
  "ba_param=state",
  "ba_param=resource",
].join("&");

const signedConsentQuery = [
  "client_id=claude",
  "scope=dongo%3Awork%3Aread%20offline_access",
  "resource=https%3A%2F%2Fdev.dongo.so%2Fp%2Ffixture-project%2Fmcp",
  "sig=signed",
  "ba_param=client_id",
  "ba_param=scope",
  "ba_param=resource",
].join("&");

test("selects exactly one project before continuing MCP authorization", async ({ page }) => {
  await page.goto(`/oauth/project?${signedProjectQuery}`);
  await expect(page.getByRole("heading", { name: "Choose one dongo project" })).toBeVisible();
  await page.getByRole("radio", { name: /Companion/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  const selected = await page.locator("html").getAttribute("data-fixture-oauth-project");
  expect(JSON.parse(selected ?? "null")).toMatchObject({ publicRef: "companion-project" });
  await expect(page.locator("html")).toHaveAttribute("data-fixture-oauth-continue", `?${signedProjectQuery}`);
  await expect(page.locator("html")).toHaveAttribute(
    "data-fixture-oauth-follow",
    JSON.stringify({ redirect: true, url: "/oauth/consent?fixture=continued" }),
  );
});

test("fails MCP project selection closed for no project, session, or backend", async ({ page }) => {
  await page.goto(`/oauth/project?${signedProjectQuery}&scenario=no-project`);
  await expect(page.getByRole("alert")).toHaveText(
    "You do not have an active project available for this request.",
  );
  await expect(page.getByRole("link", { name: "Create a project" })).toHaveAttribute(
    "href",
    /\/onboarding\?returnTo=/,
  );

  await page.goto(`/oauth/project?${signedProjectQuery}&scenario=project-error`);
  await expect(page.getByRole("alert")).toHaveText(
    "The authorization request could not be continued.",
  );
  await expect(page.getByText("fixture project detail must stay hidden")).toBeHidden();

  await page.goto(`/oauth/project?${signedProjectQuery}&scenario=missing-session`);
  await expect(page).toHaveURL(/\/login\?returnTo=/);
});

test("reviews and allows an MCP host with exact account, project, resource, and scopes", async ({ page }) => {
  await page.goto(`/oauth/consent?${signedConsentQuery}`);
  await expect(page.getByRole("heading", { name: "Allow Claude Code to use dongo?" })).toBeVisible();
  await expect(page.getByText("fixture@example.test", { exact: true })).toBeVisible();
  await expect(page.getByText("https://dev.dongo.so/p/fixture-project/mcp", { exact: true })).toBeVisible();
  await expect(page.getByText("Read project context, work, comments, and attachment metadata.")).toBeVisible();
  await expect(page.getByText("Keep this host authorized until its grant is revoked.")).toBeVisible();

  await page.getByLabel("project").selectOption("companion-project");
  await page.getByRole("button", { name: "Allow access" }).click();

  const selected = await page.locator("html").getAttribute("data-fixture-consent-project");
  expect(JSON.parse(selected ?? "null")).toMatchObject({ publicRef: "companion-project" });
  const decision = await page.locator("html").getAttribute("data-fixture-consent-decision");
  expect(JSON.parse(decision ?? "null")).toMatchObject({ accept: true, search: `?${signedConsentQuery}` });
  await expect(page.locator("html")).toHaveAttribute(
    "data-fixture-consent-follow",
    JSON.stringify({ redirect: true, url: "/fixture/oauth-complete" }),
  );
});

test("denies MCP access without selecting or binding a project", async ({ page }) => {
  await page.goto(`/oauth/consent?${signedConsentQuery}`);
  await page.getByRole("button", { name: "Deny" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-fixture-consent-project", /./);
  const decision = await page.locator("html").getAttribute("data-fixture-consent-decision");
  expect(JSON.parse(decision ?? "null")).toMatchObject({ accept: false });
});

test("fails MCP consent closed for missing client, project, session, or backend", async ({ page }) => {
  await page.goto("/oauth/consent");
  await expect(page.getByRole("heading", { name: "This request can’t be authorized" })).toBeVisible();
  await expect(page.getByText("This request does not identify an OAuth client.")).toBeVisible();

  await page.goto(`/oauth/consent?${signedConsentQuery}&scenario=no-project`);
  await expect(page.getByRole("alert")).toHaveText(
    "You do not have an active project available for this request.",
  );
  await expect(page.getByRole("button", { name: "Allow access" })).toBeDisabled();

  await page.goto(`/oauth/consent?${signedConsentQuery}&scenario=client-error`);
  await expect(page.getByText("This OAuth request could not be loaded.")).toBeVisible();
  await expect(page.getByText("fixture client detail must stay hidden")).toBeHidden();

  await page.goto(`/oauth/consent?${signedConsentQuery}&scenario=missing-session`);
  await expect(page).toHaveURL(/\/login\?returnTo=/);
});
