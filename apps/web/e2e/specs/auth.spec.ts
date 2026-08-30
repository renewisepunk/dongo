import { expect, test } from "@playwright/test";

test("validates email and presents bounded rate-limit errors", async ({ page }) => {
  await page.goto("/login?returnTo=https%3A%2F%2Fevil.example%2Fsteal");
  const email = page.getByLabel("Email address");
  await email.fill("not-an-email");
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("alert")).toHaveText("Enter a valid email address.");

  await email.fill("rate@example.test");
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Too many attempts. Wait a moment, then try again.",
  );
  await expect(page).toHaveURL(/\/login\?/);
});

test("starts Google with only a safe same-origin callback", async ({ page }) => {
  await page.goto("/login?returnTo=%2Fconnect%3Frequest%3Dfixture");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-fixture-google-callback",
    "http://127.0.0.1:4174/auth/callback?returnTo=%2Fconnect%3Frequest%3Dfixture",
  );
});

test("completes the email-code journey and preserves the safe return path", async ({ page }) => {
  await page.goto("/login?returnTo=%2Fconnect%3Frequest%3Dfixture");
  await page.getByLabel("Email address").fill("OWNER@EXAMPLE.TEST");
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page).toHaveURL(
    /\/auth\/code\?returnTo=%2Fconnect%3Frequest%3Dfixture$/,
  );
  await expect(page.getByText("owner@example.test", { exact: true })).toBeVisible();

  const code = page.getByLabel("One-time code");
  await code.fill("bad!");
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Enter the six-character code from your email.",
  );

  await code.fill("BAD123");
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "That code is not correct. Check the email and try again.",
  );

  await code.fill("EXP123");
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "That code has expired. Request a new code.",
  );

  await code.fill("ABC123");
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Fixture authentication complete" })).toBeVisible();
  await expect(page).toHaveURL(
    /\/auth\/callback\?returnTo=%2Fconnect%3Frequest%3Dfixture$/,
  );
});

test("resends an email code without changing the account", async ({ page }) => {
  await page.goto("/login");
  await page.evaluate(() => sessionStorage.setItem("dongo:auth-email", "owner@example.test"));
  await page.goto("/auth/code");
  await page.getByRole("button", { name: "Resend code" }).click();
  await expect(page.getByRole("status")).toHaveText("A new code was sent.");
  await expect(page.getByText("owner@example.test", { exact: true })).toBeVisible();
});

test("returns to sign-in when the code route has no account context", async ({ page }) => {
  await page.goto("/auth/code?returnTo=%2Fconnect");
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fconnect$/);
});
