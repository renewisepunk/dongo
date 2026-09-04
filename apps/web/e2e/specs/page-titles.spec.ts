import { expect, test } from "@playwright/test";

test("uses descriptive titles for public, authentication, and authorization routes", async ({ page }) => {
  test.slow();
  const routes: Array<[string, string]> = [
    ["/", "Agent work, visible — dongo"],
    ["/get-started", "Get started — dongo"],
    ["/help", "Help — dongo"],
    ["/security", "Security and privacy — dongo"],
    ["/changelog", "Changelog — dongo"],
    ["/login", "Sign in — dongo"],
    ["/open?scenario=missing-session", "Sign in — dongo"],
    ["/onboarding", "Set up a project — dongo"],
    ["/connect", "Connect an agent — dongo"],
    ["/device", "Authorize terminal — dongo"],
    ["/admin", "Platform administration — dongo"],
  ];

  for (const [path, title] of routes) {
    await page.goto(path);
    await expect(page).toHaveTitle(title);
  }

  await page.goto("/login");
  await page.evaluate(() => sessionStorage.setItem("dongo:auth-email", "private@example.test"));
  await page.goto("/auth/code");
  await expect(page).toHaveTitle("Check your email — dongo");
  expect(await page.title()).not.toContain("private@example.test");

  await page.goto("/auth/callback?scenario=token-error");
  await expect(page).toHaveTitle("Sign-in unavailable — dongo");
  await page.goto("/oauth/project?scenario=project-error");
  await expect(page).toHaveTitle("Project selection unavailable — dongo");
  await page.goto("/oauth/consent?scenario=client-error&client_id=private-client");
  await expect(page).toHaveTitle("Authorization unavailable — dongo");
  expect(await page.title()).not.toContain("private-client");
});

test("tracks project surfaces without exposing routed content", async ({ page }) => {
  test.slow();
  const overview = "/app/fixture-studio/dongo";

  await page.goto(overview);
  await expect(page).toHaveTitle("(1) dongo · Overview — dongo");

  await page.goto(`${overview}?search=1`);
  await expect(page).toHaveTitle("(1) dongo · Search — dongo");

  await page.goto(`${overview}?work=dong007`);
  await expect(page).toHaveTitle("(1) dongo · Work — dongo");
  expect(await page.title()).not.toContain("Approve the release candidate");

  await page.goto(`${overview}?intake=intake-waiting`);
  await expect(page).toHaveTitle("(1) dongo · Intake — dongo");
  expect(await page.title()).not.toContain("Investigate intermittent upload failures");

  await page.goto(overview);
  await page.getByRole("button", { name: "New", exact: true }).click();
  await expect(page).toHaveTitle("(1) dongo · New Intake — dongo");

  await page.goto(`${overview}/ideas`);
  await expect(page).toHaveTitle("dongo · Ideas — dongo");
  await page.goto(`${overview}/ideas?idea=new`);
  await expect(page).toHaveTitle("dongo · New Idea — dongo");
  await page.goto(`${overview}/ideas?idea=idea-editorial`);
  await expect(page).toHaveTitle("dongo · Idea — dongo");
  expect(await page.title()).not.toContain("Editorial release notes");

  for (const [path, surface] of [
    [`${overview}/done`, "Completed"],
    [`${overview}/help`, "Help"],
    [`${overview}/settings`, "Settings"],
    [`${overview}/upgrade`, "Upgrade"],
  ] as const) {
    await page.goto(path);
    await expect(page).toHaveTitle(`dongo · ${surface} — dongo`);
  }
});

test("updates titles across project switches and Back navigation", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo");
  await expect(page).toHaveTitle("(1) dongo · Overview — dongo");

  await page.getByRole("button", { name: "Select organization or project" }).click();
  await page.getByRole("menuitemradio", { name: "Companion" }).click();
  await expect(page).toHaveURL("/app/fixture-studio/companion");
  await expect(page).toHaveTitle("(1) Companion · Overview — dongo");

  await page.goBack();
  await expect(page).toHaveURL("/app/fixture-studio/dongo");
  await expect(page).toHaveTitle("(1) dongo · Overview — dongo");

  await page.goto("/app/fixture-studio/dongo/ideas");
  await expect(page).toHaveTitle("dongo · Ideas — dongo");
  await page.goBack();
  await expect(page).toHaveTitle("(1) dongo · Overview — dongo");
});
