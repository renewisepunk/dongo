import assert from "node:assert/strict";
import test from "node:test";

import { CliCoreError, DeviceAuthorizationClient } from "../src/index.ts";

test("device authorization opens one complete link and honors pending and slow_down", async () => {
  let now = 0;
  const sleeps: number[] = [];
  const requests: string[] = [];
  const opened: string[] = [];
  let reportedProposal: unknown;
  const responses = [
    Response.json({
      device_code: "device-secret",
      user_code: "ABCD-EFGH",
      verification_uri: "https://dev.dongo.so/device",
      verification_uri_complete: "https://dev.dongo.so/device?user_code=ABCD-EFGH",
      expires_in: 60,
      interval: 1,
    }),
    Response.json({ error: "authorization_pending" }, { status: 400 }),
    Response.json({ error: "slow_down" }, { status: 400 }),
    Response.json({
      access_token: "access-secret",
      refresh_token: "refresh-secret",
      token_type: "Bearer",
      expires_in: 900,
      scope: "offline_access dongo:work:read",
    }),
  ];

  const client = new DeviceAuthorizationClient({
    deviceAuthorizationEndpoint: "https://dev.dongo.so/api/auth/device/code",
    tokenEndpoint: "https://dev.dongo.so/api/auth/oauth2/token",
    clientId: "dongo-cli",
    resource: "https://dev.dongo.so/api/agent/v1",
    scopes: ["dongo:work:read", "offline_access"],
    projectProposal: {
      name: "Dongo",
      repositoryUrl: "https://github.com/renewisepunk/dongo",
      executionMode: "manual",
      projectRef: "project_dongo",
    },
    browserOpener: { open: async (url) => (opened.push(url), true) },
    events: { onVerification: (details) => void (reportedProposal = details.projectProposal) },
    clock: {
      now: () => now,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        now += milliseconds;
      },
    },
    fetch: async (input, init) => {
      requests.push(String(input));
      const body = String(init?.body ?? "");
      if (requests.length === 1) {
        assert.match(body, /resource=https%3A%2F%2Fdev.dongo.so%2Fapi%2Fagent%2Fv1/);
      } else {
        assert.match(body, /device_code=device-secret/);
      }
      return responses.shift() ?? new Response(null, { status: 500 });
    },
  });

  const tokens = await client.authorize();
  assert.deepEqual(opened, [
    "https://dev.dongo.so/device?user_code=ABCD-EFGH&project_name=Dongo&repository_url=https%3A%2F%2Fgithub.com%2Frenewisepunk%2Fdongo&execution_mode=manual&project_ref=project_dongo",
  ]);
  assert.deepEqual(reportedProposal, {
    name: "Dongo",
    repositoryUrl: "https://github.com/renewisepunk/dongo",
    executionMode: "manual",
    projectRef: "project_dongo",
  });
  assert.deepEqual(sleeps, [1_000, 1_000, 6_000]);
  assert.equal(tokens.accessToken, "access-secret");
  assert.equal(tokens.refreshToken, "refresh-secret");
  assert.deepEqual(tokens.scope, ["dongo:work:read", "offline_access"]);
});

test("device authorization denial stores nothing and reports a stable error", async () => {
  const responses = [
    Response.json({
      device_code: "device-secret",
      user_code: "ABCD-EFGH",
      verification_uri: "https://dev.dongo.so/device",
      verification_uri_complete: "https://dev.dongo.so/device?user_code=ABCD-EFGH",
      expires_in: 60,
      interval: 1,
    }),
    Response.json({ error: "access_denied" }, { status: 400 }),
  ];
  const client = new DeviceAuthorizationClient({
    deviceAuthorizationEndpoint: "https://dev.dongo.so/api/auth/device/code",
    tokenEndpoint: "https://dev.dongo.so/api/auth/oauth2/token",
    clientId: "dongo-cli",
    resource: "https://dev.dongo.so/api/agent/v1",
    scopes: ["dongo:work:read"],
    browserOpener: { open: async () => false },
    clock: { now: () => 0, sleep: async () => undefined },
    fetch: async () => responses.shift() ?? new Response(null, { status: 500 }),
  });

  await assert.rejects(client.authorize(), (error: unknown) => {
    assert.ok(error instanceof CliCoreError);
    assert.equal(error.code, "authorization_denied");
    assert.doesNotMatch(error.message, /device-secret|ABCD-EFGH/);
    return true;
  });
});

test("device authorization requires verification_uri_complete", async () => {
  const client = new DeviceAuthorizationClient({
    deviceAuthorizationEndpoint: "https://dev.dongo.so/api/auth/device/code",
    tokenEndpoint: "https://dev.dongo.so/api/auth/oauth2/token",
    clientId: "dongo-cli",
    resource: "https://dev.dongo.so/api/agent/v1",
    scopes: ["dongo:work:read"],
    browserOpener: { open: async () => true },
    fetch: async () =>
      Response.json({
        device_code: "device-secret",
        user_code: "ABCD-EFGH",
        verification_uri: "https://dev.dongo.so/device",
        expires_in: 60,
      }),
  });
  await assert.rejects(client.authorize(), /verification_uri_complete/);
});

test("unsafe verification links are rejected before browser or terminal callbacks", async () => {
  let opened = false;
  let reported = false;
  const client = new DeviceAuthorizationClient({
    deviceAuthorizationEndpoint: "https://dev.dongo.so/api/auth/device/code",
    tokenEndpoint: "https://dev.dongo.so/api/auth/oauth2/token",
    clientId: "dongo-cli",
    resource: "https://dev.dongo.so/api/agent/v1",
    scopes: ["dongo:work:read"],
    browserOpener: { open: async () => (opened = true) },
    events: { onVerification: () => void (reported = true) },
    fetch: async () =>
      Response.json({
        device_code: "device-secret",
        user_code: "ABCD-EFGH",
        verification_uri: "https://dev.dongo.so/device",
        verification_uri_complete: "javascript:alert('ABCD-EFGH')",
        expires_in: 60,
      }),
  });
  await assert.rejects(client.authorize(), /unsafe verification_uri_complete/);
  assert.equal(opened, false);
  assert.equal(reported, false);
});

test("temporary non-JSON polling failures retry until approval", async () => {
  let now = 0;
  const responses = [
    Response.json({
      device_code: "device-secret",
      user_code: "ABCD-EFGH",
      verification_uri: "https://dev.dongo.so/device",
      verification_uri_complete: "https://dev.dongo.so/device?user_code=ABCD-EFGH",
      expires_in: 60,
      interval: 1,
    }),
    new Response("temporary", { status: 503 }),
    Response.json({ access_token: "access-secret", expires_in: 900 }),
  ];
  const client = new DeviceAuthorizationClient({
    deviceAuthorizationEndpoint: "https://dev.dongo.so/api/auth/device/code",
    tokenEndpoint: "https://dev.dongo.so/api/auth/oauth2/token",
    clientId: "dongo-cli",
    resource: "https://dev.dongo.so/api/agent/v1",
    scopes: ["dongo:work:read"],
    browserOpener: { open: async () => true },
    clock: { now: () => now, sleep: async (milliseconds) => void (now += milliseconds) },
    fetch: async () => responses.shift() ?? new Response(null, { status: 500 }),
  });
  assert.equal((await client.authorize()).accessToken, "access-secret");
});

test("provider throttling without an OAuth error body backs off like slow_down", async () => {
  let now = 0;
  const sleeps: number[] = [];
  const slowDowns: number[] = [];
  const responses = [
    Response.json({
      device_code: "device-secret",
      user_code: "ABCD-EFGH",
      verification_uri: "https://dev.dongo.so/device",
      verification_uri_complete: "https://dev.dongo.so/device?user_code=ABCD-EFGH",
      expires_in: 60,
      interval: 1,
    }),
    new Response(JSON.stringify({ message: "Too many requests" }), {
      status: 429,
      headers: { "content-type": "text/plain" },
    }),
    Response.json({ access_token: "access-secret", expires_in: 900 }),
  ];
  const client = new DeviceAuthorizationClient({
    deviceAuthorizationEndpoint: "https://dev.dongo.so/api/auth/device/code",
    tokenEndpoint: "https://dev.dongo.so/api/auth/oauth2/token",
    clientId: "dongo-cli",
    resource: "https://dev.dongo.so/api/agent/v1",
    scopes: ["dongo:work:read"],
    browserOpener: { open: async () => true },
    events: { onSlowDown: (seconds) => slowDowns.push(seconds) },
    clock: {
      now: () => now,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        now += milliseconds;
      },
    },
    fetch: async () => responses.shift() ?? new Response(null, { status: 500 }),
  });

  assert.equal((await client.authorize()).accessToken, "access-secret");
  assert.deepEqual(sleeps, [1_000, 6_000]);
  assert.deepEqual(slowDowns, [6]);
});

test("cancellation is deterministic and never stores a credential", async () => {
  const controller = new AbortController();
  const client = new DeviceAuthorizationClient({
    deviceAuthorizationEndpoint: "https://dev.dongo.so/api/auth/device/code",
    tokenEndpoint: "https://dev.dongo.so/api/auth/oauth2/token",
    clientId: "dongo-cli",
    resource: "https://dev.dongo.so/api/agent/v1",
    scopes: ["dongo:work:read"],
    browserOpener: { open: async () => true },
    signal: controller.signal,
    clock: {
      now: () => 0,
      sleep: async () => {
        controller.abort();
        throw new Error("signal internals must not escape");
      },
    },
    fetch: async () =>
      Response.json({
        device_code: "device-secret",
        user_code: "ABCD-EFGH",
        verification_uri: "https://dev.dongo.so/device",
        verification_uri_complete: "https://dev.dongo.so/device?user_code=ABCD-EFGH",
        expires_in: 60,
      }),
  });
  await assert.rejects(client.authorize(), (error: unknown) => {
    assert.ok(error instanceof CliCoreError);
    assert.equal(error.code, "cancelled");
    assert.equal(error.exitCode, 130);
    assert.doesNotMatch(error.message, /signal internals|device-secret|ABCD/);
    return true;
  });
});
