import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import type { Stats } from "node:fs";
import { chmod, lstat, mkdir, open, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CliCoreError } from "./errors.ts";

export interface SecretStore {
  readonly kind: string;
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export class MemorySecretStore implements SecretStore {
  readonly kind = "memory";
  readonly #values = new Map<string, string>();

  async get(key: string) {
    return this.#values.get(key);
  }

  async set(key: string, value: string) {
    this.#values.set(key, value);
  }

  async delete(key: string) {
    this.#values.delete(key);
  }
}

function fileName(key: string): string {
  return `${createHash("sha256").update(key).digest("hex")}.json`;
}

async function assertSafeDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new CliCoreError({ code: "unsafe_path", message: `Credential directory is not a safe directory: ${directory}` });
  }
  if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
    throw new CliCoreError({ code: "unsafe_path", message: "Credential directory is owned by another user." });
  }
  await chmod(directory, 0o700);
  const secured = await lstat(directory);
  if ((secured.mode & 0o077) !== 0) {
    throw new CliCoreError({ code: "unsafe_path", message: "Credential directory permissions are not owner-only." });
  }
}

function assertSafeCredentialFile(info: Stats): void {
  if (!info.isFile()) throw new CliCoreError({ code: "unsafe_path", message: "Credential path is not a regular file." });
  if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
    throw new CliCoreError({ code: "unsafe_path", message: "Credential file is owned by another user." });
  }
  if ((info.mode & 0o077) !== 0) {
    throw new CliCoreError({ code: "unsafe_path", message: "Credential file permissions are not 0600." });
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, constants.O_RDONLY);
  try {
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EINVAL" && code !== "ENOTSUP") throw error;
  } finally {
    await handle.close();
  }
}

export class FileSecretStore implements SecretStore {
  readonly kind = "local-user-file";
  readonly #directory: string;

  constructor(directory: string) {
    this.#directory = path.resolve(directory);
  }

  async get(key: string): Promise<string | undefined> {
    await assertSafeDirectory(this.#directory);
    const target = path.join(this.#directory, fileName(key));
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      assertSafeCredentialFile(await handle.stat());
      return await handle.readFile({ encoding: "utf8" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      if ((error as NodeJS.ErrnoException).code === "ELOOP") {
        throw new CliCoreError({ code: "unsafe_path", message: "Credential path is a symlink." });
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  async set(key: string, value: string): Promise<void> {
    await assertSafeDirectory(this.#directory);
    const target = path.join(this.#directory, fileName(key));
    try {
      const existing = await lstat(target);
      if (existing.isSymbolicLink()) throw new CliCoreError({ code: "unsafe_path", message: "Credential path is a symlink." });
      assertSafeCredentialFile(existing);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const temporary = path.join(this.#directory, `.${fileName(key)}.${process.pid}.${randomUUID()}.tmp`);
    let temporaryExists = false;
    try {
      const handle = await open(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      temporaryExists = true;
      try {
        await handle.writeFile(value, { encoding: "utf8" });
        await handle.sync();
      } finally {
        await handle.close();
      }
      await chmod(temporary, 0o600);
      assertSafeCredentialFile(await lstat(temporary));
      await rename(temporary, target);
      temporaryExists = false;
      assertSafeCredentialFile(await lstat(target));
      await syncDirectory(this.#directory);
    } catch (error) {
      if (temporaryExists) await rm(temporary, { force: true });
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await assertSafeDirectory(this.#directory);
    const target = path.join(this.#directory, fileName(key));
    try {
      const info = await lstat(target);
      if (info.isSymbolicLink()) throw new CliCoreError({ code: "unsafe_path", message: "Credential path is a symlink." });
      assertSafeCredentialFile(info);
      await rm(target);
      await syncDirectory(this.#directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export function defaultConfigDirectory(): string {
  const override = process.env.DONGO_CONFIG_DIR;
  if (override) return path.resolve(override);
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA ?? os.homedir(), "Dongo");
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "dongo");
}

export function createDefaultSecretStore(options: {
  configDirectory?: string;
} = {}): SecretStore {
  if (process.platform === "win32") {
    throw new CliCoreError({
      code: "secure_store_unavailable",
      message: "Persistent interactive login is not yet supported on Windows. Use Dongo in WSL on its Linux filesystem.",
      exitCode: 4,
    });
  }
  return new FileSecretStore(path.join(options.configDirectory ?? defaultConfigDirectory(), "credentials"));
}
