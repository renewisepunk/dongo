import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Add something" })).toBeVisible();
});

test("renders every live work lane without browser errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.name));

  await expect(page.getByText("needs you", { exact: true })).toBeVisible();
  await expect(page.getByText("working", { exact: true })).toBeVisible();
  await expect(page.getByText("ready", { exact: true })).toBeVisible();
  await expect(page.getByText("inbox", { exact: true })).toBeVisible();
  await expect(page.getByText("recently done", { exact: true })).toBeVisible();
  await expect.poll(async () => await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )).toBe(true);
  expect(errors).toEqual([]);
});

test("responds to Attention and reconciles the work lane", async ({ page }) => {
  const row = page.locator('[data-work-id="work-needs"]');
  await row.click();
  const dialog = page.getByRole("dialog", { name: "Approve the release candidate" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Approve staging" }).click();
  await dialog.getByPlaceholder("Add anything the agent should know…").fill(
    "Proceed with the isolated staging rehearsal.",
  );
  await dialog.getByRole("button", { name: "Respond", exact: true }).click();

  await expect(dialog.getByText("✓ answered")).toBeVisible();
  await expect(dialog.getByText(/Approve staging — Proceed with/).first()).toBeVisible();
  await expect(page.getByText("Response sent to your agent")).toBeVisible();
  await dialog.getByRole("button", { name: /close|back/i }).click();
  await expect(page.getByText("needs you", { exact: true })).toBeHidden();
  await expect(row).toBeFocused();
});

test("reconciles optimistic Intake exactly once", async ({ page }) => {
  const composer = page.getByRole("textbox", { name: "Add something…" });
  await composer.fill("Capture this fixture request exactly once");
  await page.getByRole("button", { name: "Submit to Inbox" }).click();

  await expect(page.getByText("Added to Inbox")).toBeVisible();
  await expect(composer).toHaveValue("");
  await expect(page.getByText("Capture this fixture request exactly once", { exact: true })).toHaveCount(1);
});

test("uploads a browser-selected file before Intake submission", async ({ page }) => {
  await page.locator('input[type="file"]').setInputFiles({
    name: "fixture.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Dongo E2E fixture"),
  });
  await expect(page.getByText("fixture.txt", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Add something" }).getByText("ready", { exact: true }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Add something…" }).fill("Intake with an attachment");
  await page.getByRole("button", { name: "Submit to Inbox" }).click();
  await expect(page.getByText("Added to Inbox")).toBeVisible();
  await expect(page.getByText("Intake with an attachment", { exact: true })).toHaveCount(1);
});

test("opens search by keyboard and restores focus after detail close", async ({ page }) => {
  const searchButton = page.getByRole("button", { name: "Search this project" });
  await searchButton.focus();
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: "Search this project" });
  await expect(search).toBeVisible();
  await search.getByPlaceholder("Search work, comments and intake…").fill("fixture search");
  await expect(search.getByText("Verify fixture search", { exact: true })).toBeVisible();
  await search.getByRole("button", { name: /Verify fixture search/ }).click();
  const detail = page.getByRole("dialog", { name: "Verify fixture search" });
  await expect(detail).toBeVisible();
  await detail.getByRole("button", { name: /close|back/i }).click();
  await expect(searchButton).toBeFocused();
});

test("reconciles browser Back and preserves the overview scroll position", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 420 });
  const row = page.locator('[data-work-id="work-done"]');
  await row.scrollIntoViewIfNeeded();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  expect(scrollBefore).toBeGreaterThan(0);

  await row.click();
  const dialog = page.getByRole("dialog", { name: "Complete the agent golden journey" });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\?work=work-done$/);
  await page.goBack();

  await expect(dialog).toBeHidden();
  await expect(row).toBeFocused();
  await expect.poll(async () => page.evaluate(() => window.scrollY)).toBe(scrollBefore);
});

test("traps keyboard focus inside work detail", async ({ page }) => {
  await page.locator('[data-work-id="work-ready-a"]').click();
  const dialog = page.getByRole("dialog", { name: "Verify fixture search" });
  const close = dialog.getByRole("button", { name: /close|back/i });
  const comment = dialog.getByPlaceholder("Add a comment…");
  await expect(close).toBeFocused();

  await page.keyboard.press("Shift+Tab");
  await expect(comment).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
});

test("reflows at 320 CSS pixels and honors reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 720 });
  await expect.poll(async () => page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )).toBe(true);

  const motion = await page.locator(".brand__cursor").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      duration: Number.parseFloat(style.animationDuration),
      iterations: style.animationIterationCount,
    };
  });
  expect(motion.duration).toBeLessThanOrEqual(0.001);
  expect(motion.iterations).toBe("1");
});

test("keeps mobile controls reachable without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )).toBe(true);
  const undersized = await page.locator("button:visible, a:visible").evaluateAll((elements) =>
    elements.flatMap((element) => {
      const rect = element.getBoundingClientRect();
      return rect.height < 24 || rect.width < 24
        ? [{
            label: element.getAttribute("aria-label") || element.textContent?.trim() || element.tagName,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          }]
        : [];
    }),
  );
  expect(undersized).toEqual([]);
});
