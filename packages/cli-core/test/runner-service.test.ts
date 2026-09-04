import assert from "node:assert/strict";
import { access, chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CliCoreError } from "../src/errors.ts";
import {
  LocalRunnerServiceController,
  readRunnerServiceFile,
} from "../src/runner-service.ts";

test("macOS runner service restarts clean exits only while its owner-controlled enable marker exists", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dongo-runner-launchd-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await serviceFixture(root);
  const commands: Array<{ command: string; args: string[] }> = [];
  const service = new LocalRunnerServiceController({
    platform: "darwin",
    homeDirectory: fixture.home,
    runCommand: async (command, args) => void commands.push({ command, args }),
  });
  const installed = await service.install({
    projectRef: "project-safe",
    repositoryRoot: fixture.repository,
    nodePath: fixture.node,
    cliPath: fixture.cli,
  });
  const contents = await readRunnerServiceFile(installed.servicePath);
  const serviceDirectory = path.join(
    fixture.home, "Library", "Application Support", "dongo", "runner-services", installed.serviceName,
  );
  const launcherPath = path.join(serviceDirectory, "dongo");
  const keepAlivePath = path.join(serviceDirectory, "enabled");
  const launcher = await readRunnerServiceFile(launcherPath);
  assert.equal(contents.match(new RegExp(`<string>${escapeRegex(launcherPath)}<\\/string>`, "gu"))?.length, 2);
  assert.doesNotMatch(contents, /<string>.*node<\/string>|dongo\.js|<string>runner<\/string>/u);
  assert.match(contents, /<key>KeepAlive<\/key><dict><key>PathState<\/key>/u);
  assert.match(contents, new RegExp(escapeRegex(keepAlivePath), "u"));
  assert.doesNotMatch(contents, /SuccessfulExit/u);
  assert.doesNotMatch(contents, /sudo|dangerously|--command|--prompt/u);
  assert.match(launcher, /^#!\/bin\/sh\n# dongo local runner\./u);
  assert.match(launcher, /exec '.*node' '.*dongo\.js' runner run --project-ref 'project-safe'/u);
  assert.match(launcher, /'"'"'/u);
  assert.equal((await stat(launcherPath)).mode & 0o777, 0o700);
  assert.equal((await stat(keepAlivePath)).mode & 0o777, 0o600);
  assert.deepEqual(commands.map(({ command }) => command), ["launchctl", "launchctl", "launchctl"]);
  assert.deepEqual(commands[1]?.args.slice(0, 2), ["enable", `gui/${process.getuid?.()}/${installed.serviceName}`]);
  assert.deepEqual(commands[2]?.args.slice(0, 2), ["bootstrap", `gui/${process.getuid?.()}`]);

  await service.disable("project-safe");
  assert.deepEqual(commands.slice(3), [
    { command: "launchctl", args: ["disable", `gui/${process.getuid?.()}/${installed.serviceName}`] },
    { command: "launchctl", args: ["bootout", `gui/${process.getuid?.()}/${installed.serviceName}`] },
  ]);
  await assert.rejects(access(keepAlivePath));

  await service.remove("project-safe");
  await assert.rejects(access(launcherPath));
  await assert.rejects(access(installed.servicePath));
  assert.equal(commands.length, 5);
});

test("macOS runner disable fails closed and restores keepalive when bootout fails", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dongo-runner-launchd-failure-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await serviceFixture(root);
  let bootouts = 0;
  const service = new LocalRunnerServiceController({
    platform: "darwin",
    homeDirectory: fixture.home,
    runCommand: async (command, args) => {
      if (command === "launchctl" && args[0] === "bootout" && ++bootouts === 2) throw commandFailure(5);
    },
  });
  const installed = await service.install({
    projectRef: "project-safe",
    repositoryRoot: fixture.repository,
    nodePath: fixture.node,
    cliPath: fixture.cli,
  });
  const serviceDirectory = path.join(
    fixture.home, "Library", "Application Support", "dongo", "runner-services", installed.serviceName,
  );
  await assert.rejects(service.disable("project-safe"), /exited with code 5/u);
  await access(path.join(serviceDirectory, "enabled"));
  await access(path.join(serviceDirectory, "dongo"));
  await access(installed.servicePath);
});

test("macOS install tolerates only the documented not-loaded bootout result", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dongo-runner-launchd-idempotent-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await serviceFixture(root);
  const service = new LocalRunnerServiceController({
    platform: "darwin",
    homeDirectory: fixture.home,
    runCommand: async (command, args) => {
      if (command === "launchctl" && args[0] === "bootout") throw commandFailure(3);
    },
  });
  await service.install({
    projectRef: "project-safe",
    repositoryRoot: fixture.repository,
    nodePath: fixture.node,
    cliPath: fixture.cli,
  });
});

test("Linux runner wrapper restarts clean unexpected exits and stops cleanly after disarm", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dongo runner systemd "));
  context.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await serviceFixture(root);
  const commands: Array<{ command: string; args: string[] }> = [];
  const service = new LocalRunnerServiceController({
    platform: "linux",
    homeDirectory: fixture.home,
    runCommand: async (command, args) => void commands.push({ command, args }),
  });
  const installed = await service.install({
    projectRef: "project-safe",
    repositoryRoot: fixture.repository,
    nodePath: fixture.node,
    cliPath: fixture.cli,
  });
  const contents = await readRunnerServiceFile(installed.servicePath);
  const launcherPath = path.join(
    fixture.home, ".local", "share", "dongo", "runner-services", installed.serviceName, "dongo",
  );
  const keepAlivePath = path.join(path.dirname(launcherPath), "enabled");
  const launcher = await readRunnerServiceFile(launcherPath);
  assert.match(contents, /WorkingDirectory=".*dongo runner systemd/u);
  assert.match(contents, new RegExp(`ExecStart="${escapeRegex(launcherPath)}"`, "u"));
  assert.match(contents, /Restart=on-failure/u);
  assert.match(launcher, /if \[ ! -f '.*enabled' \]; then exit 0; fi/u);
  assert.match(launcher, /if \[ "\$status" -eq 0 \]; then exit 1; fi/u);
  assert.match(launcher, /runner run --project-ref 'project-safe'/u);
  assert.match(contents, /NoNewPrivileges=true/u);
  assert.match(contents, /PrivateTmp=true/u);
  assert.deepEqual(commands, [
    { command: "systemctl", args: ["--user", "daemon-reload"] },
    { command: "systemctl", args: ["--user", "enable", "--now", installed.serviceName] },
  ]);

  await service.disable("project-safe");
  assert.deepEqual(commands.slice(2), [
    { command: "systemctl", args: ["--user", "disable", installed.serviceName] },
    { command: "systemctl", args: ["--user", "stop", installed.serviceName] },
  ]);
  await assert.rejects(access(keepAlivePath));
  await service.remove("project-safe");
  await assert.rejects(access(launcherPath));
  await assert.rejects(access(installed.servicePath));
  assert.deepEqual(commands.at(-1), { command: "systemctl", args: ["--user", "daemon-reload"] });
});

test("Linux runner disable fails closed and restores keepalive when stop fails", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dongo-runner-systemd-failure-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await serviceFixture(root);
  const commands: Array<{ command: string; args: string[] }> = [];
  const service = new LocalRunnerServiceController({
    platform: "linux",
    homeDirectory: fixture.home,
    runCommand: async (command, args) => {
      commands.push({ command, args });
      if (command === "systemctl" && args[1] === "stop") throw commandFailure(1);
    },
  });
  const installed = await service.install({
    projectRef: "project-safe",
    repositoryRoot: fixture.repository,
    nodePath: fixture.node,
    cliPath: fixture.cli,
  });
  const serviceDirectory = path.join(
    fixture.home, ".local", "share", "dongo", "runner-services", installed.serviceName,
  );
  await assert.rejects(service.disable("project-safe"), /exited with code 1/u);
  await access(path.join(serviceDirectory, "enabled"));
  await access(path.join(serviceDirectory, "dongo"));
  await access(installed.servicePath);
  assert.deepEqual(commands.at(-1), { command: "systemctl", args: ["--user", "enable", installed.serviceName] });
});

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function commandFailure(code: number) {
  return new CliCoreError({
    code: "runner_service_failed",
    message: `The user service command exited with code ${code}.`,
    exitCode: 5,
    details: { commandExitCode: code },
  });
}

async function serviceFixture(root: string) {
  const home = path.join(root, "home");
  const repository = path.join(root, "repository");
  const bin = path.join(root, "dongo runner's bin");
  await Promise.all([mkdir(home), mkdir(repository), mkdir(bin)]);
  const node = path.join(bin, "node");
  const cli = path.join(bin, "dongo.js");
  await Promise.all([
    writeFile(node, "node", { mode: 0o700 }),
    writeFile(cli, "cli", { mode: 0o600 }),
  ]);
  await chmod(node, 0o700);
  return { home, repository, node, cli };
}
