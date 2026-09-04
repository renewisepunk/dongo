import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, rename, rm, rmdir } from "node:fs/promises";
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
  disarm(projectRef: string): Promise<{ servicePath: string; serviceName: string }>;
  disable(projectRef: string): Promise<{ servicePath: string; serviceName: string }>;
  remove(projectRef: string): Promise<{ servicePath: string; serviceName: string }>;
}

type RunCommand = (command: string, args: string[]) => Promise<void>;

interface RunnerServicePaths {
  servicePath: string;
  serviceName: string;
  launcherPath?: string;
  keepAlivePath?: string;
}

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

function shellQuote(value: string): string {
  if (/\r|\n|\0/u.test(value)) {
    throw new CliCoreError({ code: "unsafe_path", message: "Runner launcher arguments contain control characters." });
  }
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function safeWrite(target: string, contents: string, mode: 0o600 | 0o700 = 0o600): Promise<void> {
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
    mode,
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
  await chmod(target, mode);
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

async function safeRemoveEmptyDirectory(target: string): Promise<void> {
  try {
    const info = await lstat(target);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (typeof process.getuid === "function" && info.uid !== process.getuid())
    ) {
      throw new CliCoreError({ code: "unsafe_path", message: "Runner service directory is not safe to remove." });
    }
    await rmdir(target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTEMPTY") throw error;
  }
}

function publicService(service: RunnerServicePaths) {
  return { servicePath: service.servicePath, serviceName: service.serviceName };
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
        details: { commandExitCode: code },
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
      await this.disarm(projectRef);
      try {
        await this.#runCommand("launchctl", ["bootout", `gui/${process.getuid?.() ?? ""}/${service.serviceName}`]);
      } catch (error) {
        if (!isLaunchdNotLoaded(error)) {
          await this.#restoreServiceKeepAlive(service).catch(() => undefined);
          throw error;
        }
      }
    } else {
      await this.disarm(projectRef);
      try {
        await this.#runCommand("systemctl", ["--user", "stop", service.serviceName]);
      } catch (error) {
        await this.#restoreServiceKeepAlive(service).catch(() => undefined);
        throw error;
      }
    }
    return publicService(service);
  }

  async disarm(projectRef: string) {
    const service = this.#service(projectRef);
    if (this.platform === "darwin") {
      await this.#runCommand("launchctl", ["disable", `gui/${process.getuid?.() ?? ""}/${service.serviceName}`]);
      try {
        if (!service.keepAlivePath) throw new Error("Missing runner keepalive path");
        await safeRemove(service.keepAlivePath);
      } catch (error) {
        await this.#runCommand("launchctl", ["enable", `gui/${process.getuid?.() ?? ""}/${service.serviceName}`])
          .catch(() => undefined);
        throw error;
      }
    } else {
      await this.#runCommand("systemctl", ["--user", "disable", service.serviceName]);
      try {
        if (!service.keepAlivePath) throw new Error("Missing runner keepalive path");
        await safeRemove(service.keepAlivePath);
      } catch (error) {
        await this.#runCommand("systemctl", ["--user", "enable", service.serviceName]).catch(() => undefined);
        throw error;
      }
    }
    return publicService(service);
  }

  async remove(projectRef: string) {
    const service = this.#service(projectRef);
    await safeRemove(service.servicePath);
    if (service.launcherPath) {
      await safeRemove(service.launcherPath);
      if (service.keepAlivePath) await safeRemove(service.keepAlivePath);
      await safeRemoveEmptyDirectory(path.dirname(service.launcherPath));
    }
    if (this.platform === "linux") {
      await this.#runCommand("systemctl", ["--user", "daemon-reload"]);
    }
    return publicService(service);
  }

  #service(projectRef: string): RunnerServicePaths {
    const suffix = safeSuffix(projectRef);
    if (this.platform === "darwin") {
      const serviceName = `so.dongo.runner.${suffix}`;
      return {
        serviceName,
        servicePath: path.join(this.#homeDirectory, "Library", "LaunchAgents", `${serviceName}.plist`),
        launcherPath: path.join(
          this.#homeDirectory,
          "Library",
          "Application Support",
          "dongo",
          "runner-services",
          serviceName,
          "dongo",
        ),
        keepAlivePath: path.join(
          this.#homeDirectory,
          "Library",
          "Application Support",
          "dongo",
          "runner-services",
          serviceName,
          "enabled",
        ),
      };
    }
    const serviceName = `dongo-runner-${suffix}.service`;
    return {
      serviceName,
      servicePath: path.join(this.#homeDirectory, ".config", "systemd", "user", serviceName),
      launcherPath: path.join(
        this.#homeDirectory,
        ".local",
        "share",
        "dongo",
        "runner-services",
        serviceName,
        "dongo",
      ),
      keepAlivePath: path.join(
        this.#homeDirectory,
        ".local",
        "share",
        "dongo",
        "runner-services",
        serviceName,
        "enabled",
      ),
    };
  }

  async #installLaunchd(spec: RunnerServiceSpec) {
    const service = this.#service(spec.projectRef);
    const uid = process.getuid?.();
    if (uid === undefined) {
      throw new CliCoreError({ code: "runner_service_failed", message: "A user ID is required to install the macOS runner." });
    }
    if (!service.launcherPath || !service.keepAlivePath) {
      throw new CliCoreError({ code: "runner_service_failed", message: "The macOS runner launcher path is unavailable." });
    }
    const launcher = `#!/bin/sh
# dongo local runner. Installed and removed by dongo runner commands.
exec ${shellQuote(spec.nodePath)} ${shellQuote(spec.cliPath)} runner run --project-ref ${shellQuote(spec.projectRef)}
`;
    await safeWrite(service.launcherPath, launcher, 0o700);
    await safeWrite(service.keepAlivePath, "enabled\n");
    const contents = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(service.serviceName)}</string>
<key>Program</key><string>${xml(service.launcherPath)}</string>
<key>ProgramArguments</key><array><string>${xml(service.launcherPath)}</string></array>
<key>WorkingDirectory</key><string>${xml(spec.repositoryRoot)}</string>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><dict><key>PathState</key><dict><key>${xml(service.keepAlivePath)}</key><true/></dict></dict>
<key>ProcessType</key><string>Background</string>
</dict></plist>
`;
    await safeWrite(service.servicePath, contents);
    try {
      await this.#runCommand("launchctl", ["bootout", `gui/${uid}/${service.serviceName}`]);
    } catch (error) {
      if (!isLaunchdNotLoaded(error)) throw error;
    }
    await this.#runCommand("launchctl", ["enable", `gui/${uid}/${service.serviceName}`]);
    await this.#runCommand("launchctl", ["bootstrap", `gui/${uid}`, service.servicePath]);
    return publicService(service);
  }

  async #installSystemd(spec: RunnerServiceSpec) {
    const service = this.#service(spec.projectRef);
    if (!service.launcherPath || !service.keepAlivePath) {
      throw new CliCoreError({ code: "runner_service_failed", message: "The Linux runner launcher path is unavailable." });
    }
    const launcher = `#!/bin/sh
# dongo local runner. Installed and removed by dongo runner commands.
if [ ! -f ${shellQuote(service.keepAlivePath)} ]; then exit 0; fi
${shellQuote(spec.nodePath)} ${shellQuote(spec.cliPath)} runner run --project-ref ${shellQuote(spec.projectRef)}
status=$?
if [ ! -f ${shellQuote(service.keepAlivePath)} ]; then exit 0; fi
if [ "$status" -eq 0 ]; then exit 1; fi
exit "$status"
`;
    await safeWrite(service.launcherPath, launcher, 0o700);
    await safeWrite(service.keepAlivePath, "enabled\n");
    const contents = `[Unit]
Description=dongo local runner
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${systemdQuote(spec.repositoryRoot)}
ExecStart=${systemdQuote(service.launcherPath)}
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
    return publicService(service);
  }

  async #restoreServiceKeepAlive(service: RunnerServicePaths) {
    if (!service.keepAlivePath) return;
    await safeWrite(service.keepAlivePath, "enabled\n");
    if (this.platform === "darwin") {
      await this.#runCommand("launchctl", ["enable", `gui/${process.getuid?.() ?? ""}/${service.serviceName}`]);
    } else {
      await this.#runCommand("systemctl", ["--user", "enable", service.serviceName]);
    }
  }
}

function isLaunchdNotLoaded(error: unknown): boolean {
  return error instanceof CliCoreError &&
    error.code === "runner_service_failed" &&
    (error.details as { commandExitCode?: unknown } | undefined)?.commandExitCode === 3;
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
