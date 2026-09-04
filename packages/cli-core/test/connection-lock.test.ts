import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { acquireConnectionLock, CliCoreError } from "../src/index.ts";

test("a concurrent connection waits for the owner instead of starting a second flow", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dongo-connect-lock-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const first = await acquireConnectionLock({ directory, key: "repository" });
  let acquired = false;
  const second = acquireConnectionLock({ directory, key: "repository" }).then((lock) => {
    acquired = true;
    return lock;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(acquired, false);
  await first.release();
  const secondLock = await second;
  assert.equal(acquired, true);
  assert.equal(secondLock.waitedForOwner, true);
  await secondLock.release();
});

test("a dead connection owner is recovered without a duplicate approval", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dongo-connect-stale-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const key = "repository";
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 32);
  await writeFile(
    path.join(directory, `.connect-${digest}.lock`),
    JSON.stringify({ schemaVersion: 1, pid: 2_147_483_647, startedAt: Date.now() }),
    { mode: 0o600 },
  );
  const lock = await acquireConnectionLock({ directory, key });
  assert.equal(lock.waitedForOwner, false);
  await lock.release();
});

test("cancelling a duplicate wait reports that no new authorization started", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dongo-connect-cancel-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const lock = await acquireConnectionLock({ directory, key: "repository" });
  const controller = new AbortController();
  const waiting = acquireConnectionLock({ directory, key: "repository", signal: controller.signal });
  controller.abort();
  await assert.rejects(waiting, (error: unknown) => {
    assert.ok(error instanceof CliCoreError);
    assert.equal(error.code, "cancelled");
    assert.match(error.message, /no additional authorization was started/u);
    return true;
  });
  await lock.release();
});
