import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { DONGO_COMPLETION_INSTRUCTIONS } from "@dongo/mcp/managed-integrations";

import { CliCoreError } from "../src/errors.ts";
import { MemorySecretStore } from "../src/secret-store.ts";
import { quarantineRunnerMutation, runnerMutationGuardPath } from "../src/runner-mutation-guard.ts";
import {
  ClaudeRunnerAdapter,
  CodexRunnerAdapter,
  resolveGitHubCliChildEnvironment,
  resolveValidatedGitCommonDirectory,
  stopHarnessProcessGroup,
} from "../src/runner-adapters.ts";

const noCredentialEnvironment = async () => ({});

test("adapter refuses a quarantined exact job before resolving deployment credentials or spawning", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dongo-adapter-quarantine-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const guardPath = runnerMutationGuardPath(root, "project-ref", "job-1");
  await quarantineRunnerMutation({
    configDirectory: root,
    projectRef: "project-ref",
    registrationId: "registration-1",
    jobId: "job-1",
  });
  let credentials = 0;
  let spawns = 0;
  const adapter = new CodexRunnerAdapter({
    store: new MemorySecretStore(),
    executablePath: "/bin/sh",
    resolveCredentialEnvironment: async () => { credentials += 1; return { GH_TOKEN: "must-not-resolve" }; },
    spawnProcess: (() => { spawns += 1; return fakeChild(); }) as never,
  });
  await assert.rejects(adapter.execute({
    repositoryRoot: process.cwd(),
    registrationId: "registration-1",
    jobId: "job-1",
    kind: "work",
    workIdentifier: "dong088",
    mutationGuardPath: guardPath,
    signal: new AbortController().signal,
    log: async () => undefined,
  }), /job is quarantined/u);
  assert.equal(credentials, 0);
  assert.equal(spawns, 0);
});

test("both adapters recheck quarantine after credential preflight and immediately before spawn", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dongo-adapter-quarantine-race-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  for (const harness of ["codex", "claude"] as const) {
    const jobId = `job-${harness}`;
    const guardPath = runnerMutationGuardPath(root, "project-ref", jobId);
    let spawns = 0;
    const options = {
      store: new MemorySecretStore(),
      executablePath: "/bin/sh",
      resolveCredentialEnvironment: async () => {
        await quarantineRunnerMutation({
          configDirectory: root,
          projectRef: "project-ref",
          registrationId: "registration-1",
          jobId,
        });
        return { GH_TOKEN: "must-not-reach-spawn" };
      },
      spawnProcess: (() => { spawns += 1; return fakeChild(); }) as never,
    };
    const adapter = harness === "codex"
      ? new CodexRunnerAdapter(options)
      : new ClaudeRunnerAdapter(options);
    await assert.rejects(adapter.execute({
      repositoryRoot: process.cwd(),
      registrationId: "registration-1",
      jobId,
      kind: "work",
      workIdentifier: "dong088",
      mutationGuardPath: guardPath,
      signal: new AbortController().signal,
      log: async () => undefined,
    }), /job is quarantined/u);
    assert.equal(spawns, 0, `${harness} must not spawn after quarantine flips during preflight`);
  }
});

test("an abort raised synchronously by spawn is observed and stops the new process", async () => {
  const controller = new AbortController();
  let kills = 0;
  const adapter = new CodexRunnerAdapter({
    store: new MemorySecretStore(),
    executablePath: "/bin/sh",
    resolveCredentialEnvironment: noCredentialEnvironment,
    spawnProcess: (() => {
      const child = fakeChild();
      const kill = child.kill.bind(child);
      child.kill = (signal) => {
        kills += 1;
        return kill(signal);
      };
      controller.abort();
      return child;
    }) as never,
  });
  const result = await adapter.execute({
    repositoryRoot: process.cwd(),
    registrationId: "registration-1",
    jobId: "job-abort-race",
    kind: "work",
    workIdentifier: "dong088",
    signal: controller.signal,
    log: async () => undefined,
  });
  assert.equal(result.outcome, "failed");
  assert.equal(result.safeCode, "cancelled");
  assert.equal(kills, 1);
});

test("process-group confirmation failure propagates when the harness leader exits first", async () => {
  const controller = new AbortController();
  const adapter = new CodexRunnerAdapter({
    store: new MemorySecretStore(),
    executablePath: "/bin/sh",
    resolveCredentialEnvironment: noCredentialEnvironment,
    spawnProcess: (() => {
      const child = fakeChild();
      queueMicrotask(() => {
        controller.abort();
        child.emit("exit", 0);
      });
      return child;
    }) as never,
    stopProcessGroup: async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new CliCoreError({
        code: "runner_quarantine_incomplete",
        message: "The managed harness process group did not confirm termination.",
        exitCode: 6,
      });
    },
  });
  await assert.rejects(adapter.execute({
    repositoryRoot: process.cwd(),
    registrationId: "registration-1",
    jobId: "job-leader-exits-first",
    kind: "work",
    workIdentifier: "dong088",
    signal: controller.signal,
    log: async () => undefined,
  }), (error: unknown) =>
    error instanceof CliCoreError && error.code === "runner_quarantine_incomplete");
});

test("process-tree stop waits past a clean leader exit and kills a surviving descendant", async (context) => {
  if (process.platform === "win32") return;
  const child = spawn("/bin/sh", ["-c", "trap 'exit 0' TERM; (trap '' TERM; exec sleep 30) & echo ready; wait"], {
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  context.after(() => {
    if (child.pid) {
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* already stopped */ }
    }
  });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.stdout.once("data", () => resolve());
  });
  const startedAt = Date.now();
  await stopHarnessProcessGroup(child, { graceMs: 75, confirmationMs: 1_000, pollMs: 10 });
  assert.ok(Date.now() - startedAt >= 60, "surviving descendant must keep the process group alive through grace");
  assert.throws(() => process.kill(-child.pid!, 0), (error: NodeJS.ErrnoException) => error.code === "ESRCH");
});

test("Codex adapter uses fixed safe arguments and stdin, then resumes only the exact local job session", async () => {
  const calls: Array<{ executable: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; input: string }> = [];
  const spawnProcess = (_executable: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => {
    const child = fakeChild();
    const call = { executable: _executable, args, cwd: options.cwd, env: options.env, input: "" };
    child.stdin.on("data", (value) => { call.input += value.toString(); });
    calls.push(call);
    queueMicrotask(() => {
      if (args[0] === "--version") {
        child.stdout.end("codex-cli 1.2.3\n");
      } else if (args[1] === "--help") {
        child.stdout.end("--json --sandbox --cd --add-dir resume\n");
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
  let credentialResolution = 0;
  const store = new MemorySecretStore();
  const adapter = new CodexRunnerAdapter({
    store,
    executablePath: "/bin/sh",
    spawnProcess: spawnProcess as never,
    resolveCredentialEnvironment: async () => ({ GH_TOKEN: `secret-${++credentialResolution}` }),
  });
  await adapter.validate();
  const gitCommonDirectory = await resolveValidatedGitCommonDirectory({
    trustedRepositoryRoot: process.cwd(),
    jobRepositoryRoot: process.cwd(),
  });
  const input = {
    repositoryRoot: process.cwd(),
    gitCommonDirectory,
    registrationId: "registration-1",
    jobId: "job-1",
    kind: "work" as const,
    workIdentifier: "dong027",
    worktreeName: "dong027-12345678",
    branch: "codex/dongo-runner-dong027-123456789abc",
    browserReviewMode: "read_only" as const,
    signal: new AbortController().signal,
    log: async () => undefined,
  };
  const first = await adapter.execute(input);
  let executionCalls = calls.filter(({ args }) => args.at(-1) === "-");
  assert.equal(first.outcome, "completed");
  assert.equal(first.sessionReferencePresent, true);
  assert.deepEqual(executionCalls[0]?.args, [
    "exec",
    "--json",
    "--sandbox",
    "workspace-write",
    "--cd",
    process.cwd(),
    "--add-dir",
    gitCommonDirectory,
    "-",
  ]);
  assert.match(executionCalls[0]?.input ?? "", /exact dongo WorkItem dong027/u);
  assert.ok(executionCalls[0]?.input.includes(DONGO_COMPLETION_INSTRUCTIONS));
  assert.match(executionCalls[0]?.input ?? "", /externalSessionId dongo-runner-job-1/u);
  assert.match(executionCalls[0]?.input ?? "", /workspace\.worktreeName as dong027-12345678/u);
  assert.match(executionCalls[0]?.input ?? "", /workspace\.branch as codex\/dongo-runner-dong027-123456789abc/u);
  assert.match(executionCalls[0]?.input ?? "", /locally enabled read-only browser self-review/u);
  assert.match(executionCalls[0]?.input ?? "", /does not authorize signing in to another account/u);
  assert.doesNotMatch(executionCalls[0]?.args.join(" ") ?? "", /dong027/u);
  assert.equal(executionCalls[0]?.args.some((value) => value.includes("dangerously")), false);
  assert.equal(executionCalls[0]?.env.GH_TOKEN, "secret-1");
  assert.doesNotMatch(JSON.stringify({ args: executionCalls[0]?.args, input: executionCalls[0]?.input }), /secret-1/u);
  assert.equal(await adapter.canResume(input), true);
  await adapter.execute(input);
  executionCalls = calls.filter(({ args }) => args.at(-1) === "-");
  assert.deepEqual(executionCalls[1]?.args, [
    "exec",
    "resume",
    "--json",
    "0199a213-81c0-7800-8aa1-bbab2a035a53",
    "-",
  ]);
  assert.match(executionCalls[1]?.input ?? "", /exact dongo WorkItem dong027/u);
  assert.ok(executionCalls[1]?.input.includes(DONGO_COMPLETION_INSTRUCTIONS));
  assert.equal(executionCalls[1]?.cwd, process.cwd());
  assert.equal(executionCalls[1]?.env.GH_TOKEN, "secret-2");
  assert.equal(credentialResolution, 2);
  assert.doesNotMatch(JSON.stringify(first), /private model output/u);
  const sessionKey = "runner-session:codex:registration-1:job-1";
  const changedGrant = JSON.parse((await store.get(sessionKey))!) as Record<string, unknown>;
  changedGrant.gitCommonDirectory = path.join(path.dirname(gitCommonDirectory), "different-git-common");
  await store.set(sessionKey, JSON.stringify(changedGrant));
  assert.equal(await adapter.canResume(input), false);
  await adapter.discardRegistration(input.registrationId);
  assert.equal(await adapter.canResume(input), false);
});

test("Codex adapter omits browser authorization unless the owner enabled it locally", async () => {
  const calls: Array<{ args: string[]; input: string }> = [];
  const adapter = new CodexRunnerAdapter({
    store: new MemorySecretStore(),
    executablePath: "/bin/sh",
    spawnProcess: ((_executable: string, args: string[]) => {
      const child = fakeChild();
      const call = { args, input: "" };
      child.stdin.on("data", (value) => { call.input += value.toString(); });
      calls.push(call);
      queueMicrotask(() => {
        child.stdout.end();
        child.stderr.end();
        child.emit("exit", 0);
      });
      return child;
    }) as never,
    resolveCredentialEnvironment: noCredentialEnvironment,
  });
  await adapter.execute({
    repositoryRoot: process.cwd(),
    registrationId: "registration-disabled",
    jobId: "job-disabled",
    kind: "work",
    workIdentifier: "dong080",
    signal: new AbortController().signal,
    log: async () => undefined,
  });
  assert.doesNotMatch(calls[0]?.input ?? "", /browser self-review/u);
});

test("runner deployment preflight injects approved values, redacts logs, and avoids redundant login guidance", async () => {
  const calls: Array<{ env: NodeJS.ProcessEnv; input: string }> = [];
  let cleaned = false;
  let log = "";
  const adapter = new CodexRunnerAdapter({
    store: new MemorySecretStore(),
    executablePath: "/bin/sh",
    spawnProcess: ((_executable: string, _args: string[], options: { env: NodeJS.ProcessEnv }) => {
      const child = fakeChild();
      const call = { env: options.env, input: "" };
      child.stdin.on("data", (value) => { call.input += value.toString(); });
      calls.push(call);
      queueMicrotask(() => {
        child.stdout.write("token=deployment-sec");
        child.stdout.end("ret-value\n");
        child.stderr.end();
        child.emit("exit", 0);
      });
      return child;
    }) as never,
    resolveCredentialEnvironment: async () => ({ GH_TOKEN: "github-secret-value" }),
    resolveDeploymentEnvironment: async () => ({
      environment: { CONVEX_DEPLOY_KEY: "deployment-secret-value" },
      secretValues: ["deployment-secret-value"],
      cleanup: async () => { cleaned = true; },
    }),
  });
  const result = await adapter.execute({
    repositoryRoot: process.cwd(),
    trustedRepositoryRoot: process.cwd(),
    registrationId: "registration-deploy",
    jobId: "job-deploy",
    kind: "work",
    workIdentifier: "dong084",
    deploymentPolicy: { mode: "repository", capabilities: ["github", "convex"], sources: [".env.local"] },
    signal: new AbortController().signal,
    log: async (chunk) => { log += chunk; },
  });
  assert.equal(result.outcome, "completed");
  assert.equal(calls[0]?.env.CONVEX_DEPLOY_KEY, "deployment-secret-value");
  assert.equal(log, "token=[redacted]\n");
  assert.doesNotMatch(log, /deployment-secret-value/u);
  assert.match(calls[0]?.input ?? "", /already preflighted/u);
  assert.match(calls[0]?.input ?? "", /do not start a new login flow unless a fresh state check actually fails/u);
  assert.equal(cleaned, true);
});

test("failed deployment preflight stops before the harness starts with an actionable provider error", async () => {
  let launches = 0;
  const adapter = new CodexRunnerAdapter({
    store: new MemorySecretStore(),
    executablePath: "/bin/sh",
    spawnProcess: (() => {
      launches += 1;
      return fakeChild();
    }) as never,
    resolveCredentialEnvironment: async () => ({ GH_TOKEN: "github-secret-value" }),
    resolveDeploymentEnvironment: async () => {
      throw new CliCoreError({
        code: "deployment_cloudflare_unavailable",
        message: "Trusted Cloudflare deployment access is missing or expired on this computer.",
      });
    },
  });
  const result = await adapter.execute({
    repositoryRoot: process.cwd(),
    registrationId: "registration-deploy",
    jobId: "job-deploy-failure",
    kind: "work",
    workIdentifier: "dong084",
    deploymentPolicy: { mode: "repository", capabilities: ["cloudflare"], sources: [] },
    signal: new AbortController().signal,
    log: async () => undefined,
  });
  assert.equal(result.safeCode, "deployment_cloudflare_unavailable");
  assert.equal(result.safeSummary, "Trusted Cloudflare deployment access is missing or expired on this computer.");
  assert.equal(launches, 0);
});

test("Claude Code receives the same reviewed deployment bridge and cleanup", async () => {
  let launchedEnvironment: NodeJS.ProcessEnv | undefined;
  let cleaned = false;
  const adapter = new ClaudeRunnerAdapter({
    store: new MemorySecretStore(),
    executablePath: "/bin/sh",
    spawnProcess: ((_executable: string, _args: string[], options: { env: NodeJS.ProcessEnv }) => {
      launchedEnvironment = options.env;
      const child = fakeChild();
      queueMicrotask(() => {
        child.stdout.end();
        child.stderr.end();
        child.emit("exit", 0);
      });
      return child;
    }) as never,
    resolveCredentialEnvironment: noCredentialEnvironment,
    resolveDeploymentEnvironment: async () => ({
      environment: { CLOUDFLARE_API_TOKEN: "cloudflare-secret-value" },
      secretValues: ["cloudflare-secret-value"],
      cleanup: async () => { cleaned = true; },
    }),
  });

  const result = await adapter.execute({
    repositoryRoot: process.cwd(),
    registrationId: "registration-claude-deploy",
    jobId: "job-claude-deploy",
    kind: "work",
    workIdentifier: "dong084",
    deploymentPolicy: { mode: "repository", capabilities: ["cloudflare"], sources: [".env"] },
    signal: new AbortController().signal,
    log: async () => undefined,
  });

  assert.equal(result.outcome, "completed");
  assert.equal(launchedEnvironment?.CLOUDFLARE_API_TOKEN, "cloudflare-secret-value");
  assert.equal(cleaned, true);
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
    resolveCredentialEnvironment: noCredentialEnvironment,
  });
  await assert.rejects(adapter.execute({
    repositoryRoot: process.cwd(),
    registrationId: "registration-1",
    jobId: "job-1",
    kind: "work",
    workIdentifier: "dong027; rm -rf /",
    signal: new AbortController().signal,
    log: async () => undefined,
  }), /identifier is invalid/u);
  assert.equal(launches, 0);
});

test("Claude Code adapter uses print mode and stdin, then resumes only its exact local session", async () => {
  const calls: Array<{ args: string[]; cwd: string; input: string }> = [];
  const spawnProcess = (_executable: string, args: string[], options: { cwd: string }) => {
    const child = fakeChild();
    const call = { args, cwd: options.cwd, input: "" };
    child.stdin.on("data", (value) => { call.input += value.toString(); });
    calls.push(call);
    queueMicrotask(() => {
      if (args[0] === "--version") {
        child.stdout.end("2.1.0 (Claude Code)\n");
      } else if (args[0] === "--help") {
        child.stdout.end("--output-format stream-json --permission-mode acceptEdits --resume\n");
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
    resolveCredentialEnvironment: noCredentialEnvironment,
  });
  await adapter.validate();
  const gitCommonDirectory = await resolveValidatedGitCommonDirectory({
    trustedRepositoryRoot: process.cwd(),
    jobRepositoryRoot: process.cwd(),
  });
  const input = {
    repositoryRoot: process.cwd(),
    gitCommonDirectory,
    registrationId: "registration-2",
    jobId: "job-2",
    kind: "work" as const,
    workIdentifier: "dong028",
    signal: new AbortController().signal,
    log: async () => undefined,
  };
  const first = await adapter.execute(input);
  let executionCalls = calls.filter(({ args }) => args[0] === "-p");
  assert.equal(first.outcome, "completed");
  assert.equal(first.sessionReferencePresent, true);
  assert.deepEqual(executionCalls[0]?.args.slice(0, 5), [
    "-p",
    "--output-format",
    "stream-json",
    "--permission-mode",
    "acceptEdits",
  ]);
  assert.equal(executionCalls[0]?.args.some((value) => value.includes("dangerously")), false);
  assert.match(executionCalls[0]?.input ?? "", /exact dongo WorkItem dong028/u);
  assert.ok(executionCalls[0]?.input.includes(DONGO_COMPLETION_INSTRUCTIONS));
  assert.doesNotMatch(executionCalls[0]?.args.join(" ") ?? "", /dong028/u);
  assert.equal(executionCalls[0]?.cwd, process.cwd());
  assert.equal(await adapter.canResume(input), true);
  await adapter.execute(input);
  executionCalls = calls.filter(({ args }) => args[0] === "-p");
  const resumeIndex = executionCalls[1]?.args.indexOf("--resume") ?? -1;
  assert.ok(resumeIndex > 0);
  assert.equal(executionCalls[1]?.args[resumeIndex + 1], "claude_session_1234");
  assert.match(executionCalls[1]?.input ?? "", /exact dongo WorkItem dong028/u);
  assert.ok(executionCalls[1]?.input.includes(DONGO_COMPLETION_INSTRUCTIONS));
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
    resolveCredentialEnvironment: noCredentialEnvironment,
  });
  const input = {
    repositoryRoot: process.cwd(),
    gitCommonDirectory: await resolveValidatedGitCommonDirectory({
      trustedRepositoryRoot: process.cwd(),
      jobRepositoryRoot: process.cwd(),
    }),
    registrationId: "registration-3",
    jobId: "job-3",
    kind: "work" as const,
    workIdentifier: "dong028",
    signal: new AbortController().signal,
    log: async () => undefined,
  };
  await adapter.execute(input);
  assert.equal(await adapter.canResume({ ...input, repositoryRoot: "/tmp" }), false);
});

test("adapter validation rejects a CLI that lacks the safe runner features", async () => {
  const spawnProcess = () => {
    const child = fakeChild();
    queueMicrotask(() => {
      child.stdout.end("old cli without required flags\n");
      child.stderr.end();
      child.emit("exit", 0);
    });
    return child;
  };
  const adapter = new CodexRunnerAdapter({
    store: new MemorySecretStore(),
    executablePath: "/bin/sh",
    spawnProcess: spawnProcess as never,
    resolveCredentialEnvironment: noCredentialEnvironment,
  });
  await assert.rejects(adapter.validate(), (error: Error & { code?: string }) => {
    assert.equal(error.code, "harness_unsupported");
    return true;
  });
});

test("adapter cancellation terminates the local harness and reports no remote output", async () => {
  const controller = new AbortController();
  const signals: Array<NodeJS.Signals | undefined> = [];
  const spawnProcess = () => {
    const child = fakeChild();
    child.kill = (signal) => {
      signals.push(signal);
      queueMicrotask(() => child.emit("exit", null));
      return true;
    };
    queueMicrotask(() => controller.abort());
    return child;
  };
  const adapter = new ClaudeRunnerAdapter({
    store: new MemorySecretStore(),
    executablePath: "/bin/sh",
    spawnProcess: spawnProcess as never,
    resolveCredentialEnvironment: noCredentialEnvironment,
  });
  const result = await adapter.execute({
    repositoryRoot: process.cwd(),
    registrationId: "registration-cancel",
    jobId: "job-cancel",
    kind: "work",
    workIdentifier: "dong028",
    signal: controller.signal,
    log: async () => undefined,
  });
  assert.deepEqual(signals, ["SIGTERM"]);
  assert.deepEqual(result, {
    outcome: "failed",
    safeCode: "cancelled",
    safeSummary: "Claude Code was stopped after the dongo job was cancelled.",
    sessionReferencePresent: false,
  });
});

test("runner adapters use a fixed triage-only prompt for an Intake job", async () => {
  const calls: Array<{ args: string[]; input: string }> = [];
  const spawnProcess = (_executable: string, args: string[]) => {
    const child = fakeChild();
    const call = { args, input: "" };
    child.stdin.on("data", (value) => { call.input += value.toString(); });
    calls.push(call);
    queueMicrotask(() => {
      child.stdout.end(`${JSON.stringify({ type: "thread.started", thread_id: "0199a213-81c0-7800-8aa1-bbab2a035a53" })}\n`);
      child.stderr.end();
      child.emit("exit", 0);
    });
    return child;
  };
  const adapter = new CodexRunnerAdapter({
    store: new MemorySecretStore(),
    executablePath: "/bin/sh",
    spawnProcess: spawnProcess as never,
    resolveCredentialEnvironment: noCredentialEnvironment,
  });
  await adapter.execute({
    repositoryRoot: process.cwd(),
    registrationId: "registration-intake",
    jobId: "job-intake",
    kind: "intake",
    intakeId: "ks705f6sdbjpvgqhn812x0s7a18dnw1d",
    browserReviewMode: "read_only",
    signal: new AbortController().signal,
    log: async () => undefined,
  });
  const execution = calls.find(({ args }) => args.at(-1) === "-");
  assert.match(execution?.input ?? "", /exact dongo Intake ks705f6sdbjpvgqhn812x0s7a18dnw1d/u);
  assert.match(execution?.input ?? "", /only this Intake triage/u);
  assert.match(execution?.input ?? "", /do not start or implement/u);
  assert.doesNotMatch(execution?.input ?? "", /browser self-review/u);
  assert.doesNotMatch(execution?.args.join(" ") ?? "", /ks705f6/u);
});

test("Codex grants only the validated Git common directory used by an isolated linked worktree", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dongo-runner-git-common-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const remote = path.join(root, "remote.git");
  const repository = path.join(root, "repository");
  const worktree = path.join(root, "worktree");
  const unrelated = path.join(root, "unrelated");
  await runGit(root, ["init", "--bare", "--quiet", remote]);
  await mkdir(repository);
  await runGit(repository, ["init", "--quiet"]);
  await writeFile(path.join(repository, "README.md"), "trusted\n");
  await runGit(repository, ["add", "README.md"]);
  await runGit(repository, ["-c", "user.name=dongo tests", "-c", "user.email=tests@dongo.invalid", "commit", "--quiet", "-m", "trusted"]);
  await runGit(repository, ["branch", "-M", "main"]);
  await runGit(repository, ["remote", "add", "origin", remote]);
  await runGit(repository, ["push", "--quiet", "-u", "origin", "main"]);
  await runGit(repository, ["worktree", "add", "--quiet", "-b", "job", worktree, "main"]);

  const gitCommonDirectory = await resolveValidatedGitCommonDirectory({
    trustedRepositoryRoot: repository,
    jobRepositoryRoot: worktree,
  });
  assert.equal(gitCommonDirectory, await realpath(path.join(repository, ".git")));
  await writeFile(path.join(worktree, "job.txt"), "isolated\n");
  await runGit(worktree, ["add", "job.txt"]);
  await runGit(worktree, ["-c", "user.name=dongo tests", "-c", "user.email=tests@dongo.invalid", "commit", "--quiet", "-m", "job"]);
  await runGit(worktree, ["fetch", "--quiet", "origin", "main"]);
  await runGit(worktree, ["push", "--quiet", "origin", "job"]);
  assert.match(await readGit(remote, ["rev-parse", "refs/heads/job"]), /^[0-9a-f]{40}$/u);

  await mkdir(unrelated);
  await runGit(unrelated, ["init", "--quiet"]);
  await assert.rejects(resolveValidatedGitCommonDirectory({
    trustedRepositoryRoot: repository,
    jobRepositoryRoot: worktree,
    gitCommonDirectory: path.join(unrelated, ".git"),
  }), /does not match its approved Git metadata/u);
  const symlinkedCommon = path.join(root, "git-common-link");
  await symlink(gitCommonDirectory, symlinkedCommon);
  await assert.rejects(resolveValidatedGitCommonDirectory({
    trustedRepositoryRoot: repository,
    jobRepositoryRoot: worktree,
    gitCommonDirectory: symlinkedCommon,
  }), /not owner-controlled/u);
});

test("GitHub CLI credentials are resolved from the repository host without entering arguments or durable state", async () => {
  const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
  const environment = await resolveGitHubCliChildEnvironment({
    repositoryRoot: "/safe/repository",
    runProbe: async ({ command, args, cwd }) => {
      calls.push({ command, args, cwd });
      return command === "git"
        ? { ok: true, stdout: "git@github.com:renewisepunk/dongo.git\n" }
        : { ok: true, stdout: "github-secret-value\n" };
    },
  });
  assert.deepEqual(environment, { GH_TOKEN: "github-secret-value" });
  assert.deepEqual(calls, [
    { command: "git", args: ["remote", "get-url", "origin"], cwd: "/safe/repository" },
    { command: "gh", args: ["auth", "token", "--hostname", "github.com"], cwd: "/safe/repository" },
  ]);
  assert.doesNotMatch(JSON.stringify(calls), /github-secret-value/u);
});

test("GitHub CLI credential resolution fails closed and supports authenticated enterprise hosts", async () => {
  const missing = await resolveGitHubCliChildEnvironment({
    repositoryRoot: "/safe/repository",
    runProbe: async () => ({ ok: false, stdout: "" }),
  });
  assert.deepEqual(missing, {});

  const malformed = await resolveGitHubCliChildEnvironment({
    repositoryRoot: "/safe/repository",
    runProbe: async ({ command }) => command === "git"
      ? { ok: true, stdout: "https://github.com/renewisepunk/dongo.git" }
      : { ok: true, stdout: "not a token\n" },
  });
  assert.deepEqual(malformed, {});

  const enterprise = await resolveGitHubCliChildEnvironment({
    repositoryRoot: "/safe/repository",
    runProbe: async ({ command }) => command === "git"
      ? { ok: true, stdout: "https://github.example.com/renewisepunk/dongo.git" }
      : { ok: true, stdout: "enterprise-secret" },
  });
  assert.deepEqual(enterprise, {
    GH_ENTERPRISE_TOKEN: "enterprise-secret",
    GH_HOST: "github.example.com",
  });
});

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    pid?: number;
    kill(signal?: NodeJS.Signals): boolean;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    queueMicrotask(() => child.emit("exit", null));
    return true;
  };
  return child;
}

async function runGit(cwd: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile("git", ["-C", cwd, ...args], { encoding: "utf8" }, (error) => error ? reject(error) : resolve());
  });
}

async function readGit(cwd: string, args: string[]): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    execFile("git", ["-C", cwd, ...args], { encoding: "utf8" }, (error, stdout) =>
      error ? reject(error) : resolve(typeof stdout === "string" ? stdout.trim() : ""));
  });
}
