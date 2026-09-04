import assert from "node:assert/strict";
import { access, chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  LocalRunnerServiceController,
  readRunnerServiceFile,
} from "../src/runner-service.ts";

test("macOS runner service is user-scoped, command-fixed, and restart bounded", async (context) => {
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
  const launcherPath = path.join(
    fixture.home,
    "Library",
    "Application Support",
    "dongo",
    "runner-services",
    installed.serviceName,
    "dongo",
  );
  const launcher = await readRunnerServiceFile(launcherPath);
  assert.equal(contents.match(new RegExp(`<string>${launcherPath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}<\\/string>`, "gu"))?.length, 2);
  assert.doesNotMatch(contents, /<string>.*node<\/string>|dongo\.js|<string>runner<\/string>/u);
  assert.match(contents, /<key>SuccessfulExit<\/key><false\/>/u);
  assert.doesNotMatch(contents, /sudo|dangerously|--command|--prompt/u);
  assert.match(launcher, /^#!\/bin\/sh\n# dongo local runner\./u);
  assert.match(launcher, /exec '.*node' '.*dongo\.js' runner run --project-ref 'project-safe'/u);
  assert.match(launcher, /'"'"'/u);
  assert.equal((await stat(launcherPath)).mode & 0o777, 0o700);
  assert.deepEqual(commands.map(({ command }) => command), [
    "launchctl",
    "launchctl",
    "launchctl",
  ]);
  assert.deepEqual(commands[1]?.args.slice(0, 2), ["enable", `gui/${process.getuid?.()}/${installed.serviceName}`]);
  assert.deepEqual(commands[2]?.args.slice(0, 2), ["bootstrap", `gui/${process.getuid?.()}`]);

  await service.remove("project-safe");
  await assert.rejects(access(launcherPath));
});

test("Linux runner service uses only the user manager and hardens the process", async (context) => {
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
  assert.match(contents, /WorkingDirectory=".*dongo runner systemd/u);
  assert.match(contents, /ExecStart=".*node" ".*dongo\.js" runner run --project-ref "project-safe"/u);
  assert.match(contents, /NoNewPrivileges=true/u);
  assert.match(contents, /PrivateTmp=true/u);
  assert.deepEqual(commands, [
    { command: "systemctl", args: ["--user", "daemon-reload"] },
    { command: "systemctl", args: ["--user", "enable", "--now", installed.serviceName] },
  ]);
});

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
