import { createHash, randomUUID } from "node:crypto";
import { mkdir, lstat, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ExportArtifact, ExportManifest, ExportResult, ExportSnapshot, ExportWorkItem } from "./types.ts";

const MANAGED_HEADER = "<!-- dongo-managed:v1 -->";
const SECRET_QUERY_KEY = /(token|secret|signature|sig|key|credential|x-amz-|x-goog-)/i;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim();
}

function yamlString(value: string): string {
  return JSON.stringify(normalizeText(value) ?? "");
}

function safeDate(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

export function slugify(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return normalized || "work";
}

function identifierSegment(identifier: string): string {
  const normalized = identifier.normalize("NFKC").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) throw new Error("A work item has no safe immutable identifier.");
  return normalized.slice(0, 64);
}

function safeArtifact(artifact: ExportArtifact): ExportArtifact | undefined {
  const label =
    normalizeText(artifact.label) ??
    normalizeText(artifact.title) ??
    normalizeText(artifact.kind) ??
    normalizeText(artifact.type) ??
    "Artifact";
  if (!artifact.url) return { ...artifact, label };

  try {
    const url = new URL(artifact.url);
    if (!new Set(["https:", "http:"]).has(url.protocol) || url.username || url.password) return undefined;
    for (const key of url.searchParams.keys()) {
      if (SECRET_QUERY_KEY.test(key)) return { kind: artifact.kind, type: artifact.type, label, repositoryPath: artifact.repositoryPath };
    }
    url.hash = "";
    return { kind: artifact.kind, type: artifact.type, label, repositoryPath: artifact.repositoryPath, url: url.toString() };
  } catch {
    return undefined;
  }
}

function section(title: string, value: string | undefined): string[] {
  const text = normalizeText(value);
  return text ? [`# ${title}`, "", text, ""] : [];
}

export function renderWorkItem(item: ExportWorkItem): string {
  const state = normalizeText(item.state ?? item.status) ?? "ready";
  const created = safeDate(item.createdAt);
  const completed = safeDate(item.completedAt);
  const lines = [
    MANAGED_HEADER,
    "---",
    `id: ${yamlString(item.identifier)}`,
    `title: ${yamlString(item.title)}`,
    `status: ${yamlString(state)}`,
  ];
  if (created) lines.push(`created: ${created}`);
  if (completed) lines.push(`completed: ${completed}`);
  lines.push("---", "");

  lines.push(...section("Goal", item.goal ?? item.description));
  lines.push(...section("Outcome", item.outcome));
  lines.push(...section("Source intake", item.sourceIntake ?? item.sourceIntakeIds?.join("\n")));

  const artifacts = (item.artifacts ?? []).map(safeArtifact).filter((value): value is ExportArtifact => Boolean(value));
  if (artifacts.length > 0) {
    lines.push("# Artifacts", "");
    for (const artifact of artifacts) {
      const label = (normalizeText(artifact.label) ?? normalizeText(artifact.title) ?? normalizeText(artifact.kind) ?? "Artifact")
        .replace(/[\[\]\r\n]+/g, " ")
        .trim();
      if (artifact.url) lines.push(`- [${label}](${artifact.url})`);
      else if (artifact.repositoryPath) lines.push(`- ${label}: \`${artifact.repositoryPath.replace(/`/g, "\\`")}\``);
      else lines.push(`- ${label}`);
    }
    lines.push("");
  }

  const conversation = item.conversation
    ?.map((entry) => {
      const author = entry.actor?.displayName ? `${entry.actor.displayName}: ` : "";
      const body = normalizeText(entry.body);
      const attachmentIds = [...new Set(entry.attachmentIds ?? [])]
        .map((attachmentId) => normalizeText(attachmentId))
        .filter((attachmentId): attachmentId is string => Boolean(attachmentId));
      return [
        body ? `${author}${body}` : author.trimEnd(),
        ...(attachmentIds.length > 0
          ? [`Attachments: ${attachmentIds.join(", ")}`]
          : []),
      ].filter(Boolean).join("\n");
    })
    .join("\n\n");
  lines.push(...section("Notes", item.notes ?? conversation));
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

function fileName(item: ExportWorkItem, used: Map<string, string>): string {
  const base = `${identifierSegment(item.identifier)}-${slugify(item.title)}`;
  const first = `${base}.md`;
  const identity = item.id ?? item.identifier;
  const firstKey = first.toLowerCase();
  const prior = used.get(firstKey);
  if (!prior) {
    used.set(firstKey, identity);
    return first;
  }
  const digest = sha256(identity);
  for (let length = 8; length <= digest.length; length += 4) {
    const collision = `${base}-${digest.slice(0, length)}.md`;
    const collisionKey = collision.toLowerCase();
    if (!used.has(collisionKey)) {
      used.set(collisionKey, identity);
      return collision;
    }
  }
  throw new Error(`Could not create a unique export filename for ${item.identifier}.`);
}

async function assertNotSymlink(target: string): Promise<void> {
  try {
    const stat = await lstat(target);
    if (stat.isSymbolicLink()) throw new Error(`Refusing to write through symlink: ${target}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function assertWithin(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Export path escapes ${root}.`);
}

async function atomicWrite(target: string, content: string): Promise<void> {
  await assertNotSymlink(target);
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  try {
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function readManifest(file: string): Promise<ExportManifest | undefined> {
  try {
    const value = JSON.parse(await readFile(file, "utf8")) as ExportManifest;
    if (value.schemaVersion !== 1 || !Array.isArray(value.files)) return undefined;
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

async function removeStaleManagedFile(root: string, relativePath: string): Promise<boolean> {
  const target = path.resolve(root, relativePath);
  assertWithin(root, target);
  await assertNotSymlink(target);
  try {
    const content = await readFile(target, "utf8");
    if (!content.startsWith(MANAGED_HEADER)) return false;
    await rm(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function exportSnapshot(repositoryRoot: string, snapshot: ExportSnapshot): Promise<ExportResult> {
  const root = path.resolve(repositoryRoot, ".agent-work");
  const workRoot = path.join(root, "work");
  const manifestPath = path.join(root, "manifest.json");
  await assertNotSymlink(root);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await assertNotSymlink(workRoot);
  await mkdir(workRoot, { recursive: true, mode: 0o700 });

  const prior = await readManifest(manifestPath);
  const used = new Map<string, string>();
  const identities = new Set<string>();
  const files = [];
  const sorted = [...snapshot.workItems].sort((left, right) => {
    const identifierOrder = left.identifier.localeCompare(right.identifier, "en", { numeric: true });
    if (identifierOrder !== 0) return identifierOrder;
    return String(left.id ?? left.identifier).localeCompare(String(right.id ?? right.identifier), "en", { numeric: true });
  });

  for (const item of sorted) {
    const identity = String(item.id ?? item.identifier);
    if (identities.has(identity)) throw new Error(`Sync snapshot contains duplicate work item identity ${identity}.`);
    identities.add(identity);
    const name = fileName(item, used);
    const relativePath = path.posix.join("work", name);
    const target = path.resolve(root, relativePath);
    assertWithin(root, target);
    const content = renderWorkItem(item);
    await atomicWrite(target, content);
    files.push({ path: relativePath, sha256: sha256(content) });
  }

  files.sort((left, right) => left.path.localeCompare(right.path));
  const nextPaths = new Set(files.map((file) => file.path));
  const removed: string[] = [];
  for (const file of prior?.files ?? []) {
    if (!nextPaths.has(file.path) && (await removeStaleManagedFile(root, file.path))) removed.push(file.path);
  }
  removed.sort();
  const next: ExportManifest = { schemaVersion: 1, files };
  await atomicWrite(manifestPath, `${JSON.stringify(next, null, 2)}\n`);
  return { root, files, removed };
}
