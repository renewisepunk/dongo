import { CliCoreError } from "@dongo/cli-core";
import type { DongoEnvironment } from "@dongo/cli-core";

export interface ParsedArgs {
  command: string;
  subcommand?: string;
  positionals: string[];
  json: boolean;
  version: boolean;
  noBrowser: boolean;
  allowFileSecretStore: boolean;
  apply: boolean;
  important: boolean;
  resolveWithoutResponse: boolean;
  environment?: Exclude<DongoEnvironment, "custom">;
  origin?: string;
  values: Record<string, string[]>;
}

const VALUE_OPTIONS = new Set([
  "artifact",
  "attachment-id",
  "attention-id",
  "body",
  "explanation",
  "goal",
  "idempotency-key",
  "identifier",
  "intake-id",
  "kind",
  "lease-seconds",
  "linked-work-id",
  "option",
  "outcome",
  "output",
  "parent-work-id",
  "revision",
  "selected-option",
  "session-id",
  "source-intake-id",
  "state",
  "title",
  "work-id",
  "latest-update",
]);

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  let json = false;
  let version = false;
  let noBrowser = false;
  let allowFileSecretStore = false;
  let apply = false;
  let important = false;
  let resolveWithoutResponse = false;
  let help = false;
  let environment: Exclude<DongoEnvironment, "custom"> | undefined;
  let origin: string | undefined;
  const values: Record<string, string[]> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") json = true;
    else if (argument === "--help" || argument === "-h") help = true;
    else if (argument === "--version" || argument === "-V") version = true;
    else if (argument === "--no-browser") noBrowser = true;
    else if (argument === "--allow-file-secret-store") allowFileSecretStore = true;
    else if (argument === "--apply") apply = true;
    else if (argument === "--important") important = true;
    else if (argument === "--resolve-without-response") resolveWithoutResponse = true;
    else if (argument === "--environment") {
      const value = argv[++index];
      if (value !== "development" && value !== "production") {
        throw new CliCoreError({ code: "validation", message: "--environment must be development or production.", exitCode: 2 });
      }
      environment = value;
    } else if (argument === "--origin") {
      origin = argv[++index];
      if (!origin) throw new CliCoreError({ code: "validation", message: "--origin requires a URL.", exitCode: 2 });
    } else if (argument.startsWith("--") && VALUE_OPTIONS.has(argument.slice(2))) {
      const name = argument.slice(2);
      const value = argv[++index];
      if (value === undefined) {
        throw new CliCoreError({ code: "validation", message: `${argument} requires a value.`, exitCode: 2 });
      }
      (values[name] ??= []).push(value);
    } else if (argument.startsWith("-")) {
      throw new CliCoreError({ code: "validation", message: `Unknown option: ${argument}`, exitCode: 2 });
    } else positional.push(argument);
  }

  return {
    command: help ? "help" : version ? "version" : (positional[0] ?? "help"),
    subcommand: positional[1],
    positionals: positional,
    json,
    version,
    noBrowser,
    allowFileSecretStore,
    apply,
    important,
    resolveWithoutResponse,
    environment,
    origin,
    values,
  };
}
