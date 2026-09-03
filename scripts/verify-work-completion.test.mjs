import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseCompletionArguments, verifyWorkCompletion } from "./verify-work-completion.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "dongo-completion-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = join(root, "remote.git");
  const cwd = join(root, "checkout");
  mkdirSync(cwd);
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: {
    ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.invalid",
    GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.invalid",
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
  } }).trim();
  git("init", "--bare", "--initial-branch=main", remote);
  git("init", "--initial-branch=main");
  git("remote", "add", "origin", remote);
  const commit = (file, content) => {
    writeFileSync(join(cwd, file), content);
    git("add", "--", file);
    git("-c", "commit.gpgsign=false", "commit", "-m", "test change");
    return git("rev-parse", "HEAD");
  };
  const initial = commit("base.txt", "base");
  git("push", "--set-upstream", "origin", "main");
  const verify = (commits = [initial], target = "origin/main") => verifyWorkCompletion({ cwd, target, commits });
  return { root, remote, cwd, git, commit, initial, verify };
}

test("proves an integrated commit on a clean synchronized shared target without changing files", (t) => {
  const f = fixture(t);
  const delivered = f.commit("feature.txt", "delivered");
  f.git("push", "origin", "main");
  const result = f.verify([f.initial, delivered]);
  assert.equal(result.ok, true);
  assert.equal(result.targetRevision, delivered);
  assert.deepEqual(result.integratedCommits, [f.initial, delivered]);
  assert.equal(f.git("status", "--porcelain"), "");
});

test("rejects a clean pushed feature branch that is not integrated into the shared target", (t) => {
  const f = fixture(t);
  f.git("switch", "-c", "feature");
  const feature = f.commit("feature.txt", "unmerged");
  f.git("push", "--set-upstream", "origin", "feature");
  assert.throws(() => f.verify([feature]), { code: "unmerged_commit" });
  assert.equal(f.git("branch", "--show-current"), "feature");
});

test("rejects untracked, unstaged, and staged edits without discarding them", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.cwd, "untracked.txt"), "preserve");
  assert.throws(() => f.verify(), { code: "dirty_checkout" });
  f.git("add", "untracked.txt");
  assert.throws(() => f.verify(), { code: "dirty_checkout" });
  f.git("-c", "commit.gpgsign=false", "commit", "-m", "preserve staged");
  writeFileSync(join(f.cwd, "base.txt"), "preserve unstaged");
  assert.throws(() => f.verify(), { code: "dirty_checkout" });
});

test("fresh fetch rejects apparently synchronized stale target after the remote advances", (t) => {
  const f = fixture(t);
  f.git("switch", "-c", "advance");
  const newer = f.commit("newer.txt", "new remote state");
  // Directly update only the synthetic bare remote; local origin/main remains stale.
  f.git("--git-dir", f.remote, "fetch", f.cwd, "advance:refs/heads/main");
  f.git("switch", "main");
  assert.equal(f.git("rev-parse", "origin/main"), f.initial);
  assert.throws(() => f.verify(), { code: "unsynchronized_checkout" });
  assert.equal(f.git("rev-parse", "origin/main"), newer);
  assert.equal(f.git("rev-parse", "HEAD"), f.initial);
});

test("fails closed when target cannot be fetched, without leaking configured remote content", (t) => {
  const f = fixture(t);
  f.git("remote", "set-url", "origin", join(f.root, "private-secret-missing.git"));
  assert.throws(() => f.verify(), (error) => {
    assert.equal(error.code, "fetch_failed");
    assert.doesNotMatch(error.message, /private-secret|missing.git/);
    return true;
  });
});

test("does not infer target, allow a local branch, or accept no exact delivered commits", (t) => {
  const f = fixture(t);
  assert.throws(() => f.verify([f.initial], "main"), { code: "invalid_target" });
  assert.throws(() => f.verify([f.initial], "origin/HEAD"), { code: "invalid_target" });
  assert.throws(() => f.verify([]), { code: "invalid_input" });
  assert.throws(() => f.verify(["HEAD"]), { code: "invalid_input" });
  assert.throws(() => f.verify(["a".repeat(40)]), { code: "missing_commit" });
  assert.throws(() => parseCompletionArguments(["--target", "origin/main", "--target", "origin/feature"]), { code: "invalid_input" });
});

test("a cherry-pick requires the actual integrated SHA, not an unrelated source identity", (t) => {
  const f = fixture(t);
  f.git("switch", "-c", "feature");
  const source = f.commit("feature.txt", "implemented");
  f.git("switch", "main");
  f.commit("adjacent.txt", "independent");
  f.git("-c", "commit.gpgsign=false", "cherry-pick", source);
  const integrated = f.git("rev-parse", "HEAD");
  assert.notEqual(source, integrated);
  f.git("push", "origin", "main");
  assert.throws(() => f.verify([source]), { code: "unmerged_commit" });
  assert.equal(f.verify([integrated]).targetRevision, integrated);
});

test("command-line entrypoint emits one evidence JSON result or a nonzero sanitized failure", (t) => {
  const f = fixture(t);
  const helper = fileURLToPath(new URL("./verify-work-completion.mjs", import.meta.url));
  const options = { cwd: f.cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
  const stdout = execFileSync(process.execPath, [helper, "--target", "origin/main", "--commit", f.initial], options);
  assert.equal(JSON.parse(stdout).targetRevision, f.initial);
  assert.doesNotMatch(stdout, /remote\.git|checkout/);
  assert.throws(() => execFileSync(process.execPath, [helper, "--target", "origin/main", "--commit", "HEAD"], options), (error) => {
    assert.equal(error.status, 1);
    assert.equal(error.stdout, "");
    assert.equal(JSON.parse(error.stderr).code, "invalid_input");
    return true;
  });
});
