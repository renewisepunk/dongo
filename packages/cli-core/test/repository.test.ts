import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  normalizeRepositoryUrl,
  repositoryCredentialProfiles,
  suggestedProjectName,
} from "../src/repository.ts";

const execFileAsync = promisify(execFile);

test("keeps the dongo brand lowercase when proposing a project name", () => {
  assert.equal(suggestedProjectName("/workspace/dongo"), "dongo");
  assert.equal(suggestedProjectName(`/workspace/${["Don", "go"].join("")}`), "dongo");
  assert.equal(suggestedProjectName("/workspace/example-project"), "Example project");
});

test("normalizes HTTPS, SCP-style, and SSH Git origins without inventing hosts", () => {
  assert.equal(
    normalizeRepositoryUrl("https://github.com/renewisepunk/dongo.git"),
    "https://github.com/renewisepunk/dongo",
  );
  assert.equal(
    normalizeRepositoryUrl("git@github.com:renewisepunk/dongo.git"),
    "https://github.com/renewisepunk/dongo",
  );
  assert.equal(
    normalizeRepositoryUrl("ssh://git@github.com/renewisepunk/dongo.git"),
    "https://github.com/renewisepunk/dongo",
  );
});

test("omits credential-bearing or malformed repository origins", () => {
  assert.equal(normalizeRepositoryUrl("https://token@example.com/owner/repo"), undefined);
  assert.equal(normalizeRepositoryUrl("https://example.com/owner/repo?token=secret"), undefined);
  assert.equal(normalizeRepositoryUrl("not a repository"), undefined);
});

test("linked worktrees share a credential profile while independent repositories do not", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dongo-profile-worktree-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const primary = path.join(directory, "primary");
  const linked = path.join(directory, "linked");
  const independent = path.join(directory, "independent");
  await mkdir(primary);
  await execFileAsync("git", ["-C", primary, "init", "-q"]);
  await execFileAsync("git", ["-C", primary, "config", "user.email", "test@example.com"]);
  await execFileAsync("git", ["-C", primary, "config", "user.name", "Test"]);
  await execFileAsync("git", ["-C", primary, "commit", "--allow-empty", "-m", "initial"]);
  await execFileAsync("git", ["-C", primary, "worktree", "add", "-q", "-b", "linked", linked]);
  await mkdir(independent);
  await execFileAsync("git", ["-C", independent, "init", "-q"]);

  const origin = "https://dongo.so";
  const primaryProfiles = await repositoryCredentialProfiles(origin, primary);
  const linkedProfiles = await repositoryCredentialProfiles(origin, linked);
  const independentProfiles = await repositoryCredentialProfiles(origin, independent);
  assert.equal(linkedProfiles.preferred, primaryProfiles.preferred);
  assert.ok(linkedProfiles.accepted.includes(primaryProfiles.preferred));
  assert.notEqual(independentProfiles.preferred, primaryProfiles.preferred);
});
