import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { RunnerJob } from "@dongo/contracts";
import { CliCoreError } from "./errors.ts";
import { sanitizedChildEnvironment } from "./process-environment.ts";

const execFileAsync = promisify(execFile);

export interface RunnerWorkspace {
  repositoryRoot: string;
  worktreeName: string;
  branch: string;
}

export class RunnerWorkspaceManager {
  readonly #repositoryRoot: string;
  readonly #directory: string;
  readonly #environmentPath: string;
  #gitQueue: Promise<void> = Promise.resolve();

  constructor(input: {
    repositoryRoot: string;
    configDirectory: string;
    projectRef: string;
    environmentPath: string;
  }) {
    this.#repositoryRoot = input.repositoryRoot;
    this.#directory = path.join(
      input.configDirectory,
      "runner-worktrees",
      safeHash(input.projectRef),
    );
    this.#environmentPath = input.environmentPath;
  }

  async preflight(): Promise<void> {
    await this.#serialized(async () => {
      await mkdir(this.#directory, { recursive: true, mode: 0o700 });
      await assertOwnerDirectory(this.#directory);
      await Promise.all([
        this.#git(this.#repositoryRoot, ["rev-parse", "--show-toplevel"]),
        this.#git(this.#repositoryRoot, ["rev-parse", "--verify", "HEAD^{commit}"]),
        this.#git(this.#repositoryRoot, ["worktree", "list", "--porcelain"]),
      ]);
    });
  }

  async recover(job: RunnerJob): Promise<RunnerWorkspace> {
    return await this.#serialized(async () => {
      const workspace = this.#workspace(job);
      const existing = await lstat(workspace.repositoryRoot).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (!existing) {
        throw new CliCoreError({
          code: "runner_workspace_missing",
          message: "The runner cannot resume this job because its isolated worktree is missing.",
          exitCode: 4,
        });
      }
      await assertOwnerDirectory(workspace.repositoryRoot);
      await this.#assertReusable(workspace.repositoryRoot, workspace.branch);
      return { ...workspace, repositoryRoot: await realpath(workspace.repositoryRoot) };
    });
  }

  async prepare(job: RunnerJob): Promise<RunnerWorkspace> {
    return await this.#serialized(async () => {
      await mkdir(this.#directory, { recursive: true, mode: 0o700 });
      await assertOwnerDirectory(this.#directory);
      const { repositoryRoot, worktreeName, branch } = this.#workspace(job);
      const existing = await lstat(repositoryRoot).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (existing) {
        await assertOwnerDirectory(repositoryRoot);
        await this.#assertReusable(repositoryRoot, branch);
        return { repositoryRoot: await realpath(repositoryRoot), worktreeName, branch };
      }
      const branchExists = await this.#git(
        this.#repositoryRoot,
        ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
        true,
      );
      const args = branchExists
        ? ["worktree", "add", repositoryRoot, branch]
        : ["worktree", "add", "-b", branch, repositoryRoot, "HEAD"];
      await this.#git(this.#repositoryRoot, args);
      await assertOwnerDirectory(repositoryRoot);
      await this.#assertReusable(repositoryRoot, branch);
      return { repositoryRoot: await realpath(repositoryRoot), worktreeName, branch };
    });
  }

  #workspace(job: RunnerJob): RunnerWorkspace {
    const suffix = safeHash(job.id).slice(0, 12);
    const subject = job.kind === "work" && job.workIdentifier
      ? job.workIdentifier
      : "intake";
    return {
      repositoryRoot: path.join(this.#directory, safeHash(job.id)),
      worktreeName: `${subject}-${suffix.slice(0, 8)}`,
      branch: `codex/dongo-runner-${subject}-${suffix}`,
    };
  }

  async cleanup(workspace: RunnerWorkspace): Promise<boolean> {
    return await this.#serialized(async () => {
      const info = await lstat(workspace.repositoryRoot).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (!info) return true;
      await assertOwnerDirectory(workspace.repositoryRoot);
      await this.#assertReusable(workspace.repositoryRoot, workspace.branch);
      const clean = (await this.#git(workspace.repositoryRoot, [
        "status", "--porcelain=v1", "-z", "--untracked-files=normal",
      ])).stdout.length === 0;
      if (!clean) return false;
      const merged = await this.#git(this.#repositoryRoot, [
        "merge-base", "--is-ancestor", workspace.branch, "origin/main",
      ], true);
      if (!merged) return false;
      await this.#git(this.#repositoryRoot, ["worktree", "remove", workspace.repositoryRoot]);
      await this.#git(this.#repositoryRoot, ["branch", "-d", workspace.branch]);
      return true;
    });
  }

  async #assertReusable(repositoryRoot: string, branch: string) {
    const [actualRoot, actualBranch, expectedCommon, actualCommon] = await Promise.all([
      this.#git(repositoryRoot, ["rev-parse", "--show-toplevel"]),
      this.#git(repositoryRoot, ["branch", "--show-current"]),
      this.#git(this.#repositoryRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
      this.#git(repositoryRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    ]);
    const [canonicalActualRoot, canonicalRepositoryRoot, canonicalExpectedCommon, canonicalActualCommon] = await Promise.all([
      realpath(actualRoot.stdout.trim()),
      realpath(repositoryRoot),
      realpath(expectedCommon.stdout.trim()),
      realpath(actualCommon.stdout.trim()),
    ]);
    if (
      canonicalActualRoot !== canonicalRepositoryRoot ||
      actualBranch.stdout.trim() !== branch ||
      canonicalExpectedCommon !== canonicalActualCommon
    ) {
      throw new CliCoreError({
        code: "unsafe_repository",
        message: "The runner worktree does not match its approved repository binding.",
        exitCode: 4,
      });
    }
  }

  async #git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }>;
  async #git(cwd: string, args: string[], allowFailure: true): Promise<{ stdout: string; stderr: string } | undefined>;
  async #git(cwd: string, args: string[], allowFailure = false): Promise<{ stdout: string; stderr: string } | undefined> {
    try {
      const result = await execFileAsync("git", ["-C", cwd, ...args], {
        encoding: "utf8",
        env: sanitizedChildEnvironment({ PATH: this.#environmentPath }),
        maxBuffer: 1 * 1_024 * 1_024,
        timeout: 30_000,
      });
      return { stdout: result.stdout, stderr: result.stderr };
    } catch (error) {
      if (allowFailure) {
        return undefined;
      }
      throw new CliCoreError({
        code: "worktree_setup_failed",
        message: "The runner could not prepare an isolated Git worktree.",
        exitCode: 4,
      });
    }
  }

  async #serialized<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#gitQueue;
    let release!: () => void;
    this.#gitQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

function safeHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function assertOwnerDirectory(directory: string) {
  const info = await lstat(directory);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (typeof process.getuid === "function" && info.uid !== process.getuid())
  ) {
    throw new CliCoreError({
      code: "unsafe_path",
      message: "The runner worktree directory is not safe.",
      exitCode: 4,
    });
  }
}
