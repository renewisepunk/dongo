import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, lstat, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CliCoreError } from "./errors.ts";
import { sanitizedChildEnvironment } from "./process-environment.ts";

export interface SecretStore {
  readonly kind: string;
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  run(
    command: string,
    args: string[],
    input?: string,
    environment?: NodeJS.ProcessEnv,
  ): Promise<CommandResult>;
}

export class SpawnCommandRunner implements CommandRunner {
  run(
    command: string,
    args: string[],
    input = "",
    environment: NodeJS.ProcessEnv = {},
  ): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        env: sanitizedChildEnvironment(environment),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
      child.once("error", reject);
      child.once("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
      child.stdin.end(input);
    });
  }
}

const MACOS_KEYCHAIN_SET_SCRIPT = String.raw`
import Darwin
import Foundation
import Security

let environment = ProcessInfo.processInfo.environment
guard let account = environment["DONGO_KEYCHAIN_ACCOUNT"],
      let service = environment["DONGO_KEYCHAIN_SERVICE"] else {
  exit(2)
}
let value = FileHandle.standardInput.readDataToEndOfFile()
guard !value.isEmpty else { exit(2) }

let identity: [CFString: Any] = [
  kSecClass: kSecClassGenericPassword,
  kSecAttrAccount: account,
  kSecAttrService: service,
]
var trustedApplication: SecTrustedApplication?
guard SecTrustedApplicationCreateFromPath(
  "/usr/bin/security",
  &trustedApplication
) == errSecSuccess,
let trustedApplication else {
  exit(1)
}
var access: SecAccess?
guard SecAccessCreate(
  service as CFString,
  [trustedApplication] as CFArray,
  &access
) == errSecSuccess,
let access else {
  exit(1)
}
let updateStatus = SecItemUpdate(
  identity as CFDictionary,
  [kSecValueData: value, kSecAttrAccess: access] as CFDictionary
)
if updateStatus == errSecSuccess { exit(0) }
guard updateStatus == errSecItemNotFound else { exit(1) }

var item = identity
item[kSecValueData] = value
item[kSecAttrAccess] = access
exit(SecItemAdd(item as CFDictionary, nil) == errSecSuccess ? 0 : 1)
`;

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

export class MacOSKeychainStore implements SecretStore {
  readonly kind = "macos-keychain";
  readonly #service: string;
  readonly #runner: CommandRunner;

  constructor(options: { service?: string; runner?: CommandRunner } = {}) {
    this.#service = options.service ?? "so.dongo.cli";
    this.#runner = options.runner ?? new SpawnCommandRunner();
  }

  async get(key: string): Promise<string | undefined> {
    const result = await this.#runner.run("/usr/bin/security", [
      "find-generic-password",
      "-w",
      "-a",
      key,
      "-s",
      this.#service,
    ]);
    if (result.code === 44 || /could not be found/i.test(result.stderr)) return undefined;
    if (result.code !== 0) throw this.#unavailable();
    return result.stdout.replace(/\r?\n$/, "");
  }

  async set(key: string, value: string): Promise<void> {
    const result = await this.#runner.run(
      "/usr/bin/swift",
      ["-e", MACOS_KEYCHAIN_SET_SCRIPT],
      value,
      {
        DONGO_KEYCHAIN_ACCOUNT: key,
        DONGO_KEYCHAIN_SERVICE: this.#service,
      },
    );
    if (result.code !== 0) throw this.#unavailable();
  }

  async delete(key: string): Promise<void> {
    const result = await this.#runner.run("/usr/bin/security", [
      "delete-generic-password",
      "-a",
      key,
      "-s",
      this.#service,
    ]);
    if (result.code !== 0 && result.code !== 44 && !/could not be found/i.test(result.stderr)) throw this.#unavailable();
  }

  #unavailable(): CliCoreError {
    return new CliCoreError({
      code: "secure_store_unavailable",
      message: "The macOS Keychain is unavailable. Retry after unlocking it or explicitly allow the 0600 file fallback.",
      exitCode: 4,
    });
  }
}

export class SecretToolStore implements SecretStore {
  readonly kind = "secret-service";
  readonly #runner: CommandRunner;

  constructor(runner: CommandRunner = new SpawnCommandRunner()) {
    this.#runner = runner;
  }

  async get(key: string): Promise<string | undefined> {
    const result = await this.#runner.run("secret-tool", ["lookup", "service", "dongo-cli", "profile", key]);
    if (result.code === 1 && result.stdout.length === 0) return undefined;
    if (result.code !== 0) throw this.#unavailable();
    return result.stdout.replace(/\r?\n$/, "");
  }

  async set(key: string, value: string): Promise<void> {
    const result = await this.#runner.run(
      "secret-tool",
      ["store", "--label", "Dongo CLI", "service", "dongo-cli", "profile", key],
      `${value}\n`,
    );
    if (result.code !== 0) throw this.#unavailable();
  }

  async delete(key: string): Promise<void> {
    const result = await this.#runner.run("secret-tool", ["clear", "service", "dongo-cli", "profile", key]);
    if (result.code !== 0 && result.code !== 1) throw this.#unavailable();
  }

  #unavailable(): CliCoreError {
    return new CliCoreError({
      code: "secure_store_unavailable",
      message: "The system Secret Service is unavailable. Retry after unlocking it or explicitly allow the 0600 file fallback.",
      exitCode: 4,
    });
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
}

export class FileSecretStore implements SecretStore {
  readonly kind = "file-0600";
  readonly #directory: string;

  constructor(directory: string) {
    this.#directory = path.resolve(directory);
  }

  async get(key: string): Promise<string | undefined> {
    await assertSafeDirectory(this.#directory);
    const target = path.join(this.#directory, fileName(key));
    try {
      const info = await lstat(target);
      if (info.isSymbolicLink() || !info.isFile()) throw new CliCoreError({ code: "unsafe_path", message: "Credential path is unsafe." });
      if ((info.mode & 0o077) !== 0) throw new CliCoreError({ code: "unsafe_path", message: "Credential file permissions are not 0600." });
      return await readFile(target, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async set(key: string, value: string): Promise<void> {
    await assertSafeDirectory(this.#directory);
    const target = path.join(this.#directory, fileName(key));
    try {
      const existing = await lstat(target);
      if (existing.isSymbolicLink() || !existing.isFile()) throw new CliCoreError({ code: "unsafe_path", message: "Credential path is unsafe." });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const temporary = path.join(this.#directory, `.${fileName(key)}.${process.pid}.${randomUUID()}.tmp`);
    await writeFile(temporary, value, { mode: 0o600, flag: "wx" });
    try {
      await rename(temporary, target);
      await chmod(target, 0o600);
      const info = await stat(target);
      if ((info.mode & 0o077) !== 0) throw new Error("Could not enforce 0600 credential permissions.");
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await assertSafeDirectory(this.#directory);
    const target = path.join(this.#directory, fileName(key));
    try {
      const info = await lstat(target);
      if (info.isSymbolicLink()) throw new CliCoreError({ code: "unsafe_path", message: "Credential path is unsafe." });
      await rm(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export class ExplicitFallbackSecretStore implements SecretStore {
  readonly #primary?: SecretStore;
  readonly #fallback?: SecretStore;
  #activeKind?: string;

  constructor(options: { primary?: SecretStore; fallback?: SecretStore }) {
    this.#primary = options.primary;
    this.#fallback = options.fallback;
  }

  get kind(): string {
    return this.#activeKind ?? this.#primary?.kind ?? this.#fallback?.kind ?? "unavailable";
  }

  async get(key: string): Promise<string | undefined> {
    if (this.#primary) {
      try {
        const value = await this.#primary.get(key);
        if (value !== undefined) {
          this.#activeKind = this.#primary.kind;
          return value;
        }
      } catch (error) {
        if (!this.#fallback) throw this.#normalizeUnavailable(error);
      }
    }
    const value = await this.#fallback?.get(key);
    if (this.#fallback) this.#activeKind = this.#fallback.kind;
    return value;
  }

  async set(key: string, value: string): Promise<void> {
    if (this.#primary) {
      try {
        await this.#primary.set(key, value);
        this.#activeKind = this.#primary.kind;
        return;
      } catch (error) {
        if (!this.#fallback) throw this.#normalizeUnavailable(error);
      }
    }
    if (!this.#fallback) {
      throw new CliCoreError({
        code: "secure_store_unavailable",
        message: "No OS credential store is available. Re-run with --allow-file-secret-store to use the strict 0600 fallback.",
        exitCode: 4,
      });
    }
    await this.#fallback.set(key, value);
    this.#activeKind = this.#fallback.kind;
  }

  async delete(key: string): Promise<void> {
    let primaryError: unknown;
    if (this.#primary) {
      try {
        await this.#primary.delete(key);
      } catch (error) {
        primaryError = error;
      }
    }
    if (this.#fallback) await this.#fallback.delete(key);
    if (primaryError && !this.#fallback) throw this.#normalizeUnavailable(primaryError);
  }

  #normalizeUnavailable(error: unknown): CliCoreError {
    if (error instanceof CliCoreError) return error;
    return new CliCoreError({
      code: "secure_store_unavailable",
      message: "The OS credential store is unavailable. Re-run with --allow-file-secret-store to use the strict 0600 fallback.",
      exitCode: 4,
      cause: error,
    });
  }
}

export function defaultConfigDirectory(): string {
  const override = process.env.DONGO_CONFIG_DIR;
  if (override) return path.resolve(override);
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA ?? os.homedir(), "Dongo");
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "dongo");
}

export function createDefaultSecretStore(options: {
  allowFileFallback?: boolean;
  configDirectory?: string;
  runner?: CommandRunner;
} = {}): SecretStore {
  const runner = options.runner ?? new SpawnCommandRunner();
  const primary =
    process.platform === "darwin"
      ? new MacOSKeychainStore({ runner })
      : process.platform === "linux"
        ? new SecretToolStore(runner)
        : undefined;
  const fallback = options.allowFileFallback
    ? new FileSecretStore(path.join(options.configDirectory ?? defaultConfigDirectory(), "credentials"))
    : undefined;
  return new ExplicitFallbackSecretStore({ primary, fallback });
}
