import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

test("the packed CLI installs and runs without workspace dependencies", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "dongo-cli-package-"));
  try {
    const { stdout: packedName } = await execute(
      npm,
      ["pack", "--silent", "--workspace", "@wisepunk/dongo", "--pack-destination", temporaryDirectory],
      { cwd: repositoryRoot },
    );
    const archive = path.join(temporaryDirectory, packedName.trim());
    const prefix = path.join(temporaryDirectory, "install");
    await execute(npm, ["install", "--global", "--prefix", prefix, archive], { cwd: temporaryDirectory });
    const executable = path.join(prefix, "bin", process.platform === "win32" ? "dongo.cmd" : "dongo");
    if (process.platform !== "win32") {
      const bundle = await readFile(await realpath(executable), "utf8");
      assert.doesNotMatch(
        bundle,
        /\/usr\/bin\/(?:security|swift)|find-generic-password|add-generic-password|secret-tool|DONGO_KEYCHAIN/u,
      );
    }
    const { stdout } = await execute(executable, ["--json", "--help"], { cwd: temporaryDirectory });
    const result = JSON.parse(stdout) as { ok?: unknown; command?: unknown; data?: { usage?: unknown } };
    assert.equal(result.ok, true);
    assert.equal(result.command, "help");
    assert.match(String(result.data?.usage), /dongo CLI/);
    const { stdout: versionStdout } = await execute(executable, ["--version"], {
      cwd: temporaryDirectory,
    });
    assert.equal(versionStdout, "dongo 0.2.12\n");
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
});
