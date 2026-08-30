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

test("switches projects through an accessible keyboard menu", async ({ page }) => {
  const trigger = page.getByRole("button", { name: "Select organization or project" });
  await trigger.click();
  const menu = page.getByRole("menu", { name: "Organizations and projects" });
  const current = menu.getByRole("menuitemradio", { name: "dongo" });
  const companion = menu.getByRole("menuitemradio", { name: "Companion" });
  await expect(current).toHaveAttribute("aria-checked", "true");
  await expect(current).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(companion).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app\/fixture-studio\/companion$/);
});

test("restores focus when project navigation is dismissed", async ({ page }) => {
  const trigger = page.getByRole("button", { name: "Select organization or project" });
  await trigger.click();
  await expect(page.getByRole("menuitemradio", { name: "dongo" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "Organizations and projects" })).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("shows the authenticated account and organization role", async ({ page }) => {
  await page.getByRole("button", { name: "Profile and settings" }).click();
  const menu = page.getByRole("menu", { name: "Profile and settings" });
  await expect(menu.getByText("Fixture Owner", { exact: true })).toBeVisible();
  await expect(menu.getByText("fixture@example.test", { exact: true })).toBeVisible();
  await expect(menu.getByText("Fixture Studio · owner", { exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Organization settings" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Project settings" })).toBeVisible();
});

test("bounds overview connection and subscription failures", async ({ page }) => {
  await page.goto("/?scenario=overview-connect-error");
  await expect(page.getByRole("alert")).toContainText(
    "This project could not be loaded for your account.",
  );
  await expect(page.getByText("fixture overview connection detail must stay hidden")).toBeHidden();
  await expect(page.getByRole("button", { name: "Submit to Inbox" })).toBeDisabled();

  await page.goto("/?scenario=overview-subscription-error");
  await expect(page.getByRole("alert")).toContainText(
    "Live project data is temporarily unavailable.",
  );
  await expect(page.getByText("fixture overview subscription detail must stay hidden")).toBeHidden();
  await expect(page.getByRole("button", { name: "Submit to Inbox" })).toBeDisabled();
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

test("reorders Ready work by drag and by accessible controls", async ({ page }) => {
  const titles = page.locator('[data-ready-id] .work-row__title');
  await expect(titles).toHaveText(["Verify fixture search", "Audit mobile controls"]);

  const target = page.locator('[data-work-id="work-ready-b"]');
  const targetBounds = await target.boundingBox();
  expect(targetBounds).not.toBeNull();
  await page.locator('[data-work-id="work-ready-a"]').dragTo(target, {
    targetPosition: {
      x: Math.min(120, targetBounds!.width - 2),
      y: targetBounds!.height - 2,
    },
  });
  await expect(titles).toHaveText(["Audit mobile controls", "Verify fixture search"]);
  await expect(page.getByText("Ready order updated")).toBeVisible();

  await page.getByRole("button", { name: "Move Verify fixture search up" }).click();
  await expect(titles).toHaveText(["Verify fixture search", "Audit mobile controls"]);
});

test("uploads a browser-selected file before Intake submission", async ({ page }) => {
  await page.locator('input[type="file"]').setInputFiles({
    name: "fixture.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("dongo E2E fixture"),
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

test("turns the full page into a file drop zone", async ({ page }) => {
  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["Dropped fixture"], "dropped-fixture.txt", { type: "text/plain" }));
    return transfer;
  });
  await page.locator(".app-header").dispatchEvent("dragenter", { dataTransfer });
  await expect(page.getByText("Drop to attach", { exact: true })).toBeVisible();
  await page.locator(".app-header").dispatchEvent("drop", { dataTransfer });
  await expect(page.getByText("Drop to attach", { exact: true })).toBeHidden();
  await expect(page.getByText("dropped-fixture.txt", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Add something" }).getByText("ready", { exact: true }),
  ).toBeVisible();
});

test("attaches a pasted clipboard image to the new issue", async ({ page }) => {
  await page.getByRole("textbox", { name: "Add something…" }).evaluate((composer) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["image bytes"], "pasted-image.png", { type: "image/png" }));
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: transfer });
    composer.dispatchEvent(event);
  });
  await expect(page.getByText("pasted-image.png", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Add something" }).getByText("ready", { exact: true }),
  ).toBeVisible();
});

test("retries an interrupted upload without duplicating the draft", async ({ page }) => {
  const composer = page.getByRole("region", { name: "Add something" });
  await page.locator('input[type="file"]').setInputFiles({
    name: "retry-fixture.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Retry fixture"),
  });
  await expect(composer.getByText("Upload interrupted. Retry when you are online.")).toBeVisible();
  await composer.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(composer.getByText("ready", { exact: true })).toBeVisible();
  await expect(composer.getByText("retry-fixture.txt", { exact: true })).toHaveCount(1);
});

test("cancels an in-flight upload and removes its draft", async ({ page }) => {
  const composer = page.getByRole("region", { name: "Add something" });
  await page.locator('input[type="file"]').setInputFiles({
    name: "slow-fixture.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Slow fixture"),
  });
  await expect(composer.getByRole("progressbar", { name: "Uploading slow-fixture.txt" })).toBeVisible();
  await composer.getByRole("button", { name: "Remove slow-fixture.txt" }).click();
  await expect(composer.getByText("slow-fixture.txt", { exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Submit to Inbox" })).toBeDisabled();
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
