import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { requireRunnerMutationAllowed } from "./runner-mutation-guard.mjs";

test("manual releases remain allowed while managed runner releases fail closed on partial identity", () => {
  assert.deepEqual(requireRunnerMutationAllowed({}), { managed: false });
  assert.throws(() => requireRunnerMutationAllowed({ DONGO_RUNNER_JOB_ID: "job-1" }), /incomplete/u);
  assert.throws(() => requireRunnerMutationAllowed({ DONGO_RUNNER_MUTATION_GUARD_FILE: "/tmp/guard" }), /incomplete/u);
});

test("supported release entry points stop after an exact job guard flips", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dongo-release-guard-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "runner-quarantine");
  await mkdir(directory, { mode: 0o700 });
  const guardPath = path.join(directory, "guard.json");
  const environment = { DONGO_RUNNER_JOB_ID: "job-1", DONGO_RUNNER_MUTATION_GUARD_FILE: guardPath };
  assert.deepEqual(requireRunnerMutationAllowed(environment), { managed: true, jobId: "job-1" });
  await writeFile(guardPath, JSON.stringify({ schemaVersion: 1, jobId: "job-1", quarantinedAt: new Date().toISOString() }), { mode: 0o600 });
  assert.throws(() => requireRunnerMutationAllowed(environment), /job is quarantined/u);
  assert.throws(() => requireRunnerMutationAllowed({ ...environment, DONGO_RUNNER_JOB_ID: "job-2" }), /does not match/u);
});

test("nested release mutations recheck after build or preflight work", async () => {
  for (const file of ["deploy-production-web.mjs", "release-cli.mjs", "activate-agent-release-notice.mjs"]) {
    const source = await readFile(new URL(`./${file}`, import.meta.url), "utf8");
    const check = source.lastIndexOf("requireRunnerMutationAllowed");
    const mutation = file === "release-cli.mjs"
      ? source.indexOf('"publish",', check)
      : file === "deploy-production-web.mjs"
        ? source.indexOf("spawnSync", check)
        : source.indexOf("spawnSync", check);
    assert.ok(check >= 0 && mutation > check, `${file} must recheck immediately before mutation`);
  }
  const development = await readFile(new URL("./deploy-dev.mjs", import.meta.url), "utf8");
  assert.match(development, /web build[\s\S]*web Worker[\s\S]*wrangler[\s\S]*for \(const[\s\S]*requireRunnerMutationAllowed[\s\S]*spawnSync/u);
});
