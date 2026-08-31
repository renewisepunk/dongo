import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CliCoreError, CoreService, MemorySecretStore, writeProjectMarker } from "../src/index.ts";
import type { ProjectMarker } from "../src/index.ts";

const session = {
  project: { id: "project_1", name: "dongo", publicRef: "pub_dongo", executionMode: "manual" as const },
  installation: { id: "install_1", actorId: "actor_1", scopes: ["dongo:work:read", "dongo:work:write"] },
  serverTime: "2026-08-30T10:00:00.000Z",
};

function envelope(data: unknown, requestId: string) {
  return Response.json({ ok: true, data, requestId, apiVersion: "v1" });
}

test("connect, status, doctor, overview, sync, and logout form a safe local slice", async () => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "dongo-service-"));
  const configDirectory = await mkdtemp(path.join(os.tmpdir(), "dongo-config-"));
  await mkdir(path.join(repositoryRoot, ".git"));
  const store = new MemorySecretStore();
  const opened: string[] = [];
  const calls: string[] = [];

  const service = new CoreService({
    cwd: repositoryRoot,
    configDirectory,
    secretStore: store,
    now: () => 1_788_086_400_000,
    deviceClock: { now: () => 1_788_086_400_000, sleep: async () => undefined },
    browserOpener: { open: async (url) => (opened.push(url), true) },
    fetch: async (input, init) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/device/code")) {
        return Response.json({
          device_code: "device-secret",
          user_code: "ABCD-EFGH",
          verification_uri: "http://localhost:8787/device",
          verification_uri_complete: "http://localhost:8787/device?user_code=ABCD-EFGH",
          expires_in: 60,
          interval: 1,
        });
      }
      if (url.endsWith("/oauth2/token")) {
        return Response.json({
          access_token: "access-secret",
          refresh_token: "refresh-secret",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "dongo:work:read dongo:work:write offline_access",
        });
      }
      if (url.endsWith("/session_start")) {
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer access-secret");
        return envelope(session, "req_session");
      }
      if (url.endsWith("/get_overview")) {
        return envelope({ needsYou: [], working: [], ready: [{ identifier: "DON-1" }], inbox: [], recentlyDone: [] }, "req_overview");
      }
      if (url.endsWith("/sync_snapshot")) {
        return envelope(
          { workItems: [{ identifier: "DON-1", title: "Safe export", state: "done", outcome: "Complete." }] },
          "req_sync",
        );
      }
      if (url.endsWith("/oauth2/revoke")) return new Response(null, { status: 200 });
      return new Response(null, { status: 404 });
    },
  });

  const connected = await service.connect({
    origin: "http://localhost:8787",
    projectName: "dongo CLI",
    repositoryUrl: "git@github.com:renewisepunk/dongo.git",
    executionMode: "autonomous",
  });
  assert.equal(connected.project.publicRef, "pub_dongo");
  assert.equal(opened.length, 1);
  assert.equal(
    opened[0],
    "http://localhost:8787/device?user_code=ABCD-EFGH&project_name=dongo+CLI&repository_url=https%3A%2F%2Fgithub.com%2Frenewisepunk%2Fdongo&execution_mode=autonomous",
  );
  const marker = await readFile(path.join(repositoryRoot, ".agent-work", "project.json"), "utf8");
  assert.doesNotMatch(marker, /access-secret|refresh-secret|device-secret|ABCD-EFGH/);
  assert.match(marker, /pub_dongo/);

  await service.connect({ origin: "http://localhost:8787" });
  assert.match(opened[1] ?? "", /[?&]project_ref=pub_dongo(?:&|$)/u);

  const markerRecord = JSON.parse(marker) as ProjectMarker;
  await writeProjectMarker(repositoryRoot, { ...markerRecord, apiBaseUrl: "https://credential-thief.example/api" });
  const callsBeforeTamperCheck = calls.length;
  await assert.rejects(service.overview(), (error: unknown) => {
    assert.ok(error instanceof CliCoreError);
    assert.equal(error.code, "validation");
    return true;
  });
  assert.equal(calls.length, callsBeforeTamperCheck, "tampered marker must be rejected before any network request");
  await writeProjectMarker(repositoryRoot, markerRecord);

  const status = await service.authStatus();
  assert.equal(status.authenticated, true);
  assert.equal((await service.doctor()).ok, true);
  assert.equal((await service.overview()).ready.length, 1);
  const synced = await service.sync();
  assert.equal(synced.export.files[0]?.path, "work/DON-1-safe-export.md");
  assert.match(await readFile(path.join(repositoryRoot, ".agent-work", "work", "DON-1-safe-export.md"), "utf8"), /Complete\./);

  assert.equal((await service.logout()).revoked, true);
  assert.equal((await service.authStatus()).authenticated, false);
  assert.ok(calls.some((url) => url.endsWith("/oauth2/revoke")));
});

test("CI setup authenticates from the environment and writes only a non-secret project marker", async () => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "dongo-ci-service-"));
  const configDirectory = await mkdtemp(path.join(os.tmpdir(), "dongo-ci-config-"));
  await mkdir(path.join(repositoryRoot, ".git"));
  const serviceToken = `dng_svc_abcdefghijk_${"s".repeat(43)}`;
  const previousToken = process.env.DONGO_TOKEN;
  process.env.DONGO_TOKEN = serviceToken;
  const calls: string[] = [];
  try {
    const service = new CoreService({
      cwd: repositoryRoot,
      configDirectory,
      secretStore: new MemorySecretStore(),
      now: () => 1_788_086_400_000,
      fetch: async (input, init) => {
        const url = String(input);
        calls.push(url);
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          `Bearer ${serviceToken}`,
        );
        if (url.endsWith("/session_start")) {
          return envelope(
            {
              ...session,
              installation: {
                ...session.installation,
                id: "service_actor_1",
                scopes: ["dongo:work:read"],
              },
            },
            "req_ci_session",
          );
        }
        if (url.endsWith("/get_overview")) {
          return envelope(
            {
              needsYou: [],
              working: [],
              ready: [],
              inbox: [],
              recentlyDone: [],
            },
            "req_ci_overview",
          );
        }
        return new Response(null, { status: 404 });
      },
    });
    const setup = await service.setupCi();
    assert.equal(setup.credentialStore, "environment");
    assert.equal(setup.project.publicRef, "pub_dongo");
    const marker = await readFile(
      path.join(repositoryRoot, ".agent-work", "project.json"),
      "utf8",
    );
    assert.doesNotMatch(marker, /dng_svc_|ssssssss/);
    assert.match(marker, /pub_dongo/);
    assert.equal((await service.authStatus()).credential?.source, "environment");
    assert.deepEqual((await service.overview()).ready, []);
    assert.deepEqual(calls, [
      "https://dongo.so/api/agent/v1/session_start",
      "https://dongo.so/api/agent/v1/get_overview",
    ]);
  } finally {
    if (previousToken === undefined) delete process.env.DONGO_TOKEN;
    else process.env.DONGO_TOKEN = previousToken;
  }
});

test("CI setup refuses to proceed without an exact service credential", async () => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "dongo-ci-missing-"));
  await mkdir(path.join(repositoryRoot, ".git"));
  const previousToken = process.env.DONGO_TOKEN;
  try {
    delete process.env.DONGO_TOKEN;
    const service = new CoreService({ cwd: repositoryRoot });
    await assert.rejects(service.setupCi(), (error: unknown) => {
      assert.ok(error instanceof CliCoreError);
      assert.equal(error.code, "authentication_required");
      return true;
    });
  } finally {
    if (previousToken === undefined) delete process.env.DONGO_TOKEN;
    else process.env.DONGO_TOKEN = previousToken;
  }
});

test("interactive credentials cannot be redirected into the repository", async () => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "dongo-config-boundary-"));
  await mkdir(path.join(repositoryRoot, ".git"));
  const service = new CoreService({
    cwd: repositoryRoot,
    configDirectory: path.join(repositoryRoot, ".dongo-config"),
    browserOpener: { open: async () => true },
    fetch: async () => {
      throw new Error("network must not run for an unsafe credential path");
    },
  });
  await assert.rejects(service.connect({ origin: "http://localhost:8787" }), (error: unknown) => {
    assert.ok(error instanceof CliCoreError);
    assert.equal(error.code, "unsafe_path");
    assert.match(error.message, /outside the repository/);
    return true;
  });
});

test("interactive credentials cannot reach the repository through a symlinked config parent", async () => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "dongo-config-link-boundary-"));
  await mkdir(path.join(repositoryRoot, ".git"));
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "dongo-config-link-"));
  const linkedParent = path.join(outsideRoot, "linked-config");
  await symlink(repositoryRoot, linkedParent);
  const service = new CoreService({
    cwd: repositoryRoot,
    configDirectory: path.join(linkedParent, "credentials-root"),
    browserOpener: { open: async () => true },
    fetch: async () => {
      throw new Error("network must not run for a symlinked repository credential path");
    },
  });
  await assert.rejects(service.connect({ origin: "http://localhost:8787" }), (error: unknown) => {
    assert.ok(error instanceof CliCoreError);
    assert.equal(error.code, "unsafe_path");
    assert.match(error.message, /outside the repository/);
    return true;
  });
});
