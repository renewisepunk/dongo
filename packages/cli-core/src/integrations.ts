import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { renderDongoManagedIntegrationBundle } from "@dongo/mcp/managed-integrations";

import { CliCoreError } from "./errors.ts";

export type IntegrationHost = "codex" | "claude" | "generic";

export interface IntegrationFileResult {
  path: string;
  changed: boolean;
  managedContent: string;
}

export interface IntegrationResult {
  host: IntegrationHost;
  applied: boolean;
  serverName: string;
  endpoint: string;
  replacedServers: string[];
  files: IntegrationFileResult[];
  loginCommand?: string;
  rollback: string[];
}

const MANAGED_START = "<!-- dongo-managed:v1:start -->";
const MANAGED_END = "<!-- dongo-managed:v1:end -->";

function shortProjectReference(publicProjectRef: string): string {
  const withoutPrefix = publicProjectRef.replace(/^project[_-]/i, "");
  const safe = withoutPrefix.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (safe.length >= 2 && safe.length <= 31) return safe;
  const digest = createHash("sha256").update(publicProjectRef).digest("hex").slice(0, 8);
  const prefix = safe.slice(0, 22).replace(/-+$/g, "");
  return prefix.length >= 2 ? `${prefix}-${digest}` : digest;
}

function assertInside(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new CliCoreError({ code: "unsafe_path", message: "Integration target escapes the repository." });
  }
}

async function readSafeFile(target: string): Promise<string | undefined> {
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new CliCoreError({ code: "unsafe_path", message: `Integration target is not a safe file: ${target}` });
    }
    return readFile(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function ensureSafeParent(root: string, target: string): Promise<void> {
  assertInside(root, target);
  const relativeParent = path.relative(root, path.dirname(target));
  let current = root;
  for (const segment of relativeParent.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new CliCoreError({ code: "unsafe_path", message: `Integration directory is unsafe: ${current}` });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(current, { mode: 0o755 });
    }
  }
}

async function atomicWrite(root: string, target: string, content: string): Promise<void> {
  await ensureSafeParent(root, target);
  let mode = 0o644;
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new CliCoreError({ code: "unsafe_path", message: `Integration target is not a safe file: ${target}` });
    }
    mode = info.mode & 0o777;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = `${target}.dongo-${process.pid}-${randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", mode, flag: "wx" });
  try {
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function mergeInstruction(existing: string | undefined, managedBlock: string): string {
  if (existing === undefined || existing.length === 0) return managedBlock;
  const starts = existing.split(MANAGED_START).length - 1;
  const ends = existing.split(MANAGED_END).length - 1;
  if (starts === 0 && ends === 0) return `${existing.trimEnd()}\n\n${managedBlock}`;
  if (starts !== 1 || ends !== 1) {
    throw new CliCoreError({
      code: "conflict",
      message: "Managed Dongo instruction markers are malformed or duplicated; no file was changed.",
      exitCode: 6,
    });
  }
  const start = existing.indexOf(MANAGED_START);
  const end = existing.indexOf(MANAGED_END, start);
  if (end < start) {
    throw new CliCoreError({ code: "conflict", message: "Managed Dongo instruction markers are out of order.", exitCode: 6 });
  }
  return `${existing.slice(0, start)}${managedBlock}${existing.slice(end + MANAGED_END.length).replace(/^\r?\n/, "")}`;
}

interface ConfigurationMerge {
  content: string;
  replacedServers: string[];
}

function isExactManagedEndpoint(
  serverName: string,
  entry: Record<string, unknown>,
  productOrigin: string,
): boolean {
  const keys = Object.keys(entry).sort();
  if (
    keys.length !== 2
    || keys[0] !== "type"
    || keys[1] !== "url"
    || !["http", "streamable-http"].includes(String(entry.type))
    || typeof entry.url !== "string"
  ) return false;
  try {
    const endpoint = new URL(entry.url);
    const origin = new URL(productOrigin);
    const match = /^\/p\/([A-Za-z0-9_-]{1,200})\/mcp$/u.exec(endpoint.pathname);
    if (
      endpoint.origin !== origin.origin
      || endpoint.search
      || endpoint.hash
      || !match?.[1]
    ) return false;
    return serverName === `dongo-${shortProjectReference(match[1])}`;
  } catch {
    return false;
  }
}

function removeStaleManagedToml(
  existing: string,
  serverName: string,
  productOrigin: string,
): { content: string; replacedServers: string[] } {
  const tablePattern = /^\[mcp_servers\.([A-Za-z0-9_-]+)\]\s*$/gmu;
  const tables = [...existing.matchAll(tablePattern)];
  const removals: Array<{ start: number; end: number; serverName: string }> = [];
  for (const [index, table] of tables.entries()) {
    const candidateName = table[1];
    if (!candidateName || candidateName === serverName || !candidateName.startsWith("dongo-")) continue;
    const start = table.index ?? 0;
    const end = tables[index + 1]?.index ?? existing.length;
    const block = existing.slice(start, end).trim();
    const lines = block.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
    const urlMatch = lines.length === 2 ? /^url\s*=\s*"([^"\r\n]+)"$/u.exec(lines[1] ?? "") : null;
    if (
      urlMatch?.[1]
      && isExactManagedEndpoint(candidateName, { type: "http", url: urlMatch[1] }, productOrigin)
    ) removals.push({ start, end, serverName: candidateName });
  }
  let content = existing;
  for (const removal of [...removals].reverse()) {
    content = `${content.slice(0, removal.start)}${content.slice(removal.end)}`;
  }
  return { content, replacedServers: removals.map((removal) => removal.serverName) };
}

function mergeToml(
  existing: string | undefined,
  serverName: string,
  desired: string,
  productOrigin: string,
): ConfigurationMerge {
  if (existing === undefined || existing.trim().length === 0) return { content: desired, replacedServers: [] };
  const replacement = removeStaleManagedToml(existing, serverName, productOrigin);
  existing = replacement.content;
  const header = `[mcp_servers.${serverName}]`;
  const headerPattern = new RegExp(`^\\[mcp_servers\\.${serverName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\s*$`, "gm");
  const matches = [...existing.matchAll(headerPattern)];
  if (matches.length === 0) {
    return {
      content: existing.trim().length === 0 ? desired : `${existing.trimEnd()}\n\n${desired}`,
      replacedServers: replacement.replacedServers,
    };
  }
  if (matches.length !== 1) {
    throw new CliCoreError({ code: "conflict", message: `Codex server table ${header} is duplicated.`, exitCode: 6 });
  }
  const start = matches[0]?.index ?? 0;
  const afterHeader = start + (matches[0]?.[0].length ?? 0);
  const nextTable = /^\s*\[[^\]]+\]\s*$/gm;
  nextTable.lastIndex = afterHeader;
  const next = nextTable.exec(existing);
  const end = next?.index ?? existing.length;
  const current = existing.slice(start, end).trim();
  if (current === desired.trim()) return { content: existing, replacedServers: replacement.replacedServers };
  throw new CliCoreError({
    code: "conflict",
    message: `Codex server ${serverName} already exists with different settings; no file was changed.`,
    exitCode: 6,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeJson(
  existing: string | undefined,
  serverName: string,
  desiredText: string,
  productOrigin: string,
): ConfigurationMerge {
  let root: Record<string, unknown> = {};
  if (existing !== undefined && existing.trim().length > 0) {
    try {
      const parsed = JSON.parse(existing) as unknown;
      if (!isRecord(parsed)) throw new Error("not an object");
      root = parsed;
    } catch {
      throw new CliCoreError({
        code: "conflict",
        message: "Existing MCP configuration is not a JSON object; no file was changed.",
        exitCode: 6,
      });
    }
  }
  const desired = JSON.parse(desiredText) as { mcpServers: Record<string, Record<string, unknown>> };
  const desiredEntry = desired.mcpServers[serverName];
  if (!desiredEntry) throw new CliCoreError({ code: "internal", message: "Managed MCP manifest is incomplete." });
  const currentServers = root.mcpServers;
  if (currentServers !== undefined && !isRecord(currentServers)) {
    throw new CliCoreError({ code: "conflict", message: "Existing mcpServers configuration is not an object.", exitCode: 6 });
  }
  const servers = currentServers === undefined ? {} : { ...currentServers };
  const replacedServers: string[] = [];
  for (const [candidateName, candidate] of Object.entries(servers)) {
    if (
      candidateName !== serverName
      && candidateName.startsWith("dongo-")
      && isRecord(candidate)
      && isExactManagedEndpoint(candidateName, candidate, productOrigin)
    ) {
      delete servers[candidateName];
      replacedServers.push(candidateName);
    }
  }
  const existingEntry = servers[serverName];
  if (existingEntry !== undefined && JSON.stringify(existingEntry) !== JSON.stringify(desiredEntry)) {
    throw new CliCoreError({
      code: "conflict",
      message: `MCP server ${serverName} already exists with different settings; no file was changed.`,
      exitCode: 6,
    });
  }
  servers[serverName] = desiredEntry;
  root.mcpServers = servers;
  return { content: `${JSON.stringify(root, null, 2)}\n`, replacedServers };
}

export async function configureIntegration(input: {
  repositoryRoot: string;
  productOrigin: string;
  publicProjectRef: string;
  host: IntegrationHost;
  apply: boolean;
}): Promise<IntegrationResult> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  let bundle;
  try {
    bundle = renderDongoManagedIntegrationBundle({
      origin: new URL(`${input.productOrigin}/`),
      publicProjectRef: input.publicProjectRef,
      shortProjectRef: shortProjectReference(input.publicProjectRef),
    });
  } catch (cause) {
    throw new CliCoreError({
      code: "validation",
      message: "This project origin or public reference cannot be used for hosted MCP configuration.",
      exitCode: 2,
      cause,
    });
  }

  const configurationPath = path.join(repositoryRoot, input.host === "codex" ? ".codex/config.toml" : ".mcp.json");
  const instructionPath = path.join(repositoryRoot, input.host === "claude" ? "CLAUDE.md" : "AGENTS.md");
  const existingConfiguration = await readSafeFile(configurationPath);
  const existingInstruction = await readSafeFile(instructionPath);
  const manifestText =
    input.host === "codex"
      ? bundle.codexConfigToml
      : input.host === "claude"
        ? bundle.claudeProjectConfig
        : bundle.genericMcpConfig;
  const configurationMerge =
    input.host === "codex"
      ? mergeToml(existingConfiguration, bundle.serverName, manifestText, input.productOrigin)
      : mergeJson(existingConfiguration, bundle.serverName, manifestText, input.productOrigin);
  const configuration = configurationMerge.content;
  const instruction = mergeInstruction(existingInstruction, bundle.managedInstructionBlock);
  const prepared = [
    {
      path: path.relative(repositoryRoot, configurationPath),
      changed: configuration !== existingConfiguration,
      output: configuration,
      managedContent: manifestText,
    },
    {
      path: path.relative(repositoryRoot, instructionPath),
      changed: instruction !== existingInstruction,
      output: instruction,
      managedContent: bundle.managedInstructionBlock,
    },
  ];
  if (input.apply) {
    for (const file of prepared) {
      if (file.changed) await atomicWrite(repositoryRoot, path.join(repositoryRoot, file.path), file.output);
    }
  }
  const files: IntegrationFileResult[] = prepared.map(({ path: filePath, changed, managedContent }) => ({
    path: filePath,
    changed,
    managedContent,
  }));

  const loginCommand =
    input.host === "codex"
      ? `codex mcp login ${bundle.serverName} --scopes dongo:work:read,dongo:work:write,dongo:attachments:read --oauth-client-registration auto`
      : input.host === "claude"
        ? `claude mcp login ${bundle.serverName}`
        : undefined;
  const rollback =
    input.host === "codex"
      ? [`codex mcp logout ${bundle.serverName}`, `codex mcp remove ${bundle.serverName}`]
      : input.host === "claude"
        ? [`claude mcp logout ${bundle.serverName}`, `claude mcp remove --scope project ${bundle.serverName}`]
        : ["Remove only the rendered Dongo server entry and managed instruction block."];
  return {
    host: input.host,
    applied: input.apply,
    serverName: bundle.serverName,
    endpoint: bundle.endpoint,
    replacedServers: configurationMerge.replacedServers,
    files,
    loginCommand,
    rollback,
  };
}
