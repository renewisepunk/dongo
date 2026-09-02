import { CliCoreError, CoreService } from "@dongo/cli-core";
import { DongoClient } from "@dongo/client";
import type { OperationInput } from "@dongo/contracts";
import type { OperationOutput } from "@dongo/contracts";
import { readFileSync } from "node:fs";
import { parseArgs } from "./args.ts";
import type { ParsedArgs } from "./args.ts";
import { commandName, renderHelp, validateCommand } from "./command-schema.ts";
import { renderIntegrationOutput } from "./integration-output.ts";
import type { OutputWriter } from "./output.ts";
import { errorResult, processOutput, writeJson } from "./output.ts";
import { checkForCliUpdate } from "./update.ts";
import type { CliUpdateAdvisory } from "./update.ts";

const CLI_VERSION = (JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string }).version;

export interface CliDependencies {
  output?: OutputWriter;
  signal?: AbortSignal;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  updateChecker?: () => Promise<CliUpdateAdvisory | undefined>;
  serviceFactory?: () => Pick<
    CoreService,
    | "connect"
    | "createProject"
    | "setupCi"
    | "authStatus"
    | "logout"
    | "doctor"
    | "sessionStart"
    | "overview"
    | "sync"
    | "execute"
    | "attachmentInfo"
    | "fetchAttachment"
    | "integration"
    | "runnerInstall"
    | "runnerStatus"
    | "runnerApprove"
    | "runnerDisable"
    | "runnerRemove"
    | "runnerRun"
  >;
}

const updateAwareCommands = new Set([
  "connect",
  "project create",
  "ci setup",
  "doctor",
  "session-start",
  "session start",
  "overview",
  "intake get",
  "intake claim",
  "intake renew",
  "intake complete",
  "work create",
  "work get",
  "work start",
  "work update",
  "work renew",
  "work finish",
  "comment add",
  "attention request",
  "attention get",
  "attention wait",
  "attention resolve",
  "updates get",
  "updates wait",
  "attachment get",
  "attachment fetch",
  "sync",
]);

function humanJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2).replace(/[\u202a-\u202e\u2066-\u2069]/gi, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
  )}\n`;
}

function values(parsed: ParsedArgs, name: string): string[] {
  return parsed.values[name] ?? [];
}

function option(parsed: ParsedArgs, name: string): string | undefined {
  const found = values(parsed, name);
  if (found.length > 1) {
    throw new CliCoreError({ code: "validation", message: `--${name} may be provided only once.`, exitCode: 2 });
  }
  return found[0];
}

function requiredOption(parsed: ParsedArgs, name: string): string {
  const value = option(parsed, name);
  if (value === undefined || value.length === 0) {
    throw new CliCoreError({ code: "validation", message: `--${name} is required.`, exitCode: 2 });
  }
  return value;
}

function integerOption(parsed: ParsedArgs, name: string, minimum: number, required = false): number | undefined {
  const raw = option(parsed, name);
  if (raw === undefined) {
    if (required) throw new CliCoreError({ code: "validation", message: `--${name} is required.`, exitCode: 2 });
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new CliCoreError({ code: "validation", message: `--${name} must be an integer of at least ${minimum}.`, exitCode: 2 });
  }
  return value;
}

async function defaultWait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw new CliCoreError({ code: "cancelled", message: "Attention wait was cancelled.", exitCode: 130 });
  }
  await new Promise<void>((resolve, reject) => {
    const complete = () => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    };
    const timer = setTimeout(complete, milliseconds);
    const cancel = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      reject(new CliCoreError({
        code: "cancelled",
        message: "Attention wait was cancelled.",
        exitCode: 130,
      }));
    };
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

async function waitForAttention(
  service: Pick<CoreService, "execute">,
  attentionId: string,
  timeoutSeconds: number,
  dependencies: CliDependencies,
): Promise<{
  attention: OperationOutput<"get_attention">;
  wait: { status: "resolved" | "timed_out"; attempts: number; elapsedSeconds: number };
}> {
  const timeoutMilliseconds = timeoutSeconds * 1_000;
  const pause = dependencies.wait ?? defaultWait;
  let elapsedMilliseconds = 0;
  let intervalMilliseconds = 5_000;
  let attempts = 0;
  while (true) {
    const attention = await service.execute(
      "get_attention",
      { attentionId },
      dependencies.signal,
    );
    attempts += 1;
    if (attention.resolution) {
      return {
        attention,
        wait: {
          status: "resolved",
          attempts,
          elapsedSeconds: elapsedMilliseconds / 1_000,
        },
      };
    }
    if (elapsedMilliseconds >= timeoutMilliseconds) {
      return {
        attention,
        wait: {
          status: "timed_out",
          attempts,
          elapsedSeconds: elapsedMilliseconds / 1_000,
        },
      };
    }
    const nextWait = Math.min(
      intervalMilliseconds,
      timeoutMilliseconds - elapsedMilliseconds,
    );
    await pause(nextWait, dependencies.signal);
    elapsedMilliseconds += nextWait;
    intervalMilliseconds = Math.min(intervalMilliseconds * 2, 30_000);
  }
}

async function waitForUpdates(
  service: Pick<CoreService, "execute">,
  cursor: number | undefined,
  timeoutSeconds: number,
  dependencies: CliDependencies,
): Promise<OperationOutput<"get_updates"> & {
  clientWait: {
    status: "updates_available" | "timed_out";
    attempts: number;
    elapsedSeconds: number;
  };
}> {
  let currentCursor = cursor;
  let remainingSeconds = timeoutSeconds;
  let elapsedSeconds = 0;
  let attempts = 0;

  while (true) {
    const requestedSeconds = Math.min(20, remainingSeconds);
    const updates = await service.execute(
      "get_updates",
      { cursor: currentCursor, waitSeconds: requestedSeconds },
      dependencies.signal,
    );
    attempts += 1;
    const reportedSeconds = Math.max(0, updates.wait.elapsedMilliseconds / 1_000);
    const segmentSeconds = updates.wait.status === "timed_out"
      ? Math.max(requestedSeconds, reportedSeconds)
      : reportedSeconds;
    elapsedSeconds = Math.min(timeoutSeconds, elapsedSeconds + segmentSeconds);

    if (updates.updates.length > 0 || updates.hasMore) {
      return {
        ...updates,
        clientWait: { status: "updates_available", attempts, elapsedSeconds },
      };
    }

    currentCursor = updates.cursor;
    remainingSeconds = Math.max(0, timeoutSeconds - elapsedSeconds);
    if (remainingSeconds === 0 || updates.wait.status === "not_requested") {
      return {
        ...updates,
        clientWait: { status: "timed_out", attempts, elapsedSeconds },
      };
    }
  }
}

function mutationKey(parsed: ParsedArgs, onGenerated: (key: string) => void): string {
  const supplied = option(parsed, "idempotency-key");
  if (supplied) return supplied;
  const generated = DongoClient.idempotencyKey();
  onGenerated(generated);
  return generated;
}

function artifact(value: string): NonNullable<OperationInput<"update_work">["artifact"]> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as NonNullable<OperationInput<"update_work">["artifact"]>;
  } catch {
    throw new CliCoreError({ code: "validation", message: "--artifact must be one JSON object.", exitCode: 2 });
  }
}

function requireSubcommand(parsed: ParsedArgs, allowed: string[], usage: string): string {
  if (!parsed.subcommand || !allowed.includes(parsed.subcommand) || parsed.positionals.length !== 2) {
    throw new CliCoreError({ code: "validation", message: usage, exitCode: 2 });
  }
  return parsed.subcommand;
}

function requirePositionals(parsed: ParsedArgs, count: number, usage: string): void {
  if (parsed.positionals.length !== count) {
    throw new CliCoreError({ code: "validation", message: usage, exitCode: 2 });
  }
}

export async function runCli(argv: string[], dependencies: CliDependencies = {}): Promise<number> {
  const output = dependencies.output ?? processOutput;
  const jsonRequested = argv.includes("--json");
  let mutationRecoveryKey: string | undefined;
  let parsed: ParsedArgs | undefined;
  try {
    parsed = parseArgs(argv);
    if (parsed.help || parsed.command === "help") {
      const help = renderHelp(parsed);
      if (parsed.json) writeJson(output, { ok: true, command: help.command, data: { usage: help.usage, schema: help.schema } });
      else output.stdout(help.usage);
      return 0;
    }
    const validated = validateCommand(parsed);
    const commandArgs = parsed;
    const service = (dependencies.serviceFactory ?? (() => new CoreService()))();
    const commandMutationKey = () =>
      mutationKey(commandArgs, (key) => {
        mutationRecoveryKey = key;
        if (!commandArgs.json) output.stderr(`Mutation recovery key (reuse only for this exact request): ${key}\n`);
      });

    let data: unknown;
    let humanOutput: string | undefined;
    let command = validated.name;
    switch (parsed.command) {
      case "version":
        if (parsed.json) {
          writeJson(output, { ok: true, command: "version", data: { version: CLI_VERSION } });
        } else {
          output.stdout(`dongo ${CLI_VERSION}\n`);
        }
        return 0;
      case "connect":
        requirePositionals(parsed, 1, "Usage: dongo connect [options]");
        const executionMode = option(parsed, "execution-mode");
        if (executionMode !== undefined && executionMode !== "manual" && executionMode !== "autonomous") {
          throw new CliCoreError({ code: "validation", message: "--execution-mode must be manual or autonomous.", exitCode: 2 });
        }
        data = await service.connect({
          noBrowser: parsed.noBrowser,
          projectRef: option(parsed, "project-ref"),
          projectName: option(parsed, "project-name"),
          repositoryUrl: option(parsed, "repository-url"),
          executionMode,
          signal: dependencies.signal,
          events: {
            onVerification: ({ verificationUriComplete, userCode, expiresAt, browserOpened, projectProposal }) => {
              output.stderr(
                `${browserOpened ? "Opened" : "Open"} this secure link:\n${verificationUriComplete}\n\n` +
                  (projectProposal
                    ? `Approval may create “${projectProposal.name}”${projectProposal.repositoryUrl ? ` for ${projectProposal.repositoryUrl}` : ""}. The standard Free allowance is one active project; the approval page shows this account’s effective capacity. Use --project-ref to bind an existing project.\n`
                    : "") +
                  `Confirm code ${userCode} in the browser. Waiting until ${new Date(expiresAt).toISOString()}…\n`,
              );
            },
            onSlowDown: (seconds) => output.stderr(`Authorization server requested slower polling (${seconds}s).\n`),
            onNetworkRetry: (message) => output.stderr(`${message}\n`),
          },
        });
        break;
      case "project": {
        requireSubcommand(parsed, ["create"], "Usage: dongo project create --name NAME [options]");
        command = "project create";
        const projectExecutionMode = option(parsed, "execution-mode");
        if (
          projectExecutionMode !== undefined
          && projectExecutionMode !== "manual"
          && projectExecutionMode !== "autonomous"
        ) {
          throw new CliCoreError({
            code: "validation",
            message: "--execution-mode must be manual or autonomous.",
            exitCode: 2,
          });
        }
        const newProjectName = requiredOption(parsed, "name");
        data = await service.createProject({
          noBrowser: parsed.noBrowser,
          projectName: newProjectName,
          repositoryUrl: option(parsed, "repository-url"),
          executionMode: projectExecutionMode,
          signal: dependencies.signal,
          events: {
            onVerification: ({ verificationUriComplete, userCode, expiresAt, browserOpened, projectProposal }) => {
              output.stderr(
                `${browserOpened ? "Opened" : "Open"} this secure link:\n${verificationUriComplete}\n\n` +
                  `Approval will create “${projectProposal?.name ?? newProjectName}” and bind this repository. ` +
                  "The standard Free allowance is one active project; the approval page will show this account’s effective capacity and whether you can create this one. " +
                  "Your existing browser session can approve it without another account sign-in.\n" +
                  `Confirm code ${userCode} in the browser. Waiting until ${new Date(expiresAt).toISOString()}…\n`,
              );
            },
            onSlowDown: (seconds) => output.stderr(`Authorization server requested slower polling (${seconds}s).\n`),
            onNetworkRetry: (message) => output.stderr(`${message}\n`),
          },
        });
        break;
      }
      case "ci":
        requirePositionals(
          parsed,
          2,
          "Usage: dongo ci setup",
        );
        if (parsed.subcommand !== "setup") {
          throw new CliCoreError({
            code: "validation",
            message:
              "Usage: dongo ci setup",
            exitCode: 2,
          });
        }
        command = "ci setup";
        data = await service.setupCi({ signal: dependencies.signal });
        break;
      case "auth":
        requirePositionals(parsed, 2, "Usage: dongo auth status|logout");
        if (parsed.subcommand === "status") {
          command = "auth status";
          data = await service.authStatus();
        } else if (parsed.subcommand === "logout") {
          command = "auth logout";
          data = await service.logout();
        } else {
          throw new CliCoreError({ code: "validation", message: "Usage: dongo auth status|logout", exitCode: 2 });
        }
        break;
      case "doctor":
        requirePositionals(parsed, 1, "Usage: dongo doctor");
        data = await service.doctor(dependencies.signal);
        if (!(data as { ok: boolean }).ok) {
          throw new CliCoreError({
            code: "doctor_failed",
            message: "One or more dongo connection checks failed.",
            retryable: true,
            exitCode: 5,
            details: { diagnostics: data },
          });
        }
        break;
      case "session-start":
        requirePositionals(parsed, 1, "Usage: dongo session-start");
        data = await service.execute("session_start", {
          externalSessionId: option(parsed, "session-id") ?? DongoClient.idempotencyKey(),
          hostCapabilities: option(parsed, "parallel-capability") || option(parsed, "worktree-capability")
            ? {
                parallelExecution: option(parsed, "parallel-capability") as "supported" | "unsupported",
                worktreeIsolation: option(parsed, "worktree-capability") as "supported" | "unsupported",
              }
            : undefined,
        }, dependencies.signal);
        break;
      case "session":
        requirePositionals(parsed, 2, "Usage: dongo session start");
        if (parsed.subcommand !== "start") {
          throw new CliCoreError({ code: "validation", message: "Usage: dongo session start", exitCode: 2 });
        }
        command = "session start";
        data = await service.execute("session_start", {
          externalSessionId: option(parsed, "session-id") ?? DongoClient.idempotencyKey(),
          hostCapabilities: option(parsed, "parallel-capability") || option(parsed, "worktree-capability")
            ? {
                parallelExecution: option(parsed, "parallel-capability") as "supported" | "unsupported",
                worktreeIsolation: option(parsed, "worktree-capability") as "supported" | "unsupported",
              }
            : undefined,
        }, dependencies.signal);
        break;
      case "overview":
        requirePositionals(parsed, 1, "Usage: dongo overview");
        data = await service.overview(dependencies.signal);
        break;
      case "intake": {
        const action = requireSubcommand(parsed, ["get", "claim", "renew", "complete"], "Usage: dongo intake get|claim|renew|complete [options]");
        command = `intake ${action}`;
        const intakeId = requiredOption(parsed, "intake-id");
        if (action === "get") data = await service.execute("get_intake", { intakeId }, dependencies.signal);
        else if (action === "claim") {
          data = await service.execute("claim_intake", {
            idempotencyKey: commandMutationKey(),
            intakeId,
            expectedRevision: integerOption(parsed, "revision", 0, true) ?? 0,
            leaseSeconds: integerOption(parsed, "lease-seconds", 1),
          }, dependencies.signal);
        } else if (action === "renew") {
          data = await service.execute("renew_intake_claim", {
            idempotencyKey: commandMutationKey(),
            intakeId,
            expectedRevision: integerOption(parsed, "revision", 0, true) ?? 0,
            leaseSeconds: integerOption(parsed, "lease-seconds", 1),
          }, dependencies.signal);
        } else {
          const state = requiredOption(parsed, "state");
          if (state !== "processed" && state !== "dismissed") {
            throw new CliCoreError({ code: "validation", message: "--state must be processed or dismissed.", exitCode: 2 });
          }
          data = await service.execute("complete_triage", {
            idempotencyKey: commandMutationKey(),
            intakeId,
            expectedRevision: integerOption(parsed, "revision", 0, true) ?? 0,
            state,
            explanation: option(parsed, "explanation"),
            linkedWorkItemIds: values(parsed, "linked-work-id").length > 0 ? values(parsed, "linked-work-id") : undefined,
          }, dependencies.signal);
        }
        break;
      }
      case "work": {
        const action = requireSubcommand(parsed, ["create", "get", "start", "update", "renew", "finish"], "Usage: dongo work create|get|start|update|renew|finish [options]");
        command = `work ${action}`;
        if (action === "create") {
          data = await service.execute("create_work", {
            idempotencyKey: commandMutationKey(),
            title: requiredOption(parsed, "title"),
            goal: requiredOption(parsed, "goal"),
            context: option(parsed, "context"),
            links: values(parsed, "link").length > 0 ? values(parsed, "link") : undefined,
            initialComment: option(parsed, "initial-comment"),
            sourceIntakeIds: values(parsed, "source-intake-id").length > 0 ? values(parsed, "source-intake-id") : undefined,
            parentWorkItemId: option(parsed, "parent-work-id"),
          }, dependencies.signal);
        } else if (action === "get") {
          const workItemId = option(parsed, "work-id");
          const identifier = option(parsed, "identifier");
          if (Boolean(workItemId) === Boolean(identifier)) {
            throw new CliCoreError({ code: "validation", message: "Provide exactly one of --work-id or --identifier.", exitCode: 2 });
          }
          data = await service.execute("get_work", { workItemId, identifier }, dependencies.signal);
        } else if (action === "start") {
          data = await service.execute("start_work", {
            idempotencyKey: commandMutationKey(),
            workItemId: requiredOption(parsed, "work-id"),
            expectedRevision: integerOption(parsed, "revision", 0, true) ?? 0,
            externalSessionId: option(parsed, "session-id") ?? DongoClient.idempotencyKey(),
            leaseSeconds: integerOption(parsed, "lease-seconds", 1),
            workspace: option(parsed, "workspace-kind")
              ? {
                  kind: option(parsed, "workspace-kind") as
                    | "worktree"
                    | "shared_checkout"
                    | "undisclosed",
                  worktreeName: option(parsed, "worktree-name"),
                  branch: option(parsed, "branch"),
                }
              : undefined,
          }, dependencies.signal);
        } else if (action === "update") {
          const artifacts = values(parsed, "artifact");
          if (artifacts.length > 1) throw new CliCoreError({ code: "validation", message: "work update accepts at most one --artifact.", exitCode: 2 });
          const update = {
            title: option(parsed, "title"),
            goal: option(parsed, "goal"),
            latestUpdate: option(parsed, "latest-update"),
            artifact: artifacts[0] ? artifact(artifacts[0]) : undefined,
          };
          if (!update.title && !update.goal && !update.latestUpdate && !update.artifact) {
            throw new CliCoreError({ code: "validation", message: "work update requires a title, goal, latest update, or artifact.", exitCode: 2 });
          }
          data = await service.execute("update_work", {
            idempotencyKey: commandMutationKey(),
            workItemId: requiredOption(parsed, "work-id"),
            expectedRevision: integerOption(parsed, "revision", 0, true) ?? 0,
            ...update,
          }, dependencies.signal);
        } else if (action === "renew") {
          data = await service.execute("renew_claim", {
            idempotencyKey: commandMutationKey(),
            workItemId: requiredOption(parsed, "work-id"),
            expectedRevision: integerOption(parsed, "revision", 0, true) ?? 0,
            leaseSeconds: integerOption(parsed, "lease-seconds", 1),
          }, dependencies.signal);
        } else {
          data = await service.execute("finish_work", {
            idempotencyKey: commandMutationKey(),
            workItemId: requiredOption(parsed, "work-id"),
            expectedRevision: integerOption(parsed, "revision", 0, true) ?? 0,
            outcome: requiredOption(parsed, "outcome"),
            artifacts: values(parsed, "artifact").length > 0 ? values(parsed, "artifact").map(artifact) : undefined,
          }, dependencies.signal);
        }
        break;
      }
      case "comment": {
        requireSubcommand(parsed, ["add"], "Usage: dongo comment add --work-id ID --body TEXT");
        command = "comment add";
        data = await service.execute("add_comment", {
          idempotencyKey: commandMutationKey(),
          workItemId: requiredOption(parsed, "work-id"),
          body: requiredOption(parsed, "body"),
        }, dependencies.signal);
        break;
      }
      case "attention": {
        const action = requireSubcommand(parsed, ["request", "get", "wait", "resolve"], "Usage: dongo attention request|get|wait|resolve [options]");
        command = `attention ${action}`;
        if (action === "get") {
          data = await service.execute("get_attention", { attentionId: requiredOption(parsed, "attention-id") }, dependencies.signal);
        } else if (action === "wait") {
          const timeoutSeconds = integerOption(parsed, "timeout-seconds", 1) ?? 300;
          if (timeoutSeconds > 3_600) {
            throw new CliCoreError({
              code: "validation",
              message: "--timeout-seconds must be no greater than 3600.",
              exitCode: 2,
            });
          }
          if (!parsed.json) {
            output.stderr(
              `Waiting up to ${timeoutSeconds}s; checks back off from 5s to at most 30s. A stopped process cannot wake itself.\n`,
            );
          }
          data = await waitForAttention(
            service,
            requiredOption(parsed, "attention-id"),
            timeoutSeconds,
            dependencies,
          );
        } else if (action === "request") {
          const kind = requiredOption(parsed, "kind");
          if (!(["review", "decision", "question", "blocked"] as const).includes(kind as never)) {
            throw new CliCoreError({ code: "validation", message: "--kind must be review, decision, question, or blocked.", exitCode: 2 });
          }
          const attentionOptions = values(parsed, "option");
          if (attentionOptions.length === 1) {
            throw new CliCoreError({ code: "validation", message: "Provide either zero or at least two --option values.", exitCode: 2 });
          }
          data = await service.execute("request_attention", {
            idempotencyKey: commandMutationKey(),
            workItemId: requiredOption(parsed, "work-id"),
            expectedRevision: integerOption(parsed, "revision", 0, true) ?? 0,
            kind: kind as OperationInput<"request_attention">["kind"],
            title: requiredOption(parsed, "title"),
            body: requiredOption(parsed, "body"),
            important: parsed.important || undefined,
            options: attentionOptions.length > 0 ? attentionOptions : undefined,
          }, dependencies.signal);
        } else {
          const body = option(parsed, "body");
          const selectedOption = option(parsed, "selected-option");
          if (!body && !selectedOption && !parsed.resolveWithoutResponse) {
            throw new CliCoreError({ code: "validation", message: "attention resolve requires --body, --selected-option, or --resolve-without-response.", exitCode: 2 });
          }
          data = await service.execute("resolve_attention", {
            idempotencyKey: commandMutationKey(),
            attentionId: requiredOption(parsed, "attention-id"),
            body,
            selectedOption,
            resolveWithoutResponse: parsed.resolveWithoutResponse || undefined,
          }, dependencies.signal);
        }
        break;
      }
      case "updates": {
        const action = requireSubcommand(parsed, ["get", "wait"], "Usage: dongo updates get|wait [options]");
        command = `updates ${action}`;
        const cursor = integerOption(parsed, "cursor", 0);
        if (action === "get") {
          data = await service.execute("get_updates", { cursor, waitSeconds: 0 }, dependencies.signal);
        } else {
          const timeoutSeconds = integerOption(parsed, "timeout-seconds", 1) ?? 300;
          if (timeoutSeconds > 3_600) {
            throw new CliCoreError({
              code: "validation",
              message: "--timeout-seconds must be no greater than 3600.",
              exitCode: 2,
            });
          }
          if (!parsed.json) {
            output.stderr(
              `Waiting up to ${timeoutSeconds}s for new Intake signals. dongo uses bounded server backoff, and the web app can report this waiter as live only while this command is running. A stopped process cannot restart itself.\n`,
            );
          }
          data = await waitForUpdates(service, cursor, timeoutSeconds, dependencies);
        }
        break;
      }
      case "attachment": {
        const action = requireSubcommand(parsed, ["get", "fetch"], "Usage: dongo attachment get|fetch --attachment-id ID [--output PATH]");
        command = `attachment ${action}`;
        const attachmentId = requiredOption(parsed, "attachment-id");
        data = action === "get"
          ? await service.attachmentInfo(attachmentId, dependencies.signal)
          : await service.fetchAttachment(attachmentId, option(parsed, "output"), dependencies.signal);
        break;
      }
      case "sync": {
        requirePositionals(parsed, 1, "Usage: dongo sync");
        const result = await service.sync(dependencies.signal);
        data = { export: result.export };
        break;
      }
      case "integrate": {
        const host = requireSubcommand(parsed, ["codex", "claude", "generic"], "Usage: dongo integrate codex|claude|generic [--apply]");
        command = `integrate ${host}`;
        data = await service.integration(host as "codex" | "claude" | "generic", parsed.apply);
        humanOutput = renderIntegrationOutput(data as Awaited<ReturnType<CoreService["integration"]>>);
        break;
      }
      case "runner": {
        const action = requireSubcommand(
          parsed,
          ["install", "status", "approve", "disable", "remove", "run"],
          "Usage: dongo runner install|status|approve|disable|remove|run [options]",
        );
        command = `runner ${action}`;
        if (action === "install") {
          const harnesses = values(parsed, "harness");
          if (harnesses.length === 0 || harnesses.some((value) => value !== "codex" && value !== "claude")) {
            throw new CliCoreError({ code: "validation", message: "Provide --harness codex and/or --harness claude.", exitCode: 2 });
          }
          const approval = option(parsed, "approval");
          if (approval !== undefined && approval !== "ask" && approval !== "automatic") {
            throw new CliCoreError({ code: "validation", message: "--approval must be ask or automatic.", exitCode: 2 });
          }
          data = await service.runnerInstall({
            label: option(parsed, "label") ?? "This computer",
            harnesses: [...new Set(harnesses)] as Array<"codex" | "claude">,
            approvalMode: approval as "ask" | "automatic" | undefined,
          });
        } else if (action === "status") {
          data = await service.runnerStatus();
        } else if (action === "approve") {
          data = await service.runnerApprove(requiredOption(parsed, "job-id"));
        } else if (action === "disable") {
          data = await service.runnerDisable();
        } else if (action === "remove") {
          data = await service.runnerRemove();
        } else {
          data = await service.runnerRun(
            requiredOption(parsed, "project-ref"),
            dependencies.signal,
          );
        }
        break;
      }
      default:
        throw new CliCoreError({ code: "validation", message: `Unknown command: ${parsed.command}`, exitCode: 2 });
    }

    const update = updateAwareCommands.has(command)
      ? await (dependencies.updateChecker
          ?? (dependencies.serviceFactory ? async () => undefined : () => checkForCliUpdate(CLI_VERSION)))()
      : undefined;
    if (parsed.json) writeJson(output, {
      ok: true,
      command,
      data,
      ...(update ? { update } : {}),
      ...(mutationRecoveryKey ? { recovery: { idempotencyKey: mutationRecoveryKey } } : {}),
    });
    else {
      output.stdout(humanOutput ?? humanJson(data));
      if (update) {
        output.stderr(
          `dongo CLI ${update.latestVersion} is available. Ask the user before running: ${update.installCommand}\n`,
        );
      }
    }
    return 0;
  } catch (error) {
    const failure = errorResult(error, parsed ? (commandName(parsed) ?? parsed.command) : "unknown");
    if (mutationRecoveryKey) {
      failure.result.recovery = { idempotencyKey: mutationRecoveryKey };
      if (failure.exitCode === 5) {
        failure.result.error.details = {
          ...(failure.result.error.details && typeof failure.result.error.details === "object"
            ? failure.result.error.details as Record<string, unknown>
            : {}),
          idempotencyKey: mutationRecoveryKey,
        };
      }
    }
    if (parsed?.json ?? jsonRequested) writeJson(output, failure.result);
    else output.stderr(`${failure.result.error.code}: ${failure.result.error.message}\n`);
    return failure.exitCode;
  }
}
