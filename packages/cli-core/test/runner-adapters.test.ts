import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import { MemorySecretStore } from "../src/secret-store.ts";
import { CodexRunnerAdapter } from "../src/runner-adapters.ts";

test("Codex adapter uses fixed safe arguments and resumes only the exact local job session", async () => {
  const calls: Array<{ executable: string; args: string[]; cwd: string }> = [];
  const spawnProcess = (_executable: string, args: string[], options: { cwd: string }) => {
    const child = fakeChild();
    calls.push({ executable: _executable, args, cwd: options.cwd });
    queueMicrotask(() => {
      if (args[0] === "--version") {
        child.stdout.end("codex-cli 1.2.3\n");
      } else {
        child.stdout.end([
          JSON.stringify({ type: "thread.started", thread_id: "0199a213-81c0-7800-8aa1-bbab2a035a53" }),
          JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "private model output" } }),
          "",
        ].join("\n"));
      }
      child.stderr.end();
      child.emit("exit", 0);
    });
    return child;
  };
  const adapter = new CodexRunnerAdapter({
    store: new MemorySecretStore(),
    executablePath: "/bin/sh",
    spawnProcess: spawnProcess as never,
  });
  await adapter.validate();
  const input = {
    repositoryRoot: process.cwd(),
    registrationId: "registration-1",
    jobId: "job-1",
    workIdentifier: "dong027",
    signal: new AbortController().signal,
    log: async () => undefined,
  };
  const first = await adapter.execute(input);
  assert.equal(first.outcome, "completed");
  assert.equal(first.sessionReferencePresent, true);
  assert.deepEqual(calls[1]?.args.slice(0, 5), ["exec", "--json", "--sandbox", "workspace-write", calls[1]?.args[4]]);
  assert.match(calls[1]?.args[4] ?? "", /exact dongo WorkItem dong027/u);
  assert.equal(calls[1]?.args.some((value) => value.includes("dangerously")), false);
  assert.equal(await adapter.canResume(input), true);
  await adapter.execute(input);
  assert.deepEqual(calls[2]?.args.slice(0, 4), [
    "exec",
    "resume",
    "--json",
    "0199a213-81c0-7800-8aa1-bbab2a035a53",
  ]);
  assert.equal(calls[2]?.cwd, process.cwd());
  assert.doesNotMatch(JSON.stringify(first), /private model output/u);
});

test("Codex adapter refuses an invalid server identifier before launch", async () => {
  let launches = 0;
  const adapter = new CodexRunnerAdapter({
    store: new MemorySecretStore(),
    executablePath: "/bin/sh",
    spawnProcess: (() => {
      launches += 1;
      return fakeChild();
    }) as never,
  });
  await assert.rejects(adapter.execute({
    repositoryRoot: process.cwd(),
    registrationId: "registration-1",
    jobId: "job-1",
    workIdentifier: "dong027; rm -rf /",
    signal: new AbortController().signal,
    log: async () => undefined,
  }), /identifier is invalid/u);
  assert.equal(launches, 0);
});

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    pid?: number;
    kill(signal?: NodeJS.Signals): boolean;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    queueMicrotask(() => child.emit("exit", null));
    return true;
  };
  return child;
}
