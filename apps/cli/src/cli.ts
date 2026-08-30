import { CliCoreError, CoreService } from "@dongo/cli-core";
import type { CoreServiceOptions } from "@dongo/cli-core";
import { DongoClient } from "@dongo/client";
import type { OperationInput } from "@dongo/contracts";
import { readFileSync } from "node:fs";
import { parseArgs } from "./args.ts";
import type { ParsedArgs } from "./args.ts";
import type { OutputWriter } from "./output.ts";
import { errorResult, processOutput, writeJson } from "./output.ts";

const CLI_VERSION = (JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string }).version;

export interface CliDependencies {
  output?: OutputWriter;
  signal?: AbortSignal;
  serviceFactory?: (options: CoreServiceOptions) => Pick<
    CoreService,
    | "connect"
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
  >;
  serviceOptions?: CoreServiceOptions;
}

const HELP = `Dongo CLI

Usage:
  dongo connect [--environment development|production] [--origin URL] [--project-ref REF] [--project-name NAME] [--repository-url URL] [--execution-mode manual|autonomous] [--no-browser]
  dongo ci setup [--environment development|production]
  dongo auth status
  dongo auth logout
  dongo doctor
  dongo session-start
  dongo overview
  dongo intake get|claim|renew|complete [options]
  dongo work create|get|start|update|renew|finish [options]
  dongo comment add [options]
  dongo attention request|get|resolve [options]
  dongo attachment get|fetch [--attachment-id ID] [--output PATH]
  dongo sync
  dongo integrate codex|claude|generic [--apply]

Options:
  --version, -V                Print the installed CLI version
  --json                       Write one stable JSON result to stdout
  --no-browser                 Print the complete approval link without opening it
  --project-ref REF            Bind the terminal to an exact existing project
  --project-name NAME          Override the inferred first-project name
  --repository-url URL         Override the inferred Git origin URL
  --execution-mode MODE        Create the first project in manual or autonomous mode
  --idempotency-key KEY        Reuse this key when recovering a mutation response
  --apply                      Apply a rendered host integration after preview
`;

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

function allowOnlyValues(parsed: ParsedArgs, allowed: string[]): void {
  const unexpected = Object.keys(parsed.values).find((name) => !allowed.includes(name));
  if (unexpected) {
    throw new CliCoreError({ code: "validation", message: `--${unexpected} is not valid for this command.`, exitCode: 2 });
  }
}

function validateModeFlags(parsed: ParsedArgs): void {
  const ciSetup = parsed.command === "ci" && parsed.subcommand === "setup";
  const invalid =
    (parsed.noBrowser && parsed.command !== "connect") ||
    (parsed.environment !== undefined && parsed.command !== "connect" && !ciSetup) ||
    (parsed.origin !== undefined && parsed.command !== "connect") ||
    (parsed.apply && parsed.command !== "integrate") ||
    (parsed.important && !(parsed.command === "attention" && parsed.subcommand === "request")) ||
    (parsed.resolveWithoutResponse && !(parsed.command === "attention" && parsed.subcommand === "resolve"));
  if (invalid) throw new CliCoreError({ code: "validation", message: "A command-specific option was used with the wrong command.", exitCode: 2 });
}

export async function runCli(argv: string[], dependencies: CliDependencies = {}): Promise<number> {
  const output = dependencies.output ?? processOutput;
  const jsonRequested = argv.includes("--json");
  let mutationRecoveryKey: string | undefined;
  let parsed: ParsedArgs | undefined;
  try {
    parsed = parseArgs(argv);
    validateModeFlags(parsed);
    const commandArgs = parsed;
    const service = (dependencies.serviceFactory ?? ((options) => new CoreService(options)))({
      ...dependencies.serviceOptions,
    });
    const commandMutationKey = () =>
      mutationKey(commandArgs, (key) => {
        mutationRecoveryKey = key;
        output.stderr(`Mutation recovery key (reuse only for this exact request): ${key}\n`);
      });

    let data: unknown;
    let command = parsed.command;
    switch (parsed.command) {
      case "help":
        allowOnlyValues(parsed, []);
        if (parsed.json) writeJson(output, { ok: true, command: "help", data: { usage: HELP } });
        else output.stdout(HELP);
        return 0;
      case "version":
        allowOnlyValues(parsed, []);
        if (parsed.json) {
          writeJson(output, { ok: true, command: "version", data: { version: CLI_VERSION } });
        } else {
          output.stdout(`dongo ${CLI_VERSION}\n`);
        }
        return 0;
      case "connect":
        allowOnlyValues(parsed, ["project-ref", "project-name", "repository-url", "execution-mode"]);
        requirePositionals(parsed, 1, "Usage: dongo connect [options]");
        const executionMode = option(parsed, "execution-mode");
        if (executionMode !== undefined && executionMode !== "manual" && executionMode !== "autonomous") {
          throw new CliCoreError({ code: "validation", message: "--execution-mode must be manual or autonomous.", exitCode: 2 });
        }
        data = await service.connect({
          environment: parsed.environment,
          origin: parsed.origin,
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
                    ? `If this account has no project, approval will create “${projectProposal.name}”${projectProposal.repositoryUrl ? ` for ${projectProposal.repositoryUrl}` : ""}.\n`
                    : "") +
                  `Confirm code ${userCode} in the browser. Waiting until ${new Date(expiresAt).toISOString()}…\n`,
              );
            },
            onSlowDown: (seconds) => output.stderr(`Authorization server requested slower polling (${seconds}s).\n`),
            onNetworkRetry: (message) => output.stderr(`${message}\n`),
          },
        });
        break;
      case "ci":
        allowOnlyValues(parsed, []);
        requirePositionals(
          parsed,
          2,
          "Usage: dongo ci setup [--environment development|production]",
        );
        if (parsed.subcommand !== "setup") {
          throw new CliCoreError({
            code: "validation",
            message:
              "Usage: dongo ci setup [--environment development|production]",
            exitCode: 2,
          });
        }
        command = "ci setup";
        data = await service.setupCi({
          environment: parsed.environment,
          signal: dependencies.signal,
        });
        break;
      case "auth":
        allowOnlyValues(parsed, []);
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
        allowOnlyValues(parsed, []);
        requirePositionals(parsed, 1, "Usage: dongo doctor");
        data = await service.doctor(dependencies.signal);
        if (!(data as { ok: boolean }).ok) {
          if (parsed.json) writeJson(output, { ok: false, command, data });
          else output.stdout(humanJson(data));
          return 5;
        }
        break;
      case "session-start":
        allowOnlyValues(parsed, []);
        requirePositionals(parsed, 1, "Usage: dongo session-start");
        data = await service.sessionStart(dependencies.signal);
        break;
      case "session":
        allowOnlyValues(parsed, []);
        requirePositionals(parsed, 2, "Usage: dongo session start");
        if (parsed.subcommand !== "start") {
          throw new CliCoreError({ code: "validation", message: "Usage: dongo session start", exitCode: 2 });
        }
        command = "session start";
        data = await service.sessionStart(dependencies.signal);
        break;
      case "overview":
        allowOnlyValues(parsed, []);
        requirePositionals(parsed, 1, "Usage: dongo overview");
        data = await service.overview(dependencies.signal);
        break;
      case "intake": {
        const action = requireSubcommand(parsed, ["get", "claim", "renew", "complete"], "Usage: dongo intake get|claim|renew|complete [options]");
        command = `intake ${action}`;
        allowOnlyValues(
          parsed,
          action === "get"
            ? ["intake-id"]
            : action === "complete"
              ? ["intake-id", "revision", "state", "explanation", "linked-work-id", "idempotency-key"]
              : ["intake-id", "revision", "lease-seconds", "idempotency-key"],
        );
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
        allowOnlyValues(
          parsed,
          action === "create"
            ? ["title", "goal", "source-intake-id", "parent-work-id", "idempotency-key"]
            : action === "get"
              ? ["work-id", "identifier"]
              : action === "start"
                ? ["work-id", "revision", "session-id", "lease-seconds", "idempotency-key"]
                : action === "update"
                  ? ["work-id", "revision", "title", "goal", "latest-update", "artifact", "idempotency-key"]
                  : action === "renew"
                    ? ["work-id", "revision", "lease-seconds", "idempotency-key"]
                    : ["work-id", "revision", "outcome", "artifact", "idempotency-key"],
        );
        if (action === "create") {
          data = await service.execute("create_work", {
            idempotencyKey: commandMutationKey(),
            title: requiredOption(parsed, "title"),
            goal: requiredOption(parsed, "goal"),
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
        allowOnlyValues(parsed, ["work-id", "body", "idempotency-key"]);
        data = await service.execute("add_comment", {
          idempotencyKey: commandMutationKey(),
          workItemId: requiredOption(parsed, "work-id"),
          body: requiredOption(parsed, "body"),
        }, dependencies.signal);
        break;
      }
      case "attention": {
        const action = requireSubcommand(parsed, ["request", "get", "resolve"], "Usage: dongo attention request|get|resolve [options]");
        command = `attention ${action}`;
        allowOnlyValues(
          parsed,
          action === "get"
            ? ["attention-id"]
            : action === "request"
              ? ["work-id", "revision", "kind", "title", "body", "option", "idempotency-key"]
              : ["attention-id", "body", "selected-option", "idempotency-key"],
        );
        if (action === "get") {
          data = await service.execute("get_attention", { attentionId: requiredOption(parsed, "attention-id") }, dependencies.signal);
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
      case "attachment": {
        const action = requireSubcommand(parsed, ["get", "fetch"], "Usage: dongo attachment get|fetch --attachment-id ID [--output PATH]");
        command = `attachment ${action}`;
        allowOnlyValues(parsed, action === "get" ? ["attachment-id"] : ["attachment-id", "output"]);
        const attachmentId = requiredOption(parsed, "attachment-id");
        data = action === "get"
          ? await service.attachmentInfo(attachmentId, dependencies.signal)
          : await service.fetchAttachment(attachmentId, option(parsed, "output"), dependencies.signal);
        break;
      }
      case "sync": {
        allowOnlyValues(parsed, []);
        requirePositionals(parsed, 1, "Usage: dongo sync");
        const result = await service.sync(dependencies.signal);
        data = { export: result.export };
        break;
      }
      case "integrate": {
        const host = requireSubcommand(parsed, ["codex", "claude", "generic"], "Usage: dongo integrate codex|claude|generic [--apply]");
        command = `integrate ${host}`;
        allowOnlyValues(parsed, []);
        data = await service.integration(host as "codex" | "claude" | "generic", parsed.apply);
        break;
      }
      default:
        throw new CliCoreError({ code: "validation", message: `Unknown command: ${parsed.command}`, exitCode: 2 });
    }

    if (parsed.json) writeJson(output, { ok: true, command, data });
    else output.stdout(humanJson(data));
    return 0;
  } catch (error) {
    const failure = errorResult(error);
    if (mutationRecoveryKey && failure.exitCode === 5) {
      failure.result.error.details = {
        ...(failure.result.error.details && typeof failure.result.error.details === "object"
          ? failure.result.error.details as Record<string, unknown>
          : {}),
        idempotencyKey: mutationRecoveryKey,
      };
    }
    if (parsed?.json ?? jsonRequested) writeJson(output, failure.result);
    else output.stderr(`${failure.result.error.code}: ${failure.result.error.message}\n`);
    return failure.exitCode;
  }
}
