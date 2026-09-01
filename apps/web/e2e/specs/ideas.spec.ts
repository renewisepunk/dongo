import { expect, test } from "@playwright/test";

function ideaRow(page: import("@playwright/test").Page, ideaId: string) {
  return page.locator(`[data-idea-id="${ideaId}"] .idea-row__select`);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo/ideas");
  await expect(page.getByRole("heading", { name: "Ideas", exact: true })).toBeVisible();
});

test("opens Ideas from the project Overview", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo");
  await page.getByRole("button", { name: "Ideas", exact: true }).click();
  await expect(page).toHaveURL("/app/fixture-studio/dongo/ideas");
  await expect(page.getByText("Possible future work. Agents cannot see or claim Ideas.")).toBeVisible();
});

test("keeps Ideas distinct from agent execution and query-backs selection", async ({ page }) => {
  await expect(page.getByText("Possible future work. Agents cannot see or claim Ideas.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Capture idea" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Open/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("region", { name: "Open Ideas" })).toContainText("Editorial release notes");
  await expect(page.getByText("ready", { exact: true })).toBeHidden();
  await expect(page.getByText("working", { exact: true })).toBeHidden();

  await ideaRow(page, "idea-editorial").click();
  await expect(page).toHaveURL(/\/ideas\?idea=idea-editorial$/);
  await expect(page.getByRole("complementary", { name: "Editorial release notes" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
});

test("captures rich Idea content and a finalized attachment", async ({ page }) => {
  await page.getByRole("button", { name: "Capture idea" }).click();
  const detail = page.getByRole("complementary", { name: "Capture idea" });
  await detail.getByLabel("Title").fill("Release evidence library");
  await detail.getByRole("textbox", { name: "Idea · Markdown supported", exact: true }).fill("## A durable index\n\nCollect evidence without scheduling work.");
  await detail.getByText("Preview formatted Idea").click();
  await expect(detail.getByRole("heading", { name: "A durable index" })).toBeVisible();
  await detail.getByLabel("Context").fill("Useful after several releases have accumulated.");
  await detail.getByLabel(/Links/).fill("https://example.test/evidence");
  await detail.getByLabel("Choose files to add to Idea").setInputFiles({
    name: "evidence-map.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("release evidence"),
  });
  await expect(detail.getByText("ready to save")).toBeVisible();
  await detail.getByRole("button", { name: "Capture idea" }).click();

  await expect(page).toHaveURL(/idea=idea-created-/);
  await expect(page.getByText("Release evidence library", { exact: true }).first()).toBeVisible();
  const payload = await page.evaluate(() => JSON.parse(document.documentElement.dataset.fixtureIdeaCreated ?? "{}"));
  expect(payload).toMatchObject({
    title: "Release evidence library",
    text: "## A durable index\n\nCollect evidence without scheduling work.",
    context: "Useful after several releases have accumulated.",
    links: ["https://example.test/evidence"],
  });
  expect(payload.attachmentIds).toHaveLength(1);
});

test("preserves an unsaved draft per Idea while switching", async ({ page }) => {
  await ideaRow(page, "idea-editorial").click();
  await page.getByLabel("Context").fill("A private draft for editorial notes.");
  await expect(page.getByText("Draft saved on this device.")).toBeVisible();
  await ideaRow(page, "idea-offline").click();
  await expect(page.getByLabel("Title")).toHaveValue("Offline field notes");
  await ideaRow(page, "idea-editorial").click();
  await expect(page.getByLabel("Context")).toHaveValue("A private draft for editorial notes.");
  await expect(page.getByText("Draft restored for this Idea.")).toBeVisible();
});

test("synchronizes a clean editor and retains dirty work through a live conflict", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo/ideas?idea=idea-editorial&scenario=ideas-live");
  await expect(page.getByLabel("Context")).toHaveValue("Keep it useful for people outside the repository.");
  await expect(page.getByLabel("Context")).toHaveValue("Live context from another browser.");
  await expect(page.getByText("Updated from live Ideas activity.")).toBeVisible();

  await page.goto("/app/fixture-studio/dongo/ideas?idea=idea-offline&scenario=ideas-conflict");
  await page.getByLabel("Context").fill("My unsaved travel constraint.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("alert")).toContainText("changed elsewhere");
  await expect(page.getByLabel("Context")).toHaveValue("My unsaved travel constraint.");
  await page.getByRole("button", { name: "Keep my edits" }).click();
  await expect(page.getByLabel("Context")).toHaveValue("My unsaved travel constraint.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved. Connected views update in real time.")).toBeVisible();
});

test("orders Open Ideas and archives then restores without mixing filters", async ({ page }) => {
  const open = page.getByRole("region", { name: "Open Ideas" });
  await expect(open.locator(".idea-row").first()).toContainText("Editorial release notes");
  await page.getByRole("button", { name: "Move Offline field notes earlier" }).click();
  await expect(open.locator(".idea-row").first()).toContainText("Offline field notes");
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.fixtureIdeaOrder)).toContain("idea-offline,idea-editorial");

  await ideaRow(page, "idea-editorial").click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByRole("region", { name: "Open Ideas" })).not.toContainText("Editorial release notes");
  await page.getByRole("tab", { name: /Archived/ }).click();
  await ideaRow(page, "idea-editorial").click();
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByRole("tab", { name: /Open/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("complementary", { name: "Editorial release notes" })).toBeVisible();
});

test("downloads saved attachments with a named control", async ({ page }) => {
  await ideaRow(page, "idea-editorial").click();
  await expect(page.getByText("release-moodboard.png")).toBeVisible();
  await page.getByRole("button", { name: "Download" }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.fixtureIdeaDownloaded)).toBe("attachment-moodboard");
});

test("promotes exactly once with confirmation and linked history", async ({ page }) => {
  await ideaRow(page, "idea-offline").click();
  await page.getByRole("button", { name: "Promote to Inbox" }).click();
  const confirmation = page.getByRole("dialog", { name: "Send this idea to Inbox?" });
  await expect(confirmation).toContainText("This creates one Intake item for agents to triage. The idea becomes Promoted and stays linked.");
  await confirmation.getByRole("button", { name: "Send to Inbox" }).click();

  await expect(page.getByRole("tab", { name: /Promoted/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Already in Inbox" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "View in Inbox" }).first()).toHaveAttribute("href", "/app/fixture-studio/dongo?intake=intake-from-new-promotion");
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.fixtureIdeaPromotions)).toBe("1");
});

test("reports duplicate-safe promotion when the Idea is already linked", async ({ page }) => {
  await page.goto("/app/fixture-studio/dongo/ideas?idea=idea-editorial&scenario=ideas-promotion-existing");
  await page.getByRole("button", { name: "Promote to Inbox" }).click();
  await page.getByRole("dialog", { name: "Send this idea to Inbox?" }).getByRole("button", { name: "Send to Inbox" }).click();
  await expect(page.getByText("Already in Inbox", { exact: true }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.fixtureIdeaPromotions ?? "0")).toBe("0");
});

test("shows promoted provenance in both directions", async ({ page }) => {
  await page.getByRole("tab", { name: /Promoted/ }).click();
  await ideaRow(page, "idea-promoted").click();
  await page.getByRole("link", { name: "View in Inbox" }).first().click();
  await expect(page).toHaveURL(/\?intake=intake-from-idea$/);
  await expect(page.getByRole("region", { name: "Project health digest" }).getByRole("link", { name: "Promoted from Ideas" })).toHaveAttribute(
    "href",
    "/app/fixture-studio/dongo/ideas?filter=promoted&idea=idea-promoted",
  );
});

test("stacks the selected Idea on a narrow viewport without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ideaRow(page, "idea-editorial").click();
  await expect(page.getByRole("complementary", { name: "Editorial release notes" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Open Ideas" })).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
