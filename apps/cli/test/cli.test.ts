import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { CliCoreError } from "@dongo/cli-core";
import { DongoClientError } from "@dongo/client";
import { isEntrypoint, runCli } from "../src/index.ts";

test("the installed workspace symlink resolves to the CLI entrypoint", () => {
  const source = resolve("src/index.ts");
  const installedBinary = resolve("../../node_modules/.bin/dongo");
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

const fakeService = {
  connect: async () => ({ project: { publicRef: "pub_1" } }),
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
  integration: async (host: string, apply: boolean) => ({ host, applied: apply, files: [] }),
};

test("ci setup accepts only a non-interactive environment selection", async () => {
  const stream = capture();
  let environment: string | undefined;
  const exitCode = await runCli(
    ["ci", "setup", "--environment", "production", "--json"],
    {
      output: stream.output,
      serviceFactory: () => ({
        ...fakeService,
        setupCi: async (options: { environment?: string }) => {
          environment = options.environment;
          return {
            project: { publicRef: "pub_ci" },
            credentialStore: "environment",
          };
        },
      }) as never,
    },
  );
  assert.equal(exitCode, 0);
  assert.equal(environment, "production");
  assert.deepEqual(JSON.parse(stream.values().stdout), {
    ok: true,
    command: "ci setup",
    data: {
      project: { publicRef: "pub_ci" },
      credentialStore: "environment",
    },
  });

  const rejected = capture();
  assert.equal(
    await runCli(["ci", "setup", "--origin", "https://other.example", "--json"], {
      output: rejected.output,
      serviceFactory: () => fakeService as never,
    }),
    2,
  );
});

test("--version reports the package version in human and JSON modes", async () => {
  const human = capture();
  assert.equal(await runCli(["--version"], { output: human.output }), 0);
  assert.equal(human.values().stdout, "dongo 0.1.0\n");
  assert.equal(human.values().stderr, "");

  const json = capture();
  assert.equal(await runCli(["--version", "--json"], { output: json.output }), 0);
  assert.deepEqual(JSON.parse(json.values().stdout), {
    ok: true,
    command: "version",
    data: { version: "0.1.0" },
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
    data: { ok: false, checks: [{ name: "server", ok: false }] },
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
  const verificationUriComplete = "https://dev.dongo.so/device?user_code=ABCD-EFGH";
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
  assert.match(stream.values().stderr, /https:\/\/dev\.dongo\.so\/device\?user_code=ABCD-EFGH/);
  assert.equal(JSON.parse(stream.values().stdout).data.project.publicRef, "pub_1");
});

test("cancellation uses the shell-standard exit code and stable JSON", async () => {
  const stream = capture();
  const exitCode = await runCli(["connect", "--json"], {
    output: stream.output,
    serviceFactory: () => ({
      ...fakeService,
      connect: async () => {
        throw new CliCoreError({ code: "cancelled", message: "Dongo authorization was cancelled. No credential was stored.", exitCode: 130 });
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
    { operation: "update_work", argv: ["work", "update", "--work-id", "work_1", "--revision", "2", "--latest-update", "Progress"] },
    { operation: "renew_claim", argv: ["work", "renew", "--work-id", "work_1", "--revision", "3"] },
    { operation: "finish_work", argv: ["work", "finish", "--work-id", "work_1", "--revision", "4", "--outcome", "Done"] },
    { operation: "add_comment", argv: ["comment", "add", "--work-id", "work_1", "--body", "Context"] },
    { operation: "request_attention", argv: ["attention", "request", "--work-id", "work_1", "--revision", "5", "--kind", "decision", "--title", "Choose", "--body", "Pick", "--option", "A", "--option", "B"] },
    { operation: "get_attention", argv: ["attention", "get", "--attention-id", "attention_1"] },
    { operation: "resolve_attention", argv: ["attention", "resolve", "--attention-id", "attention_1", "--selected-option", "A"] },
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

test("integration commands preview by default and apply only with the explicit flag", async () => {
  for (const apply of [false, true]) {
    const stream = capture();
    const argv = ["integrate", "codex", ...(apply ? ["--apply"] : []), "--json"];
    assert.equal(await runCli(argv, { output: stream.output, serviceFactory: () => fakeService as never }), 0);
    assert.deepEqual(JSON.parse(stream.values().stdout).data, { host: "codex", applied: apply, files: [] });
  }
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

test("generated mutation keys are recoverable after a temporary response failure", async () => {
  let receivedKey = "";
  const stream = capture();
  const exitCode = await runCli(["work", "create", "--title", "Title", "--goal", "Goal", "--json"], {
    output: stream.output,
    serviceFactory: () => ({
      ...fakeService,
      execute: async (_operation: string, input: { idempotencyKey: string }) => {
        receivedKey = input.idempotencyKey;
        throw new DongoClientError({ code: "network_error", message: "Could not reach Dongo.", retryable: true });
      },
    }) as never,
  });
  assert.equal(exitCode, 5);
  assert.match(receivedKey, /^[0-9a-f-]{36}$/);
  assert.match(stream.values().stderr, new RegExp(receivedKey));
  assert.equal(JSON.parse(stream.values().stdout).error.details.idempotencyKey, receivedKey);
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
