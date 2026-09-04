import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { CliCoreError } from "./errors.ts";

const execFileAsync = promisify(execFile);

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function findRepositoryRoot(start = process.cwd()): Promise<string> {
  let current = path.resolve(start);
  while (true) {
    if ((await exists(path.join(current, ".agent-work", "project.json"))) || (await exists(path.join(current, ".git")))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new CliCoreError({
    code: "repository_not_found",
    message: "No Git repository was found. Run this command inside the repository you want to connect.",
    exitCode: 2,
  });
}

export function credentialProfile(productOrigin: string, repositoryRoot: string): string {
  const digest = createHash("sha256").update(productOrigin).update("\0").update(path.resolve(repositoryRoot)).digest("hex");
  return `repo-${digest.slice(0, 32)}`;
}

/**
 * Resolve the stable checkout which owns Git's common directory. Linked
 * worktrees have different top-level paths but the same common Git directory,
 * so they must share the repository-scoped credential created by the primary
 * checkout. An unrelated clone has a different common directory and therefore
 * remains isolated even when it has the same remote URL.
 */
export async function canonicalRepositoryRoot(repositoryRoot: string): Promise<string> {
  const resolvedRoot = await realpath(repositoryRoot);
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", resolvedRoot, "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { encoding: "utf8", maxBuffer: 4_096, timeout: 5_000 },
    );
    const commonDirectory = await realpath(path.resolve(resolvedRoot, stdout.trim()));
    return path.basename(commonDirectory) === ".git"
      ? path.dirname(commonDirectory)
      : resolvedRoot;
  } catch {
    return resolvedRoot;
  }
}

export async function repositoryCredentialProfiles(
  productOrigin: string,
  repositoryRoot: string,
): Promise<{ preferred: string; accepted: string[]; linked: Array<{ root: string; profile: string }> }> {
  const [resolvedRoot, canonicalRoot] = await Promise.all([
    realpath(repositoryRoot),
    canonicalRepositoryRoot(repositoryRoot),
  ]);
  const linkedRoots: string[] = [];
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", resolvedRoot, "worktree", "list", "--porcelain", "-z"],
      { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 5_000 },
    );
    for (const field of stdout.split("\0")) {
      if (!field.startsWith("worktree ")) continue;
      linkedRoots.push(await realpath(field.slice("worktree ".length)));
    }
  } catch {
    linkedRoots.push(resolvedRoot);
  }
  const linked = [...new Set([canonicalRoot, resolvedRoot, ...linkedRoots])]
    .map((root) => ({ root, profile: credentialProfile(productOrigin, root) }));
  const preferred = credentialProfile(productOrigin, canonicalRoot);
  return {
    preferred,
    accepted: [...new Set(linked.map(({ profile }) => profile))],
    linked,
  };
}

export function repositoryName(repositoryRoot: string): string {
  return path.basename(path.resolve(repositoryRoot));
}

export function suggestedProjectName(repositoryRoot: string): string {
  const name = repositoryName(repositoryRoot).replace(/[-_]+/gu, " ").trim();
  if (name.toLocaleLowerCase("en-US") === "dongo") return "dongo";
  return name ? `${name[0]!.toUpperCase()}${name.slice(1)}` : "Project";
}

export function normalizeRepositoryUrl(value: string): string | undefined {
  const raw = value.trim();
  if (!raw || raw.length > 2_048 || /[\r\n\0]/u.test(raw)) return undefined;
  const scp = raw.includes("://")
    ? null
    : /^(?:[^@\s/:]+@)?([A-Za-z0-9.-]+):([^\s?#]+)$/u.exec(raw);
  if (scp) {
    const host = scp[1]!.toLowerCase();
    const repositoryPath = scp[2]!.replace(/^\/+|\/+$/gu, "");
    if (!host || !repositoryPath) return undefined;
    return `https://${host}/${repositoryPath.replace(/\.git$/u, "")}`;
  }
  try {
    const url = new URL(raw);
    if (
      !["http:", "https:", "ssh:"].includes(url.protocol)
      || url.username && url.protocol !== "ssh:"
      || url.password
      || url.search
      || url.hash
      || !url.hostname
    ) return undefined;
    const protocol = url.protocol === "ssh:" ? "https:" : url.protocol;
    const repositoryPath = url.pathname.replace(/\.git\/?$/u, "").replace(/\/$/u, "");
    if (!repositoryPath || repositoryPath === "/") return undefined;
    return `${protocol}//${url.hostname}${url.port ? `:${url.port}` : ""}${repositoryPath}`;
  } catch {
    return undefined;
  }
}

export async function repositoryOriginUrl(repositoryRoot: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", repositoryRoot, "config", "--get", "remote.origin.url"],
      { encoding: "utf8", maxBuffer: 4_096, timeout: 5_000 },
    );
    return normalizeRepositoryUrl(stdout);
  } catch {
    return undefined;
  }
}
