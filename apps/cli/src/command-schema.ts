import { CliCoreError } from "@dongo/cli-core";
import type { ParsedArgs } from "./args.ts";

type ValueType = "string" | "integer" | "json-object";

export interface OptionSchema {
  name: string;
  description: string;
  required?: boolean;
  repeatable?: boolean;
  type?: ValueType;
  minimum?: number;
  maximum?: number;
  allowed?: string[];
}

export interface CommandSchema {
  command: string;
  summary: string;
  usage: string;
  options: OptionSchema[];
  flags?: Array<{ name: string; description: string }>;
}

const idempotency: OptionSchema = {
  name: "idempotency-key",
  description: "Reuse a mutation key when recovering the exact same request.",
};
const workId: OptionSchema = { name: "work-id", description: "WorkItem ID.", required: true };
const intakeId: OptionSchema = { name: "intake-id", description: "Intake item ID.", required: true };
const attentionId: OptionSchema = { name: "attention-id", description: "Attention request ID.", required: true };
const revision: OptionSchema = {
  name: "revision",
  description: "Expected current revision.",
  required: true,
  type: "integer",
  minimum: 0,
};
const lease: OptionSchema = {
  name: "lease-seconds",
  description: "Requested lease duration in seconds.",
  type: "integer",
  minimum: 1,
};
const artifact: OptionSchema = {
  name: "artifact",
  description: "Artifact JSON object.",
  type: "json-object",
};

export const COMMAND_SCHEMAS: Record<string, CommandSchema> = {
  connect: {
    command: "connect",
    summary: "Authorize this repository and connect it to a dongo project.",
    usage: "dongo connect [--project-ref REF] [--project-name NAME] [--repository-url URL] [--execution-mode manual|autonomous] [--agent-host codex] [--no-browser]",
    options: [
      { name: "project-ref", description: "Bind to an existing project reference." },
      { name: "project-name", description: "Name proposed if approval creates a project." },
      { name: "repository-url", description: "Repository URL proposed if approval creates a project." },
      { name: "execution-mode", description: "Initial project execution mode.", allowed: ["manual", "autonomous"] },
      { name: "agent-host", description: "Authorize one MCP host in the same browser approval.", allowed: ["codex"] },
    ],
    flags: [{ name: "no-browser", description: "Print the approval link without opening a browser." }],
  },
  "project create": {
    command: "project create",
    summary: "Create a new project and bind this repository to it.",
    usage: "dongo project create --name NAME [--repository-url URL] [--execution-mode manual|autonomous] [--agent-host codex] [--no-browser]",
    options: [
      { name: "name", description: "New project name.", required: true },
      { name: "repository-url", description: "Repository URL; inferred from Git when omitted." },
      { name: "execution-mode", description: "Initial project execution mode.", allowed: ["manual", "autonomous"] },
      { name: "agent-host", description: "Authorize one MCP host in the same browser approval.", allowed: ["codex"] },
    ],
    flags: [{ name: "no-browser", description: "Print the approval link without opening a browser." }],
  },
  "ci setup": { command: "ci setup", summary: "Connect CI using DONGO_TOKEN.", usage: "dongo ci setup", options: [] },
  "auth status": { command: "auth status", summary: "Show local authentication status.", usage: "dongo auth status", options: [] },
  "auth logout": { command: "auth logout", summary: "Revoke and remove the local credential.", usage: "dongo auth logout", options: [] },
  doctor: { command: "doctor", summary: "Check the local dongo connection.", usage: "dongo doctor", options: [] },
  "session-start": {
    command: "session-start",
    summary: "Start or resume the current agent session.",
    usage: "dongo session-start [--session-id ID] [capability options]",
    options: [
      { name: "session-id", description: "Stable external agent session ID." },
      { name: "parallel-capability", description: "Whether this host supports parallel execution.", allowed: ["supported", "unsupported"] },
      { name: "worktree-capability", description: "Whether this host supports isolated worktrees.", allowed: ["supported", "unsupported"] },
    ],
  },
  "session start": {
    command: "session start",
    summary: "Start or resume the current agent session.",
    usage: "dongo session start [--session-id ID] [capability options]",
    options: [
      { name: "session-id", description: "Stable external agent session ID." },
      { name: "parallel-capability", description: "Whether this host supports parallel execution.", allowed: ["supported", "unsupported"] },
      { name: "worktree-capability", description: "Whether this host supports isolated worktrees.", allowed: ["supported", "unsupported"] },
    ],
  },
  overview: { command: "overview", summary: "Show current project work and Intake.", usage: "dongo overview", options: [] },
  "intake get": { command: "intake get", summary: "Get one Intake item.", usage: "dongo intake get --intake-id ID", options: [intakeId] },
  "intake claim": { command: "intake claim", summary: "Claim an Intake item for triage.", usage: "dongo intake claim --intake-id ID --revision N [--lease-seconds N]", options: [intakeId, revision, lease, idempotency] },
  "intake renew": { command: "intake renew", summary: "Renew an Intake claim.", usage: "dongo intake renew --intake-id ID --revision N [--lease-seconds N]", options: [intakeId, revision, lease, idempotency] },
  "intake complete": {
    command: "intake complete",
    summary: "Complete Intake triage.",
    usage: "dongo intake complete --intake-id ID --revision N --state processed|dismissed [options]",
    options: [intakeId, revision, { name: "state", description: "Final triage state.", required: true, allowed: ["processed", "dismissed"] }, { name: "explanation", description: "Triage explanation." }, { name: "linked-work-id", description: "Linked WorkItem ID.", repeatable: true }, idempotency],
  },
  "work create": {
    command: "work create",
    summary: "Create a focused WorkItem.",
    usage: "dongo work create --title TEXT --goal TEXT [options]",
    options: [
      { name: "title", description: "WorkItem title.", required: true },
      { name: "goal", description: "Completion goal.", required: true },
      { name: "context", description: "Planning context or constraints." },
      { name: "link", description: "Related HTTP(S) link.", repeatable: true },
      { name: "initial-comment", description: "Initial conversation comment." },
      { name: "source-intake-id", description: "Source Intake ID.", repeatable: true },
      {
        name: "parent-work-id",
        description: "Direct parent WorkItem ID; children cannot have their own children.",
      },
      idempotency,
    ],
  },
  "work get": {
    command: "work get",
    summary: "Get one WorkItem by ID or identifier.",
    usage: "dongo work get (--work-id ID | --identifier IDENTIFIER)",
    options: [{ ...workId, required: false }, { name: "identifier", description: "Canonical compact ID (such as dong008) or a retained legacy ID." }],
  },
  "work start": {
    command: "work start",
    summary: "Start a WorkItem and attach it to a Run.",
    usage: "dongo work start --work-id ID --revision N [options]",
    options: [
      workId,
      revision,
      { name: "session-id", description: "Stable external agent session ID." },
      { name: "workspace-kind", description: "Current checkout isolation.", allowed: ["worktree", "shared_checkout", "undisclosed"] },
      { name: "worktree-name", description: "Safe worktree label; never an absolute path." },
      { name: "branch", description: "Optional branch label; never a URL or absolute path." },
      lease,
      idempotency,
    ],
  },
  "work update": {
    command: "work update",
    summary: "Record WorkItem details or Run progress.",
    usage: "dongo work update --work-id ID --revision N (--title TEXT | --goal TEXT | --latest-update TEXT | --artifact JSON)",
    options: [workId, revision, { name: "title", description: "Updated title." }, { name: "goal", description: "Updated goal." }, { name: "latest-update", description: "Meaningful Run progress or blocker." }, artifact, idempotency],
  },
  "work renew": { command: "work renew", summary: "Renew the active WorkItem claim.", usage: "dongo work renew --work-id ID --revision N [--lease-seconds N]", options: [workId, revision, lease, idempotency] },
  "work finish": {
    command: "work finish",
    summary: "Finish verified Work; repository changes require host-verified shared-target integration and any required release acceptance (unless explicitly local-only).",
    usage: "dongo work finish --work-id ID --revision N --outcome TEXT [--artifact JSON ...]",
    options: [workId, revision, { name: "outcome", description: "Exact integrated revision and verified outcome, or explicit limited scope.", required: true }, { ...artifact, repeatable: true }, idempotency],
  },
  "comment add": { command: "comment add", summary: "Add a comment to a WorkItem.", usage: "dongo comment add --work-id ID --body TEXT", options: [workId, { name: "body", description: "Comment body.", required: true }, idempotency] },
  "attention request": {
    command: "attention request",
    summary: "Request a human review, decision, answer, or unblock.",
    usage: "dongo attention request [--work-id ID --revision N | --intake-id ID] --kind KIND --title TEXT --body TEXT [options]",
    options: [
      { ...workId, required: false, description: "Active WorkItem ID; omit for owner Attention." },
      { ...revision, required: false, description: "Expected WorkItem revision; required with --work-id." },
      { ...intakeId, required: false, description: "Optional Intake associated with owner Attention." },
      { name: "kind", description: "Attention kind.", required: true, allowed: ["review", "decision", "question", "blocked"] },
      { name: "title", description: "Short request title.", required: true },
      { name: "body", description: "Request details.", required: true },
      { name: "option", description: "Choice offered to the human; provide zero or at least two.", repeatable: true },
      idempotency,
    ],
    flags: [{ name: "important", description: "Mark the request important." }],
  },
  "attention get": { command: "attention get", summary: "Get one Attention request and its resolution.", usage: "dongo attention get --attention-id ID", options: [attentionId] },
  "attention wait": {
    command: "attention wait",
    summary: "Wait for an Attention response using bounded backoff.",
    usage: "dongo attention wait --attention-id ID [--timeout-seconds 1..3600]",
    options: [attentionId, { name: "timeout-seconds", description: "Maximum wait in seconds; defaults to 300.", type: "integer", minimum: 1, maximum: 3_600 }],
  },
  "attention resolve": {
    command: "attention resolve",
    summary: "Resolve an Attention request.",
    usage: "dongo attention resolve --attention-id ID (--body TEXT | --selected-option TEXT | --resolve-without-response)",
    options: [attentionId, { name: "body", description: "Written response." }, { name: "selected-option", description: "Selected offered option." }, idempotency],
    flags: [{ name: "resolve-without-response", description: "Resolve without response content." }],
  },
  "updates get": {
    command: "updates get",
    summary: "Pull new dongo update signals once.",
    usage: "dongo updates get [--cursor N]",
    options: [{ name: "cursor", description: "Last processed update cursor.", type: "integer", minimum: 0 }],
  },
  "updates wait": {
    command: "updates wait",
    summary: "Wait for new Intake signals using bounded server backoff.",
    usage: "dongo updates wait [--cursor N] [--timeout-seconds 1..3600]",
    options: [
      { name: "cursor", description: "Last processed update cursor.", type: "integer", minimum: 0 },
      { name: "timeout-seconds", description: "Maximum wait in seconds; defaults to 300.", type: "integer", minimum: 1, maximum: 3_600 },
    ],
  },
  "attachment get": { command: "attachment get", summary: "Return safe attachment metadata.", usage: "dongo attachment get --attachment-id ID", options: [{ name: "attachment-id", description: "Attachment ID.", required: true }] },
  "attachment fetch": { command: "attachment fetch", summary: "Download an attachment to a new safe path.", usage: "dongo attachment fetch --attachment-id ID [--output PATH]", options: [{ name: "attachment-id", description: "Attachment ID.", required: true }, { name: "output", description: "Destination path." }] },
  sync: { command: "sync", summary: "Write the deterministic local dongo snapshot.", usage: "dongo sync", options: [] },
  "integrate codex": { command: "integrate codex", summary: "Preview or apply the Codex integration.", usage: "dongo integrate codex [--apply]", options: [], flags: [{ name: "apply", description: "Apply the previewed managed changes." }] },
  "integrate claude": { command: "integrate claude", summary: "Preview or apply the Claude Code integration.", usage: "dongo integrate claude [--apply]", options: [], flags: [{ name: "apply", description: "Apply the previewed managed changes." }] },
  "integrate generic": { command: "integrate generic", summary: "Preview or apply the generic AGENTS.md integration.", usage: "dongo integrate generic [--apply]", options: [], flags: [{ name: "apply", description: "Apply the previewed managed changes." }] },
  "runner install": {
    command: "runner install",
    summary: "Install the login-scoped local runner for this repository.",
    usage: "dongo runner install --harness codex|claude [--harness ...] [--approval ask|automatic] [--browser-review disabled|read-only] [--deployment-access disabled|repository] [--label NAME]",
    options: [
      { name: "harness", description: "Locally installed harness allowed for this repository.", required: true, repeatable: true, allowed: ["codex", "claude"] },
      { name: "approval", description: "Ask locally before every job, or explicitly opt this repository into automatic starts.", allowed: ["ask", "automatic"] },
      { name: "browser-review", description: "Allow Codex to inspect this app in the existing browser session without changing data.", allowed: ["disabled", "read-only"] },
      { name: "deployment-access", description: "Allow agents to use only approved provider credentials and .env values from this repository's trusted checkout.", allowed: ["disabled", "repository"] },
      { name: "label", description: "Recognizable, non-sensitive computer name shown in dongo, such as Studio Mac." },
    ],
  },
  "runner configure": {
    command: "runner configure",
    summary: "Change local runner trust and browser self-review settings.",
    usage: "dongo runner configure [--approval ask|automatic] [--browser-review disabled|read-only] [--deployment-access disabled|repository]",
    options: [
      { name: "approval", description: "Ask locally before every job, or trust this repository for automatic starts.", allowed: ["ask", "automatic"] },
      { name: "browser-review", description: "Allow Codex to inspect this app in the existing browser session without changing data.", allowed: ["disabled", "read-only"] },
      { name: "deployment-access", description: "Review and allow trusted repository deployment credentials for isolated worktrees.", allowed: ["disabled", "repository"] },
    ],
  },
  "runner status": { command: "runner status", summary: "Show local runner health without exposing credentials.", usage: "dongo runner status", options: [] },
  "runner approve": { command: "runner approve", summary: "Approve one waiting job on this computer.", usage: "dongo runner approve --job-id ID", options: [{ name: "job-id", description: "Waiting runner job ID.", required: true }] },
  "runner disable": { command: "runner disable", summary: "Stop automatic login startup but retain the revocable registration.", usage: "dongo runner disable", options: [] },
  "runner remove": { command: "runner remove", summary: "Revoke and remove the local runner.", usage: "dongo runner remove", options: [] },
  "runner run": { command: "runner run", summary: "Run the local worker in the foreground (normally managed at login).", usage: "dongo runner run --project-ref REF", options: [{ name: "project-ref", description: "Exact locally configured project reference.", required: true }] },
  version: { command: "version", summary: "Print the installed CLI version.", usage: "dongo --version", options: [] },
};

const GROUPS: Record<string, { summary: string; subcommands: string[] }> = {
  project: { summary: "Create and connect dongo projects.", subcommands: ["create"] },
  ci: { summary: "Configure dongo for CI.", subcommands: ["setup"] },
  auth: { summary: "Inspect or remove local authentication.", subcommands: ["status", "logout"] },
  session: { summary: "Manage the current agent session.", subcommands: ["start"] },
  intake: { summary: "Inspect and triage Intake.", subcommands: ["get", "claim", "renew", "complete"] },
  work: { summary: "Create and execute WorkItems.", subcommands: ["create", "get", "start", "update", "renew", "finish"] },
  comment: { summary: "Add WorkItem discussion.", subcommands: ["add"] },
  attention: { summary: "Request, inspect, wait for, or resolve Attention.", subcommands: ["request", "get", "wait", "resolve"] },
  updates: { summary: "Pull or wait for agent update signals.", subcommands: ["get", "wait"] },
  attachment: { summary: "Inspect or safely fetch attachments.", subcommands: ["get", "fetch"] },
  integrate: { summary: "Preview or apply a host integration.", subcommands: ["codex", "claude", "generic"] },
  runner: { summary: "Install and operate the secure local runner.", subcommands: ["install", "configure", "status", "approve", "disable", "remove", "run"] },
};

const COMMON_OPTIONS = [
  "  --json                       Write one JSON envelope to stdout.",
  "  --help, -h                   Show help for this command.",
];

export function commandName(parsed: ParsedArgs): string | undefined {
  const pair = parsed.positionals.slice(0, 2).join(" ");
  if (COMMAND_SCHEMAS[pair]) return pair;
  if (COMMAND_SCHEMAS[parsed.command]) return parsed.command;
  return undefined;
}

export function expectedSchema(parsed: ParsedArgs): CommandSchema | { command: string; summary: string; subcommands: string[] } {
  const name = commandName(parsed);
  if (name) return COMMAND_SCHEMAS[name];
  if (GROUPS[parsed.command]) return { command: parsed.command, ...GROUPS[parsed.command] };
  return {
    command: "dongo",
    summary: "Agent-first project management from the terminal.",
    subcommands: [...new Set(Object.keys(COMMAND_SCHEMAS).map((name) => name.split(" ")[0]).filter((name) => name !== "version"))],
  };
}

function commandHelp(schema: CommandSchema): string {
  const lines = [`${schema.command} — ${schema.summary}`, "", "Usage:", `  ${schema.usage}`];
  if (schema.options.length || schema.flags?.length) {
    lines.push("", "Options:");
    for (const option of schema.options) {
      const value = option.allowed?.join("|") ?? (option.type === "integer" ? "N" : option.type === "json-object" ? "JSON" : "VALUE");
      lines.push(`  --${option.name} ${value}${option.repeatable ? " ..." : ""}${option.required ? " (required)" : ""}`);
      lines.push(`      ${option.description}`);
    }
    for (const flag of schema.flags ?? []) {
      lines.push(`  --${flag.name}`);
      lines.push(`      ${flag.description}`);
    }
  }
  lines.push("", ...COMMON_OPTIONS, "");
  return `${lines.join("\n")}\n`;
}

function groupHelp(group: string): string {
  const details = GROUPS[group];
  return `${group} — ${details.summary}\n\nUsage:\n${details.subcommands.map((subcommand) => `  dongo ${group} ${subcommand} [options]`).join("\n")}\n\nRun dongo ${group} <command> --help for command options.\n`;
}

export function renderHelp(parsed: ParsedArgs): { command: string; usage: string; schema: ReturnType<typeof expectedSchema> } {
  const requested = parsed.command === "help" ? parsed.positionals.slice(1) : parsed.positionals;
  const pair = requested.slice(0, 2).join(" ");
  const single = requested[0];
  if (COMMAND_SCHEMAS[pair]) return { command: pair, usage: commandHelp(COMMAND_SCHEMAS[pair]), schema: COMMAND_SCHEMAS[pair] };
  if (single && COMMAND_SCHEMAS[single]) return { command: single, usage: commandHelp(COMMAND_SCHEMAS[single]), schema: COMMAND_SCHEMAS[single] };
  if (single && GROUPS[single]) return { command: single, usage: groupHelp(single), schema: { command: single, ...GROUPS[single] } };
  const commands = Object.values(COMMAND_SCHEMAS).map((schema) => `  ${schema.usage}\n      ${schema.summary}`).join("\n");
  const usage = `dongo CLI\n\nUsage:\n  dongo integrate codex|claude|generic [--apply]\n${commands}\n\nOptions:\n${COMMON_OPTIONS.join("\n")}\n  --version, -V                Print the installed CLI version.\n`;
  return { command: "help", usage, schema: expectedSchema(parsed) };
}

function presentFlags(parsed: ParsedArgs): string[] {
  return [
    parsed.noBrowser ? "no-browser" : undefined,
    parsed.apply ? "apply" : undefined,
    parsed.important ? "important" : undefined,
    parsed.resolveWithoutResponse ? "resolve-without-response" : undefined,
  ].filter((value): value is string => Boolean(value));
}

export function validateCommand(parsed: ParsedArgs): { name: string; schema: CommandSchema } {
  const issues = [...parsed.issues];
  const name = commandName(parsed);
  const schema = name ? COMMAND_SCHEMAS[name] : undefined;
  if (!name || !schema) {
    if (GROUPS[parsed.command]) {
      issues.push(parsed.subcommand ? `Unknown ${parsed.command} command: ${parsed.subcommand}.` : `${parsed.command} requires a subcommand.`);
    } else {
      issues.push(`Unknown command: ${parsed.command}.`);
    }
    throwValidation(issues, expectedSchema(parsed));
  }

  const expectedPositionals = name === "version" && parsed.version ? 0 : name.split(" ").length;
  if (parsed.positionals.length !== expectedPositionals) {
    issues.push(`Expected: ${schema.usage}`);
  }
  const allowedValues = new Set(schema.options.map((option) => option.name));
  for (const valueName of Object.keys(parsed.values)) {
    if (!allowedValues.has(valueName)) issues.push(`--${valueName} is not valid for ${name}.`);
  }
  const allowedFlags = new Set((schema.flags ?? []).map((flag) => flag.name));
  for (const flag of presentFlags(parsed)) {
    if (!allowedFlags.has(flag)) issues.push(`--${flag} is not valid for ${name}.`);
  }
  for (const option of schema.options) {
    const found = parsed.values[option.name] ?? [];
    if (option.required && (found.length === 0 || found.some((value) => value.length === 0))) {
      issues.push(`--${option.name} is required.`);
    }
    if (!option.repeatable && found.length > 1) issues.push(`--${option.name} may be provided only once.`);
    for (const value of found) {
      if (option.type === "integer") {
        const number = Number(value);
        if (!Number.isSafeInteger(number) || (option.minimum !== undefined && number < option.minimum) || (option.maximum !== undefined && number > option.maximum)) {
          const range = option.maximum !== undefined ? `${option.minimum ?? 0}..${option.maximum}` : `at least ${option.minimum ?? 0}`;
          issues.push(`--${option.name} must be an integer in ${range}.`);
        }
      }
      if (option.allowed && !option.allowed.includes(value)) issues.push(`--${option.name} must be one of: ${option.allowed.join(", ")}.`);
      if (option.type === "json-object") {
        try {
          const decoded = JSON.parse(value) as unknown;
          if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error("not an object");
        } catch {
          issues.push(`--${option.name} must be a JSON object.`);
        }
      }
    }
  }

  if (name === "work get") {
    const count = Number(Boolean(parsed.values["work-id"]?.[0])) + Number(Boolean(parsed.values.identifier?.[0]));
    if (count !== 1) issues.push("Provide exactly one of --work-id or --identifier.");
  }
  if (name === "work update" && !["title", "goal", "latest-update", "artifact"].some((option) => parsed.values[option]?.[0])) {
    issues.push("Provide at least one of --title, --goal, --latest-update, or --artifact.");
  }
  if (name === "session-start" || name === "session start") {
    const parallel = parsed.values["parallel-capability"]?.[0];
    const worktree = parsed.values["worktree-capability"]?.[0];
    if (Boolean(parallel) !== Boolean(worktree)) {
      issues.push("Provide both --parallel-capability and --worktree-capability, or neither.");
    }
  }
  if (name === "work start") {
    const hasWorkspaceMetadata = Boolean(
      parsed.values["worktree-name"]?.[0] || parsed.values.branch?.[0],
    );
    if (hasWorkspaceMetadata && !parsed.values["workspace-kind"]?.[0]) {
      issues.push("Provide --workspace-kind when disclosing a worktree or branch label.");
    }
    if (
      parsed.values["worktree-name"]?.[0] &&
      parsed.values["workspace-kind"]?.[0] !== "worktree"
    ) {
      issues.push("--worktree-name requires --workspace-kind worktree.");
    }
  }
  if (name === "attention request" && parsed.values.option?.length === 1) {
    issues.push("Provide either zero or at least two --option values.");
  }
  if (name === "attention request") {
    const hasWork = Boolean(parsed.values["work-id"]?.[0]);
    const hasRevision = Boolean(parsed.values.revision?.[0]);
    const hasIntake = Boolean(parsed.values["intake-id"]?.[0]);
    if (hasWork !== hasRevision) {
      issues.push("Provide --work-id and --revision together, or omit both for owner Attention.");
    }
    if (hasWork && hasIntake) {
      issues.push("--intake-id cannot be combined with --work-id.");
    }
  }
  if (name === "attention resolve" && !parsed.values.body?.[0] && !parsed.values["selected-option"]?.[0] && !parsed.resolveWithoutResponse) {
    issues.push("Provide --body, --selected-option, or --resolve-without-response.");
  }
  if (issues.length > 0) throwValidation(issues, schema);
  return { name, schema };
}

function throwValidation(issues: string[], schema: ReturnType<typeof expectedSchema>): never {
  const uniqueIssues = [...new Set(issues)];
  throw new CliCoreError({
    code: "validation",
    message: `Invalid command arguments:\n${uniqueIssues.map((issue) => `- ${issue}`).join("\n")}`,
    exitCode: 2,
    details: { issues: uniqueIssues, schema },
  });
}
