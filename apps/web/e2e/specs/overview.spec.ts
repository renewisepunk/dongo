import { expect, test, type Page } from "@playwright/test";

function workDetail(page: Page, name: string) {
  return page.locator(".detail").filter({
    has: page.getByRole("heading", { name }),
  });
}

async function openWideOverview(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app/fixture-studio/dongo");
  await page.getByRole("button", { name: "New", exact: true }).click();
  const composer = page.getByRole("textbox", { name: "Add something…" });
  await expect(composer).toBeVisible();
  await composer.blur();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo");
  await expect(page.getByRole("button", { name: "New", exact: true })).toHaveText("+ New");
  await expect(page.getByRole("region", { name: "Add something" })).toBeHidden();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await expect(page.getByRole("region", { name: "Add something" })).toBeVisible();
  await page.getByRole("textbox", { name: "Add something…" }).blur();
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
  await expect(page.getByText("recently closed", { exact: true })).toBeVisible();
  await expect.poll(async () => await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )).toBe(true);
  expect(errors).toEqual([]);
});

test("keeps Needs You first and carries its live count in the page title", async ({ page }) => {
  const needsYou = page.locator(".work-section--attention");
  const composer = page.getByRole("region", { name: "Add something" });
  const activity = page.getByRole("region", { name: "agent activity" });

  await expect(page).toHaveTitle("(1) needs you — dongo");
  await expect.poll(async () => await needsYou.evaluate((element) => {
    const needsTop = element.getBoundingClientRect().top;
    const composerTop = document.querySelector(".composer")?.getBoundingClientRect().top ?? Infinity;
    const activityTop = document.querySelector(".concurrent-activity")?.getBoundingClientRect().top ?? Infinity;
    return needsTop < composerTop && needsTop < activityTop;
  })).toBe(true);

  await page.locator('[data-work-id="work-needs"]').click();
  const detail = workDetail(page, "Approve the release candidate");
  await detail.getByRole("button", { name: "Approve staging" }).click();
  await detail.getByRole("button", { name: "Respond", exact: true }).click();
  await expect(needsYou).toBeHidden();
  await expect(page).toHaveTitle("overview — dongo");
});

test("requests desktop permission from a gesture and deduplicates private native alerts", async ({ page }) => {
  await page.addInitScript(() => {
    class FixtureNotification {
      static permission: NotificationPermission = "default";
      static async requestPermission(): Promise<NotificationPermission> {
        document.documentElement.dataset.fixtureNotificationPermissionRequests = String(
          Number(document.documentElement.dataset.fixtureNotificationPermissionRequests ?? "0") + 1,
        );
        FixtureNotification.permission = "granted";
        return "granted";
      }

      onclick: (() => void) | null = null;

      constructor(title: string, options?: NotificationOptions) {
        document.documentElement.dataset.fixtureNotificationCount = String(
          Number(document.documentElement.dataset.fixtureNotificationCount ?? "0") + 1,
        );
        document.documentElement.dataset.fixtureNotificationTitle = title;
        document.documentElement.dataset.fixtureNotificationBody = options?.body ?? "";
        document.documentElement.dataset.fixtureNotificationTag = options?.tag ?? "";
      }

      close() {}
    }
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: FixtureNotification,
    });
  });
  await page.goto("/app/fixture-studio/dongo?scenario=owner-attention-live");

  const alerts = page.locator(".attention-alerts__button");
  await expect(alerts).toBeVisible();
  await expect(alerts).toHaveAccessibleName("turn on desktop alerts");
  expect(await page.evaluate(() =>
    document.documentElement.dataset.fixtureNotificationPermissionRequests,
  )).toBeUndefined();
  await alerts.click();
  await expect(alerts).toHaveAttribute("aria-pressed", "true");
  await expect(alerts).toHaveText("desktop alerts on");
  expect(await page.evaluate(() =>
    document.documentElement.dataset.fixtureNotificationPermissionRequests,
  )).toBe("1");

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    Object.defineProperty(document, "hasFocus", {
      configurable: true,
      value: () => false,
    });
    window.dispatchEvent(new Event("dongo:test:publish-owner-attention"));
    window.dispatchEvent(new Event("dongo:test:publish-owner-attention"));
  });

  await expect.poll(async () => await page.evaluate(() =>
    document.documentElement.dataset.fixtureNotificationCount,
  )).toBe("1");
  expect(await page.evaluate(() => ({
    title: document.documentElement.dataset.fixtureNotificationTitle,
    body: document.documentElement.dataset.fixtureNotificationBody,
    tag: document.documentElement.dataset.fixtureNotificationTag,
  }))).toEqual({
    title: "dongo needs you",
    body: "A new action is waiting. Open dongo to review it.",
    tag: "dongo-needs-you",
  });
  await expect(page).toHaveTitle("(2) needs you — dongo");
});

test("does not repeat a denied desktop notification request", async ({ page }) => {
  await page.addInitScript(() => {
    class DeniedNotification {
      static permission: NotificationPermission = "default";
      static async requestPermission(): Promise<NotificationPermission> {
        DeniedNotification.permission = "denied";
        return "denied";
      }
    }
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: DeniedNotification,
    });
  });
  await page.goto("/app/fixture-studio/dongo");

  await page.getByRole("button", { name: "turn on desktop alerts" }).click();
  await expect(page.getByRole("button", { name: "turn on desktop alerts" })).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText(
    "Desktop alerts are blocked in browser settings",
  );
});

test("hides the desktop alert control when native notifications are unsupported", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto("/app/fixture-studio/dongo");

  await expect(page.locator(".work-section--attention")).toBeVisible();
  await expect(page.locator(".attention-alerts")).toHaveCount(0);
});

test("shows concurrent agents, safe workspace detail, and live progress", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo?scenario=concurrency-live");
  const activity = page.getByRole("region", { name: "agent activity" });

  await expect(activity).toContainText("1 / 4 active");
  const running = activity.locator('[data-run-id="run-attachments"]');
  const waiting = activity.locator('[data-run-id="run-release"]');
  await expect(running).toContainText("Claude");
  await expect(running).toContainText("dong008");
  await expect(running).toContainText("Running");
  await expect(running).toContainText("Worktree · codex/attachment-delivery");
  await expect(running).toContainText("Lease healthy");
  await expect(waiting).toContainText("Waiting");
  await expect(waiting).toContainText("Isolated workspace");
  await expect(waiting).toContainText("Lease released");
  await expect(running).toContainText("Live progress: retry cancellation verified.");
  await expect(page.locator('[data-work-id="work-working"]')).toBeHidden();
  await expect(page.getByText("working", { exact: true })).toBeHidden();
  await running.click();
  await expect(page.getByRole("region", { name: "Harden attachment delivery" })).toBeVisible();
  await expect(running).toHaveAttribute("aria-current", "page");
});

test("keeps an undisclosed host serial without implying workspace support", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo?scenario=concurrency-undisclosed");
  const run = page.locator('[data-run-id="run-release"]');

  await expect(run).toContainText("Workspace details unavailable");
  await expect(run).toContainText(
    "This host continues serially until it reports isolated-workspace support.",
  );
});

test("keeps Working usable when live agent activity is unavailable", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo?scenario=concurrency-error");
  await expect(page.getByText("Live agent activity is temporarily unavailable.")).toBeVisible();
  await expect(page.locator('[data-work-id="work-working"]')).toBeVisible();
});

test("hands focus to a replacement Run without stealing retained row focus", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo?scenario=concurrency-transition");
  const working = page.locator('[data-work-id="work-working"]');
  await expect(working).toBeVisible();
  await working.focus();
  await expect(working).toBeFocused();

  await page.evaluate(() =>
    window.dispatchEvent(new Event("dongo:test:publish-concurrency")),
  );

  const run = page.locator('[data-run-id="run-attachments"]');
  await expect(working).toBeHidden();
  await expect(run).toBeFocused();

  const needs = page.locator('[data-work-id="work-needs"]');
  await needs.focus();
  await page.evaluate(() =>
    window.dispatchEvent(new Event("dongo:test:publish-concurrency")),
  );
  await expect(needs).toBeFocused();
});

test("uses canonical compact IDs in live rows and links", async ({ page }) => {
  const needs = page.locator('[data-work-id="work-needs"]');
  const ready = page.locator('[data-work-id="work-ready-a"]');

  await expect(needs).toContainText("dong007");
  await expect(needs).toHaveAttribute("href", "/app/fixture-studio/dongo?work=dong007");
  await expect(ready).toContainText("dong009");
  await expect(ready).toHaveAttribute("href", "/app/fixture-studio/dongo?work=dong009");
  await expect(page.locator('[data-work-id="work-done"]')).toContainText("dong006 · 1h");
  await expect(page.getByText("DONGO-7", { exact: true })).toBeHidden();
});

test("queues and cancels Ready work through a truthful live runner state", async ({ page }) => {
  const ready = page.locator('[data-ready-id="work-ready-a"]');
  await ready.locator('[data-work-id="work-ready-a"]').click();
  const detail = workDetail(page, "Verify fixture search");
  await expect(detail.getByText("A compatible runner is online.")).toBeVisible();
  await detail.getByRole("button", { name: "Run with Codex" }).click();
  await expect(detail.getByText("Queued · waiting for an online runner")).toBeVisible();
  await expect(detail.getByText(/asks for approval on its computer/)).toBeHidden();
  await detail.getByRole("button", { name: /close|back/i }).click();
  await expect(ready.getByText("Queued for Codex", { exact: true })).toBeVisible();
  await ready.locator('[data-work-id="work-ready-a"]').click();
  await detail.getByRole("button", { name: "Cancel local run" }).click();
  await expect(detail.getByText("Cancelled", { exact: true })).toBeVisible();
  await detail.getByRole("button", { name: /close|back/i }).click();
  await expect(ready.getByText("Local run cancelled", { exact: true })).toBeVisible();
});

test("closes Ready work as completed while preserving its outcome", async ({ page }) => {
  await page.locator('[data-work-id="work-ready-a"]').click();
  const detail = workDetail(page, "Verify fixture search");
  await detail.getByRole("button", { name: "Set issue outcome", exact: true }).click();
  await detail.getByLabel("Completed").check();
  await detail.getByLabel("Note optional").fill("Verified manually.");
  await detail.getByRole("button", { name: "Mark done" }).click();
  await expect(detail.getByText("Completed", { exact: true })).toBeVisible();
  await expect(detail.getByText("Verified manually.", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.fixtureClosedWork)).toContain('"reason":"completed"');
});

test("dismisses Inbox Intake without deleting its durable detail", async ({ page }) => {
  const row = page.locator('[data-nav-kind="intake"][data-nav-id="intake-waiting"]');
  await row.click();
  const detail = workDetail(page, "Investigate the fixture login screen");
  await detail.getByRole("button", { name: "Set issue outcome", exact: true }).click();
  await detail.getByLabel("Incorrect or added by mistake").check();
  await detail.getByLabel("Note optional").fill("Filed against the wrong project.");
  await detail.getByRole("button", { name: "Close issue", exact: true }).click();
  await expect(detail.getByText("Incorrect or added by mistake", { exact: true })).toBeVisible();
  await expect(row).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.fixtureClosedIntake)).toContain('"reason":"incorrect"');
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

test("shows the current plan allowance and keeps project creation discoverable", async ({ page }) => {
  await page.getByRole("button", { name: "Select organization or project" }).click();
  const menu = page.getByRole("menu", { name: "Organizations and projects" });

  await expect(menu.getByText("Paid plan · 2 active projects", { exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "+ Create project" })).toBeVisible();
  await menu.getByRole("menuitem", { name: "+ Create project" }).click();
  await expect(page).toHaveURL(/\/onboarding\?organization=fixture-studio$/);
});

test("replaces project creation with upgrade when the Free allowance is full", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo?scenario=overview-free-limit");
  await page.getByRole("button", { name: "Select organization or project" }).click();
  const menu = page.getByRole("menu", { name: "Organizations and projects" });

  await expect(menu.getByText("Free plan · 2 of 2 active projects", { exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "+ Create project" })).toHaveCount(0);
  await menu.getByRole("menuitem", { name: "Upgrade to add projects" }).click();
  await expect(page).toHaveURL(/\/app\/fixture-studio\/dongo\/upgrade$/);
});

test("restores focus when project navigation is dismissed", async ({ page }) => {
  const trigger = page.getByRole("button", { name: "Select organization or project" });
  await trigger.click();
  await expect(page.getByRole("menuitemradio", { name: "dongo" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "Organizations and projects" })).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("creates and navigates one level of accessible subtasks", async ({ page }) => {
  await page.locator('[data-work-id="work-ready-a"]').click();
  const parent = workDetail(page, "Verify fixture search");
  const add = parent.getByRole("button", { name: "+ Add subtask" });

  await add.click();
  const title = parent.getByLabel("Title", { exact: true });
  const goal = parent.getByLabel("Goal optional", { exact: true });
  await expect(title).toBeFocused();
  await title.fill("Cover the narrow-screen search path");
  await goal.fill("Verify the child journey independently at mobile widths.");
  await parent.getByRole("button", { name: "Add subtask", exact: true }).click();

  await expect(page.getByRole("status")).toContainText("Subtask added");
  await expect(parent.getByText("0/1 done", { exact: true })).toBeVisible();
  const child = parent.getByRole("button", {
    name: /dong011 Cover the narrow-screen search path ready/i,
  });
  await expect(child).toBeVisible();
  await expect(add).toBeFocused();
  await expect.poll(async () => page.evaluate(() =>
    document.documentElement.dataset.fixtureCreatedSubtask,
  )).toContain('"parentWorkItemId":"work-ready-a"');

  await child.click();
  const childDetail = workDetail(page, "Cover the narrow-screen search path");
  await expect(childDetail.getByText("parent issue", { exact: true })).toBeVisible();
  await expect(childDetail.getByRole("button", {
    name: /dong009 Verify fixture search ready/i,
  })).toBeVisible();
  await expect(childDetail.getByRole("button", { name: /Add subtask/i })).toBeHidden();

  await childDetail.getByRole("button", {
    name: /dong009 Verify fixture search ready/i,
  }).click();
  await expect(workDetail(page, "Verify fixture search")).toBeVisible();
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
  await expect(page.getByRole("list", { name: "Agent setup sequence" }).getByRole("listitem")).toHaveCount(5);
  await expect(page.getByRole("heading", { name: "Keyboard shortcuts" })).toBeVisible();
  await expect(page.getByText("Command menu", { exact: true })).toBeVisible();
});

test("bounds overview connection and subscription failures", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo?scenario=overview-connect-error");
  await expect(page.getByRole("alert")).toContainText(
    "This project could not be loaded for your account.",
  );
  await expect(page.getByText("fixture overview connection detail must stay hidden")).toBeHidden();
  await expect(page.getByRole("button", { name: "New", exact: true })).toBeDisabled();

  await page.goto("/app/fixture-studio/dongo?scenario=overview-subscription-error");
  await expect(page.getByRole("alert")).toContainText(
    "Live project data is temporarily unavailable.",
  );
  await expect(page.getByText("fixture overview subscription detail must stay hidden")).toBeHidden();
  await expect(page.getByRole("button", { name: "New", exact: true })).toBeDisabled();
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
  await expect(dialog.getByText(/next explicit pull.*backoff.*stopped agent/i)).toBeVisible();
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
  await expect(page.getByRole("region", { name: "Add something" })).toBeHidden();
  await expect(page.getByRole("button", { name: "New", exact: true })).toBeFocused();
  await expect(page.getByText("Capture this fixture request exactly once", { exact: true })).toHaveCount(1);
});

test("opens capture on demand and keeps a draft when it is collapsed", async ({ page }) => {
  const composer = page.getByRole("textbox", { name: "Add something…" });
  await composer.fill("Keep this unfinished thought");
  await page.keyboard.press("Escape");

  const newButton = page.getByRole("button", { name: "New", exact: true });
  await expect(newButton).toBeFocused();
  await expect(page.getByText("Draft saved", { exact: true })).toBeVisible();
  await newButton.click();
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue("Keep this unfinished thought");
});

test("gives an empty Inbox item a stable label in the sidebar and detail", async ({ page }) => {
  const fallback = page.getByText("Untitled intake", { exact: true });
  await expect(fallback).toBeVisible();
  await fallback.click();

  const detail = workDetail(page, "Untitled intake");
  await expect(detail).toBeVisible();
  await expect(detail.getByLabel("Text", { exact: true })).toHaveValue("");
  await expect(detail.getByRole("button", { name: "Save changes" })).toBeDisabled();
});

test("explicitly saves Intake text, context, links, and a new image", async ({ page }) => {
  await page.getByText("Investigate the fixture login screen", { exact: true }).click();
  const detail = page.locator(".detail");
  await detail.getByLabel("Text", { exact: true }).fill("Investigate the updated login screen");
  await detail.getByLabel("Context", { exact: true }).fill("Focus on the passwordless return path.");
  await detail.getByLabel(/Links/).fill("https://example.test/auth\nhttps://example.test/repro");
  await detail.getByLabel("Choose files to add to Intake").setInputFiles({
    name: "login-state.png",
    mimeType: "image/png",
    buffer: Buffer.from("fixture image"),
  });

  await expect(detail.getByText(/ready to save/)).toBeVisible();
  await expect(detail.getByText("Unsaved changes.", { exact: true })).toBeVisible();
  await detail.getByRole("button", { name: "Save changes" }).click();

  await expect(detail.getByText("Changes saved. Connected views update in real time.", { exact: true })).toBeVisible();
  await expect(detail.getByText("login-state.png", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Investigate the updated login screen" })).toBeVisible();
  await expect(detail.getByRole("heading", { name: "Investigate the updated login screen" })).toBeVisible();
  const saved = JSON.parse(await page.locator("html").getAttribute("data-fixture-intake-edit") ?? "null");
  expect(saved).toMatchObject({
    intakeId: "intake-waiting",
    expectedRevision: 1,
    text: "Investigate the updated login screen",
    context: "Focus on the passwordless return path.",
    links: ["https://example.test/auth", "https://example.test/repro"],
  });
  expect(saved.addAttachmentIds).toHaveLength(1);
});

test("retains Intake edits through a revision conflict and supports an explicit retry", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo?scenario=intake-edit-conflict");
  await page.getByText("Investigate the fixture login screen", { exact: true }).click();
  const detail = workDetail(page, "Investigate the fixture login screen");
  const context = detail.getByLabel("Context", { exact: true });
  await context.fill("Keep this human context through the conflict.");
  await detail.getByRole("button", { name: "Save changes" }).click();

  await expect(detail.getByRole("alert")).toContainText("changed elsewhere");
  await expect(context).toHaveValue("Keep this human context through the conflict.");
  await detail.getByRole("button", { name: "Keep my edits" }).click();
  await expect(context).toHaveValue("Keep this human context through the conflict.");
  await detail.getByRole("button", { name: "Save changes" }).click();
  await expect(detail.getByText("Changes saved. Connected views update in real time.", { exact: true })).toBeVisible();

  const saved = JSON.parse(await page.locator("html").getAttribute("data-fixture-intake-edit") ?? "null");
  expect(saved).toMatchObject({
    expectedRevision: 2,
    context: "Keep this human context through the conflict.",
  });
});

test("synchronizes a clean Intake editor from live project updates", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo?scenario=intake-edit-live");
  await page.getByText("Investigate the fixture login screen", { exact: true }).click();
  const detail = workDetail(page, "Investigate the fixture login screen");

  await expect(detail.getByLabel("Context", { exact: true })).toHaveValue(
    "Live context added from another browser.",
  );
  await expect(detail.getByText("Updated from live project activity.", { exact: true })).toBeVisible();
});

test("keeps a dirty Intake draft when a live update arrives and can use latest", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo?scenario=intake-edit-live");
  await page.getByText("Investigate the fixture login screen", { exact: true }).click();
  const detail = workDetail(page, "Investigate the fixture login screen");
  const context = detail.getByLabel("Context", { exact: true });
  await context.fill("Keep this local draft until I choose.");

  await expect(detail.getByRole("alert")).toContainText("changed elsewhere");
  await expect(context).toHaveValue("Keep this local draft until I choose.");
  await detail.getByRole("button", { name: "Use latest" }).click();
  await expect(context).toHaveValue("Live context added from another browser.");
  await expect(detail.getByText("Latest version loaded. Your unsaved edits were discarded.", { exact: true })).toBeVisible();
});

test("retains a failed enrichment upload for a focused retry", async ({ page }) => {
  await page.getByText("Investigate the fixture login screen", { exact: true }).click();
  const detail = workDetail(page, "Investigate the fixture login screen");
  await detail.getByLabel("Choose files to add to Intake").setInputFiles({
    name: "retry-intake.png",
    mimeType: "image/png",
    buffer: Buffer.from("retry fixture"),
  });

  await expect(detail.getByText(/Upload interrupted/)).toBeVisible();
  await expect(detail.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await detail.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(detail.getByText(/ready to save/)).toBeVisible();
  await expect(detail.getByRole("button", { name: "Save changes" })).toBeEnabled();
});

test("keeps processed Intake details read-only", async ({ page }) => {
  await page.getByText("Prepare a trustworthy release candidate", { exact: true }).click();
  const detail = workDetail(page, "Prepare a trustworthy release candidate");
  await expect(detail).toBeVisible();
  await expect(detail.getByText("edit intake", { exact: true })).toBeHidden();
  await expect(detail.getByRole("button", { name: "Save changes" })).toBeHidden();
});

test("retains the draft when an agent finishes processing during save", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo?scenario=intake-edit-processed-race");
  await page.getByText("Investigate the fixture login screen", { exact: true }).click();
  const detail = workDetail(page, "Investigate the fixture login screen");
  const context = detail.getByLabel("Context", { exact: true });
  await context.fill("Do not lose this late clarification.");
  await detail.getByRole("button", { name: "Save changes" }).click();

  await expect(detail.getByRole("alert")).toContainText(
    "The agent finished processing this item before your save",
  );
  await expect(context).toHaveValue("Do not lose this late clarification.");
  await expect(context).toBeDisabled();
  await expect(detail.getByText(/submitted details are read-only/i)).toBeVisible();
});

test("does not offer a false agent notification action for waiting Intake", async ({ page }) => {
  await page.getByText("Investigate the fixture login screen", { exact: true }).click();
  const detail = workDetail(page, "Investigate the fixture login screen");

  await expect(detail.getByRole("button", { name: /notify agent/i })).toHaveCount(0);
  await expect(detail.getByText(/agent is waiting for updates|next explicit pull|stopped agent/i)).toHaveCount(0);
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
  await page.getByRole("button", { name: "Close new Intake" }).click();
  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["Dropped fixture"], "dropped-fixture.txt", { type: "text/plain" }));
    return transfer;
  });
  await page.locator(".app-header").dispatchEvent("dragenter", { dataTransfer });
  await expect(page.getByText("Drop to attach", { exact: true })).toBeVisible();
  await page.locator(".app-header").dispatchEvent("drop", { dataTransfer });
  await expect(page.getByText("Drop to attach", { exact: true })).toBeHidden();
  await expect(page.getByRole("region", { name: "Add something" })).toBeVisible();
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

test("uses an attachment filename for attachment-only Intake search results", async ({ page }) => {
  await page.getByRole("button", { name: "Search this project" }).click();
  const search = page.getByRole("dialog", { name: "Search this project" });
  await search.getByPlaceholder("Search work, comments and intake…").fill("capture.png");

  const result = search.getByRole("button", { name: /capture\.png/ });
  await expect(result).toContainText("capture.png");
  await expect(result).not.toContainText("Untitled intake");
});

test("finds an exact legacy ID but opens and displays the canonical ID", async ({ page }) => {
  await page.getByRole("button", { name: "Search this project" }).click();
  const search = page.getByRole("dialog", { name: "Search this project" });
  await search.getByPlaceholder("Search work, comments and intake…").fill("DONGO-6");
  const result = search.getByRole("button", { name: /Complete the agent golden journey/ });

  await expect(result).toContainText("dong006");
  await result.click();
  await expect(page).toHaveURL(/\?work=dong006$/);
  await expect(
    workDetail(page, "Complete the agent golden journey")
      .getByRole("button", { name: "Copy issue ID dong006" }),
  ).toBeVisible();
});

test("keeps migrated legacy work bookmarks usable", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo?work=DONGO-6");
  const detail = workDetail(page, "Complete the agent golden journey");

  await expect(detail).toBeVisible();
  await expect(detail.getByRole("button", { name: "Copy issue ID dong006" })).toBeVisible();
  await expect(page).toHaveURL(/\?work=DONGO-6$/);
});

test("uses capture and search shortcuts without hijacking text entry", async ({ page }) => {
  await page.getByRole("button", { name: "Close new Intake" }).click();
  await page.keyboard.press("c");
  const composer = page.getByRole("textbox", { name: "Add something…" });
  await expect(composer).toBeFocused();

  await composer.fill("Keep / inside this draft");
  await page.keyboard.press("/");
  await expect(composer).toHaveValue("Keep / inside this draft/");
  await expect(page.getByRole("dialog", { name: "Search this project" })).toBeHidden();

  await composer.blur();
  await page.keyboard.press("/");
  await expect(page.getByRole("dialog", { name: "Search this project" })).toBeVisible();
});

test("opens the active issue as keyboard navigation moves through the list", async ({ page }) => {
  await openWideOverview(page);
  const first = page.locator('[data-work-id="work-needs"]');
  const second = page.locator('[data-work-id="work-working"]');

  await page.keyboard.press("j");
  await expect(first).toBeFocused();
  await expect(workDetail(page, "Approve the release candidate")).toBeVisible();
  await expect(first).toHaveAttribute("aria-current", "page");
  await expect(page).toHaveURL(/work=dong007/);

  await page.keyboard.press("ArrowDown");
  await expect(second).toBeFocused();
  await expect(workDetail(page, "Harden attachment delivery")).toBeVisible();
  await expect(second).toHaveAttribute("aria-current", "page");
  await expect(page).toHaveURL(/work=dong008/);

  await page.keyboard.press("k");
  await expect(first).toBeFocused();
  await expect(workDetail(page, "Approve the release candidate")).toBeVisible();
  await expect(first).toHaveAttribute("aria-current", "page");
  await expect(page).toHaveURL(/work=dong007/);

  await page.keyboard.press("Escape");
  await expect(first).toBeFocused();
  await expect(page).not.toHaveURL(/work=/);

  await page.keyboard.press("Space");
  const peek = workDetail(page, "Approve the release candidate");
  await expect(peek).toBeVisible();
  await expect(peek.getByText("peek · esc closes")).toBeVisible();
  await expect(page).not.toHaveURL(/work=dong007/);
  await page.keyboard.press("Escape");
  await expect(first).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(peek).toBeVisible();
  await expect(page).toHaveURL(/work=dong007/);
});

test("uses a wide contextual navigator and non-modal detail article", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const readyLink = page.locator('[data-work-id="work-ready-a"]');
  await expect(readyLink).toHaveAttribute(
    "href",
    "/app/fixture-studio/dongo?work=dong009",
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
  await expect(page).toHaveURL(/work=dong008/);
  await expect(workingLink).toHaveAttribute("aria-current", "page");

  await page.goBack();
  await expect(page.getByRole("region", { name: "Verify fixture search" })).toBeVisible();
  await expect(page).toHaveURL(/work=dong009/);

  const close = page.getByRole("region", { name: "Verify fixture search" })
    .getByRole("button", { name: /close|back/i });
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  await expect.poll(async () => page.evaluate(() =>
    !document.activeElement?.closest(".detail"),
  )).toBe(true);
});

test("focuses the response surface and autosaves drafts independently per task", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.locator('[data-work-id="work-working"]').click();
  const workingComment = workDetail(page, "Harden attachment delivery")
    .getByRole("textbox", { name: "Add a comment" });
  await expect(workingComment).toBeFocused();
  await workingComment.fill("Draft for attachment delivery");
  await expect(page.getByText(/draft saved on this device/)).toBeVisible();

  await page.locator('[data-work-id="work-ready-a"]').click();
  const readyComment = workDetail(page, "Verify fixture search")
    .getByRole("textbox", { name: "Add a comment" });
  await expect(readyComment).toBeFocused();
  await readyComment.fill("Draft for fixture search");

  await page.locator('[data-work-id="work-needs"]').click();
  const attentionResponse = workDetail(page, "Approve the release candidate")
    .getByRole("textbox", { name: /Add anything the agent should know/ });
  await expect(
    workDetail(page, "Approve the release candidate")
      .getByRole("button", { name: "Approve staging" }),
  ).toBeFocused();
  await attentionResponse.fill("Unsent decision context");

  await page.locator('[data-work-id="work-working"]').click();
  await expect(workingComment).toHaveValue("Draft for attachment delivery");
  await page.locator('[data-work-id="work-ready-a"]').click();
  await expect(readyComment).toHaveValue("Draft for fixture search");
  await page.locator('[data-work-id="work-needs"]').click();
  await expect(attentionResponse).toHaveValue("Unsent decision context");
});

test("renders agent changes from live subscriptions without reloading", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo?scenario=live-agent-update");
  await expect(page.getByRole("button", { name: "New", exact: true })).toBeVisible();
  await page.locator('[data-work-id="work-working"]').click();
  const detail = workDetail(page, "Harden attachment delivery");

  await expect(detail.getByText("Testing retry and cancellation semantics.")).toBeVisible();
  await expect(
    detail.getByText("Agent update arrived over the live project subscription."),
  ).toBeVisible();
  await expect(detail.getByText("latest from Agent", { exact: true })).toBeVisible();
  await expect(detail.getByText("latest from dongo CLI", { exact: true })).toBeHidden();
  await expect(page).toHaveURL(/scenario=live-agent-update.*work=dong008|work=dong008.*scenario=live-agent-update/);
});

test("keeps a human draft when an agent wins a simultaneous Attention edit", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo?scenario=attention-conflict");
  await expect(page.getByRole("button", { name: "New", exact: true })).toBeVisible();
  await page.locator('[data-work-id="work-needs"]').click();
  const detail = workDetail(page, "Approve the release candidate");
  const response = detail.getByRole("textbox", {
    name: /Add anything the agent should know/,
  });
  await response.fill("Keep this human context available");
  await detail.getByRole("button", { name: "Respond", exact: true }).click();

  await expect(detail.getByRole("alert")).toContainText(
    "latest agent update is shown and your draft was kept",
  );
  await expect(detail.getByText("The agent continued with the safe default.")).toBeVisible();
  await expect(detail.getByRole("textbox", { name: "Unsent response draft" })).toHaveValue(
    "Keep this human context available",
  );
});

test("renders Intake-related owner Attention directly in Needs You", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo?scenario=owner-attention-intake");
  const card = page.getByRole("article", {
    name: "Choose the project release order",
  });

  await expect(card).toBeVisible();
  await expect(card.getByText("important", { exact: true })).toBeVisible();
  await expect(card.getByText("Codex is asking about Intake.", { exact: false })).toBeVisible();
  await expect(card.getByRole("button", { name: "Hosted services first" })).toBeVisible();
  await expect(page.locator(".work-section--attention .section-heading__count")).toHaveText("2");
  await expect(card.locator("[data-work-id]")).toHaveCount(0);
  await expect(card.getByRole("link")).toHaveCount(0);

  await card.getByRole("textbox", { name: "Response to agent" }).focus();
  await expect.poll(async () => await page.evaluate(() =>
    document.documentElement.dataset.fixtureOwnerAttentionSeen,
  )).toBe("owner-attention-release");
});

test("responds to owner Attention and removes only its Needs You card", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo?scenario=owner-attention");
  const card = page.getByRole("article", {
    name: "Choose the project release order",
  });
  await card.getByRole("button", { name: "Hosted services first" }).click();
  const response = card.getByRole("textbox", { name: "Response to agent" });
  await response.fill("Publish the hosted services, then the exact CLI archive.");
  await response.press("Control+Enter");

  await expect(card).toBeHidden();
  await expect(page.getByRole("status")).toContainText("Response sent to your agent");
  await expect(page.locator('[data-work-id="work-needs"]')).toBeVisible();
  await expect.poll(async () => await page.evaluate(() =>
    JSON.parse(document.documentElement.dataset.fixtureOwnerAttentionResponse ?? "{}"),
  )).toEqual({
    attentionRequestId: "owner-attention-release",
    selectedOption: "Hosted services first",
    body: "Publish the hosted services, then the exact CLI archive.",
  });
});

test("keeps a failed owner Attention draft, clears it after retry, and resolves without response", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo?scenario=owner-attention-error");
  let card = page.getByRole("article", {
    name: "Choose the project release order",
  });
  const response = card.getByRole("textbox", { name: "Response to agent" });
  await response.focus();
  await expect.poll(async () => await page.evaluate(() =>
    document.documentElement.dataset.fixtureOwnerAttentionSeen,
  )).toBe("owner-attention-release");
  await response.fill("Keep this response through a transient failure.");
  await card.getByRole("button", { name: "Respond", exact: true }).click();
  await expect(card.getByRole("alert")).toContainText("your draft was kept");
  await expect(response).toHaveValue("Keep this response through a transient failure.");
  await card.getByRole("button", { name: "Respond", exact: true }).click();
  await expect(card).toBeHidden();

  await page.goto("/app/fixture-studio/dongo?scenario=owner-attention");
  card = page.getByRole("article", { name: "Choose the project release order" });
  await expect(card.getByRole("textbox", { name: "Response to agent" })).toHaveValue("");
  await card.getByRole("button", { name: "Resolve without response" }).click();
  await expect(card).toBeHidden();
  await expect.poll(async () => await page.evaluate(() =>
    document.documentElement.dataset.fixtureOwnerAttentionResolution,
  )).toBe("owner-attention-release");
});

test("keeps wide detail synchronized while arrows move through the sidebar", async ({ page }) => {
  await openWideOverview(page);
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
  const secondDetail = page.getByRole("region", { name: "Audit mobile controls" });
  await expect(secondDetail).toBeVisible();
  await expect(second).toHaveAttribute("aria-current", "page");
  await expect(page).toHaveURL(/work=dong010/);

  await page.keyboard.press("Control+k");
  const commands = page.getByRole("dialog", { name: "Command menu" });
  await commands.getByRole("button", { name: /Issue \/ detail/ }).click();
  await expect(secondDetail).toBeFocused();
  await expect(page).toHaveURL(/work=dong010/);

  await page.keyboard.press("ArrowLeft");
  await expect(second).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(first).toBeFocused();
  await expect(firstDetail).toBeVisible();
  await expect(page).toHaveURL(/work=dong009/);

  await page.keyboard.press("ArrowLeft");
  await expect(firstDetail).toBeFocused();
  await expect(page).toHaveURL(/work=dong009/);

  await page.keyboard.press("ArrowLeft");
  await expect(first).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(second).toBeFocused();
  await expect(secondDetail).toBeVisible();
  await expect(page).toHaveURL(/work=dong010/);

  await page.keyboard.press("Enter");
  await expect(secondDetail).toBeVisible();
  await expect(second).toHaveAttribute("aria-current", "page");
  await expect(secondDetail.getByPlaceholder("Add a comment…")).toBeFocused();

  await secondDetail.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(second).toBeFocused();
  await expect(second.locator("..")).toHaveCSS("outline-style", "solid");

  await page.keyboard.press("ArrowLeft");
  await expect(secondDetail).toBeFocused();
  await page.keyboard.press("r");
  await expect(secondDetail.getByPlaceholder("Add a comment…")).toBeFocused();
});

test("moves keyboard selection into capture and draws one outer selection border", async ({ page }) => {
  await openWideOverview(page);
  const composer = page.getByRole("textbox", { name: "Add something…" });
  const first = page.locator('[data-work-id="work-needs"]');

  await page.keyboard.press("j");
  await expect(first).toBeFocused();
  await page.keyboard.press("k");
  await expect(first).toBeFocused();
  await page.keyboard.press("Escape");
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
  await expect(ready).toHaveCSS("outline-style", "solid");
  await expect(ready).toHaveCSS("outline-width", "2px");
  await expect(readyOpen).toHaveCSS("outline-style", "none");
  await expect(readyOpen).toHaveCSS("box-shadow", "none");
});

test("opens the response surface with R and submits composers with Control Enter", async ({ page }) => {
  await openWideOverview(page);
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
  await openWideOverview(page);
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await expect(page.locator('[data-work-id="work-ready-a"]')).toBeFocused();

  await page.keyboard.press("w");
  await expect(page.getByText("Starting work is agent-owned. Ask the connected agent to claim it.")).toBeVisible();
  await page.keyboard.press("d");
  await expect(page.getByText("Only the active agent run can mark work done.")).toBeVisible();
  await page.keyboard.press("e");
  await expect(page.getByText("Add your correction as a comment for the agent.")).toBeVisible();
  await expect(page.getByPlaceholder("Add a comment…")).toBeFocused();
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
  await expect(page).toHaveURL(/\?work=dong006$/);
  await page.goBack();

  await expect(dialog).toBeHidden();
  await expect(row).toBeFocused();
  await expect.poll(async () => page.evaluate(() => window.scrollY)).toBe(scrollBefore);
});

test("renders attributed agent progress as safe reviewable Markdown", async ({ page }) => {
  await page.locator('[data-work-id="work-done"]').click();
  const dialog = workDetail(page, "Complete the agent golden journey");
  await expect(dialog.locator(".conversation-entry__who").first()).toHaveText("Codex");
  await expect(dialog.locator(".conversation-entry__role")).toHaveText(["agent", "agent"]);
  await expect(dialog.getByText("mcp agent", { exact: true })).toBeHidden();
  const historical = dialog.locator(".conversation-entry", { hasText: "Historical transport-attributed update." });
  await expect(historical.locator(".conversation-entry__who")).toHaveText("Agent");
  await expect(historical).not.toContainText("dongo CLI");
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
  const identifier = dialog.getByRole("button", { name: "Copy issue ID dong006" });
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
  )).toBe("dong006");
  await expect(page.getByText("dong006 copied", { exact: true })).toBeVisible();
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
  await expect(dialog.getByPlaceholder("Add a comment…")).toBeFocused();

  await close.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(attach).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
});

test("keeps the dongo logo cursor animation slow and subtle", async ({ page }) => {
  const motion = await page.locator(".brand__cursor").evaluate((element) => {
    const style = getComputedStyle(element);
    const animation = element.getAnimations()[0];
    const keyframes = animation?.effect instanceof KeyframeEffect
      ? animation.effect.getKeyframes()
      : [];
    const opacities = keyframes
      .map((keyframe) => Number.parseFloat(String(keyframe.opacity)))
      .filter(Number.isFinite);

    return {
      duration: Number.parseFloat(style.animationDuration),
      name: style.animationName,
      opacityFloor: Math.min(...opacities),
      timing: style.animationTimingFunction,
    };
  });

  expect(motion.name).toBe("dongo-cursor-pulse");
  expect(motion.duration).toBeGreaterThanOrEqual(4);
  expect(motion.timing).toBe("ease-in-out");
  expect(motion.opacityFloor).toBeGreaterThanOrEqual(0.5);
  expect(motion.opacityFloor).toBeLessThan(1);
});

test("uses one exact stroke weight for the dongo logo arrow and cursor", async ({ page }) => {
  const weights = await page.locator(".brand").evaluate((brand) => {
    const chevron = brand.querySelector<HTMLElement>(".brand__chevron");
    const cursor = brand.querySelector<HTMLElement>(".brand__cursor");
    if (!chevron || !cursor) throw new Error("Brand marks are missing");

    const measure = () => {
      const chevronStyle = getComputedStyle(chevron);
      const cursorStyle = getComputedStyle(cursor);
      return {
        cursorWidth: Number.parseFloat(cursorStyle.width),
        chevronRightStroke: Number.parseFloat(chevronStyle.borderRightWidth),
        chevronBottomStroke: Number.parseFloat(chevronStyle.borderBottomWidth),
      };
    };

    const compact = measure();
    brand.classList.remove("brand--compact");
    const full = measure();
    brand.classList.add("brand--compact");
    return { compact, full };
  });

  for (const variant of [weights.compact, weights.full]) {
    expect(variant.cursorWidth).toBeGreaterThan(0);
    expect(variant.cursorWidth).toBe(variant.chevronRightStroke);
    expect(variant.cursorWidth).toBe(variant.chevronBottomStroke);
  }
});

test("reflows at 320 CSS pixels and honors reduced motion", async ({ page, browserName }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 720 });
  const brand = page.getByRole("link", { name: "dongo home" });
  const project = page.getByRole("button", { name: "Select organization or project" });
  const ideas = page.getByRole("button", { name: "Ideas", exact: true });
  const search = page.getByRole("button", { name: "Search this project" });
  const profile = page.getByRole("button", { name: "Profile and settings" });
  await expect(search.locator("span").first()).toHaveText("search");
  await expect(search.locator("span").first()).toBeVisible();
  expect(await search.evaluate((element) => getComputedStyle(element, "::before").content)).toBe("none");
  const projectName = project.locator("span").first();
  await projectName.evaluate((element) => {
    element.textContent = "A very long mobile project name that must truncate";
  });
  await expect.poll(async () => page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )).toBe(true);
  const projectNameMetrics = await projectName.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    text: element.textContent,
  }));
  expect(projectNameMetrics.scrollWidth, JSON.stringify(projectNameMetrics))
    .toBeGreaterThan(projectNameMetrics.clientWidth);

  await brand.focus();
  await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
  await expect(project).toBeFocused();
  await project.click();
  const projectMenu = page.getByRole("menu", { name: "Organizations and projects" });
  await expect(projectMenu).toBeVisible();
  expect(Number.parseFloat(await projectMenu.evaluate((element) => getComputedStyle(element).animationDuration)))
    .toBeLessThanOrEqual(0.001);
  await page.keyboard.press("Escape");
  await expect(project).toBeFocused();
  await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
  await expect(ideas).toBeFocused();
  await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
  await expect(search).toBeFocused();
  await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
  await expect(profile).toBeFocused();
  await profile.click();
  const profileMenu = page.getByRole("menu", { name: "Profile and settings" });
  await expect(profileMenu).toBeVisible();
  expect(Number.parseFloat(await profileMenu.evaluate((element) => getComputedStyle(element).animationDuration)))
    .toBeLessThanOrEqual(0.001);
  await page.keyboard.press("Escape");
  await expect(profile).toBeFocused();

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

test("keeps mobile controls reachable without horizontal overflow", async ({ page, browserName }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const brand = page.getByRole("link", { name: "dongo home" });
  const projectMenu = page.getByRole("button", { name: "Select organization or project" });
  const ideas = page.getByRole("button", { name: "Ideas", exact: true });
  const search = page.getByRole("button", { name: "Search this project" });
  const profile = page.getByRole("button", { name: "Profile and settings" });
  const projectName = projectMenu.locator("span").first();
  await projectName.evaluate((element) => {
    element.textContent = "An unusually long project name for a narrow viewport";
  });
  await expect.poll(async () => await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )).toBe(true);
  const projectNameMetrics = await projectName.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    text: element.textContent,
  }));
  expect(projectNameMetrics.scrollWidth, JSON.stringify(projectNameMetrics))
    .toBeGreaterThan(projectNameMetrics.clientWidth);

  const [brandBounds, projectBounds, ideasBounds, searchBounds, profileBounds] = await Promise.all([
    brand.boundingBox(),
    projectMenu.boundingBox(),
    ideas.boundingBox(),
    search.boundingBox(),
    profile.boundingBox(),
  ]);
  if (!brandBounds || !projectBounds || !ideasBounds || !searchBounds || !profileBounds) {
    throw new Error("Mobile header controls are not visible");
  }
  expect(Math.abs(brandBounds.y - profileBounds.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(projectBounds.y - ideasBounds.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(projectBounds.y - searchBounds.y)).toBeLessThanOrEqual(1);
  expect(projectBounds.y).toBeGreaterThanOrEqual(brandBounds.y + brandBounds.height + 4);
  expect(Math.abs(projectBounds.x - brandBounds.x)).toBeLessThanOrEqual(1);
  expect(Math.abs((searchBounds.x + searchBounds.width) - (profileBounds.x + profileBounds.width)))
    .toBeLessThanOrEqual(1);

  await brand.focus();
  await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
  await expect(projectMenu).toBeFocused();
  await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
  await expect(ideas).toBeFocused();
  await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
  await expect(search).toBeFocused();
  await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
  await expect(profile).toBeFocused();

  await projectMenu.click();
  const menu = page.getByRole("menu", { name: "Organizations and projects" });
  await expect(menu).toBeVisible();
  const [headerBounds, menuBounds] = await Promise.all([
    page.locator(".app-header--overview").boundingBox(),
    menu.boundingBox(),
  ]);
  if (!headerBounds || !menuBounds) throw new Error("Mobile project menu is not visible");
  expect(menuBounds.y).toBeGreaterThanOrEqual(headerBounds.y + headerBounds.height - 1);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(projectMenu).toBeFocused();

  await profile.click();
  const profileMenu = page.getByRole("menu", { name: "Profile and settings" });
  await expect(profileMenu).toBeVisible();
  await expect.poll(async () => await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )).toBe(true);
  await page.keyboard.press("Escape");
  await expect(profileMenu).toBeHidden();
  await expect(profile).toBeFocused();

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
