import { expect, test } from "@playwright/test";

test("saves credential-free project settings with keyboard execution-mode selection", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo/settings");
  await expect(page.getByRole("heading", { name: "General" })).toBeVisible();
  await expect(page.getByLabel("Work identifier code")).toHaveValue("dong");
  const repository = page.getByLabel("Repository URL");
  await repository.fill("https://user:secret@github.com/renewisepunk/dongo");
  await page.getByRole("button", { name: "Save project" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Enter a credential-free HTTP or HTTPS repository URL.",
  );

  await page.getByLabel("Project name").fill("dongo Workspace");
  await repository.fill("github.com/renewisepunk/dongo");
  const manual = page.getByRole("radio", { name: /Manual/ });
  await manual.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: /Autonomous/ })).toBeFocused();
  await page.getByRole("button", { name: "Save project" }).click();
  await expect(page.getByRole("status")).toHaveText("Project settings saved.");
  const update = await page.locator("html").getAttribute("data-fixture-project-update");
  expect(JSON.parse(update ?? "null")).toEqual({
    name: "dongo Workspace",
    repositoryUrl: "https://github.com/renewisepunk/dongo",
    executionMode: "autonomous",
    parallelExecution: {
      enabled: false,
      maxConcurrentRuns: 1,
      requiresIsolatedWorkspaces: true,
    },
  });
});

test("lets an owner opt into isolated parallel work with a safety cap", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo/settings?scenario=parallel-enabled");

  await expect(page.getByLabel("Allow parallel work")).toBeChecked();
  await expect(page.getByLabel("Maximum concurrent runs")).toHaveValue("6");
  await expect(page.getByText("This is a safety cap, not a plan limit.")).toBeVisible();
  await expect(page.getByText(/agent host creates its agents and isolated worktrees/)).toBeVisible();

  await page.getByLabel("Maximum concurrent runs").selectOption("3");
  await page.getByRole("button", { name: "Save project" }).click();
  await expect(page.getByRole("status")).toHaveText("Project settings saved.");
  const update = await page.locator("html").getAttribute("data-fixture-project-update");
  expect(JSON.parse(update ?? "null")).toMatchObject({
    parallelExecution: {
      enabled: true,
      maxConcurrentRuns: 3,
      requiresIsolatedWorkspaces: true,
    },
  });
});

test("revokes installations and creates a one-time scoped CI credential", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo/settings?tab=Agent%20access");
  await expect(page.getByRole("heading", { name: "Agent access" })).toBeVisible();
  await expect(page.getByText("https://dev.dongo.so/p/fixture-project/mcp", { exact: true })).toBeVisible();
  await expect(page.getByText(/dongo CLI/)).toBeVisible();
  await expect(page.getByText(/Claude Code/)).toBeVisible();
  const surfacedCopy = await page.locator("body").innerText();
  const accessibleLabels = await page.locator("[aria-label]").evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("aria-label") ?? "").join("\n"),
  );
  const metadata = await page.locator("meta[content]").evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("content") ?? "").join("\n"),
  );
  const forbiddenBrandCase = new RegExp(["\\bD", "ongo|D", "ONGO", "\\b(?![-_.])"].join(""));
  expect(`${await page.title()}\n${surfacedCopy}\n${accessibleLabels}\n${metadata}`).not.toMatch(
    forbiddenBrandCase,
  );

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

test("opts into automatic Inbox processing on one trusted runner and supports revocation", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo/settings?tab=Local%20runner");
  await expect(page.getByRole("heading", { name: "Local runner" })).toBeVisible();
  await expect(page.getByText("Fixture Mac", { exact: true })).toBeVisible();
  await expect(page.getByText("online · waiting for work", { exact: true })).toBeVisible();
  await expect(page.getByText("Inbox pickup is off.", { exact: false })).toBeVisible();
  await expect(page.getByText(/dongo does not wake a sleeping or powered-off computer/)).toBeVisible();
  await expect(page.getByText("dongo integrate codex --apply", { exact: true })).toBeVisible();
  await expect(page.getByText("dongo integrate claude --apply", { exact: true })).toBeVisible();
  await expect(page.getByText(/never copy the dongo CLI credential into an agent/)).toBeVisible();
  await expect(page.getByText("dongo runner install --harness codex", { exact: true })).toBeVisible();
  await expect(page.getByText("dongo runner install --harness claude", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Process current and future Inbox with Codex" }).click();
  await expect(page.getByRole("status")).toContainText("Codex will process new Inbox items automatically");
  await expect(page.getByRole("status")).toContainText("3 waiting items were queued too");
  expect(JSON.parse(
    await page.locator("html").getAttribute("data-fixture-automatic-intake") ?? "null",
  )).toEqual({
    expectedRevision: 0,
    registrationId: "runner-settings-fixture",
    harness: "codex",
    includeExisting: true,
  });
  await page.getByRole("button", { name: "Revoke" }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("status")).toContainText("Local runner access revoked");
  await expect(page.locator("html")).toHaveAttribute("data-fixture-revoked-runner", "runner-settings-fixture");
});

test("does not present an ask-mode runner as ready for Inbox pickup", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo/settings?tab=Local%20runner&scenario=runner-ask");
  await expect(page.getByText("Inbox pickup is off.", { exact: false })).toBeVisible();
  await expect(page.getByText(/New Inbox items will wait here until an agent checks manually/)).toBeVisible();
  await expect(
    page.getByRole("paragraph").filter({ hasText: "Local approval is required" }).getByRole("code"),
  ).toHaveText("dongo runner configure --approval automatic");
  await expect(page.getByRole("button", { name: /Process current and future Inbox/ })).toBeHidden();
});

test("updates organization membership and confirms removal", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo/settings?tab=Members");
  await page.getByLabel("Organization name").fill("Fixture Collective");
  await expect(page.getByText("fixture-collective", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save organization" }).click();
  await expect(page.getByRole("status")).toHaveText("Organization settings saved.");
  await expect(page).toHaveURL(/\/app\/fixture-collective\/dongo\/settings\?tab=Members$/);
  await expect(page.getByLabel("Organization slug")).toHaveValue("fixture-collective");
  expect(JSON.parse(
    await page.locator("html").getAttribute("data-fixture-organization-update") ?? "null",
  )).toEqual({ name: "Fixture Collective", slug: "fixture-collective" });

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

test("validates an organization address before saving", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo/settings?tab=Members");
  await page.getByLabel("Organization name").fill("你好");
  await page.getByRole("button", { name: "Save organization" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Use at least one letter or number in the organization name.",
  );
  await expect(page).toHaveURL(/\/app\/fixture-studio\/dongo\/settings\?tab=Members$/);
});

test("aligns the member action with its field and stacks both controls on small screens", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 760 });
  await page.goto("/app/fixture-studio/dongo/settings?tab=Members");

  const email = page.getByLabel("Account email");
  const addMember = page.getByRole("button", { name: "Add member" });
  const desktopEmail = await email.boundingBox();
  const desktopButton = await addMember.boundingBox();
  if (!desktopEmail || !desktopButton) throw new Error("Member controls are not visible");
  expect(desktopButton.height).toBe(desktopEmail.height);
  expect(Math.abs(
    (desktopButton.y + desktopButton.height) - (desktopEmail.y + desktopEmail.height),
  )).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileEmail = await email.boundingBox();
  const mobileButton = await addMember.boundingBox();
  if (!mobileEmail || !mobileButton) throw new Error("Mobile member controls are not visible");
  expect(mobileButton.height).toBe(mobileEmail.height);
  expect(Math.abs(mobileButton.width - mobileEmail.width)).toBeLessThanOrEqual(1);
  expect(mobileButton.y).toBeGreaterThan(mobileEmail.y + mobileEmail.height);
  await expect.poll(async () => page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )).toBe(true);
});

test("enforces member read-only administration and shows plan limits", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo/settings?scenario=member");
  await expect(page.getByLabel("Project name")).toBeDisabled();
  await expect(page.getByLabel("Allow parallel work")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save project" })).toBeHidden();

  await page.getByRole("button", { name: "Agent access" }).click();
  await expect(page.getByText("Only an organization owner can view or manage agent installations.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create CI credential" })).toBeHidden();

  await page.getByRole("button", { name: "Plan & storage" }).click();
  await expect(page.getByText("1 / 1", { exact: true })).toBeVisible();
  await expect(page.getByText("2.0 MB / 10 GB", { exact: true })).toBeVisible();
  await expect(page.getByText(/Individual uploads are limited to 250 MB/)).toBeVisible();
  await expect(page.getByText(/using 1 of 1 active projects.*standard Free allowance is 1/)).toBeVisible();
  await expect(page.getByText(/planned \$19 Unlimited plan is available to review/)).toBeVisible();
});

test("shows finite additional project capacity without claiming a paid plan", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo/settings?scenario=capacity-override");
  await page.getByRole("button", { name: "Plan & storage" }).click();

  await expect(page.getByText("2 / 5", { exact: true })).toBeVisible();
  await expect(page.getByText(/Additional capacity has been granted to this organization/)).toBeVisible();
  await expect(page.getByText(/Paid plan/)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Create another project" })).toBeVisible();
});

test("routes a Free owner at the project limit to the upgrade page", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo/settings?tab=Plan%20%26%20storage&scenario=free-limit-owner");

  const upgrade = page.getByRole("link", { name: "Upgrade to add projects" });
  await expect(upgrade).toHaveAttribute("href", "/app/fixture-studio/dongo/upgrade");
  await expect(page.getByRole("link", { name: "Create another project" })).toHaveCount(0);
});

test("archives and restores a project only after explicit confirmation", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo/settings");
  await page.getByRole("button", { name: "Archive dongo" }).click();
  await expect(page.getByText("Archive dongo and revoke agent access?", { exact: true })).toBeVisible();
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

test("bounds installation revocation and credential-copy failures", async ({ page }) => {
  await page.goto(
    "/app/fixture-studio/dongo/settings?tab=Agent%20access&scenario=installation-error",
  );
  await expect(page.getByRole("alert")).toHaveText(
    "Agent installations are temporarily unavailable.",
  );
  await expect(page.getByText("fixture installation detail must stay hidden")).toBeHidden();

  await page.goto(
    "/app/fixture-studio/dongo/settings?tab=Agent%20access&scenario=mutation-error",
  );
  await page.getByRole("button", { name: "Revoke" }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "The installation could not be revoked. Try again.",
  );
  await expect(page.getByText("fixture revoke detail must stay hidden")).toBeHidden();

  await page.goto(
    "/app/fixture-studio/dongo/settings?tab=Agent%20access&scenario=copy-error",
  );
  await page.getByRole("button", { name: "Create CI credential" }).click();
  await page.getByRole("button", { name: "Copy credential" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Copy failed. Select the credential and copy it manually before closing it.",
  );
  await expect(page.getByText("fixture copy detail must stay hidden")).toBeHidden();
  await expect(page.getByLabel("One-time DONGO_TOKEN value")).toHaveValue(
    "fixture-ci-token-not-secret",
  );
});
