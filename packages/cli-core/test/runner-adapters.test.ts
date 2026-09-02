import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import { MemorySecretStore } from "../src/secret-store.ts";
import { ClaudeRunnerAdapter, CodexRunnerAdapter } from "../src/runner-adapters.ts";

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

test("Claude Code adapter uses print mode and resumes only its exact local session", async () => {
  const calls: Array<{ args: string[]; cwd: string }> = [];
  const spawnProcess = (_executable: string, args: string[], options: { cwd: string }) => {
    const child = fakeChild();
    calls.push({ args, cwd: options.cwd });
    queueMicrotask(() => {
      if (args[0] === "--version") {
        child.stdout.end("2.1.0 (Claude Code)\n");
      } else {
        child.stdout.end([
          JSON.stringify({ type: "system", subtype: "init", session_id: "claude_session_1234" }),
          JSON.stringify({ type: "assistant", message: { content: "private Claude output" } }),
          JSON.stringify({ type: "result", subtype: "success", session_id: "claude_session_1234" }),
          "",
        ].join("\n"));
      }
      child.stderr.end();
      child.emit("exit", 0);
    });
    return child;
  };
  const adapter = new ClaudeRunnerAdapter({
    store: new MemorySecretStore(),
    executablePath: "/bin/sh",
    spawnProcess: spawnProcess as never,
  });
  await adapter.validate();
  const input = {
    repositoryRoot: process.cwd(),
    registrationId: "registration-2",
    jobId: "job-2",
    workIdentifier: "dong028",
    signal: new AbortController().signal,
    log: async () => undefined,
  };
  const first = await adapter.execute(input);
  assert.equal(first.outcome, "completed");
  assert.equal(first.sessionReferencePresent, true);
  assert.deepEqual(calls[1]?.args.slice(0, 5), [
    "-p",
    "--output-format",
    "stream-json",
    "--permission-mode",
    "acceptEdits",
  ]);
  assert.equal(calls[1]?.args.some((value) => value.includes("dangerously")), false);
  assert.equal(calls[1]?.cwd, process.cwd());
  assert.equal(await adapter.canResume(input), true);
  await adapter.execute(input);
  const resumeIndex = calls[2]?.args.indexOf("--resume") ?? -1;
  assert.ok(resumeIndex > 0);
  assert.equal(calls[2]?.args[resumeIndex + 1], "claude_session_1234");
  assert.doesNotMatch(JSON.stringify(first), /private Claude output/u);
});

test("harness sessions cannot be resumed from a different repository", async () => {
  const store = new MemorySecretStore();
  const spawnProcess = (_executable: string, args: string[]) => {
    const child = fakeChild();
    queueMicrotask(() => {
      child.stdout.end(args[0] === "--version"
        ? "2.1.0\n"
        : `${JSON.stringify({ type: "system", subtype: "init", session_id: "claude_session_9876" })}\n`);
      child.stderr.end();
      child.emit("exit", 0);
    });
    return child;
  };
  const adapter = new ClaudeRunnerAdapter({
    store,
    executablePath: "/bin/sh",
    spawnProcess: spawnProcess as never,
  });
  const input = {
    repositoryRoot: process.cwd(),
    registrationId: "registration-3",
    jobId: "job-3",
    workIdentifier: "dong028",
    signal: new AbortController().signal,
    log: async () => undefined,
  };
  await adapter.execute(input);
  assert.equal(await adapter.canResume({ ...input, repositoryRoot: "/tmp" }), false);
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
