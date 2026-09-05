import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";

import { CliCoreError } from "./errors.ts";

const GUARD_SCHEMA_VERSION = 1;

function validatePart(value: string, label: string): void {
  if (!/^[A-Za-z0-9_-]{1,200}$/u.test(value)) {
    throw new CliCoreError({ code: "validation", message: `${label} is invalid.`, exitCode: 2 });
  }
}

export function runnerMutationGuardPath(configDirectory: string, projectRef: string, jobId: string): string {
  validatePart(projectRef, "Runner project reference");
  validatePart(jobId, "Runner job ID");
  const name = createHash("sha256").update(`${projectRef}:${jobId}`).digest("hex");
  return path.join(path.resolve(configDirectory), "runner-quarantine", `${name}.json`);
}

async function safeDirectory(target: string): Promise<string> {
  const parent = path.dirname(target);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const info = await lstat(parent);
  if (!info.isDirectory() || info.isSymbolicLink() ||
    (typeof process.getuid === "function" && info.uid !== process.getuid())) {
    throw new CliCoreError({ code: "unsafe_path", message: "The runner quarantine directory is not owner-controlled.", exitCode: 4 });
  }
  await chmod(parent, 0o700);
  return await realpath(parent);
}

export async function quarantineRunnerMutation(options: {
  configDirectory: string;
  projectRef: string;
  registrationId: string;
  jobId: string;
  now?: () => number;
}): Promise<string> {
  validatePart(options.registrationId, "Runner registration ID");
  const target = runnerMutationGuardPath(options.configDirectory, options.projectRef, options.jobId);
  const parent = await safeDirectory(target);
  const value = JSON.stringify({
    schemaVersion: GUARD_SCHEMA_VERSION,
    projectRef: options.projectRef,
    registrationId: options.registrationId,
    jobId: options.jobId,
    quarantinedAt: new Date((options.now ?? Date.now)()).toISOString(),
  });
  const temporary = path.join(parent, `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  let exists = false;
  try {
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    exists = true;
    try {
      await handle.writeFile(value, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(temporary, 0o600);
    await rename(temporary, target);
    exists = false;
    return target;
  } finally {
    if (exists) await rm(temporary, { force: true });
  }
}

export async function runnerMutationIsQuarantined(guardPath: string): Promise<boolean> {
  const absolute = path.resolve(guardPath);
  try {
    const info = await lstat(absolute);
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && info.uid !== process.getuid())) {
      throw new CliCoreError({ code: "unsafe_path", message: "The runner quarantine guard is not owner-controlled.", exitCode: 4 });
    }
    const value = JSON.parse(await readFile(absolute, "utf8")) as Record<string, unknown>;
    return value.schemaVersion === GUARD_SCHEMA_VERSION && typeof value.quarantinedAt === "string";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    if (error instanceof CliCoreError) throw error;
    throw new CliCoreError({ code: "unsafe_path", message: "The runner quarantine guard is invalid.", exitCode: 4 });
  }
}

export async function assertRunnerMutationAllowed(guardPath = process.env.DONGO_RUNNER_MUTATION_GUARD_FILE): Promise<void> {
  if (!guardPath || !path.isAbsolute(guardPath)) {
    throw new CliCoreError({
      code: "release_quarantine_unavailable",
      message: "This process has no verified dongo runner mutation guard. External mutations are disabled.",
      exitCode: 6,
    });
  }
  if (await runnerMutationIsQuarantined(guardPath)) {
    throw new CliCoreError({
      code: "release_quarantined",
      message: "This dongo runner job is quarantined. No new external mutation may start; explicitly queue a new job after review.",
      exitCode: 6,
    });
  }
}
