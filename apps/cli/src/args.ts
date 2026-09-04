export interface ParsedArgs {
  command: string;
  subcommand?: string;
  positionals: string[];
  json: boolean;
  version: boolean;
  noBrowser: boolean;
  apply: boolean;
  important: boolean;
  resolveWithoutResponse: boolean;
  help: boolean;
  values: Record<string, string[]>;
  issues: string[];
}

const VALUE_OPTIONS = new Set([
  "artifact",
  "attachment-id",
  "attention-id",
  "body",
  "context",
  "cursor",
  "explanation",
  "goal",
  "idempotency-key",
  "identifier",
  "intake-id",
  "kind",
  "harness",
  "approval",
  "browser-review",
  "max-concurrent-jobs",
  "deployment-access",
  "job-id",
  "label",
  "initial-comment",
  "link",
  "lease-seconds",
  "linked-work-id",
  "name",
  "option",
  "outcome",
  "output",
  "parent-work-id",
  "project-name",
  "project-ref",
  "revision",
  "repository-url",
  "selected-option",
  "session-id",
  "source-intake-id",
  "state",
  "title",
  "timeout-seconds",
  "work-id",
  "latest-update",
  "activity-kind",
  "activity-label",
  "activity-next-step",
  "execution-mode",
  "agent-host",
  "parallel-capability",
  "worktree-capability",
  "workspace-kind",
  "worktree-name",
  "branch",
]);

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  let json = false;
  let version = false;
  let noBrowser = false;
  let apply = false;
  let important = false;
  let resolveWithoutResponse = false;
  let help = false;
  const values: Record<string, string[]> = {};
  const issues: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") json = true;
    else if (argument === "--help" || argument === "-h") help = true;
    else if (argument === "--version" || argument === "-V") version = true;
    else if (argument === "--no-browser") noBrowser = true;
    else if (argument === "--apply") apply = true;
    else if (argument === "--important") important = true;
    else if (argument === "--resolve-without-response") resolveWithoutResponse = true;
    else if (argument.startsWith("--") && VALUE_OPTIONS.has(argument.slice(2))) {
      const name = argument.slice(2);
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        issues.push(`${argument} requires a value.`);
      } else {
        index += 1;
        (values[name] ??= []).push(value);
      }
    } else if (argument.startsWith("-")) {
      issues.push(`Unknown option: ${argument}.`);
    } else positional.push(argument);
  }

  return {
    command: version ? "version" : (positional[0] ?? "help"),
    subcommand: positional[1],
    positionals: positional,
    json,
    version,
    noBrowser,
    apply,
    important,
    resolveWithoutResponse,
    help,
    values,
    issues,
  };
}
