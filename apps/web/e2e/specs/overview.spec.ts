import { expect, test, type Page } from "@playwright/test";

function workDetail(page: Page, name: string) {
  return page.locator(".detail").filter({
    has: page.getByRole("heading", { name }),
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo");
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
  await expect(menu.getByRole("menuitem", { name: /Help/ })).toBeVisible();
});

test("opens the route-backed help guide from the profile menu", async ({ page }) => {
  await page.getByRole("button", { name: "Profile and settings" }).click();
  await page.getByRole("menuitem", { name: /Help/ }).click();

  await expect(page).toHaveURL(/\/app\/fixture-studio\/dongo\/help$/);
  await expect(page.getByRole("heading", { name: "Keep the loop moving" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Keyboard shortcuts" })).toBeVisible();
  await expect(page.getByText("Command menu", { exact: true })).toBeVisible();
});

test("bounds overview connection and subscription failures", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo?scenario=overview-connect-error");
  await expect(page.getByRole("alert")).toContainText(
    "This project could not be loaded for your account.",
  );
  await expect(page.getByText("fixture overview connection detail must stay hidden")).toBeHidden();
  await expect(page.getByRole("button", { name: "Submit to Inbox" })).toBeDisabled();

  await page.goto("/app/fixture-studio/dongo?scenario=overview-subscription-error");
  await expect(page.getByRole("alert")).toContainText(
    "Live project data is temporarily unavailable.",
  );
  await expect(page.getByText("fixture overview subscription detail must stay hidden")).toBeHidden();
  await expect(page.getByRole("button", { name: "Submit to Inbox" })).toBeDisabled();
});

test("responds to Attention and reconciles the work lane", async ({ page }) => {
  const row = page.locator('[data-work-id="work-needs"]');
  await row.click();
  const dialog = workDetail(page, "Approve the release candidate");
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

test("pastes and submits a finalized image attachment with a comment", async ({ page }) => {
  await page.locator('[data-work-id="work-ready-a"]').click();
  const dialog = workDetail(page, "Verify fixture search");
  const comment = dialog.getByRole("textbox", { name: "Add a comment" });
  await comment.evaluate(async (composer) => {
    const transfer = new DataTransfer();
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#09090b";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#ffb800";
    context.fillRect(36, 36, 8, 288);
    context.fillStyle = "#f2f2f4";
    context.font = "bold 38px sans-serif";
    context.fillText("attachment preview", 72, 190);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), "image/png"));
    transfer.items.add(new File([blob], "comment-image.png", { type: "image/png" }));
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: transfer });
    composer.dispatchEvent(event);
  });

  const commentForm = dialog.locator(".comment-form");
  await expect(commentForm.getByText("comment-image.png", { exact: true })).toBeVisible();
  await expect(commentForm.getByText("ready", { exact: true })).toBeVisible();
  await comment.fill("The screenshot shows the edge case.");
  await comment.press("Control+Enter");

  await expect(page.getByText("Comment added")).toBeVisible();
  await expect(dialog.getByText("The screenshot shows the edge case.")).toBeVisible();
  await expect(dialog.getByText("comment-image.png", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Download comment-image.png" })).toBeVisible();
  const preview = dialog.getByRole("img", { name: "comment-image.png" });
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("loading", "lazy");
  await expect(preview).toHaveAttribute("src", /^blob:/);
  await expect(dialog.getByText(/secure preview and download/)).toBeVisible();

  const previewUrl = await preview.getAttribute("src");
  expect(previewUrl).not.toBeNull();
  await dialog.getByRole("button", { name: /close|back/i }).click();
  await expect.poll(async () => await page.evaluate(async (url) => {
    try {
      await fetch(url);
      return false;
    } catch {
      return true;
    }
  }, previewUrl!)).toBe(true);
});

test("keeps an SVG attachment on the secure download fallback", async ({ page }) => {
  await page.locator('[data-work-id="work-ready-a"]').click();
  const dialog = workDetail(page, "Verify fixture search");
  const comment = dialog.getByRole("textbox", { name: "Add a comment" });
  await comment.evaluate((composer) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([
      '<svg xmlns="http://www.w3.org/2000/svg"><text>untrusted</text></svg>',
    ], "untrusted.svg", { type: "image/svg+xml" }));
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: transfer });
    composer.dispatchEvent(event);
  });

  await expect(dialog.locator(".comment-form").getByText("ready", { exact: true })).toBeVisible();
  await comment.press("Control+Enter");

  const attachment = dialog.locator('.attachment-row:has-text("untrusted.svg")');
  await expect(attachment.getByText("IMG", { exact: true })).toBeVisible();
  await expect(attachment.getByText(/secure download/)).toBeVisible();
  await expect(attachment.getByRole("button", { name: "Download untrusted.svg" })).toBeVisible();
  await expect(attachment.getByRole("img", { name: "untrusted.svg" })).toHaveCount(0);
});

test("routes a detail drop to the comment instead of the Intake composer", async ({ page }) => {
  await page.locator('[data-work-id="work-ready-a"]').click();
  const dialog = workDetail(page, "Verify fixture search");
  const commentForm = dialog.locator(".comment-form");
  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["comment drop"], "comment-drop.txt", { type: "text/plain" }));
    return transfer;
  });

  await commentForm.dispatchEvent("dragenter", { dataTransfer });
  await expect(dialog.getByText("Drop to attach to this comment")).toBeVisible();
  await expect(page.getByText("Drop to attach", { exact: true })).toBeHidden();
  await commentForm.dispatchEvent("drop", { dataTransfer });

  await expect(dialog.getByText("Drop to attach to this comment")).toBeHidden();
  await expect(commentForm.getByText("comment-drop.txt", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Add something" }).getByText("comment-drop.txt", { exact: true })).toBeHidden();
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
  await page.keyboard.press("/");
  const search = page.getByRole("dialog", { name: "Search this project" });
  await expect(search).toBeVisible();
  await search.getByPlaceholder("Search work, comments and intake…").fill("fixture search");
  await expect(search.getByText("Verify fixture search", { exact: true })).toBeVisible();
  await search.getByRole("button", { name: /Verify fixture search/ }).click();
  const detail = workDetail(page, "Verify fixture search");
  await expect(detail).toBeVisible();
  await detail.getByRole("button", { name: /close|back/i }).click();
  await expect(searchButton).toBeFocused();
});

test("uses capture and search shortcuts without hijacking text entry", async ({ page }) => {
  const composer = page.getByRole("textbox", { name: "Add something…" });
  await page.keyboard.press("c");
  await expect(composer).toBeFocused();

  await composer.fill("Keep / inside this draft");
  await page.keyboard.press("/");
  await expect(composer).toHaveValue("Keep / inside this draft/");
  await expect(page.getByRole("dialog", { name: "Search this project" })).toBeHidden();

  await composer.blur();
  await page.keyboard.press("/");
  await expect(page.getByRole("dialog", { name: "Search this project" })).toBeVisible();
});

test("navigates, peeks, opens, and restores selection by keyboard", async ({ page }) => {
  const first = page.locator('[data-work-id="work-needs"]');
  const second = page.locator('[data-work-id="work-working"]');

  await page.keyboard.press("j");
  await expect(first).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(second).toBeFocused();
  await page.keyboard.press("k");
  await expect(first).toBeFocused();

  await page.keyboard.press("Space");
  const peek = workDetail(page, "Approve the release candidate");
  await expect(peek).toBeVisible();
  await expect(peek.getByText("peek · esc closes")).toBeVisible();
  await expect(page).not.toHaveURL(/work=work-needs/);
  await page.keyboard.press("Escape");
  await expect(first).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(peek).toBeVisible();
  await expect(page).toHaveURL(/work=work-needs/);
});

test("uses a wide contextual navigator and non-modal detail article", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const readyLink = page.locator('[data-work-id="work-ready-a"]');
  await expect(readyLink).toHaveAttribute(
    "href",
    "/app/fixture-studio/dongo?work=work-ready-a",
  );

  await readyLink.click();
  const detail = page.getByRole("region", { name: "Verify fixture search" });
  await expect(detail).toBeVisible();
  await expect(detail).not.toHaveAttribute("aria-modal");
  await expect(readyLink).toHaveAttribute("aria-current", "page");

  const layout = await page.locator(".app-page").evaluate((element) => {
    const columns = getComputedStyle(element).gridTemplateColumns
      .split(" ")
      .map((value) => Number.parseFloat(value));
    const overview = element.querySelector<HTMLElement>(".overview-scroll")!;
    const detail = element.querySelector<HTMLElement>(".detail")!;
    return {
      display: getComputedStyle(element).display,
      columns,
      navigatorWidth: overview.getBoundingClientRect().width,
      detailWidth: detail.getBoundingClientRect().width,
      summaryDisplay: getComputedStyle(
        overview.querySelector<HTMLElement>(".work-row__summary")!,
      ).display,
    };
  });
  expect(layout.display).toBe("grid");
  expect(layout.columns).toHaveLength(2);
  expect(layout.navigatorWidth).toBeGreaterThanOrEqual(304);
  expect(layout.navigatorWidth).toBeLessThanOrEqual(384);
  expect(layout.detailWidth).toBeGreaterThan(layout.navigatorWidth);
  expect(layout.summaryDisplay).toBe("none");

  const workingLink = page.locator('[data-work-id="work-working"]');
  await workingLink.click();
  await expect(page.getByRole("region", { name: "Harden attachment delivery" })).toBeVisible();
  await expect(page).toHaveURL(/work=work-working/);
  await expect(workingLink).toHaveAttribute("aria-current", "page");

  await page.goBack();
  await expect(page.getByRole("region", { name: "Verify fixture search" })).toBeVisible();
  await expect(page).toHaveURL(/work=work-ready-a/);

  const close = page.getByRole("region", { name: "Verify fixture search" })
    .getByRole("button", { name: /close|back/i });
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  await expect.poll(async () => page.evaluate(() =>
    !document.activeElement?.closest(".detail"),
  )).toBe(true);
});

test("moves from wide detail to the sidebar, selects with arrows, and re-enters with Enter", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const first = page.locator('[data-work-id="work-ready-a"]');
  const second = page.locator('[data-work-id="work-ready-b"]');

  await first.click();
  const firstDetail = page.getByRole("region", { name: "Verify fixture search" });
  await expect(firstDetail).toBeVisible();
  await firstDetail.getByRole("button", { name: /close|back/i }).focus();

  await page.keyboard.press("ArrowLeft");
  await expect(first).toBeFocused();
  await expect(first.locator("..")).toHaveCSS("outline-style", "solid");
  await expect(first.locator("..")).toHaveCSS("outline-width", "2px");
  await page.keyboard.press("ArrowDown");
  await expect(second).toBeFocused();
  await expect(second.locator("..")).toHaveCSS("outline-style", "solid");
  await expect(second.locator("..")).toHaveCSS("outline-width", "2px");
  await expect(first.locator("..")).toHaveCSS("outline-style", "none");
  await expect(page).toHaveURL(/work=work-ready-a/);

  await page.keyboard.press("Control+k");
  const commands = page.getByRole("dialog", { name: "Command menu" });
  await commands.getByRole("button", { name: /Issue \/ detail/ }).click();
  await expect(firstDetail).toBeFocused();
  await expect(page).toHaveURL(/work=work-ready-a/);

  await page.keyboard.press("ArrowLeft");
  await expect(first).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(second).toBeFocused();

  await page.keyboard.press("ArrowLeft");
  await expect(firstDetail).toBeFocused();
  await expect(page).toHaveURL(/work=work-ready-a/);
  await expect(second.locator("..")).toHaveCSS("outline-style", "none");

  await page.keyboard.press("ArrowLeft");
  await expect(first).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(second).toBeFocused();

  await page.keyboard.press("Enter");
  const secondDetail = page.getByRole("region", { name: "Audit mobile controls" });
  await expect(secondDetail).toBeVisible();
  await expect(second).toHaveAttribute("aria-current", "page");
  await expect(secondDetail).toBeFocused();
  await expect(second.locator("..")).toHaveCSS("outline-style", "none");

  await page.keyboard.press("ArrowLeft");
  await expect(second).toBeFocused();
  await expect(second.locator("..")).toHaveCSS("outline-style", "solid");

  await page.keyboard.press("ArrowLeft");
  await expect(secondDetail).toBeFocused();
  await page.keyboard.press("r");
  await expect(secondDetail.getByPlaceholder("Add a comment…")).toBeFocused();
});

test("moves keyboard selection into capture and draws one outer selection border", async ({ page }) => {
  const composer = page.getByRole("textbox", { name: "Add something…" });
  const first = page.locator('[data-work-id="work-needs"]');

  await page.keyboard.press("j");
  await expect(first).toBeFocused();
  await page.keyboard.press("k");
  await expect(composer).toBeFocused();
  await expect.poll(async () => page.getByRole("region", { name: "Add something" }).evaluate(
    (element) => getComputedStyle(element).borderColor ===
      getComputedStyle(document.documentElement).getPropertyValue("--amber").trim(),
  )).toBe(true);

  await page.keyboard.press("ArrowDown");
  await expect(first).toBeFocused();

  await page.keyboard.press("j");
  await page.keyboard.press("j");
  const ready = page.locator('[data-ready-id="work-ready-a"]');
  const readyOpen = ready.locator(".ready-row__open");
  await expect(readyOpen).toBeFocused();
  await expect.poll(async () => ready.evaluate(
    (element) => getComputedStyle(element).borderColor ===
      getComputedStyle(document.documentElement).getPropertyValue("--amber").trim(),
  )).toBe(true);
  await expect(readyOpen).toHaveCSS("outline-style", "none");
  await expect(readyOpen).toHaveCSS("box-shadow", "none");
});

test("opens the response surface with R and submits composers with Control Enter", async ({ page }) => {
  await page.keyboard.press("j");
  await page.keyboard.press("r");
  const dialog = workDetail(page, "Approve the release candidate");
  const firstOption = dialog.getByRole("button", { name: "Approve staging" });
  await expect(firstOption).toBeFocused();
  await firstOption.click();
  const response = dialog.getByPlaceholder("Add anything the agent should know…");
  await response.fill("Ship the verified candidate.");
  await response.press("Control+Enter");
  await expect(page.getByText("Response sent to your agent")).toBeVisible();

  await dialog.getByPlaceholder("Add a comment…").fill("Record this review note.");
  await dialog.getByPlaceholder("Add a comment…").press("Control+Enter");
  await expect(page.getByText("Comment added")).toBeVisible();
  await expect(dialog.getByText("Record this review note.")).toBeVisible();
});

test("opens the command menu and compact shortcut reference", async ({ page }) => {
  const searchButton = page.getByRole("button", { name: "Search this project" });
  await searchButton.focus();
  await page.keyboard.press("Control+k");

  const commands = page.getByRole("dialog", { name: "Command menu" });
  await expect(commands).toBeVisible();
  await expect(commands.getByRole("textbox", { name: "Filter commands" })).toBeFocused();
  await expect(commands.getByText("agent-owned").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(searchButton).toBeFocused();

  await page.keyboard.press("Shift+/");
  const shortcuts = page.getByRole("dialog", { name: "Move at agent speed" });
  await expect(shortcuts).toBeVisible();
  await expect(shortcuts.getByText("Move to Working", { exact: true })).toBeVisible();
  await expect(shortcuts.getByText("Issue / detail", { exact: true })).toBeVisible();
  await expect(shortcuts.getByText("Command menu", { exact: true })).toBeVisible();
  await shortcuts.getByRole("button", { name: "esc" }).click();
  await expect(searchButton).toBeFocused();
});

test("keeps agent-owned state shortcuts truthful", async ({ page }) => {
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await expect(page.locator('[data-work-id="work-ready-a"]')).toBeFocused();

  await page.keyboard.press("w");
  await expect(page.getByText("Starting work is agent-owned. Ask the connected agent to claim it.")).toBeVisible();
  await page.keyboard.press("d");
  await expect(page.getByText("Only the active agent run can mark work done.")).toBeVisible();
  await page.keyboard.press("e");
  await expect(page.getByText("Human work editing is not available yet. Add a comment with the correction.")).toBeVisible();
});

test("reconciles browser Back and preserves the overview scroll position", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 420 });
  const row = page.locator('[data-work-id="work-done"]');
  await row.scrollIntoViewIfNeeded();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  expect(scrollBefore).toBeGreaterThan(0);

  await row.click();
  const dialog = workDetail(page, "Complete the agent golden journey");
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\?work=work-done$/);
  await page.goBack();

  await expect(dialog).toBeHidden();
  await expect(row).toBeFocused();
  await expect.poll(async () => page.evaluate(() => window.scrollY)).toBe(scrollBefore);
});

test("renders attributed agent progress as safe reviewable Markdown", async ({ page }) => {
  await page.locator('[data-work-id="work-done"]').click();
  const dialog = workDetail(page, "Complete the agent golden journey");
  await expect(dialog.getByText("Codex", { exact: true })).toBeVisible();
  await expect(dialog.getByText("mcp agent", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Verification" })).toBeVisible();
  await expect(dialog.getByText("Shipped the verified path.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Review evidence" })).toHaveAttribute(
    "href",
    "https://example.test/evidence",
  );
  await expect(dialog.getByRole("table")).toContainText("Contracts");
  await expect(dialog.getByText("231 tests passed", { exact: true })).toBeVisible();
  await expect(dialog.locator("img")).toHaveCount(0);
  await expect(dialog.getByText("<img src=x onerror=alert(1)>", { exact: true })).toBeVisible();
});

test("places a prominent copyable issue ID above the work title", async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        async writeText(value: string) {
          document.documentElement.dataset.copiedIssueId = value;
        },
      },
    });
  });
  await page.locator('[data-work-id="work-done"]').click();
  const dialog = workDetail(page, "Complete the agent golden journey");
  const identifier = dialog.getByRole("button", { name: "Copy issue ID DONGO-6" });
  const title = dialog.getByRole("heading", { name: "Complete the agent golden journey" });

  await expect(identifier).toBeVisible();
  const [identifierBox, titleBox, identifierFontSize] = await Promise.all([
    identifier.boundingBox(),
    title.boundingBox(),
    identifier.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
  ]);
  expect(identifierBox).not.toBeNull();
  expect(titleBox).not.toBeNull();
  expect(identifierBox!.y + identifierBox!.height).toBeLessThanOrEqual(titleBox!.y);
  expect(identifierFontSize).toBeGreaterThanOrEqual(15);

  await identifier.click();
  await expect.poll(async () => page.evaluate(() =>
    document.documentElement.dataset.copiedIssueId,
  )).toBe("DONGO-6");
  await expect(page.getByText("DONGO-6 copied", { exact: true })).toBeVisible();
  await expect(identifier).toHaveAttribute("data-copied", "true");
});

test("traps keyboard focus inside work detail", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 720 });
  await page.locator('[data-work-id="work-ready-a"]').click();
  const dialog = workDetail(page, "Verify fixture search");
  await expect(dialog).toHaveAttribute("role", "dialog");
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  const close = dialog.getByRole("button", { name: /close|back/i });
  const attach = dialog.getByRole("button", { name: "+ Attach" });
  await expect(close).toBeFocused();

  await page.keyboard.press("Shift+Tab");
  await expect(attach).toBeFocused();
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
