import assert from "node:assert/strict";
import { mkdtemp, readFile, mkdir, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { exportSnapshot, renderWorkItem } from "../src/index.ts";

test("rendering is deterministic and protects frontmatter", () => {
  const item = {
    identifier: "DON-1",
    title: "Title\n---\nsecret: nope",
    state: "done",
    goal: "One  \r\nTwo",
    artifacts: [{ title: "Preview", url: "https://example.com/path?token=secret" }],
  };
  const first = renderWorkItem(item);
  const second = renderWorkItem(item);
  assert.equal(first, second);
  assert.match(first, /title: "Title\\n---\\nsecret: nope"/);
  assert.doesNotMatch(first, /token=secret/);
  assert.match(first, /- Preview/);
});

test("snapshot export writes stable files and removes only stale managed files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dongo-export-"));
  const first = await exportSnapshot(root, {
    workItems: [
      { identifier: "DON-2", title: "Second", state: "ready" },
      { identifier: "DON-1", title: "Café / traversal ../", state: "done", outcome: "Fixed." },
    ],
  });
  const manifestOne = await readFile(path.join(root, ".agent-work", "manifest.json"), "utf8");
  const second = await exportSnapshot(root, {
    workItems: [{ identifier: "DON-1", title: "Café / traversal ../", state: "done", outcome: "Fixed." }],
  });
  const manifestTwo = await readFile(path.join(root, ".agent-work", "manifest.json"), "utf8");
  assert.notEqual(manifestOne, manifestTwo);
  assert.deepEqual(second.removed, ["work/DON-2-second.md"]);
  assert.equal(first.files[0]?.path, "work/DON-1-cafe-traversal.md");

  const third = await exportSnapshot(root, {
    workItems: [{ identifier: "DON-1", title: "Café / traversal ../", state: "done", outcome: "Fixed." }],
  });
  assert.equal(await readFile(path.join(root, ".agent-work", "manifest.json"), "utf8"), manifestTwo);
  assert.deepEqual(third.removed, []);
});

test("snapshot export refuses symlinked work directories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dongo-export-link-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "dongo-export-outside-"));
  await mkdir(path.join(root, ".agent-work"));
  await symlink(outside, path.join(root, ".agent-work", "work"));
  await assert.rejects(
    exportSnapshot(root, { workItems: [{ identifier: "DON-1", title: "No escape" }] }),
    /symlink/,
  );
});

test("canonical artifacts, source IDs, and conversation notes export without temporary URLs", () => {
  const markdown = renderWorkItem({
    identifier: "DON-8",
    title: "Canonical snapshot",
    state: "done",
    goal: "Use the shared contract.",
    sourceIntakeIds: ["intake_1", "intake_2"],
    artifacts: [
      { kind: "preview", label: "Preview", url: "https://preview.example/build?x-amz-signature=secret" },
      { kind: "file", label: "Report", repositoryPath: "reports/final.md" },
    ],
    conversation: [{
      actor: { displayName: "Agent" },
      body: "Verified.",
      attachmentIds: ["attachment_image", "attachment_trace"],
    }],
  });
  assert.match(markdown, /intake_1\nintake_2/);
  assert.match(markdown, /- Preview/);
  assert.doesNotMatch(markdown, /x-amz-signature|secret/);
  assert.match(markdown, /Report: `reports\/final\.md`/);
  assert.match(markdown, /Agent: Verified\./);
  assert.match(markdown, /Attachments: attachment_image, attachment_trace/);
  assert.doesNotMatch(markdown, /signature=/);
});

test("filename collision handling is deterministic across snapshot ordering", async () => {
  const left = await mkdtemp(path.join(os.tmpdir(), "dongo-export-order-a-"));
  const right = await mkdtemp(path.join(os.tmpdir(), "dongo-export-order-b-"));
  const first = { id: "work_b", identifier: "DON-9", title: "Collision" };
  const second = { id: "work_a", identifier: "DON-9", title: "Collision" };
  const exportA = await exportSnapshot(left, { workItems: [first, second] });
  const exportB = await exportSnapshot(right, { workItems: [second, first] });
  assert.deepEqual(exportA.files, exportB.files);
  for (const file of exportA.files) {
    assert.equal(
      await readFile(path.join(left, ".agent-work", file.path), "utf8"),
      await readFile(path.join(right, ".agent-work", file.path), "utf8"),
    );
  }
});

test("case-insensitive filename collisions cannot overwrite another item", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dongo-export-case-"));
  const result = await exportSnapshot(root, {
    workItems: [
      { id: "work_a", identifier: "DON-10", title: "Same" },
      { id: "work_b", identifier: "don-10", title: "same" },
    ],
  });
  assert.equal(result.files.length, 2);
  assert.equal(new Set(result.files.map((file) => file.path.toLowerCase())).size, 2);
});
