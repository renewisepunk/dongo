import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createDefaultSecretStore,
  FileSecretStore,
} from "../src/index.ts";

test("local credential storage creates user-only files outside the repository", async () => {
  const directory = path.join(await mkdtemp(path.join(os.tmpdir(), "dongo-store-")), "credentials");
  const store = new FileSecretStore(directory);
  await store.set("profile", "refresh-secret");
  assert.equal(await store.get("profile"), "refresh-secret");
  const files = await readdir(directory);
  assert.equal(files.length, 1);
  assert.equal((await lstat(directory)).mode & 0o777, 0o700);
  const info = await lstat(path.join(directory, files[0] ?? ""));
  assert.equal(info.mode & 0o777, 0o600);
  assert.equal(await readFile(path.join(directory, files[0] ?? ""), "utf8"), "refresh-secret");
  assert.equal(store.kind, "local-user-file");
});

test("local credential storage refuses symlink targets", async () => {
  const directory = path.join(await mkdtemp(path.join(os.tmpdir(), "dongo-store-link-")), "credentials");
  const store = new FileSecretStore(directory);
  await store.set("profile", "first");
  const files = await readdir(directory);
  await store.delete("profile");
  await symlink("/tmp", path.join(directory, files[0] ?? "credential"));
  await assert.rejects(store.set("profile", "second"), /symlink/);
});

test("default storage is a dongo-owned local file and needs no platform helper", async () => {
  const configDirectory = await mkdtemp(path.join(os.tmpdir(), "dongo-default-store-"));
  const store = createDefaultSecretStore({ configDirectory });
  assert.equal(store.kind, "local-user-file");
  await store.set("profile", "refresh-secret");
  assert.equal(await store.get("profile"), "refresh-secret");
});

test("local credential reads fail closed when permissions become broad", async () => {
  const directory = path.join(await mkdtemp(path.join(os.tmpdir(), "dongo-store-mode-")), "credentials");
  const store = new FileSecretStore(directory);
  await store.set("profile", "refresh-secret");
  const files = await readdir(directory);
  await chmod(path.join(directory, files[0] ?? ""), 0o644);
  await assert.rejects(store.get("profile"), /permissions are not 0600/);
});

test("local credential storage refuses a symlinked credential directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dongo-store-directory-link-"));
  const destination = path.join(root, "destination");
  const directory = path.join(root, "credentials");
  await mkdir(destination, { mode: 0o700 });
  await symlink(destination, directory);
  const store = new FileSecretStore(directory);
  await assert.rejects(store.set("profile", "refresh-secret"), /not a safe directory/);
  assert.deepEqual(await readdir(destination), []);
});

test("local credential storage refuses a non-regular credential path", async () => {
  const directory = path.join(await mkdtemp(path.join(os.tmpdir(), "dongo-store-type-")), "credentials");
  const store = new FileSecretStore(directory);
  await store.set("profile", "first");
  const [credentialName] = await readdir(directory);
  assert.ok(credentialName);
  await store.delete("profile");
  await mkdir(path.join(directory, credentialName), { mode: 0o700 });

  await assert.rejects(store.get("profile"), /not a regular file/);
  await assert.rejects(store.set("profile", "second"), /not a regular file/);
});

test("local credential storage rejects a simulated foreign-owned directory", async () => {
  if (typeof process.getuid !== "function") return;
  const directory = path.join(await mkdtemp(path.join(os.tmpdir(), "dongo-store-owner-directory-")), "credentials");
  const store = new FileSecretStore(directory);
  await store.set("profile", "refresh-secret");
  const descriptor = Object.getOwnPropertyDescriptor(process, "getuid");
  assert.ok(descriptor);
  const owner = process.getuid();
  Object.defineProperty(process, "getuid", { ...descriptor, value: () => owner + 1 });
  try {
    await assert.rejects(store.get("profile"), /directory is owned by another user/);
  } finally {
    Object.defineProperty(process, "getuid", descriptor);
  }
});

test("local credential storage rejects a simulated foreign-owned file", async () => {
  if (typeof process.getuid !== "function") return;
  const directory = path.join(await mkdtemp(path.join(os.tmpdir(), "dongo-store-owner-file-")), "credentials");
  const store = new FileSecretStore(directory);
  await store.set("profile", "refresh-secret");
  const descriptor = Object.getOwnPropertyDescriptor(process, "getuid");
  assert.ok(descriptor);
  const owner = process.getuid();
  let calls = 0;
  Object.defineProperty(process, "getuid", {
    ...descriptor,
    value: () => {
      calls += 1;
      return calls === 1 ? owner : owner + 1;
    },
  });
  try {
    await assert.rejects(store.get("profile"), /file is owned by another user/);
  } finally {
    Object.defineProperty(process, "getuid", descriptor);
  }
});

test("an interrupted temporary write cannot replace the committed credential", async () => {
  const directory = path.join(await mkdtemp(path.join(os.tmpdir(), "dongo-store-interrupted-")), "credentials");
  const store = new FileSecretStore(directory);
  await store.set("profile", "committed-secret");
  const [credentialName] = await readdir(directory);
  assert.ok(credentialName);
  const interrupted = path.join(directory, `.${credentialName}.999.interrupted.tmp`);
  await writeFile(interrupted, "partial-secret", { encoding: "utf8", flag: "wx", mode: 0o600 });

  assert.equal(await store.get("profile"), "committed-secret");
  await store.set("profile", "rotated-secret");
  assert.equal(await store.get("profile"), "rotated-secret");
  assert.equal(await readFile(interrupted, "utf8"), "partial-secret");
});
