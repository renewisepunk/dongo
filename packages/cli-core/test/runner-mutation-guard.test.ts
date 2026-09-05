import assert from "node:assert/strict";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertRunnerMutationAllowed,
  quarantineRunnerMutation,
  runnerMutationGuardPath,
  runnerMutationIsQuarantined,
} from "../src/runner-mutation-guard.ts";

test("runner mutation guard flips atomically and remains exact-job fail closed", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dongo-quarantine-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const target = runnerMutationGuardPath(root, "project-ref", "job-1");
  assert.equal(await runnerMutationIsQuarantined(target), false);
  await assertRunnerMutationAllowed(target);

  const written = await quarantineRunnerMutation({
    configDirectory: root,
    projectRef: "project-ref",
    registrationId: "registration-1",
    jobId: "job-1",
    now: () => 1_725_000_000_000,
  });
  assert.equal(written, target);
  assert.equal(await runnerMutationIsQuarantined(target), true);
  await assert.rejects(assertRunnerMutationAllowed(target), /job is quarantined/u);
  assert.notEqual(target, runnerMutationGuardPath(root, "project-ref", "job-2"));
});

test("runner mutation guard rejects unsafe or absent managed identities", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dongo-quarantine-unsafe-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(assertRunnerMutationAllowed(undefined), /no verified dongo runner mutation guard/u);
  const target = runnerMutationGuardPath(root, "project-ref", "job-1");
  await symlink(path.join(root, "missing"), target).catch(async () => {
    // The guard directory is created lazily.
    await quarantineRunnerMutation({ configDirectory: root, projectRef: "project-ref", registrationId: "registration-1", jobId: "seed" });
    await symlink(path.join(root, "missing"), target);
  });
  await assert.rejects(runnerMutationIsQuarantined(target), /owner-controlled|invalid/u);
});
