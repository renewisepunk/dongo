import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DONGO_MCP_LIMITS,
  operationResultToToolResult,
} from "../src/index.js";

test("oversized structured output becomes a bounded correctable error", () => {
  const result = operationResultToToolResult(
    "get_overview",
    { ok: true, data: { huge: "x".repeat(10_000) } },
    "request-id",
    { ...DEFAULT_DONGO_MCP_LIMITS, maxResultBytes: 64, maxTextBytes: 256 },
  );
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent, undefined);
  const text = result.content[0];
  assert.equal(text?.type, "text");
  if (text?.type === "text") {
    assert.match(text.text, /result_too_large/);
    assert.ok(new TextEncoder().encode(text.text).byteLength <= 256);
  }
});

test("attachment response emits a resource link without URL text fallback", () => {
  const signedUrl = "https://attachments.example/file?signature=secret";
  const result = operationResultToToolResult(
    "get_attachment",
    {
      ok: true,
      data: {
        attachmentId: "attachment-id",
        filename: "untrusted.txt",
        contentType: "text/plain",
        byteSize: 12,
        downloadUrl: signedUrl,
      },
    },
    "request-id",
    DEFAULT_DONGO_MCP_LIMITS,
  );
  assert.equal(result.isError, undefined);
  assert.equal(result.content[0]?.type, "resource_link");
  assert.equal(JSON.stringify(result.content).includes(signedUrl), true);
  assert.equal(
    result.content.some(
      (content) => content.type === "text" && content.text.includes(signedUrl),
    ),
    false,
  );
});

test("sync snapshot says the server did not mutate the repository", () => {
  const result = operationResultToToolResult(
    "sync_snapshot",
    { ok: true, data: { version: 1, markdown: "# snapshot" } },
    "request-id",
    DEFAULT_DONGO_MCP_LIMITS,
  );
  const content = result.content[0];
  assert.equal(content?.type, "text");
  if (content?.type === "text") {
    assert.match(content.text, /did not write, stage, commit, or push/);
    assert.doesNotMatch(content.text, /# snapshot/);
  }
});
