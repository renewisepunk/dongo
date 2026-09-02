import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { CliCoreError } from "./errors.ts";
import { sanitizedChildEnvironment } from "./process-environment.ts";

export type RunnerServicePlatform = "darwin" | "linux";

export interface RunnerServiceSpec {
  projectRef: string;
  repositoryRoot: string;
  nodePath: string;
  cliPath: string;
}

export interface RunnerServiceController {
  readonly platform: RunnerServicePlatform;
  install(spec: RunnerServiceSpec): Promise<{ servicePath: string; serviceName: string }>;
  disable(projectRef: string): Promise<{ servicePath: string; serviceName: string }>;
  remove(projectRef: string): Promise<{ servicePath: string; serviceName: string }>;
}

type RunCommand = (command: string, args: string[]) => Promise<void>;

function safeSuffix(projectRef: string): string {
  return createHash("sha256").update(projectRef).digest("hex").slice(0, 16);
}

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function systemdQuote(value: string): string {
  if (/\r|\n|\0/u.test(value)) {
    throw new CliCoreError({ code: "unsafe_path", message: "Runner service arguments contain control characters." });
  }
  return `"${value
    .replaceAll("%", "%%")
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')}"`;
}

async function safeWrite(target: string, contents: string): Promise<void> {
  const directory = path.dirname(target);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryInfo = await lstat(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
    throw new CliCoreError({ code: "unsafe_path", message: "Runner service directory is not safe." });
  }
  if (typeof process.getuid === "function" && directoryInfo.uid !== process.getuid()) {
    throw new CliCoreError({ code: "unsafe_path", message: "Runner service directory is owned by another user." });
  }
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const handle = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    const existing = await lstat(target);
    if (!existing.isFile() || existing.isSymbolicLink()) {
      throw new CliCoreError({ code: "unsafe_path", message: "Runner service path is not a regular file." });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      await rm(temporary, { force: true });
      throw error;
    }
  }
  try {
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  await chmod(target, 0o600);
}

async function safeRemove(target: string): Promise<void> {
  try {
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new CliCoreError({ code: "unsafe_path", message: "Runner service path is not a regular file." });
    }
    await rm(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function defaultRunCommand(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "ignore",
      env: sanitizedChildEnvironment(),
      shell: false,
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new CliCoreError({
        code: "runner_service_failed",
        message: `The user service command exited with code ${code ?? "unknown"}.`,
        exitCode: 5,
      }));
    });
  });
}

export class LocalRunnerServiceController implements RunnerServiceController {
  readonly platform: RunnerServicePlatform;
  readonly #homeDirectory: string;
  readonly #runCommand: RunCommand;

  constructor(options: {
    platform?: NodeJS.Platform;
    homeDirectory?: string;
    runCommand?: RunCommand;
  } = {}) {
    const platform = options.platform ?? process.platform;
    if (platform !== "darwin" && platform !== "linux") {
      throw new CliCoreError({
        code: "unsupported_platform",
        message: "The dongo runner currently supports macOS and Linux user sessions. Windows is not yet supported.",
        exitCode: 4,
      });
    }
    this.platform = platform;
    this.#homeDirectory = options.homeDirectory ?? os.homedir();
    this.#runCommand = options.runCommand ?? defaultRunCommand;
  }

  async install(spec: RunnerServiceSpec) {
    await Promise.all([
      assertExecutableFile(spec.nodePath),
      assertExecutableFile(spec.cliPath),
      assertRepository(spec.repositoryRoot),
    ]);
    return this.platform === "darwin"
      ? await this.#installLaunchd(spec)
      : await this.#installSystemd(spec);
  }

  async disable(projectRef: string) {
    const service = this.#service(projectRef);
    if (this.platform === "darwin") {
      await this.#runCommand("launchctl", ["disable", `gui/${process.getuid?.() ?? ""}/${service.serviceName}`])
        .catch(() => undefined);
      await this.#runCommand("launchctl", ["bootout", `gui/${process.getuid?.() ?? ""}/${service.serviceName}`])
        .catch(() => undefined);
    } else {
      await this.#runCommand("systemctl", ["--user", "disable", "--now", service.serviceName])
        .catch(() => undefined);
    }
    return service;
  }

  async remove(projectRef: string) {
    const service = await this.disable(projectRef);
    await safeRemove(service.servicePath);
    if (this.platform === "linux") {
      await this.#runCommand("systemctl", ["--user", "daemon-reload"]);
    }
    return service;
  }

  #service(projectRef: string) {
    const suffix = safeSuffix(projectRef);
    if (this.platform === "darwin") {
      const serviceName = `so.dongo.runner.${suffix}`;
      return {
        serviceName,
        servicePath: path.join(this.#homeDirectory, "Library", "LaunchAgents", `${serviceName}.plist`),
      };
    }
    const serviceName = `dongo-runner-${suffix}.service`;
    return {
      serviceName,
      servicePath: path.join(this.#homeDirectory, ".config", "systemd", "user", serviceName),
    };
  }

  async #installLaunchd(spec: RunnerServiceSpec) {
    const service = this.#service(spec.projectRef);
    const uid = process.getuid?.();
    if (uid === undefined) {
      throw new CliCoreError({ code: "runner_service_failed", message: "A user ID is required to install the macOS runner." });
    }
    const contents = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(service.serviceName)}</string>
<key>ProgramArguments</key><array><string>${xml(spec.nodePath)}</string><string>${xml(spec.cliPath)}</string><string>runner</string><string>run</string><string>--project-ref</string><string>${xml(spec.projectRef)}</string></array>
<key>WorkingDirectory</key><string>${xml(spec.repositoryRoot)}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ProcessType</key><string>Background</string>
</dict></plist>
`;
    await safeWrite(service.servicePath, contents);
    await this.#runCommand("launchctl", ["bootout", `gui/${uid}/${service.serviceName}`]).catch(() => undefined);
    await this.#runCommand("launchctl", ["enable", `gui/${uid}/${service.serviceName}`]);
    await this.#runCommand("launchctl", ["bootstrap", `gui/${uid}`, service.servicePath]);
    return service;
  }

  async #installSystemd(spec: RunnerServiceSpec) {
    const service = this.#service(spec.projectRef);
    const contents = `[Unit]
Description=dongo local runner
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${systemdQuote(spec.repositoryRoot)}
ExecStart=${systemdQuote(spec.nodePath)} ${systemdQuote(spec.cliPath)} runner run --project-ref ${systemdQuote(spec.projectRef)}
Restart=on-failure
RestartSec=10
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
`;
    await safeWrite(service.servicePath, contents);
    await this.#runCommand("systemctl", ["--user", "daemon-reload"]);
    await this.#runCommand("systemctl", ["--user", "enable", "--now", service.serviceName]);
    return service;
  }
}

async function assertExecutableFile(target: string): Promise<void> {
  const info = await lstat(path.resolve(target));
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new CliCoreError({ code: "unsafe_path", message: "Runner executable path is not a regular file." });
  }
}

async function assertRepository(target: string): Promise<void> {
  const info = await lstat(path.resolve(target));
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new CliCoreError({ code: "unsafe_path", message: "Runner repository path is not a safe directory." });
  }
}

export async function readRunnerServiceFile(target: string): Promise<string> {
  return await readFile(target, "utf8");
}
