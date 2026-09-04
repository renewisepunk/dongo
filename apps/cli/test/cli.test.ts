import assert from "node:assert/strict";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { CliCoreError, type IntegrationResult } from "@dongo/cli-core";
import { DongoClientError } from "@dongo/client";
import { COMMAND_SCHEMAS } from "../src/command-schema.ts";
import { isEntrypoint, runCli } from "../src/index.ts";
import { checkForCliUpdate } from "../src/update.ts";

const noncanonicalProductCase = /\b(?:Dongo|DONGO)\b(?![-_.])/u;

test("a symlinked binary resolves to the CLI entrypoint", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "dongo-cli-entrypoint-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const source = resolve("src/index.ts");
  const installedBinary = join(directory, "dongo");
  await symlink(source, installedBinary);
  assert.equal(isEntrypoint(pathToFileURL(source).href, installedBinary), true);
});

function capture() {
  let stdout = "";
  let stderr = "";
  return {
    output: {
      stdout: (value: string) => (stdout += value),
      stderr: (value: string) => (stderr += value),
    },
    values: () => ({ stdout, stderr }),
  };
}

function integrationFixture(host: IntegrationResult["host"], applied: boolean): IntegrationResult {
  return {
    host,
    applied,
    serverName: "dongo-project",
    endpoint: "https://dongo.so/p/project/mcp",
    replacedServers: [],
    files: [{ path: ".mcp.json", changed: true, managedContent: "private implementation detail" }],
    loginCommand: "claude mcp login dongo-project",
    rollback: ["claude mcp remove dongo-project"],
    lifecycle: {
      state: applied ? "configuration_applied" : "preview_ready",
      connectionState: "unverified",
      summary: applied
        ? "Configuration applied. Connection verification is still required."
        : "Preview ready. No files were changed.",
      steps: [
        { order: 1, id: "apply_configuration", title: "Apply the configuration.", status: applied ? "complete" : "action_required", instruction: applied ? "Applied." : "Review, then apply.", ...(!applied ? { command: `dongo integrate ${host} --apply` } : {}) },
        { order: 2, id: "approve_project_server", title: "Approve the project-scoped server, if required.", status: "conditional", instruction: "Approve it only if prompted." },
        { order: 3, id: "complete_login", title: "Complete login, if required.", status: "conditional", instruction: "Log in only if prompted.", command: "claude mcp login dongo-project" },
        { order: 4, id: "restart_host", title: "Restart only when necessary.", status: "conditional", instruction: "Restart only if dynamic loading fails." },
        { order: 5, id: "verify_connection", title: "Verify the connection.", status: "pending", instruction: "Start a dongo session." },
      ],
    },
  };
}

const fakeService = {
  connect: async () => ({ project: { publicRef: "pub_1" } }),
  createProject: async () => ({ project: { publicRef: "pub_created" } }),
  setupCi: async () => ({ project: { publicRef: "pub_ci" }, credentialStore: "environment" }),
  authStatus: async () => ({ authenticated: true, credential: { scopes: ["dongo:work:read"] } }),
  logout: async () => ({ revoked: true }),
  doctor: async () => ({ ok: true, checks: [] }),
  sessionStart: async () => ({ project: { executionMode: "manual" } }),
  overview: async () => ({ needsYou: [], working: [], ready: [], inbox: [], recentlyDone: [] }),
  sync: async () => ({ snapshot: { workItems: [] }, export: { root: "/repo/.agent-work", files: [], removed: [] } }),
  execute: async (operation: string, input: unknown) => ({ operation, input }),
  attachmentInfo: async (attachmentId: string) => ({ attachmentId, filename: "report.txt", byteSize: 5, downloadAvailable: true }),
  fetchAttachment: async (attachmentId: string, output?: string) => ({ attachmentId, path: output ?? ".agent-work/attachments/report.txt" }),
  integration: async (host: IntegrationResult["host"], apply: boolean) => integrationFixture(host, apply),
  runnerInstall: async (options: unknown) => ({ installed: true, options }),
  runnerStatus: async () => ({ installed: true, enabled: true }),
  runnerApprove: async (jobId: string) => ({ approved: true, jobId }),
  runnerConfigure: async (options: unknown) => ({ changed: true, options }),
  runnerDisable: async () => ({ disabled: true }),
  runnerRemove: async () => ({ removed: true }),
  runnerRun: async (projectRef: string) => ({ stopped: true, projectRef }),
};

test("ci setup is production-only and accepts no environment selection", async () => {
  const stream = capture();
  const exitCode = await runCli(
    ["ci", "setup", "--json"],
    {
      output: stream.output,
      serviceFactory: () => fakeService as never,
    },
  );
  assert.equal(exitCode, 0);
  assert.deepEqual(JSON.parse(stream.values().stdout), {
    ok: true,
    command: "ci setup",
    data: {
      project: { publicRef: "pub_ci" },
      credentialStore: "environment",
    },
  });

  for (const args of [
    ["connect", "--environment", "development", "--json"],
    ["connect", "--origin", "https://dev.dongo.so", "--json"],
    ["ci", "setup", "--environment", "production", "--json"],
  ]) {
    const rejected = capture();
    assert.equal(await runCli(args, {
      output: rejected.output,
      serviceFactory: () => fakeService as never,
    }), 2);
    assert.equal(JSON.parse(rejected.values().stdout).error.code, "validation");
  }
});

test("help exposes only the production connection flow", async () => {
  const stream = capture();
  assert.equal(await runCli(["help"], { output: stream.output }), 0);
  assert.match(stream.values().stdout, /dongo connect/u);
  assert.doesNotMatch(stream.values().stdout, /--environment|--origin|dev\.dongo\.so/u);
});

test("every command provides specific human and machine-readable help", async () => {
  for (const schema of Object.values(COMMAND_SCHEMAS)) {
    const argv = schema.command === "version" ? ["--version"] : schema.command.split(" ");
    const human = capture();
    assert.equal(await runCli([...argv, "--help"], { output: human.output }), 0, schema.command);
    assert.match(human.values().stdout, new RegExp(schema.usage.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")), schema.command);
    assert.doesNotMatch(
      human.values().stdout,
      noncanonicalProductCase,
      schema.command,
    );

    const json = capture();
    assert.equal(await runCli([...argv, "--help", "--json"], { output: json.output }), 0, schema.command);
    const envelope = JSON.parse(json.values().stdout);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.data.schema.command, schema.command);
    assert.equal(json.values().stderr, "");
  }
});

test("finish help exposes host-verified integration and release preconditions without a service call", async () => {
  const human = capture();
  const json = capture();
  let serviceCalls = 0;
  const serviceFactory = () => {
    serviceCalls += 1;
    return fakeService as never;
  };
  assert.equal(await runCli(["work", "finish", "--help"], { output: human.output, serviceFactory }), 0);
  assert.equal(await runCli(["work", "finish", "--help", "--json"], { output: json.output, serviceFactory }), 0);
  const schema = JSON.parse(json.values().stdout).data.schema;
  assert.match(schema.summary, /repository changes require host-verified shared-target integration/u);
  assert.match(schema.summary, /required release acceptance/u);
  assert.match(schema.summary, /explicitly local-only/u);
  assert.ok(human.values().stdout.includes(schema.summary));
  assert.ok(human.values().stdout.includes(schema.options.find((option: { name: string }) => option.name === "outcome").description));
  assert.equal(human.values().stderr, "");
  assert.equal(json.values().stderr, "");
  assert.equal(serviceCalls, 0);
});

test("--version reports the package version in human and JSON modes", async () => {
  const human = capture();
  assert.equal(await runCli(["--version"], { output: human.output }), 0);
  assert.equal(human.values().stdout, "dongo 0.2.12\n");
  assert.equal(human.values().stderr, "");

  const json = capture();
  assert.equal(await runCli(["--version", "--json"], { output: json.output }), 0);
  assert.deepEqual(JSON.parse(json.values().stdout), {
    ok: true,
    command: "version",
    data: { version: "0.2.12" },
  });
  assert.equal(json.values().stderr, "");
});

test("--json writes exactly one machine-readable result to stdout", async () => {
  const stream = capture();
  const exitCode = await runCli(["overview", "--json"], {
    output: stream.output,
    serviceFactory: () => fakeService as never,
  });
  const values = stream.values();
  assert.equal(exitCode, 0);
  assert.deepEqual(JSON.parse(values.stdout), {
    ok: true,
    command: "overview",
    data: { needsYou: [], working: [], ready: [], inbox: [], recentlyDone: [] },
  });
  assert.equal(values.stderr, "");
  assert.equal(values.stdout.trim().split("\n").length, 1);
});

test("online commands expose a consent-first CLI update advisory to agents", async () => {
  const stream = capture();
  const advisory = {
    available: true as const,
    package: "@wisepunk/dongo" as const,
    currentVersion: "0.2.3",
    latestVersion: "0.3.0",
    consentRequired: true as const,
    prompt: "A newer dongo CLI is available. Ask the user whether they want to install it before running the command.",
    installCommand: "npm install --global @wisepunk/dongo@0.3.0",
  };
  assert.equal(await runCli(["overview", "--json"], {
    output: stream.output,
    serviceFactory: () => fakeService as never,
    updateChecker: async () => advisory,
  }), 0);
  assert.deepEqual(JSON.parse(stream.values().stdout).update, advisory);
  assert.equal(stream.values().stderr, "");

  const human = capture();
  assert.equal(await runCli(["overview"], {
    output: human.output,
    serviceFactory: () => fakeService as never,
    updateChecker: async () => advisory,
  }), 0);
  assert.match(human.values().stderr, /Ask the user before running/u);
  assert.match(human.values().stderr, /@wisepunk\/dongo@0\.3\.0/u);
});

test("the update checker accepts only a newer stable version from the fixed package response", async () => {
  const response = (body: unknown) => async () => new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  assert.equal(await checkForCliUpdate("0.2.3", { fetch: response({ version: "0.2.3" }) }), undefined);
  assert.equal(await checkForCliUpdate("0.2.3", { fetch: response({ version: "latest; rm -rf" }) }), undefined);
  assert.equal(await checkForCliUpdate("0.2.3", { fetch: async () => { throw new Error("offline"); } }), undefined);
  assert.deepEqual(await checkForCliUpdate("0.2.3", { fetch: response({ version: "0.2.4" }) }), {
    available: true,
    package: "@wisepunk/dongo",
    currentVersion: "0.2.3",
    latestVersion: "0.2.4",
    consentRequired: true,
    prompt: "A newer dongo CLI is available. Ask the user whether they want to install it before running the command.",
    installCommand: "npm install --global @wisepunk/dongo@0.2.4",
  });

  const startedAt = Date.now();
  assert.equal(await checkForCliUpdate("0.2.0", {
    timeoutMilliseconds: 10,
    fetch: async (_input, init) => await new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  }), undefined);
  assert.ok(Date.now() - startedAt < 250);
});

test("doctor failure has deterministic JSON and exit code", async () => {
  const stream = capture();
  const exitCode = await runCli(["doctor", "--json"], {
    output: stream.output,
    serviceFactory: () => ({ ...fakeService, doctor: async () => ({ ok: false, checks: [{ name: "server", ok: false }] }) }) as never,
  });
  assert.equal(exitCode, 5);
  assert.deepEqual(JSON.parse(stream.values().stdout), {
    ok: false,
    command: "doctor",
    error: {
      code: "doctor_failed",
      message: "One or more dongo connection checks failed.",
      retryable: true,
      details: { diagnostics: { ok: false, checks: [{ name: "server", ok: false }] } },
    },
  });
});

test("unknown options fail without contaminating JSON stdout", async () => {
  const stream = capture();
  const exitCode = await runCli(["overview", "--bad", "--json"], {
    output: stream.output,
    serviceFactory: () => fakeService as never,
  });
  assert.equal(exitCode, 2);
  assert.equal(JSON.parse(stream.values().stdout).error.code, "validation");
  assert.equal(stream.values().stderr, "");
});

test("connect keeps the complete approval link out of JSON stdout", async () => {
  const stream = capture();
  const verificationUriComplete = "https://dongo.so/device?user_code=ABCD-EFGH";
  const exitCode = await runCli(["connect", "--json", "--no-browser"], {
    output: stream.output,
    serviceFactory: () => ({
      ...fakeService,
      connect: async (options: { events?: { onVerification?: (details: unknown) => void } }) => {
        options.events?.onVerification?.({
          verificationUriComplete,
          userCode: "ABCD-EFGH",
          expiresAt: 1_788_086_460_000,
          browserOpened: false,
        });
        return { project: { publicRef: "pub_1" } };
      },
    }) as never,
  });
  assert.equal(exitCode, 0);
  assert.doesNotMatch(stream.values().stdout, /ABCD-EFGH|verification|user_code/);
  assert.match(stream.values().stderr, /https:\/\/dongo\.so\/device\?user_code=ABCD-EFGH/);
  assert.equal(JSON.parse(stream.values().stdout).data.project.publicRef, "pub_1");
});

test("connect forwards an explicit project proposal", async () => {
  const stream = capture();
  let received: Record<string, unknown> | undefined;
  const exitCode = await runCli([
    "connect",
    "--project-ref", "project_dongo",
    "--project-name", "dongo",
    "--repository-url", "https://github.com/renewisepunk/dongo",
    "--execution-mode", "manual",
    "--agent-host", "codex",
    "--json",
  ], {
    output: stream.output,
    serviceFactory: () => ({
      ...fakeService,
      connect: async (options: Record<string, unknown>) => {
        received = options;
        return { project: { publicRef: "pub_1" } };
      },
    }) as never,
  });
  assert.equal(exitCode, 0);
  assert.equal(received?.projectName, "dongo");
  assert.equal(received?.projectRef, "project_dongo");
  assert.equal(received?.repositoryUrl, "https://github.com/renewisepunk/dongo");
  assert.equal(received?.executionMode, "manual");
  assert.equal(received?.agentHost, "codex");
});

test("connect rejects an unsupported execution mode", async () => {
  const stream = capture();
  assert.equal(await runCli(["connect", "--execution-mode", "reckless", "--json"], {
    output: stream.output,
    serviceFactory: () => fakeService as never,
  }), 2);
  assert.equal(JSON.parse(stream.values().stdout).error.code, "validation");
});

test("connect rejects an unsupported combined-approval host", async () => {
  const stream = capture();
  assert.equal(await runCli(["connect", "--agent-host", "claude", "--json"], {
    output: stream.output,
    serviceFactory: () => fakeService as never,
  }), 2);
  assert.equal(JSON.parse(stream.values().stdout).error.code, "validation");
});

test("project create carries explicit creation intent and explains the free-plan allowance", async () => {
  const stream = capture();
  let received: Record<string, unknown> | undefined;
  const exitCode = await runCli([
    "project", "create",
    "--name", "Another project",
    "--repository-url", "https://github.com/example/another",
    "--execution-mode", "autonomous",
    "--agent-host", "codex",
    "--no-browser",
    "--json",
  ], {
    output: stream.output,
    serviceFactory: () => ({
      ...fakeService,
      createProject: async (options: Record<string, unknown>) => {
        received = options;
        const events = options.events as {
          onVerification?: (details: Record<string, unknown>) => void;
        } | undefined;
        events?.onVerification?.({
          verificationUriComplete: "https://dongo.so/device?user_code=ABCD-EFGH&project_action=create",
          userCode: "ABCD-EFGH",
          expiresAt: 1_788_086_460_000,
          browserOpened: false,
          projectProposal: { name: "Another project" },
        });
        return { project: { publicRef: "pub_created" } };
      },
    }) as never,
  });

  assert.equal(exitCode, 0);
  assert.equal(received?.projectName, "Another project");
  assert.equal(received?.repositoryUrl, "https://github.com/example/another");
  assert.equal(received?.executionMode, "autonomous");
  assert.equal(received?.agentHost, "codex");
  assert.equal(received?.noBrowser, true);
  assert.equal(JSON.parse(stream.values().stdout).command, "project create");
  assert.match(stream.values().stderr, /standard Free allowance is one active project/i);
  assert.match(stream.values().stderr, /effective capacity/i);
  assert.match(stream.values().stderr, /without another account sign-in/i);
});

test("cancellation uses the shell-standard exit code and stable JSON", async () => {
  const stream = capture();
  const exitCode = await runCli(["connect", "--json"], {
    output: stream.output,
    serviceFactory: () => ({
      ...fakeService,
      connect: async () => {
        throw new CliCoreError({ code: "cancelled", message: "dongo authorization was cancelled. No credential was stored.", exitCode: 130 });
      },
    }) as never,
  });
  assert.equal(exitCode, 130);
  assert.equal(JSON.parse(stream.values().stdout).error.code, "cancelled");
  assert.equal(stream.values().stderr, "");
});

test("unexpected failures never reflect their message into JSON output", async () => {
  const stream = capture();
  const exitCode = await runCli(["overview", "--json"], {
    output: stream.output,
    serviceFactory: () => ({ ...fakeService, overview: async () => { throw new Error("refresh-secret customer content"); } }) as never,
  });
  assert.equal(exitCode, 1);
  assert.deepEqual(JSON.parse(stream.values().stdout).error, {
    code: "internal",
    message: "Unexpected CLI failure.",
    retryable: false,
  });
});

test("CLI routes every remaining v1 operation with stable JSON and reusable mutation keys", async () => {
  const cases: Array<{ operation: string; argv: string[] }> = [
    { operation: "get_intake", argv: ["intake", "get", "--intake-id", "intake_1"] },
    { operation: "claim_intake", argv: ["intake", "claim", "--intake-id", "intake_1", "--revision", "1"] },
    { operation: "renew_intake_claim", argv: ["intake", "renew", "--intake-id", "intake_1", "--revision", "2"] },
    { operation: "complete_triage", argv: ["intake", "complete", "--intake-id", "intake_1", "--revision", "3", "--state", "processed"] },
    { operation: "create_work", argv: ["work", "create", "--title", "Title", "--goal", "Goal"] },
    { operation: "get_work", argv: ["work", "get", "--identifier", "DON-1"] },
    { operation: "start_work", argv: ["work", "start", "--work-id", "work_1", "--revision", "1", "--session-id", "session_1"] },
    { operation: "update_work", argv: ["work", "update", "--work-id", "work_1", "--revision", "2", "--activity-kind", "verification", "--activity-label", "Browser acceptance", "--activity-next-step", "Release the candidate"] },
    { operation: "renew_claim", argv: ["work", "renew", "--work-id", "work_1", "--revision", "3"] },
    { operation: "finish_work", argv: ["work", "finish", "--work-id", "work_1", "--revision", "4", "--outcome", "Done"] },
    { operation: "add_comment", argv: ["comment", "add", "--work-id", "work_1", "--body", "Context"] },
    { operation: "request_attention", argv: ["attention", "request", "--work-id", "work_1", "--revision", "5", "--kind", "decision", "--title", "Choose", "--body", "Pick", "--option", "A", "--option", "B"] },
    { operation: "request_owner_attention", argv: ["attention", "request", "--intake-id", "intake_1", "--kind", "question", "--title", "Clarify", "--body", "What should change?"] },
    { operation: "get_attention", argv: ["attention", "get", "--attention-id", "attention_1"] },
    { operation: "resolve_attention", argv: ["attention", "resolve", "--attention-id", "attention_1", "--selected-option", "A"] },
    { operation: "get_updates", argv: ["updates", "get", "--cursor", "7"] },
  ];

  for (const item of cases) {
    const stream = capture();
    const mutation = !item.operation.startsWith("get_");
    const exitCode = await runCli([...item.argv, ...(mutation ? ["--idempotency-key", "idem_12345678"] : []), "--json"], {
      output: stream.output,
      serviceFactory: () => fakeService as never,
    });
    assert.equal(exitCode, 0, item.operation);
    const result = JSON.parse(stream.values().stdout);
    assert.equal(result.data.operation, item.operation);
    if (mutation) assert.equal(result.data.input.idempotencyKey, "idem_12345678");
    assert.equal(stream.values().stderr, "");
  }

  const stream = capture();
  assert.equal(await runCli(["attachment", "get", "--attachment-id", "attachment_1", "--json"], {
    output: stream.output,
    serviceFactory: () => fakeService as never,
  }), 0);
  assert.deepEqual(JSON.parse(stream.values().stdout).data, {
    attachmentId: "attachment_1",
    filename: "report.txt",
    byteSize: 5,
    downloadAvailable: true,
  });
});

test("session and work start forward explicit parallel safety metadata", async () => {
  const received: Array<{ operation: string; input: unknown }> = [];
  const service = {
    ...fakeService,
    execute: async (operation: string, input: unknown) => {
      received.push({ operation, input });
      return { accepted: true };
    },
  };
  const session = capture();
  assert.equal(await runCli([
    "session", "start",
    "--session-id", "agent-session",
    "--parallel-capability", "supported",
    "--worktree-capability", "supported",
    "--json",
  ], { output: session.output, serviceFactory: () => service as never }), 0);
  const work = capture();
  assert.equal(await runCli([
    "work", "start",
    "--work-id", "work_1",
    "--revision", "3",
    "--session-id", "agent-session",
    "--workspace-kind", "worktree",
    "--worktree-name", "agent-one",
    "--branch", "work/one",
    "--json",
  ], { output: work.output, serviceFactory: () => service as never }), 0);
  assert.deepEqual(received[0], {
    operation: "session_start",
    input: {
      externalSessionId: "agent-session",
      hostCapabilities: {
        parallelExecution: "supported",
        worktreeIsolation: "supported",
      },
    },
  });
  assert.equal(received[1]?.operation, "start_work");
  assert.deepEqual(
    received[1]?.input as Record<string, unknown>,
    {
      idempotencyKey: (received[1]?.input as Record<string, unknown>).idempotencyKey,
      workItemId: "work_1",
      expectedRevision: 3,
      externalSessionId: "agent-session",
      leaseSeconds: undefined,
      workspace: {
        kind: "worktree",
        worktreeName: "agent-one",
        branch: "work/one",
      },
    },
  );
});

test("session capability flags are supplied together in the JSON validation envelope", async () => {
  const stream = capture();
  assert.equal(await runCli([
    "session-start",
    "--parallel-capability", "supported",
    "--json",
  ], { output: stream.output, serviceFactory: () => fakeService as never }), 2);
  const envelope = JSON.parse(stream.values().stdout);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.command, "session-start");
  assert.equal(envelope.error.code, "validation");
  assert.deepEqual(envelope.error.details.schema.command, "session-start");
  assert.match(
    envelope.error.details.issues.join("\n"),
    /Provide both --parallel-capability and --worktree-capability/u,
  );
  assert.equal(stream.values().stderr, "");
});

test("work create forwards planning context, links, and an initial comment", async () => {
  const stream = capture();
  let received: Record<string, unknown> | undefined;
  const exitCode = await runCli([
    "work", "create",
    "--title", "Title",
    "--goal", "Goal",
    "--context", "Keep compatibility",
    "--parent-work-id", "work_parent",
    "--link", "https://example.com/spec",
    "--link", "https://example.com/design",
    "--initial-comment", "Start with the client inventory.",
    "--json",
  ], {
    output: stream.output,
    serviceFactory: () => ({
      ...fakeService,
      execute: async (_operation: string, input: Record<string, unknown>) => {
        received = input;
        return { id: "work_1" };
      },
    }) as never,
  });

  assert.equal(exitCode, 0);
  assert.equal(received?.context, "Keep compatibility");
  assert.equal(received?.parentWorkItemId, "work_parent");
  assert.deepEqual(received?.links, ["https://example.com/spec", "https://example.com/design"]);
  assert.equal(received?.initialComment, "Start with the client inventory.");
  assert.equal(stream.values().stderr, "");
});

test("work get forwards canonical compact identifiers without rewriting them", async () => {
  const stream = capture();
  let received: Record<string, unknown> | undefined;
  assert.equal(await runCli([
    "work", "get", "--identifier", "dong008", "--json",
  ], {
    output: stream.output,
    serviceFactory: () => ({
      ...fakeService,
      execute: async (_operation: string, input: Record<string, unknown>) => {
        received = input;
        return { identifier: "dong008", legacyIdentifiers: ["DONGO-8"] };
      },
    }) as never,
  }), 0);
  assert.deepEqual(received, { workItemId: undefined, identifier: "dong008" });
  assert.deepEqual(JSON.parse(stream.values().stdout).data, {
    identifier: "dong008",
    legacyIdentifiers: ["DONGO-8"],
  });
});

test("attention wait discovers a response with bounded exponential backoff", async () => {
  const stream = capture();
  const waits: number[] = [];
  let attempts = 0;
  const exitCode = await runCli([
    "attention",
    "wait",
    "--attention-id",
    "attention_1",
    "--timeout-seconds",
    "300",
    "--json",
  ], {
    output: stream.output,
    wait: async (milliseconds) => {
      waits.push(milliseconds);
    },
    serviceFactory: () => ({
      ...fakeService,
      execute: async () => {
        attempts += 1;
        return attempts === 3
          ? { id: "attention_1", resolution: { kind: "responded", body: "Proceed" } }
          : { id: "attention_1" };
      },
    }) as never,
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(waits, [5_000, 10_000]);
  assert.deepEqual(JSON.parse(stream.values().stdout).data.wait, {
    status: "resolved",
    attempts: 3,
    elapsedSeconds: 15,
  });
  assert.equal(stream.values().stderr, "");
});

test("attention wait stops at its timeout instead of polling forever", async () => {
  const stream = capture();
  const waits: number[] = [];
  const exitCode = await runCli([
    "attention",
    "wait",
    "--attention-id",
    "attention_1",
    "--timeout-seconds",
    "12",
    "--json",
  ], {
    output: stream.output,
    wait: async (milliseconds) => {
      waits.push(milliseconds);
    },
    serviceFactory: () => ({
      ...fakeService,
      execute: async () => ({ id: "attention_1" }),
    }) as never,
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(waits, [5_000, 7_000]);
  assert.deepEqual(JSON.parse(stream.values().stdout).data.wait, {
    status: "timed_out",
    attempts: 3,
    elapsedSeconds: 12,
  });
});

test("updates wait keeps a bounded waiter visible and resumes from the returned cursor", async () => {
  const stream = capture();
  const received: Array<Record<string, unknown>> = [];
  let attempts = 0;
  const exitCode = await runCli([
    "updates",
    "wait",
    "--timeout-seconds",
    "45",
    "--json",
  ], {
    output: stream.output,
    serviceFactory: () => ({
      ...fakeService,
      execute: async (operation: string, input: Record<string, unknown>) => {
        assert.equal(operation, "get_updates");
        received.push(input);
        attempts += 1;
        return attempts === 1
          ? {
              cursor: 5,
              updates: [],
              hasMore: false,
              wait: { status: "timed_out", requestedSeconds: 20, elapsedMilliseconds: 20_000 },
              delivery: { mechanism: "bounded_pull", stoppedAgentsRestarted: false },
              serverTime: 1,
            }
          : {
              cursor: 6,
              updates: [{ id: "signal_1", version: 6, kind: "intake_available", intakeId: "intake_1", priority: "important", createdAt: 2 }],
              hasMore: false,
              wait: { status: "updates_available", requestedSeconds: 20, elapsedMilliseconds: 0 },
              delivery: { mechanism: "bounded_pull", stoppedAgentsRestarted: false },
              serverTime: 2,
            };
      },
    }) as never,
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(received, [
    { cursor: undefined, waitSeconds: 20 },
    { cursor: 5, waitSeconds: 20 },
  ]);
  const data = JSON.parse(stream.values().stdout).data;
  assert.equal(data.updates[0].intakeId, "intake_1");
  assert.deepEqual(data.clientWait, {
    status: "updates_available",
    attempts: 2,
    elapsedSeconds: 20,
  });
  assert.equal(stream.values().stderr, "");
});

test("updates get sends numeric cursor fields through the CLI service boundary", async () => {
  const stream = capture();
  const received: Array<{ operation: string; input: Record<string, unknown> }> = [];
  const exitCode = await runCli([
    "updates",
    "get",
    "--cursor",
    "7",
    "--json",
  ], {
    output: stream.output,
    serviceFactory: () => ({
      ...fakeService,
      execute: async (operation: string, input: Record<string, unknown>) => {
        received.push({ operation, input });
        return {
          cursor: 7,
          updates: [],
          hasMore: false,
          wait: { status: "timed_out", requestedSeconds: 0, elapsedMilliseconds: 0 },
          delivery: { mechanism: "bounded_pull", stoppedAgentsRestarted: false },
          serverTime: 3,
        };
      },
    }) as never,
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(received, [{
    operation: "get_updates",
    input: { cursor: 7, waitSeconds: 0 },
  }]);
  assert.equal(stream.values().stderr, "");
});

test("updates wait stops at the caller timeout and never busy-polls", async () => {
  const stream = capture();
  const received: Array<Record<string, unknown>> = [];
  const exitCode = await runCli([
    "updates",
    "wait",
    "--cursor",
    "9",
    "--timeout-seconds",
    "12",
    "--json",
  ], {
    output: stream.output,
    serviceFactory: () => ({
      ...fakeService,
      execute: async (_operation: string, input: Record<string, unknown>) => {
        received.push(input);
        return {
          cursor: 9,
          updates: [],
          hasMore: false,
          wait: { status: "timed_out", requestedSeconds: 12, elapsedMilliseconds: 12_000 },
          delivery: { mechanism: "bounded_pull", stoppedAgentsRestarted: false },
          serverTime: 3,
        };
      },
    }) as never,
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(received, [{ cursor: 9, waitSeconds: 12 }]);
  assert.deepEqual(JSON.parse(stream.values().stdout).data.clientWait, {
    status: "timed_out",
    attempts: 1,
    elapsedSeconds: 12,
  });
});

test("integration commands preview by default and apply only with the explicit flag", async () => {
  for (const apply of [false, true]) {
    const stream = capture();
    const argv = ["integrate", "codex", ...(apply ? ["--apply"] : []), "--json"];
    assert.equal(await runCli(argv, { output: stream.output, serviceFactory: () => fakeService as never }), 0);
    assert.deepEqual(JSON.parse(stream.values().stdout).data, integrationFixture("codex", apply));
    assert.equal(stream.values().stderr, "");
  }
});

test("runner commands expose explicit local policy and stable JSON", async () => {
  const calls: Array<{ method: string; input?: unknown }> = [];
  const service = {
    ...fakeService,
    runnerInstall: async (input: unknown) => {
      calls.push({ method: "install", input });
      return { installed: true };
    },
    runnerApprove: async (jobId: string) => {
      calls.push({ method: "approve", input: jobId });
      return { approved: true, jobId };
    },
    runnerConfigure: async (input: { approvalMode?: string; browserReviewMode?: string; maxConcurrentJobs?: number }) => {
      calls.push({ method: "configure", input });
      return { changed: true, approvalMode: input.approvalMode ?? "ask", previousApprovalMode: "ask", browserReviewMode: input.browserReviewMode ?? "disabled", previousBrowserReviewMode: "disabled", harnesses: ["codex"] };
    },
  };
  const install = capture();
  assert.equal(await runCli([
    "runner",
    "install",
    "--harness",
    "codex",
    "--harness",
    "claude",
    "--approval",
    "automatic",
    "--browser-review",
    "read-only",
    "--label",
    "Studio Mac",
    "--max-concurrent-jobs",
    "4",
    "--json",
  ], { output: install.output, serviceFactory: () => service as never }), 0);
  assert.deepEqual(calls[0], {
    method: "install",
    input: {
      label: "Studio Mac",
      harnesses: ["codex", "claude"],
      approvalMode: "automatic",
      browserReviewMode: "read_only",
      maxConcurrentJobs: 4,
    },
  });
  assert.equal(JSON.parse(install.values().stdout).command, "runner install");

  const approval = capture();
  assert.equal(await runCli([
    "runner",
    "approve",
    "--job-id",
    "job-1",
    "--json",
  ], { output: approval.output, serviceFactory: () => service as never }), 0);
  assert.deepEqual(calls[1], { method: "approve", input: "job-1" });

  const configure = capture();
  assert.equal(await runCli([
    "runner",
    "configure",
    "--approval",
    "automatic",
    "--max-concurrent-jobs",
    "3",
    "--json",
  ], { output: configure.output, serviceFactory: () => service as never }), 0);
  assert.deepEqual(calls[2], { method: "configure", input: { approvalMode: "automatic", browserReviewMode: undefined, maxConcurrentJobs: 3 } });
  assert.equal(JSON.parse(configure.values().stdout).command, "runner configure");
});

test("runner commands explain outcomes without dumping implementation details", async () => {
  const installResult = {
    registration: {
      id: "registration_internal",
      projectId: "project_internal",
      installationId: "installation_internal",
      label: "This computer",
      platform: "darwin",
      version: "0.1.0",
      harnesses: ["codex"],
      approvalMode: "ask",
      status: "active",
      createdAt: 1_788_458_887_950,
      updatedAt: 1_788_458_887_950,
    },
    service: {
      serviceName: "so.dongo.runner.internal",
      servicePath: "/Users/person/Library/LaunchAgents/so.dongo.runner.internal.plist",
    },
    repositoryRoot: "/Users/Workspace/dongo",
    approvalMode: "ask",
    browserReviewMode: "disabled",
    maxConcurrentJobs: 6,
    harnesses: ["codex"],
  };
  const waitingStatus = {
    installed: true,
    enabled: true,
    projectRef: "project_internal",
    registrationId: "registration_internal",
    repositoryRoot: "/Users/Workspace/dongo",
    harnesses: ["codex"],
    approvalMode: "ask",
    browserReviewMode: "disabled",
    maxConcurrentJobs: 6,
    servicePlatform: "darwin",
    state: {
      schemaVersion: 2,
      status: "awaiting_local_approval",
      projectRef: "project_internal",
      registrationId: "registration_internal",
      version: "0.1.0",
      currentJob: {
        id: "job_actionable",
        kind: "work",
        workIdentifier: "dong062",
        harness: "codex",
        state: "awaiting_local_approval",
        revision: 1,
      },
      currentJobs: [{
        id: "job_actionable",
        kind: "work",
        workIdentifier: "dong062",
        harness: "codex",
        state: "awaiting_local_approval",
        revision: 1,
        worktreeName: "dong062-12345678",
        branch: "codex/dongo-runner-dong062-123456789abc",
      }],
      updatedAt: "2026-09-03T18:00:00.000Z",
    },
  };
  const service = {
    ...fakeService,
    runnerInstall: async () => installResult,
    runnerStatus: async () => waitingStatus,
    runnerApprove: async (jobId: string) => ({
      approved: true,
      jobId,
      kind: "work",
      workIdentifier: "dong062",
      intakeId: undefined,
    }),
    runnerConfigure: async ({ approvalMode, browserReviewMode, maxConcurrentJobs }: { approvalMode?: "ask" | "automatic"; browserReviewMode?: "disabled" | "read_only"; maxConcurrentJobs?: number }) => ({
      changed: true,
      approvalMode: approvalMode ?? "ask",
      previousApprovalMode: approvalMode === "automatic" ? "ask" as const : "automatic" as const,
      browserReviewMode: browserReviewMode ?? "disabled",
      previousBrowserReviewMode: "disabled" as const,
      maxConcurrentJobs: maxConcurrentJobs ?? 6,
      previousMaxConcurrentJobs: 6,
      harnesses: ["codex" as const],
    }),
    runnerDisable: async () => ({
      disabled: true,
      service: { serviceName: "so.dongo.runner.internal", servicePath: "/Users/person/internal.plist" },
    }),
    runnerRemove: async () => ({
      removed: true,
      registrationId: "registration_internal",
      service: { serviceName: "so.dongo.runner.internal", servicePath: "/Users/person/internal.plist" },
    }),
    runnerRun: async () => ({ stopped: true }),
  };

  const install = capture();
  assert.equal(await runCli(["runner", "install", "--harness", "codex"], {
    output: install.output,
    serviceFactory: () => service as never,
  }), 0);
  assert.equal(install.values().stdout, [
    "dongo runner is ready.",
    "",
    "This computer can now run queued dongo work with Codex in this repository—even after you close this terminal. Eligible jobs run concurrently in separate Git worktrees, up to the project safety limit.",
    "You’ll be asked on this computer before an agent starts working.",
    "Browser self-review is off. An agent will ask you when live browser verification is required.",
    "This computer will run at most 6 jobs at once.",
    "macOS may show “Background Items Added” for “dongo.” That is this user-level dongo runner, not an unknown Node.js service.",
    "Manage it in System Settings → General → Login Items & Extensions, or use dongo runner disable and dongo runner remove.",
    "New Inbox items are not routed here automatically. To enable that, first run: dongo runner configure --approval automatic",
    "If this computer is offline, the issue waits until it comes back.",
    "",
    "Check it anytime: dongo runner status",
    "",
  ].join("\n"));
  assert.doesNotMatch(install.values().stdout, /registration_internal|project_internal|\/Users\/|1788458887950|so\.dongo/u);

  const status = capture();
  assert.equal(await runCli(["runner", "status"], {
    output: status.output,
    serviceFactory: () => service as never,
  }), 0);
  assert.match(status.values().stdout, /^dongo runner is on\./u);
  assert.match(status.values().stdout, /1 agent job is active in separate worktrees \(1 awaiting local approval\)\./u);
  assert.match(status.values().stdout, /dongo runner approve --job-id job_actionable/u);
  assert.match(status.values().stdout, /Background Items Added/u);
  assert.match(status.values().stdout, /System Settings → General → Login Items & Extensions/u);
  assert.doesNotMatch(status.values().stdout, /registration_internal|project_internal|\/Users\/|2026-09-03/u);
  assert.match(status.values().stdout, /New Inbox items are not routed here automatically/u);

  const configure = capture();
  assert.equal(await runCli(["runner", "configure", "--approval", "automatic"], {
    output: configure.output,
    serviceFactory: () => service as never,
  }), 0);
  assert.equal(configure.values().stdout, [
    "dongo runner settings were updated.",
    "",
    "Your agents can start automatically in isolated Git worktrees.",
    "Browser self-review is off. An agent will ask you when live browser verification is required.",
    "Local concurrency limit: 6 jobs.",
    "Codex can start in isolated Git worktrees. Confirm Inbox routing in Project settings → Local runner.",
    "",
  ].join("\n"));

  const approve = capture();
  assert.equal(await runCli(["runner", "approve", "--job-id", "job_actionable"], {
    output: approve.output,
    serviceFactory: () => service as never,
  }), 0);
  assert.equal(approve.values().stdout, "Job approved.\nAn agent can now start working on dong062 on this computer.\n");

  const disable = capture();
  assert.equal(await runCli(["runner", "disable"], {
    output: disable.output,
    serviceFactory: () => service as never,
  }), 0);
  assert.match(disable.values().stdout, /^dongo runner is paused\./u);
  assert.doesNotMatch(disable.values().stdout, /so\.dongo|\/Users\//u);

  const remove = capture();
  assert.equal(await runCli(["runner", "remove"], {
    output: remove.output,
    serviceFactory: () => service as never,
  }), 0);
  assert.match(remove.values().stdout, /^dongo runner was removed\./u);
  assert.match(remove.values().stdout, /runner access was revoked/u);
  assert.doesNotMatch(remove.values().stdout, /registration_internal|so\.dongo|\/Users\//u);

  const foreground = capture();
  assert.equal(await runCli(["runner", "run", "--project-ref", "project_internal"], {
    output: foreground.output,
    serviceFactory: () => service as never,
  }), 0);
  assert.equal(foreground.values().stdout, "dongo runner stopped.\n");

  const json = capture();
  assert.equal(await runCli(["runner", "install", "--harness", "codex", "--json"], {
    output: json.output,
    serviceFactory: () => service as never,
  }), 0);
  assert.deepEqual(JSON.parse(json.values().stdout), {
    ok: true,
    command: "runner install",
    data: installResult,
  });
});

test("runner status explains how to set up an unconfigured repository", async () => {
  const stream = capture();
  assert.equal(await runCli(["runner", "status"], {
    output: stream.output,
    serviceFactory: () => ({
      ...fakeService,
      runnerStatus: async () => ({
        installed: false,
        enabled: false,
        projectRef: "project_internal",
        harnesses: [],
        servicePlatform: "darwin",
      }),
    }) as never,
  }), 0);
  assert.equal(stream.values().stdout, [
    "No dongo runner is set up for this repository.",
    "",
    "Set one up to let this computer work on dongo issues, even after you close the terminal.",
    "Start with: dongo runner install --help",
    "",
  ].join("\n"));
});

test("integration human output gives the ordered setup sequence without raw configuration details", async () => {
  const stream = capture();
  assert.equal(await runCli(["integrate", "claude", "--apply"], {
    output: stream.output,
    serviceFactory: () => fakeService as never,
  }), 0);
  const stdout = stream.values().stdout;
  assert.match(stdout, /^dongo Claude Code configuration applied successfully\./u);
  assert.match(stdout, /1\. Apply the configuration\. \(done\)[\s\S]*2\. Approve the project-scoped server, if required\. \(if required\)[\s\S]*3\. Complete login, if required\. \(if required\)[\s\S]*4\. Restart only when necessary\. \(if required\)[\s\S]*5\. Verify the connection\. \(after the prior steps\)/u);
  assert.match(stdout, /Run: claude mcp login dongo-project/u);
  assert.doesNotMatch(stdout, /https:\/\/|private implementation detail|rollback|serverName|managedContent/u);
  assert.doesNotMatch(stdout, noncanonicalProductCase);
  assert.equal(stream.values().stderr, "");
});

test("mutation validation fails before invoking the service", async () => {
  let called = false;
  const stream = capture();
  const exitCode = await runCli(["work", "finish", "--work-id", "work_1", "--revision", "not-a-number", "--outcome", "Done", "--json"], {
    output: stream.output,
    serviceFactory: () => ({ ...fakeService, execute: async () => { called = true; } }) as never,
  });
  assert.equal(exitCode, 2);
  assert.equal(called, false);
  assert.equal(JSON.parse(stream.values().stdout).error.code, "validation");
});

test("validation reports all argument problems with the expected command schema", async () => {
  let called = false;
  const stream = capture();
  const exitCode = await runCli([
    "attention", "request",
    "--revision", "not-a-number",
    "--kind", "wrong",
    "--title", "",
    "--option", "only-one",
    "--timeout-seconds", "0",
    "--json",
  ], {
    output: stream.output,
    serviceFactory: () => ({ ...fakeService, execute: async () => { called = true; } }) as never,
  });
  assert.equal(exitCode, 2);
  assert.equal(called, false);
  const envelope = JSON.parse(stream.values().stdout);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.command, "attention request");
  assert.equal(envelope.error.code, "validation");
  assert.deepEqual(envelope.error.details.schema.command, "attention request");
  assert.deepEqual(envelope.error.details.issues, [
    "--timeout-seconds is not valid for attention request.",
    "--revision must be an integer in at least 0.",
    "--kind must be one of: review, decision, question, blocked.",
    "--title is required.",
    "--body is required.",
    "Provide either zero or at least two --option values.",
    "Provide --work-id and --revision together, or omit both for owner Attention.",
  ]);
  assert.equal(stream.values().stderr, "");
});

test("API exit codes distinguish scope, conflict, and temporary failures", async () => {
  const cases = [
    { code: "insufficient_scope", retryable: false, exitCode: 4 },
    { code: "revision_conflict", retryable: false, exitCode: 6 },
    { code: "network_error", retryable: true, exitCode: 5 },
  ];
  for (const item of cases) {
    const stream = capture();
    const exitCode = await runCli(["overview", "--json"], {
      output: stream.output,
      serviceFactory: () => ({
        ...fakeService,
        overview: async () => {
          throw new DongoClientError({ code: item.code, message: "Safe failure.", retryable: item.retryable });
        },
      }) as never,
    });
    assert.equal(exitCode, item.exitCode);
  }
});

test("an already resolved Attention returns the specific idempotent conflict", async () => {
  const stream = capture();
  const exitCode = await runCli([
    "attention", "resolve", "--attention-id", "attention_1", "--selected-option", "A", "--json",
  ], {
    output: stream.output,
    serviceFactory: () => ({
      ...fakeService,
      execute: async () => {
        throw new DongoClientError({ code: "already_resolved", message: "generic domain message", retryable: true });
      },
    }) as never,
  });
  assert.equal(exitCode, 6);
  const envelope = JSON.parse(stream.values().stdout);
  assert.equal(envelope.command, "attention resolve");
  assert.deepEqual(envelope.error, {
    code: "already_resolved",
    message: "Attention already resolved.",
    retryable: false,
  });
  assert.match(envelope.recovery.idempotencyKey, /^[0-9a-f-]{36}$/);
  assert.equal(stream.values().stderr, "");
});

test("generated mutation keys are recoverable after a temporary response failure", async () => {
  let receivedKey = "";
  const stream = capture();
  const exitCode = await runCli(["work", "create", "--title", "Title", "--goal", "Goal", "--json"], {
    output: stream.output,
    serviceFactory: () => ({
      ...fakeService,
      execute: async (_operation: string, input: { idempotencyKey: string }) => {
        receivedKey = input.idempotencyKey;
        throw new DongoClientError({ code: "network_error", message: "Could not reach dongo.", retryable: true });
      },
    }) as never,
  });
  assert.equal(exitCode, 5);
  assert.match(receivedKey, /^[0-9a-f-]{36}$/);
  assert.equal(stream.values().stderr, "");
  const envelope = JSON.parse(stream.values().stdout);
  assert.equal(envelope.command, "work create");
  assert.equal(envelope.error.details.idempotencyKey, receivedKey);
  assert.deepEqual(envelope.recovery, { idempotencyKey: receivedKey });
});

test("generated mutation keys are returned in successful JSON envelopes", async () => {
  let receivedKey = "";
  const stream = capture();
  assert.equal(await runCli(["comment", "add", "--work-id", "work_1", "--body", "Done", "--json"], {
    output: stream.output,
    serviceFactory: () => ({
      ...fakeService,
      execute: async (_operation: string, input: { idempotencyKey: string }) => {
        receivedKey = input.idempotencyKey;
        return { saved: true };
      },
    }) as never,
  }), 0);
  const envelope = JSON.parse(stream.values().stdout);
  assert.deepEqual(envelope.recovery, { idempotencyKey: receivedKey });
  assert.equal(stream.values().stderr, "");
});

test("human output escapes bidirectional terminal controls", async () => {
  const stream = capture();
  assert.equal(await runCli(["overview"], {
    output: stream.output,
    serviceFactory: () => ({ ...fakeService, overview: async () => ({ title: "safe\u202espoof" }) }) as never,
  }), 0);
  assert.doesNotMatch(stream.values().stdout, /\u202e/);
  assert.match(stream.values().stdout, /\\u202e/);
});
