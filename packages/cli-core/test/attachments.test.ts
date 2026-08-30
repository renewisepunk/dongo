import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CliCoreError, fetchAttachmentFile } from "../src/index.ts";

const access = {
  attachmentId: "attachment_1",
  filename: "../report.txt",
  contentType: "text/plain",
  byteSize: 5,
  downloadUrl: "https://objects.example/report?x-amz-signature=signed-secret",
  expiresAt: 1_788_086_460_000,
};

test("attachment fetch writes a bounded file without forwarding authorization or exposing its URL", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dongo-attachment-"));
  const result = await fetchAttachmentFile({
    repositoryRoot: root,
    access,
    fetch: async (input, init) => {
      assert.match(String(input), /x-amz-signature=signed-secret/);
      assert.equal(new Headers(init?.headers).has("authorization"), false);
      assert.equal(init?.redirect, "error");
      return new Response("hello", { headers: { "content-length": "5" } });
    },
  });
  assert.equal(result.path, path.join(".agent-work", "attachments", "attachment_1-report.txt"));
  assert.equal(await readFile(path.join(root, result.path), "utf8"), "hello");
  assert.doesNotMatch(JSON.stringify(result), /x-amz|signed-secret|objects\.example/);
});

test("attachment size mismatch removes the temporary file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dongo-attachment-size-"));
  await assert.rejects(
    fetchAttachmentFile({
      repositoryRoot: root,
      access,
      fetch: async () => new Response("too long", { headers: { "content-length": "8" } }),
    }),
    (error: unknown) => error instanceof CliCoreError && error.code === "validation",
  );
  const directory = path.join(root, ".agent-work", "attachments");
  assert.deepEqual(await readdir(directory), []);
});

test("attachment fetch refuses symlinked output directories and .git paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dongo-attachment-link-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "dongo-attachment-outside-"));
  await symlink(outside, path.join(root, "linked"));
  await assert.rejects(
    fetchAttachmentFile({ repositoryRoot: root, access, output: "linked/report.txt", fetch: async () => new Response("hello") }),
    /unsafe/,
  );
  await assert.rejects(
    fetchAttachmentFile({ repositoryRoot: root, access, output: ".git/hooks/report", fetch: async () => new Response("hello") }),
    /outside \.git/,
  );
});
