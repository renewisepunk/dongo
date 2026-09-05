import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  CliCoreError,
  CoreService,
  credentialProfile,
  MemorySecretStore,
  writeProjectMarker,
} from "../src/index.ts";
import type { ProjectMarker } from "../src/index.ts";

const execFileAsync = promisify(execFile);

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
    allowNonProduction: true,
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
        return envelope({ needsYou: [], working: [], ready: [{ identifier: "dong001", legacyIdentifiers: ["DON-1"] }], inbox: [], recentlyDone: [] }, "req_overview");
      }
      if (url.endsWith("/sync_snapshot")) {
        return envelope(
          { workItems: [{ identifier: "dong001", legacyIdentifiers: ["DON-1"], title: "Safe export", state: "done", outcome: "Complete." }] },
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
    agentHost: "codex",
  });
  assert.equal(connected.project.publicRef, "pub_dongo");
  assert.equal(opened.length, 1);
  assert.equal(
    opened[0],
    "http://localhost:8787/device?user_code=ABCD-EFGH&project_name=dongo+CLI&repository_url=https%3A%2F%2Fgithub.com%2Frenewisepunk%2Fdongo&execution_mode=autonomous&agent_host=codex",
  );
  const marker = await readFile(path.join(repositoryRoot, ".agent-work", "project.json"), "utf8");
  assert.doesNotMatch(marker, /access-secret|refresh-secret|device-secret|ABCD-EFGH/);
  assert.match(marker, /pub_dongo/);

  const reconnected = await service.connect({ origin: "http://localhost:8787" });
  assert.equal(reconnected.project.publicRef, "pub_dongo");
  assert.equal(opened.length, 1, "a healthy existing connection must not start another browser authorization");

  await service.createProject({
    origin: "http://localhost:8787",
    projectName: "Another project",
  });
  const creationUrl = new URL(opened[1] ?? "");
  assert.equal(creationUrl.searchParams.get("project_action"), "create");
  assert.equal(creationUrl.searchParams.get("project_name"), "Another project");
  assert.equal(creationUrl.searchParams.has("project_ref"), false);

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
  assert.equal(synced.export.files[0]?.path, "work/dong001-safe-export.md");
  assert.match(await readFile(path.join(repositoryRoot, ".agent-work", "work", "dong001-safe-export.md"), "utf8"), /Complete\./);

  assert.equal((await service.logout()).revoked, true);
  assert.equal((await service.authStatus()).authenticated, false);
  assert.ok(calls.some((url) => url.endsWith("/oauth2/revoke")));
});

test("a linked worktree reuses the newest exact-project sibling binding", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dongo-service-worktrees-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const primary = path.join(directory, "primary");
  const linked = path.join(directory, "linked");
  const configDirectory = path.join(directory, "config");
  await mkdir(primary);
  await execFileAsync("git", ["-C", primary, "init", "-q"]);
  await execFileAsync("git", ["-C", primary, "config", "user.email", "test@example.com"]);
  await execFileAsync("git", ["-C", primary, "config", "user.name", "Test"]);
  await execFileAsync("git", ["-C", primary, "commit", "--allow-empty", "-m", "initial"]);
  await execFileAsync("git", ["-C", primary, "worktree", "add", "-q", "-b", "linked", linked]);

  const environment = {
    productOrigin: "http://localhost:8787",
    issuer: "http://localhost:8787/api/auth",
    apiBaseUrl: "http://localhost:8787/api/agent/v1",
    apiResource: "http://localhost:8787/api/agent/v1",
  };
  const staleProfile = credentialProfile(environment.productOrigin, await realpath(primary));
  const healthyProfile = credentialProfile(environment.productOrigin, await realpath(linked));
  const marker: ProjectMarker = {
    schemaVersion: 1,
    environment: "custom",
    ...environment,
    publicProjectRef: "pub_dongo",
    projectId: "project_1",
    projectName: "dongo",
    installationId: "install_1",
    credentialProfile: staleProfile,
    connectedAt: "2026-09-01T00:00:00.000Z",
  };
  await writeProjectMarker(linked, marker);
  await writeProjectMarker(primary, {
    ...marker,
    credentialProfile: healthyProfile,
    connectedAt: "2026-09-04T00:00:00.000Z",
  });
  const store = new MemorySecretStore();
  const credential = JSON.stringify({
    schemaVersion: 1,
    clientId: "dongo-cli",
    issuer: environment.issuer,
    resource: environment.apiResource,
    tokenEndpoint: `${environment.issuer}/oauth2/token`,
    revocationEndpoint: `${environment.issuer}/oauth2/revoke`,
    accessToken: "healthy-access",
    accessTokenExpiresAt: Date.now() + 3600_000,
    tokenType: "Bearer",
    scopes: ["dongo:work:read"],
  });
  await store.set(healthyProfile, credential);
  let browserOpens = 0;
  const service = new CoreService({
    cwd: linked,
    configDirectory,
    allowNonProduction: true,
    secretStore: store,
    browserOpener: { open: async () => (browserOpens += 1, true) },
    fetch: async (input, init) => {
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer healthy-access");
      if (String(input).endsWith("/session_start")) return envelope(session, "req_linked_session");
      return new Response(null, { status: 404 });
    },
  });

  const linkedDoctor = await service.doctor();
  assert.equal(linkedDoctor.ok, true, JSON.stringify(linkedDoctor.checks));
  assert.equal((await service.connect({ origin: environment.productOrigin })).project.publicRef, "pub_dongo");
  assert.equal(browserOpens, 0);
});

test("a copied marker remains rejected in an independent repository", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dongo-service-independent-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const original = path.join(directory, "original");
  const independent = path.join(directory, "independent");
  await mkdir(path.join(original, ".git"), { recursive: true });
  await mkdir(path.join(independent, ".git"), { recursive: true });
  const environment = {
    productOrigin: "http://localhost:8787",
    issuer: "http://localhost:8787/api/auth",
    apiBaseUrl: "http://localhost:8787/api/agent/v1",
    apiResource: "http://localhost:8787/api/agent/v1",
  };
  await writeProjectMarker(independent, {
    schemaVersion: 1,
    environment: "custom",
    ...environment,
    publicProjectRef: "pub_dongo",
    projectId: "project_1",
    projectName: "dongo",
    installationId: "install_1",
    credentialProfile: credentialProfile(environment.productOrigin, original),
    connectedAt: "2026-09-04T00:00:00.000Z",
  });
  let requests = 0;
  const service = new CoreService({
    cwd: independent,
    configDirectory: path.join(directory, "config"),
    allowNonProduction: true,
    secretStore: new MemorySecretStore(),
    fetch: async () => {
      requests += 1;
      return new Response(null, { status: 500 });
    },
  });

  const result = await service.doctor();
  assert.equal(result.ok, false);
  assert.match(result.checks.at(-1)?.detail ?? "", /credential binding are inconsistent/u);
  assert.equal(requests, 0, "an independent repository must be rejected before credential or network use");
});

test("a changed repository remote invalidates a bound marker", async (context) => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "dongo-service-remote-"));
  context.after(() => rm(repositoryRoot, { force: true, recursive: true }));
  await execFileAsync("git", ["-C", repositoryRoot, "init", "-q"]);
  await execFileAsync("git", ["-C", repositoryRoot, "remote", "add", "origin", "git@github.com:renewisepunk/replacement.git"]);
  const environment = {
    productOrigin: "http://localhost:8787",
    issuer: "http://localhost:8787/api/auth",
    apiBaseUrl: "http://localhost:8787/api/agent/v1",
    apiResource: "http://localhost:8787/api/agent/v1",
  };
  await writeProjectMarker(repositoryRoot, {
    schemaVersion: 1,
    environment: "custom",
    ...environment,
    publicProjectRef: "pub_dongo",
    projectId: "project_1",
    projectName: "dongo",
    installationId: "install_1",
    credentialProfile: credentialProfile(environment.productOrigin, await realpath(repositoryRoot)),
    repositoryUrl: "https://github.com/renewisepunk/dongo",
    connectedAt: "2026-09-04T00:00:00.000Z",
  });
  let requests = 0;
  const service = new CoreService({
    cwd: repositoryRoot,
    configDirectory: path.join(repositoryRoot, "..", "config"),
    allowNonProduction: true,
    secretStore: new MemorySecretStore(),
    fetch: async () => {
      requests += 1;
      return new Response(null, { status: 500 });
    },
  });

  const result = await service.doctor();
  assert.equal(result.ok, false);
  assert.match(result.checks.at(-1)?.detail ?? "", /credential binding are inconsistent/u);
  assert.equal(requests, 0, "a changed remote must be rejected before credential or network use");
});

test("concurrent connect calls create one browser authorization and reuse its result", async (context) => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "dongo-connect-single-flight-"));
  const configDirectory = await mkdtemp(path.join(os.tmpdir(), "dongo-connect-single-flight-config-"));
  context.after(() => rm(repositoryRoot, { force: true, recursive: true }));
  context.after(() => rm(configDirectory, { force: true, recursive: true }));
  await mkdir(path.join(repositoryRoot, ".git"));
  const store = new MemorySecretStore();
  let browserOpens = 0;
  let releaseToken!: () => void;
  const tokenGate = new Promise<void>((resolve) => { releaseToken = resolve; });
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/device/code")) return Response.json({
      device_code: "device-secret",
      user_code: "ABCD-EFGH",
      verification_uri: "http://localhost:8787/device",
      verification_uri_complete: "http://localhost:8787/device?user_code=ABCD-EFGH",
      expires_in: 60,
      interval: 1,
    });
    if (url.endsWith("/oauth2/token")) {
      await tokenGate;
      return Response.json({
        access_token: "access-secret",
        refresh_token: "refresh-secret",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "dongo:work:read offline_access",
      });
    }
    if (url.endsWith("/session_start")) {
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer access-secret");
      return envelope(session, "req_single_flight_session");
    }
    return new Response(null, { status: 404 });
  };
  const makeService = () => new CoreService({
    cwd: repositoryRoot,
    configDirectory,
    allowNonProduction: true,
    secretStore: store,
    deviceClock: { now: Date.now, sleep: async () => undefined },
    browserOpener: { open: async () => (browserOpens += 1, true) },
    fetch,
  });
  const first = makeService().connect({ origin: "http://localhost:8787" });
  while (browserOpens === 0) await new Promise((resolve) => setTimeout(resolve, 1));
  const second = makeService().connect({ origin: "http://localhost:8787" });
  releaseToken();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.project.publicRef, "pub_dongo");
  assert.equal(secondResult.project.publicRef, "pub_dongo");
  assert.equal(browserOpens, 1);
});

test("a waiter does not repeat a failed connection authorization", async (context) => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "dongo-connect-failed-owner-"));
  const configDirectory = await mkdtemp(path.join(os.tmpdir(), "dongo-connect-failed-owner-config-"));
  context.after(() => rm(repositoryRoot, { force: true, recursive: true }));
  context.after(() => rm(configDirectory, { force: true, recursive: true }));
  await mkdir(path.join(repositoryRoot, ".git"));
  let browserOpens = 0;
  let releaseFailure!: () => void;
  const failureGate = new Promise<void>((resolve) => { releaseFailure = resolve; });
  const makeService = () => new CoreService({
    cwd: repositoryRoot,
    configDirectory,
    allowNonProduction: true,
    secretStore: new MemorySecretStore(),
    deviceClock: { now: Date.now, sleep: async () => undefined },
    browserOpener: { open: async () => (browserOpens += 1, true) },
    fetch: async (input) => {
      const url = String(input);
      if (url.endsWith("/device/code")) return Response.json({
        device_code: "device-secret",
        user_code: "ABCD-EFGH",
        verification_uri: "http://localhost:8787/device",
        verification_uri_complete: "http://localhost:8787/device?user_code=ABCD-EFGH",
        expires_in: 60,
        interval: 1,
      });
      if (url.endsWith("/oauth2/token")) {
        await failureGate;
        return Response.json({ error: "access_denied" }, { status: 400 });
      }
      return new Response(null, { status: 404 });
    },
  });
  const first = makeService().connect({ origin: "http://localhost:8787" });
  while (browserOpens === 0) await new Promise((resolve) => setTimeout(resolve, 1));
  const second = makeService().connect({ origin: "http://localhost:8787" });
  // Keep the owner blocked for longer than one connection-lock polling interval
  // so a loaded parallel test run cannot release it before the waiter observes it.
  await new Promise((resolve) => setTimeout(resolve, 300));
  releaseFailure();

  const [ownerResult, waiterResult] = await Promise.allSettled([first, second]);
  assert.equal(ownerResult.status, "rejected");
  assert.ok(ownerResult.reason instanceof CliCoreError);
  assert.equal(ownerResult.reason.code, "authorization_denied");
  assert.equal(waiterResult.status, "rejected");
  assert.ok(waiterResult.reason instanceof CliCoreError);
  assert.equal(waiterResult.reason.code, "connection_attempt_incomplete");
  assert.match(waiterResult.reason.message, /did not start another authorization/u);
  assert.equal(browserOpens, 1);
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

test("the released service rejects non-production connection options", async () => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "dongo-production-only-"));
  await mkdir(path.join(repositoryRoot, ".git"));
  const service = new CoreService({
    cwd: repositoryRoot,
    secretStore: new MemorySecretStore(),
    fetch: async () => {
      throw new Error("non-production options must be rejected before network access");
    },
  });

  await assert.rejects(
    service.connect({ environment: "development" }),
    (error: unknown) => error instanceof CliCoreError && error.code === "validation" && /internal-only/u.test(error.message),
  );
  await assert.rejects(
    service.connect({ origin: "http://localhost:8787" }),
    (error: unknown) => error instanceof CliCoreError && error.code === "validation" && /internal-only/u.test(error.message),
  );
  await assert.rejects(
    service.setupCi({ environment: "development" }),
    (error: unknown) => error instanceof CliCoreError && error.code === "validation" && /internal-only/u.test(error.message),
  );
});

test("explicit project creation cannot also select an existing project", async () => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "dongo-create-project-"));
  await mkdir(path.join(repositoryRoot, ".git"));
  const service = new CoreService({
    cwd: repositoryRoot,
    allowNonProduction: true,
    fetch: async () => {
      throw new Error("conflicting creation intent must fail before network access");
    },
  });
  await assert.rejects(
    service.connect({
      origin: "http://localhost:8787",
      createProject: true,
      projectRef: "existing_project",
    }),
    (error: unknown) =>
      error instanceof CliCoreError
      && error.code === "validation"
      && /cannot also bind/u.test(error.message),
  );
});

test("interactive credentials cannot be redirected into the repository", async () => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "dongo-config-boundary-"));
  await mkdir(path.join(repositoryRoot, ".git"));
  const service = new CoreService({
    cwd: repositoryRoot,
    configDirectory: path.join(repositoryRoot, ".dongo-config"),
    allowNonProduction: true,
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
    allowNonProduction: true,
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
