import { createHash, randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { CliCoreError } from "./errors.ts";

const DEFAULT_WAIT_MS = 10 * 60 * 1_000;
const STALE_AFTER_MS = 15 * 60 * 1_000;

function cancelled(): CliCoreError {
  return new CliCoreError({
    code: "cancelled",
    message: "The dongo connection wait was cancelled; no additional authorization was started.",
    exitCode: 130,
  });
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function pause(milliseconds: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(cancelled());
    const onAbort = () => {
      clearTimeout(timer);
      reject(cancelled());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function assertOwnerOnly(target: string, info: Stats, kind: "directory" | "file"): void {
  const expected = kind === "directory" ? info.isDirectory() : info.isFile();
  const effectiveUserId = process.geteuid?.();
  if (
    info.isSymbolicLink()
    || !expected
    || effectiveUserId !== undefined && info.uid !== effectiveUserId
    || process.platform !== "win32" && (info.mode & 0o077) !== 0
  ) {
    throw new CliCoreError({
      code: "unsafe_path",
      message: `The dongo connection lock ${kind} is not an owner-only ${kind}.`,
    });
  }
}

export async function acquireConnectionLock(options: {
  directory: string;
  key: string;
  signal?: AbortSignal;
  now?: () => number;
  waitMilliseconds?: number;
}): Promise<{ release: () => Promise<void>; waitedForOwner: boolean }> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.waitMilliseconds ?? DEFAULT_WAIT_MS);
  let waitedForOwner = false;
  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  await chmod(options.directory, 0o700);
  assertOwnerOnly(options.directory, await lstat(options.directory), "directory");
  const digest = createHash("sha256").update(options.key).digest("hex").slice(0, 32);
  const target = path.join(options.directory, `.connect-${digest}.lock`);

  while (true) {
    if (options.signal?.aborted) throw cancelled();
    try {
      const ownerId = randomUUID();
      const handle = await open(target, "wx", 0o600);
      await handle.writeFile(JSON.stringify({ schemaVersion: 1, ownerId, pid: process.pid, startedAt: now() }));
      await handle.sync();
      await handle.close();
      assertOwnerOnly(target, await lstat(target), "file");
      const release = async () => {
        const current = await readFile(target, "utf8").catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return undefined;
          throw error;
        });
        if (!current) return;
        try {
          if ((JSON.parse(current) as { ownerId?: string }).ownerId === ownerId) {
            await rm(target, { force: true });
          }
        } catch {
          // Never remove a lock which no longer proves this caller owns it.
        }
      };
      return { release, waitedForOwner };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      waitedForOwner = true;
    }

    const info = await lstat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!info) continue;
    assertOwnerOnly(target, info, "file");
    let owner: { pid?: number; startedAt?: number } = {};
    try {
      owner = JSON.parse(await readFile(target, "utf8")) as typeof owner;
    } catch {
      // A partially written lock is treated as live until its bounded stale age.
    }
    const age = now() - Math.min(info.mtimeMs, owner.startedAt ?? info.mtimeMs);
    const deadOwner = Number.isSafeInteger(owner.pid) && Number(owner.pid) > 0 && !processExists(Number(owner.pid));
    if (deadOwner || age > STALE_AFTER_MS) {
      const current = await lstat(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (current && current.dev === info.dev && current.ino === info.ino) {
        await rm(target, { force: true });
        waitedForOwner = false;
      }
      continue;
    }
    if (now() >= deadline) {
      throw new CliCoreError({
        code: "connection_in_progress",
        message: "Another dongo connect is still waiting for approval. Keep that command open; this command did not start another authorization.",
        retryable: true,
        exitCode: 5,
      });
    }
    await pause(Math.min(250, Math.max(1, deadline - now())), options.signal);
  }
}
