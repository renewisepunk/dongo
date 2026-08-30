import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CliCoreError,
  ExplicitFallbackSecretStore,
  FileSecretStore,
  MacOSKeychainStore,
  type CommandRunner,
} from "../src/index.ts";

test("file fallback creates user-only files outside the repository", async () => {
  const directory = path.join(await mkdtemp(path.join(os.tmpdir(), "dongo-store-")), "credentials");
  const store = new FileSecretStore(directory);
  await store.set("profile", "refresh-secret");
  assert.equal(await store.get("profile"), "refresh-secret");
  const files = await import("node:fs/promises").then((fs) => fs.readdir(directory));
  assert.equal(files.length, 1);
  const info = await lstat(path.join(directory, files[0] ?? ""));
  assert.equal(info.mode & 0o777, 0o600);
  assert.equal(await readFile(path.join(directory, files[0] ?? ""), "utf8"), "refresh-secret");
});

test("file fallback refuses symlink credential targets", async () => {
  const directory = path.join(await mkdtemp(path.join(os.tmpdir(), "dongo-store-link-")), "credentials");
  const store = new FileSecretStore(directory);
  await store.set("profile", "first");
  const files = await import("node:fs/promises").then((fs) => fs.readdir(directory));
  await store.delete("profile");
  await symlink("/tmp", path.join(directory, files[0] ?? "credential"));
  await assert.rejects(store.set("profile", "second"), /unsafe/);
});

test("fallback must be explicitly supplied", async () => {
  const store = new ExplicitFallbackSecretStore({});
  await assert.rejects(store.set("profile", "secret"), /--allow-file-secret-store/);
});

test("macOS keychain receives the secret on stdin, never argv", async () => {
  const calls: Array<{
    command: string;
    args: string[];
    input?: string;
    environment?: NodeJS.ProcessEnv;
  }> = [];
  const runner: CommandRunner = {
    run: async (command, args, input, environment) => {
      calls.push({ command, args, input, environment });
      return { code: 0, stdout: "", stderr: "" };
    },
  };
  const store = new MacOSKeychainStore({ runner });
  await store.set("profile", "refresh-secret");
  assert.equal(calls[0]?.command, "/usr/bin/swift");
  assert.equal(calls[0]?.input, "refresh-secret");
  assert.ok(!calls[0]?.args.includes("refresh-secret"));
  assert.ok(!Object.values(calls[0]?.environment ?? {}).includes("refresh-secret"));
  assert.deepEqual(calls[0]?.environment, {
    DONGO_KEYCHAIN_ACCOUNT: "profile",
    DONGO_KEYCHAIN_SERVICE: "so.dongo.cli",
  });
});

test("missing OS tooling produces a stable error or uses only an explicit fallback", async () => {
  const unavailable = {
    kind: "os-store",
    get: async () => {
      throw Object.assign(new Error("spawn secret-tool ENOENT sensitive internals"), { code: "ENOENT" });
    },
    set: async () => {
      throw Object.assign(new Error("spawn secret-tool ENOENT sensitive internals"), { code: "ENOENT" });
    },
    delete: async () => undefined,
  };
  const strict = new ExplicitFallbackSecretStore({ primary: unavailable });
  await assert.rejects(strict.set("profile", "secret"), (error: unknown) => {
    assert.ok(error instanceof CliCoreError);
    assert.equal(error.code, "secure_store_unavailable");
    assert.doesNotMatch(error.message, /sensitive internals|secret-tool/);
    return true;
  });

  const directory = path.join(await mkdtemp(path.join(os.tmpdir(), "dongo-store-explicit-")), "credentials");
  const fallback = new ExplicitFallbackSecretStore({ primary: unavailable, fallback: new FileSecretStore(directory) });
  await fallback.set("profile", "refresh-secret");
  assert.equal(fallback.kind, "file-0600");
  assert.equal(await fallback.get("profile"), "refresh-secret");
});
