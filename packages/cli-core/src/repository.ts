import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import path from "node:path";

import { CliCoreError } from "./errors.ts";

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

export function repositoryName(repositoryRoot: string): string {
  return path.basename(path.resolve(repositoryRoot));
}
