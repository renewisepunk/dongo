import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import {
  CURRENT_AGENT_RELEASE_NOTICE,
  ConvexHmacOperationExecutor,
  type OperationExecutionContext,
} from "../src/index.js";

const SECRET = "0123456789abcdef0123456789abcdef";
const TIMESTAMP = 2_000_000_000_000;
const NONCE = "00000000-0000-4000-8000-000000000001";

function executionContext(): OperationExecutionContext {
  return {
    requestId: "request-id",
    projectRef: "project_ref_123",
    signal: new AbortController().signal,
    principal: {
      clientId: "codex-client",
      grantId: "oauth-binding-id",
      installationId: "installation-id",
      installationActorId: "actor-id",
      organizationId: "organization-id",
      projectId: "project-id",
      projectRef: "project_ref_123",
      issuer: "https://auth.example/",
      resource: "https://mcp.example/p/project_ref_123/mcp",
      scopes: ["dongo:work:read", "dongo:attachments:read"],
    },
  };
}

function attachmentData() {
  return {
    attachmentId: "attachment-id",
    filename: "report.pdf",
    contentType: "application/pdf",
    byteSize: 123,
    downloadUrl: "https://downloads.example/attachment-id?signature=short-lived",
    expiresAt: TIMESTAMP + 60_000,
  };
}

test("Convex executor signs the exact versioned envelope without forwarding bearer data", async () => {
  let observed: Request | undefined;
  const executor = new ConvexHmacOperationExecutor({
    convexSiteUrl: new URL("https://example.convex.site/"),
    secret: SECRET,
    nowMs: () => TIMESTAMP,
    nonce: () => NONCE,
    fetch: async function (this: void, input, init) {
      assert.equal(this, undefined);
      observed = new Request(input, init);
      return Response.json({
        ok: true,
        data: attachmentData(),
        requestId: "request-id",
        apiVersion: "v1",
      });
    },
  });

  const result = await executor.execute(
    "get_attachment",
    { attachmentId: "attachment-id" },
    executionContext(),
  );
  assert.equal(result.ok, true);

  assert.ok(observed);
  assert.equal(observed.url, "https://example.convex.site/internal/agent/v1/execute");
  assert.equal(observed.method, "POST");
  assert.equal(observed.redirect, "manual");
  assert.equal(observed.headers.get("x-dongo-key-id"), "v1");
  assert.equal(observed.headers.get("x-dongo-timestamp"), String(TIMESTAMP));
  assert.equal(observed.headers.get("x-dongo-nonce"), NONCE);
  assert.equal(observed.headers.has("authorization"), false);

  const rawBody = await observed.clone().text();
  const envelope = JSON.parse(rawBody) as Record<string, unknown>;
  assert.equal(envelope.version, 1);
  assert.equal(envelope.operation, "get_attachment");
  assert.equal("token" in envelope, false);
  assert.equal(rawBody.includes("opaque-access-token"), false);
  assert.equal(rawBody.includes("npm install"), false);
  assert.deepEqual(envelope.releaseNotice, {
    id: CURRENT_AGENT_RELEASE_NOTICE.id,
    sequence: CURRENT_AGENT_RELEASE_NOTICE.sequence,
  });
  assert.deepEqual(envelope.context, {
    requestId: "request-id",
    installationId: "installation-id",
    actorId: "actor-id",
    organizationId: "organization-id",
    projectId: "project-id",
    projectRef: "project_ref_123",
    clientId: "codex-client",
    grantId: "oauth-binding-id",
    issuer: "https://auth.example/",
    resource: "https://mcp.example/p/project_ref_123/mcp",
    scopes: ["dongo:work:read", "dongo:attachments:read"],
  });

  const bodyHash = createHash("sha256").update(rawBody).digest("hex");
  const canonical = `${TIMESTAMP}\n${NONCE}\nPOST\n/internal/agent/v1/execute\n${bodyHash}`;
  const expectedSignature = createHmac("sha256", SECRET)
    .update(canonical)
    .digest("base64url");
  assert.equal(
    observed.headers.get("x-dongo-signature"),
    expectedSignature,
  );
});

test("Convex executor accepts only the current release delivery marker", async () => {
  for (const [delivery, expected] of [
    [
      {
        id: CURRENT_AGENT_RELEASE_NOTICE.id,
        sequence: CURRENT_AGENT_RELEASE_NOTICE.sequence,
      },
      true,
    ],
    [
      {
        id: "attacker-selected-release",
        sequence: CURRENT_AGENT_RELEASE_NOTICE.sequence,
      },
      false,
    ],
    [
      {
        id: CURRENT_AGENT_RELEASE_NOTICE.id,
        sequence: CURRENT_AGENT_RELEASE_NOTICE.sequence + 1,
      },
      false,
    ],
    [{ id: CURRENT_AGENT_RELEASE_NOTICE.id, sequence: "1" }, false],
  ] as const) {
    const executor = new ConvexHmacOperationExecutor({
      convexSiteUrl: new URL("https://example.convex.site/"),
      secret: SECRET,
      nowMs: () => TIMESTAMP,
      nonce: () => NONCE,
      fetch: async () =>
        Response.json({
          ok: true,
          data: attachmentData(),
          requestId: "request-id",
          apiVersion: "v1",
          releaseNoticeDelivery: delivery,
        }),
    });
    const result = await executor.execute(
      "get_attachment",
      { attachmentId: "attachment-id" },
      executionContext(),
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.releaseNotice !== undefined, expected);
    }
  }
});

test("Convex executor includes the validated external session in signed context", async () => {
  let body: Record<string, unknown> | undefined;
  const executor = new ConvexHmacOperationExecutor({
    convexSiteUrl: new URL("https://example.convex.site/"),
    secret: SECRET,
    nowMs: () => TIMESTAMP,
    nonce: () => NONCE,
    fetch: async (input, init) => {
      body = JSON.parse(await new Request(input, init).text()) as Record<string, unknown>;
      return Response.json({
        ok: false,
        error: { code: "not_found", message: "Not found", retryable: false },
        requestId: "request-id",
      });
    },
  });
  await executor.execute(
    "session_start",
    { externalSessionId: "codex-session" },
    executionContext(),
  );
  assert.equal(
    (body?.context as Record<string, unknown>).externalSessionId,
    "codex-session",
  );
});

test("Convex executor rejects response drift at the runtime contract boundary", async () => {
  const executor = new ConvexHmacOperationExecutor({
    convexSiteUrl: new URL("https://example.convex.site/"),
    secret: SECRET,
    nowMs: () => TIMESTAMP,
    nonce: () => NONCE,
    fetch: async () =>
      Response.json({
        ok: true,
        data: { attachmentId: "missing-required-fields" },
        requestId: "request-id",
        apiVersion: "v1",
      }),
  });
  const result = await executor.execute(
    "get_attachment",
    { attachmentId: "attachment-id" },
    executionContext(),
  );
  assert.equal(result.ok, false);
  if (result.ok === false) {
    assert.equal(result.error.code, "internal");
    assert.equal(result.error.retryable, false);
  }
});

test("Convex executor rejects mismatched request IDs and malformed errors", async () => {
  for (const response of [
    { ok: true, data: attachmentData(), requestId: "wrong", apiVersion: "v1" },
    {
      ok: false,
      error: { code: "INVALID CODE", message: "bad", retryable: false },
      requestId: "request-id",
    },
  ]) {
    const executor = new ConvexHmacOperationExecutor({
      convexSiteUrl: new URL("https://example.convex.site/"),
      secret: SECRET,
      nowMs: () => TIMESTAMP,
      nonce: () => NONCE,
      fetch: async () => Response.json(response),
    });
    const result = await executor.execute(
      "get_attachment",
      { attachmentId: "attachment-id" },
      executionContext(),
    );
    assert.equal(result.ok, false);
    if (result.ok === false) {
      assert.equal(result.error.code, "temporarily_unavailable");
    }
  }
});

test("Convex executor refuses inconsistent trusted context before signing", async () => {
  let called = false;
  const executor = new ConvexHmacOperationExecutor({
    convexSiteUrl: new URL("https://example.convex.site/"),
    secret: SECRET,
    fetch: async () => {
      called = true;
      return Response.json({});
    },
  });
  const base = executionContext();
  const result = await executor.execute(
    "get_attachment",
    { attachmentId: "attachment-id" },
    { ...base, projectRef: "other_project" },
  );
  assert.equal(result.ok, false);
  assert.equal(called, false);
  if (result.ok === false) {
    assert.equal(result.error.code, "unauthorized");
  }
});
