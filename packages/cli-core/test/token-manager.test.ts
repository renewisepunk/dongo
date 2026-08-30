import assert from "node:assert/strict";
import { lstat, mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CliCoreError, MemorySecretStore, TokenManager } from "../src/index.ts";
import type { StoredCredential } from "../src/index.ts";

const credential: StoredCredential = {
  schemaVersion: 1,
  clientId: "dongo-cli",
  issuer: "https://dev.dongo.so/api/auth",
  resource: "https://dev.dongo.so/api/agent/v1",
  tokenEndpoint: "https://dev.dongo.so/api/auth/oauth2/token",
  revocationEndpoint: "https://dev.dongo.so/api/auth/oauth2/revoke",
  accessToken: "expired-access-secret",
  accessTokenExpiresAt: 1,
  refreshToken: "refresh-secret-1",
  tokenType: "Bearer",
  scopes: ["offline_access", "dongo:work:read"],
};

test("refresh creates its lock directory and persists rotated credentials", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dongo-refresh-"));
  const lockDirectory = path.join(root, "not-created-yet");
  const store = new MemorySecretStore();
  let calls = 0;
  const manager = new TokenManager({
    profile: "profile",
    store,
    lockDirectory,
    now: () => 10_000,
    fetch: async (input, init) => {
      calls += 1;
      assert.equal(String(input), credential.tokenEndpoint);
      const body = String(init?.body);
      assert.match(body, /grant_type=refresh_token/);
      assert.match(body, /refresh_token=refresh-secret-1/);
      return Response.json({
        access_token: "access-secret-2",
        refresh_token: "refresh-secret-2",
        token_type: "Bearer",
        expires_in: 900,
        scope: "dongo:work:read offline_access",
      });
    },
  });
  await manager.save(credential);

  assert.equal(await manager.getAccessToken(), "access-secret-2");
  assert.equal(calls, 1);
  assert.equal((await manager.load())?.refreshToken, "refresh-secret-2");
  assert.equal((await lstat(lockDirectory)).mode & 0o077, 0);
  assert.deepEqual(await readdir(lockDirectory), []);
});

test("failed revocation retains local material for a safe retry", async () => {
  const store = new MemorySecretStore();
  const manager = new TokenManager({
    profile: "profile",
    store,
    lockDirectory: await mkdtemp(path.join(os.tmpdir(), "dongo-revoke-")),
    fetch: async () =>
      Response.json(
        { error: "temporarily_unavailable", error_description: "refresh-secret-1 must never escape" },
        { status: 503 },
      ),
  });
  await manager.save(credential);

  await assert.rejects(manager.logout(), (error: unknown) => {
    assert.ok(error instanceof CliCoreError);
    assert.equal(error.code, "temporary_failure");
    assert.doesNotMatch(error.message, /refresh-secret-1/);
    return true;
  });
  assert.equal((await manager.load())?.refreshToken, "refresh-secret-1");
});
