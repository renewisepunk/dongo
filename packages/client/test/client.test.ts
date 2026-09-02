import assert from "node:assert/strict";
import test from "node:test";

import { DongoClient, DongoClientError } from "../src/index.ts";

const tokenProvider = { getAccessToken: async () => "not-a-real-token" };

test("typed client sends bearer auth and parses the v1 envelope", async () => {
  let request: Request | undefined;
  const client = new DongoClient({
    baseUrl: "https://dev.dongo.so/api/agent/v1",
    tokenProvider,
    fetch: async (input, init) => {
      request = new Request(input, init);
      return Response.json({
        ok: true,
        data: { needsYou: [], working: [], ready: [], inbox: [], recentlyDone: [] },
        requestId: "req_1",
        apiVersion: "v1",
      });
    },
  });

  const overview = await client.getOverview();
  assert.deepEqual(overview.ready, []);
  assert.equal(request?.url, "https://dev.dongo.so/api/agent/v1/get_overview");
  assert.equal(request?.method, "GET");
  assert.equal(await request?.text(), "");
  assert.equal(request?.headers.get("authorization"), "Bearer not-a-real-token");
});

test("session start follows the canonical POST contract", async () => {
  let request: Request | undefined;
  const client = new DongoClient({
    baseUrl: "https://dev.dongo.so/api/agent/v1",
    tokenProvider,
    fetch: async (input, init) => {
      request = new Request(input, init);
      return Response.json({
        ok: true,
        data: { project: { name: "dongo", publicRef: "pub_1" }, installation: { id: "actor_1" } },
        requestId: "req_session",
        apiVersion: "v1",
      });
    },
  });

  await client.sessionStart({ externalSessionId: "session-1" });
  assert.equal(request?.method, "POST");
  assert.deepEqual(JSON.parse((await request?.text()) ?? ""), { externalSessionId: "session-1" });
});

test("project updates use bounded cursor query parameters", async () => {
  let request: Request | undefined;
  const client = new DongoClient({
    baseUrl: "https://dev.dongo.so/api/agent/v1",
    tokenProvider,
    fetch: async (input, init) => {
      request = new Request(input, init);
      return Response.json({
        ok: true,
        data: {
          cursor: 8,
          updates: [],
          hasMore: false,
          wait: {
            status: "timed_out",
            requestedSeconds: 20,
            elapsedMilliseconds: 20_000,
          },
          delivery: {
            mechanism: "bounded_pull",
            stoppedAgentsRestarted: false,
          },
          serverTime: 20_000,
        },
        requestId: "req_updates",
        apiVersion: "v1",
      });
    },
  });

  const result = await client.getUpdates({ cursor: 7, waitSeconds: 20 });
  assert.equal(result.cursor, 8);
  assert.equal(request?.method, "GET");
  assert.equal(
    request?.url,
    "https://dev.dongo.so/api/agent/v1/get_updates?cursor=7&waitSeconds=20",
  );
  assert.equal(await request?.text(), "");
});

test("runner waits keep credentials in a bounded POST body", async () => {
  let request: Request | undefined;
  const token = `dng_run_${"a".repeat(11)}_${"b".repeat(43)}`;
  const client = new DongoClient({
    baseUrl: "https://dev.dongo.so/api/agent/v1",
    tokenProvider,
    requestTimeoutMs: 1,
    fetch: async (input, init) => {
      request = new Request(input, init);
      return Response.json({
        ok: true,
        data: {
          registration: {
            id: "registration-1",
            projectId: "project-1",
            installationId: "installation-1",
            label: "Studio Mac",
            platform: "darwin",
            version: "0.1.0",
            harnesses: ["codex"],
            approvalMode: "ask",
            status: "active",
            createdAt: 1,
            updatedAt: 1,
          },
          wait: {
            status: "timed_out",
            requestedSeconds: 20,
            elapsedMilliseconds: 20_000,
          },
          serverTime: 20_000,
        },
        requestId: "req_runner_wait",
        apiVersion: "v1",
      });
    },
  });
  const input = {
    idempotencyKey: "runner-wait-client",
    registrationId: "registration-1",
    token,
    waitSeconds: 20,
    platform: "darwin" as const,
    version: "0.1.0",
    harnesses: ["codex" as const],
    approvalMode: "ask" as const,
  };
  await client.runnerWait(input);
  assert.equal(request?.method, "POST");
  assert.equal(request?.url, "https://dev.dongo.so/api/agent/v1/runner_wait");
  assert.deepEqual(JSON.parse((await request?.text()) ?? ""), input);
  assert.doesNotMatch(request?.url ?? "", /dng_run_/u);
});

test("read operations retry transient failures", async () => {
  let calls = 0;
  const client = new DongoClient({
    baseUrl: "https://dev.dongo.so/api/agent/v1",
    tokenProvider,
    clock: { now: () => 0, sleep: async () => undefined },
    random: () => 0,
    fetch: async () => {
      calls += 1;
      if (calls === 1) return new Response("unavailable", { status: 503 });
      return Response.json({
        ok: true,
        data: { needsYou: [], working: [], ready: [], inbox: [], recentlyDone: [] },
        requestId: "req_2",
        apiVersion: "v1",
      });
    },
  });

  await client.getOverview();
  assert.equal(calls, 2);
});

test("client surfaces stable API errors without reflecting credentials", async () => {
  const client = new DongoClient({
    baseUrl: "https://dev.dongo.so/api/agent/v1",
    tokenProvider,
    fetch: async () =>
      Response.json(
        {
          ok: false,
          error: {
            code: "insufficient_scope",
            message: "not-a-real-token https://example.test/file?signature=secret customer content",
            retryable: false,
          },
          requestId: "req_3",
        },
        { status: 403 },
      ),
  });

  await assert.rejects(client.getOverview(), (error: unknown) => {
    assert.ok(error instanceof DongoClientError);
    assert.equal(error.code, "insufficient_scope");
    assert.equal(error.requestId, "req_3");
    assert.equal(error.message, "The dongo installation needs additional access for this operation.");
    assert.doesNotMatch(error.message, /not-a-real-token|signature=secret|customer content/);
    return true;
  });
});

test("identifier exhaustion is specific, non-retryable, and actionable", async () => {
  let calls = 0;
  const client = new DongoClient({
    baseUrl: "https://dev.dongo.so/api/agent/v1",
    tokenProvider,
    fetch: async () => {
      calls += 1;
      return Response.json(
        {
          ok: false,
          error: {
            code: "identifier_exhausted",
            message: "server detail",
            retryable: false,
            details: {
              maxSequence: 999,
              nextSequence: 1000,
              action: "use_another_project",
            },
          },
          requestId: "req_identifiers",
        },
        { status: 409 },
      );
    },
  });

  await assert.rejects(
    client.createWork({
      idempotencyKey: "identifier-exhaustion-test",
      title: "One too many",
      goal: "Prove the boundary.",
    }),
    (error: unknown) => {
      assert.ok(error instanceof DongoClientError);
      assert.equal(error.code, "identifier_exhausted");
      assert.equal(error.retryable, false);
      assert.equal(
        error.message,
        "This project has used all 999 work identifiers. Use another project for new work.",
      );
      assert.deepEqual(error.details, {
        maxSequence: 999,
        nextSequence: 1000,
        action: "use_another_project",
      });
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("Retry-After replaces jitter rather than adding a second delay", async () => {
  const sleeps: number[] = [];
  let calls = 0;
  const client = new DongoClient({
    baseUrl: "https://dev.dongo.so/api/agent/v1",
    tokenProvider,
    maxAttempts: 2,
    clock: { now: () => 0, sleep: async (milliseconds) => void sleeps.push(milliseconds) },
    fetch: async () => {
      calls += 1;
      if (calls === 1) {
        return Response.json(
          { ok: false, error: { code: "rate_limited", message: "wait", retryable: true }, requestId: "req_wait" },
          { status: 429, headers: { "retry-after": "2" } },
        );
      }
      return Response.json({
        ok: true,
        data: { needsYou: [], working: [], ready: [], inbox: [], recentlyDone: [] },
        requestId: "req_ok",
        apiVersion: "v1",
      });
    },
  });

  await client.getOverview();
  assert.deepEqual(sleeps, [2_000]);
});

test("invalid error envelopes surface a stable client error", async () => {
  const client = new DongoClient({
    baseUrl: "https://dev.dongo.so/api/agent/v1",
    tokenProvider,
    maxAttempts: 1,
    fetch: async () => Response.json({ ok: false, requestId: "req_bad" }, { status: 500 }),
  });
  await assert.rejects(client.getOverview(), (error: unknown) => {
    assert.ok(error instanceof DongoClientError);
    assert.equal(error.code, "http_500");
    assert.equal(error.message, "dongo returned HTTP 500.");
    return true;
  });
});

test("idempotent mutations retry with the same contract key and body", async () => {
  const requests: Request[] = [];
  const client = new DongoClient({
    baseUrl: "https://dev.dongo.so/api/agent/v1",
    tokenProvider,
    clock: { now: () => 0, sleep: async () => undefined },
    fetch: async (input, init) => {
      requests.push(new Request(input, init));
      if (requests.length === 1) throw new Error("response lost after commit");
      return Response.json({
        ok: true,
        data: { id: "work_1", identifier: "dong001", legacyIdentifiers: ["DON-1"], title: "Title", goal: "Goal", state: "ready" },
        requestId: "req_mutation",
        apiVersion: "v1",
      });
    },
  });
  const idempotencyKey = "idem_12345678";
  await client.createWork({ idempotencyKey, title: "Title", goal: "Goal" });
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.headers.get("idempotency-key"), idempotencyKey);
  assert.equal(requests[1]?.headers.get("idempotency-key"), idempotencyKey);
  assert.equal(await requests[0]?.text(), await requests[1]?.text());
});

test("create work sends optional planning context, links, and initial comment", async () => {
  let request: Request | undefined;
  const client = new DongoClient({
    baseUrl: "https://dev.dongo.so/api/agent/v1",
    tokenProvider,
    fetch: async (input, init) => {
      request = new Request(input, init);
      return Response.json({
        ok: true,
        data: { id: "work_1", identifier: "dong001", legacyIdentifiers: ["DON-1"], title: "Title", goal: "Goal", state: "ready" },
        requestId: "req_create_context",
        apiVersion: "v1",
      });
    },
  });
  const input = {
    idempotencyKey: "idem_create_context",
    title: "Title",
    goal: "Goal",
    context: "Compatibility constraints",
    links: ["https://example.com/design"],
    initialComment: "Begin with the client inventory.",
  };

  await client.createWork(input);
  assert.deepEqual(JSON.parse((await request?.text()) ?? ""), input);
});

test("contract-invalid inputs fail before transport", async () => {
  let called = false;
  const client = new DongoClient({
    baseUrl: "https://dev.dongo.so/api/agent/v1",
    tokenProvider,
    fetch: async () => {
      called = true;
      return new Response(null, { status: 500 });
    },
  });
  await assert.rejects(
    client.createWork({ idempotencyKey: "idem_12345678", title: "Missing goal" } as never),
    (error: unknown) => error instanceof DongoClientError && error.code === "validation",
  );
  assert.equal(called, false);
});

test("claim and revision conflicts are never retried even if a server marks them retryable", async () => {
  let calls = 0;
  const client = new DongoClient({
    baseUrl: "https://dev.dongo.so/api/agent/v1",
    tokenProvider,
    fetch: async () => {
      calls += 1;
      return Response.json(
        { ok: false, error: { code: "revision_conflict", message: "stale", retryable: true }, requestId: "req_conflict" },
        { status: 409 },
      );
    },
  });
  await assert.rejects(
    client.updateWork({ idempotencyKey: "idem_12345678", workItemId: "work_1", expectedRevision: 1, latestUpdate: "Progress" }),
    (error: unknown) => error instanceof DongoClientError && error.code === "revision_conflict" && !error.retryable,
  );
  assert.equal(calls, 1);
});

test("already-resolved Attention errors stay specific and non-retryable", async () => {
  let calls = 0;
  const client = new DongoClient({
    baseUrl: "https://dev.dongo.so/api/agent/v1",
    tokenProvider,
    fetch: async () => {
      calls += 1;
      return Response.json(
        {
          ok: false,
          error: { code: "already_resolved", message: "untrusted server detail", retryable: true },
          requestId: "req_resolved",
        },
        { status: 409 },
      );
    },
  });

  await assert.rejects(client.getOverview(), (error: unknown) => {
    assert.ok(error instanceof DongoClientError);
    assert.equal(error.code, "already_resolved");
    assert.equal(error.message, "Attention already resolved.");
    assert.equal(error.retryable, false);
    return true;
  });
  assert.equal(calls, 1);
});
