import assert from "node:assert/strict";
import test from "node:test";
import {
  CURRENT_AGENT_RELEASE_NOTICE,
  DEFAULT_DONGO_MCP_LIMITS,
  operationResultToToolResult,
} from "../src/index.js";

test("oversized structured output becomes a bounded correctable error", () => {
  const result = operationResultToToolResult(
    "get_overview",
    {
      ok: true,
      data: { huge: "x".repeat(10_000) },
      releaseNotice: CURRENT_AGENT_RELEASE_NOTICE,
    },
    "request-id",
    { ...DEFAULT_DONGO_MCP_LIMITS, maxResultBytes: 64, maxTextBytes: 256 },
  );
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent, undefined);
  assert.equal(result._meta?.["dongo/releaseNotice"], undefined);
  assert.equal(result.content.length, 1);
  const text = result.content[0];
  assert.equal(text?.type, "text");
  if (text?.type === "text") {
    assert.match(text.text, /result_too_large/);
    assert.ok(new TextEncoder().encode(text.text).byteLength <= 256);
  }
});

test("release notices are additive, bounded, trusted, and consent-first", () => {
  const data = { project: { id: "project-id" }, ready: [] };
  const result = operationResultToToolResult(
    "get_overview",
    { ok: true, data, releaseNotice: CURRENT_AGENT_RELEASE_NOTICE },
    "request-id",
    { ...DEFAULT_DONGO_MCP_LIMITS, maxTextBytes: 1_024 },
  );
  assert.deepEqual(result.structuredContent, data);
  assert.equal(result.isError, undefined);
  assert.equal(result.content.length, 2);
  const notice = result.content[1];
  assert.equal(notice?.type, "text");
  if (notice?.type === "text") {
    assert.match(notice.text, /hosted dongo MCP service is already updated/u);
    assert.match(notice.text, /Only if it is older/u);
    assert.match(notice.text, /explicit user approval/u);
    assert.match(
      notice.text,
      /npm install --global @wisepunk\/dongo@0\.2\.15/u,
    );
    assert.ok(new TextEncoder().encode(notice.text).byteLength <= 1_024);
  }
  assert.deepEqual(result._meta?.["dongo/releaseNotice"], {
    schemaVersion: 1,
    id: CURRENT_AGENT_RELEASE_NOTICE.id,
    sequence: CURRENT_AGENT_RELEASE_NOTICE.sequence,
    cliVersion: "0.2.15",
    consentRequired: true,
  });
});

test("release notices do not alter attachment resource links", () => {
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
      releaseNotice: CURRENT_AGENT_RELEASE_NOTICE,
    },
    "request-id",
    DEFAULT_DONGO_MCP_LIMITS,
  );
  assert.equal(result.content[0]?.type, "resource_link");
  assert.equal(result.content[1]?.type, "text");
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
