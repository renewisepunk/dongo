import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

/** Local evidence only: never changes files, merges, pushes, or finishes Work. */
export function verifyWorkCompletion({ cwd = process.cwd(), target, commits }) {
  if (typeof target !== "string" || !target || !Array.isArray(commits) ||
      commits.length === 0 || commits.some((sha) => !SHA.test(sha))) {
    fail("invalid_input", "Specify an explicit remote target and at least one full integrated commit SHA.");
  }
  const git = (args, code = "git_failed") => {
    try {
      return execFileSync("git", args, {
        cwd, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
      }).trim();
    } catch {
      // Git stderr may contain credential-bearing remote URLs or private paths.
      fail(code, `Git verification failed (${code}); inspect the repository locally without publishing credentials.`);
    }
  };
  const clean = () => {
    if (git(["status", "--porcelain=v1", "--untracked-files=all"]) !== "") {
      fail("dirty_checkout", "The integration checkout has uncommitted or untracked changes; preserve and resolve them before completion.");
    }
  };
  clean();
  const fullTarget = target.startsWith("refs/remotes/") ? target : `refs/remotes/${target}`;
  git(["check-ref-format", fullTarget], "invalid_target");
  const remoteTarget = fullTarget.slice("refs/remotes/".length);
  const remote = git(["remote"]).split("\n")
    .filter((name) => name && !name.startsWith("-") && remoteTarget.startsWith(`${name}/`))
    .sort((a, b) => b.length - a.length)[0];
  if (!remote) fail("invalid_target", "The target must name a configured remote branch, not a local or feature-branch upstream inferred by the helper.");
  const branch = remoteTarget.slice(remote.length + 1);
  if (!branch || branch === "HEAD") fail("invalid_target", "Choose the actual shared target branch; remote HEAD is not an explicit target.");
  const remoteRef = `refs/heads/${branch}`;
  git(["check-ref-format", remoteRef], "invalid_target");
  git(["fetch", "--no-tags", "--no-recurse-submodules", remote, `+${remoteRef}:${fullTarget}`], "fetch_failed");
  const targetRevision = git(["rev-parse", "--verify", `${fullTarget}^{commit}`], "invalid_target");
  const headRevision = git(["rev-parse", "--verify", "HEAD^{commit}"]);
  for (const commit of [...new Set(commits)]) {
    git(["rev-parse", "--verify", `${commit}^{commit}`], "missing_commit");
    git(["merge-base", "--is-ancestor", commit, targetRevision], "unmerged_commit");
  }
  if (headRevision !== targetRevision) {
    fail("unsynchronized_checkout", "The integration checkout HEAD does not equal the freshly fetched shared target. This helper never resets or merges it.");
  }
  clean();
  // A remote branch can move while local checks run. Fail closed at this final observation.
  const remoteLines = git(["ls-remote", "--exit-code", "--refs", remote, remoteRef], "remote_check_failed").split("\n");
  if (remoteLines.length !== 1 || remoteLines[0] !== `${targetRevision}\t${remoteRef}`) {
    fail("target_changed", "The remote target changed during verification; refetch, reassess, and rerun the relevant checks.");
  }
  if (git(["rev-parse", "--verify", "HEAD^{commit}"]) !== headRevision ||
      git(["rev-parse", "--verify", `${fullTarget}^{commit}`]) !== targetRevision) {
    fail("checkout_changed", "Local HEAD or the target ref changed during verification; reassess ownership and rerun the checks.");
  }
  clean();
  return {
    ok: true, kind: "host_git_completion_evidence", target: fullTarget,
    targetRevision, headRevision, integratedCommits: [...new Set(commits)],
    clean: true, synchronized: true, remoteCheckedAt: new Date().toISOString(),
    scope: "Git integration only; the caller must verify scope completeness, behavior, and any required release acceptance separately.",
  };
}

export function parseCompletionArguments(args) {
  const input = { target: undefined, commits: [] };
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!value || (option !== "--target" && option !== "--commit")) fail("invalid_input", "Usage: node verify-work-completion.mjs --target origin/main --commit FULL_SHA [--commit FULL_SHA]");
    if (option === "--commit") input.commits.push(value);
    else {
      if (input.target !== undefined) fail("invalid_input", "Specify --target exactly once.");
      input.target = value;
    }
  }
  return input;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(verifyWorkCompletion(parseCompletionArguments(process.argv.slice(2))), null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, code: error.code ?? "verification_failed", message: error.message }));
    process.exitCode = 1;
  }
}
