import { expect, test } from "@playwright/test";

test("saves credential-free project settings with keyboard execution-mode selection", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo/settings");
  await expect(page.getByRole("heading", { name: "General" })).toBeVisible();
  const repository = page.getByLabel("Repository URL");
  await repository.fill("https://user:secret@github.com/renewisepunk/dongo");
  await page.getByRole("button", { name: "Save project" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Enter a credential-free HTTP or HTTPS repository URL.",
  );

  await page.getByLabel("Project name").fill("Dongo Workspace");
  await repository.fill("github.com/renewisepunk/dongo");
  const manual = page.getByRole("radio", { name: /Manual/ });
  await manual.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: /Autonomous/ })).toBeFocused();
  await page.getByRole("button", { name: "Save project" }).click();
  await expect(page.getByRole("status")).toHaveText("Project settings saved.");
  const update = await page.locator("html").getAttribute("data-fixture-project-update");
  expect(JSON.parse(update ?? "null")).toEqual({
    name: "Dongo Workspace",
    repositoryUrl: "https://github.com/renewisepunk/dongo",
    executionMode: "autonomous",
  });
});

test("revokes installations and creates a one-time scoped CI credential", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo/settings?tab=Agent%20access");
  await expect(page.getByRole("heading", { name: "Agent access" })).toBeVisible();
  await expect(page.getByText("https://dev.dongo.so/p/fixture-project/mcp", { exact: true })).toBeVisible();
  await expect(page.getByText(/Dongo CLI/)).toBeVisible();
  await expect(page.getByText(/Claude Code/)).toBeVisible();

  await page.getByRole("button", { name: "Revoke" }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("status")).toHaveText("Agent access revoked.");
  await expect(page.locator("html")).toHaveAttribute(
    "data-fixture-revoked-installation",
    "installation-cli",
  );

  await page.getByLabel("Credential name").fill("Release CI");
  await page.getByLabel(/Read attachments/).uncheck();
  await page.getByRole("button", { name: "Create CI credential" }).click();
  await expect(page.getByLabel("One-time DONGO_TOKEN value")).toHaveValue(
    "fixture-ci-token-not-secret",
  );
  const created = await page.locator("html").getAttribute("data-fixture-service-credential");
  expect(JSON.parse(created ?? "null")).toEqual({
    label: "Release CI",
    scopes: ["dongo:work:read", "dongo:work:write"],
  });
  await page.getByRole("button", { name: "Copy credential" }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-fixture-settings-clipboard",
    "fixture-ci-token-not-secret",
  );
  await page.getByRole("button", { name: "I have stored it" }).click();
  await expect(page.getByLabel("One-time DONGO_TOKEN value")).toBeHidden();
});

test("updates organization membership and confirms removal", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo/settings?tab=Members");
  await page.getByLabel("Organization name").fill("Fixture Collective");
  await page.getByRole("button", { name: "Save organization" }).click();
  await expect(page.getByRole("status")).toHaveText("Organization settings saved.");
  await expect(page.locator("html")).toHaveAttribute(
    "data-fixture-organization-update",
    "Fixture Collective",
  );

  await page.getByLabel("Account email").fill("new@example.test");
  await page.getByRole("button", { name: "Add member" }).click();
  await expect(page.getByRole("status")).toHaveText("Member access added.");
  await expect(page.getByText("Added Member", { exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-fixture-added-member", "new@example.test");

  const memberRow = page.getByText("Fixture Member", { exact: true }).locator("..", { hasText: "member@example.test" }).locator("..");
  await memberRow.getByRole("button", { name: "Remove" }).click();
  await memberRow.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("status")).toHaveText("Member access removed.");
  await expect(page.locator("html")).toHaveAttribute("data-fixture-removed-member", "membership-member");
});

test("enforces member read-only administration and shows plan limits", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo/settings?scenario=member");
  await expect(page.getByLabel("Project name")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save project" })).toBeHidden();

  await page.getByRole("button", { name: "Agent access" }).click();
  await expect(page.getByText("Only an organization owner can view or manage agent installations.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create CI credential" })).toBeHidden();

  await page.getByRole("button", { name: "Plan & storage" }).click();
  await expect(page.getByText("1 / 1", { exact: true })).toBeVisible();
  await expect(page.getByText("2.0 MB / 10 GB", { exact: true })).toBeVisible();
  await expect(page.getByText(/Individual uploads are limited to 250 MB/)).toBeVisible();
});

test("archives and restores a project only after explicit confirmation", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo/settings");
  await page.getByRole("button", { name: "Archive Dongo" }).click();
  await expect(page.getByText("Archive Dongo and revoke agent access?", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Yes, archive" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.locator("html")).toHaveAttribute("data-fixture-archived-project", "true");

  await page.goto("/app/fixture-studio/dongo/settings?scenario=archived");
  await expect(page.getByText("This project is archived.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Restore project" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Project restored. Existing agent installations remain revoked.",
  );
  await expect(page.locator("html")).toHaveAttribute("data-fixture-restored-project", "true");
});

test("bounds settings load and mutation failures", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo/settings?scenario=load-error");
  await expect(page.getByRole("alert")).toHaveText(
    "This project could not be loaded for your account.",
  );
  await expect(page.getByText("fixture settings detail must stay hidden")).toBeHidden();

  await page.goto("/app/fixture-studio/dongo/settings");
  await page.getByLabel("Project name").fill("Fail safely");
  await page.getByRole("button", { name: "Save project" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Project settings could not be saved. Try again.",
  );
  await expect(page.getByText("fixture update detail must stay hidden")).toBeHidden();
});
