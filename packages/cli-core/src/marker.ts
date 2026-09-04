import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { DongoEnvironment } from "./environment.ts";
import { CliCoreError } from "./errors.ts";

export interface ProjectMarker {
  schemaVersion: 1;
  environment: DongoEnvironment;
  productOrigin: string;
  issuer: string;
  apiBaseUrl: string;
  apiResource: string;
  publicProjectRef: string;
  projectId?: string;
  projectName: string;
  installationId: string;
  credentialProfile: string;
  repositoryUrl?: string;
  connectedAt: string;
}

export function markerPath(repositoryRoot: string): string {
  return path.join(path.resolve(repositoryRoot), ".agent-work", "project.json");
}

async function assertNotSymlink(target: string): Promise<void> {
  try {
    if ((await lstat(target)).isSymbolicLink()) {
      throw new CliCoreError({ code: "unsafe_path", message: `Refusing to use symlinked dongo path: ${target}` });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function requireString(record: Record<string, unknown>, key: keyof ProjectMarker): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new CliCoreError({ code: "validation", message: `Project marker is missing ${key}.` });
  }
  return value;
}

export async function readProjectMarker(repositoryRoot: string): Promise<ProjectMarker | undefined> {
  const target = markerPath(repositoryRoot);
  await assertNotSymlink(path.dirname(target));
  await assertNotSymlink(target);
  try {
    const record = JSON.parse(await readFile(target, "utf8")) as Record<string, unknown>;
    if (record.schemaVersion !== 1) throw new CliCoreError({ code: "validation", message: "Unsupported project marker version." });
    const environment = requireString(record, "environment");
    if (!["development", "production", "custom"].includes(environment)) {
      throw new CliCoreError({ code: "validation", message: "Project marker has an invalid environment." });
    }
    return {
      schemaVersion: 1,
      environment: environment as DongoEnvironment,
      productOrigin: requireString(record, "productOrigin"),
      issuer: requireString(record, "issuer"),
      apiBaseUrl: requireString(record, "apiBaseUrl"),
      apiResource: requireString(record, "apiResource"),
      publicProjectRef: requireString(record, "publicProjectRef"),
      projectId: typeof record.projectId === "string" ? record.projectId : undefined,
      projectName: requireString(record, "projectName"),
      installationId: requireString(record, "installationId"),
      credentialProfile: requireString(record, "credentialProfile"),
      repositoryUrl: typeof record.repositoryUrl === "string" ? record.repositoryUrl : undefined,
      connectedAt: requireString(record, "connectedAt"),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if (error instanceof SyntaxError) throw new CliCoreError({ code: "validation", message: "Project marker is not valid JSON." });
    throw error;
  }
}

export async function writeProjectMarker(repositoryRoot: string, marker: ProjectMarker): Promise<string> {
  const target = markerPath(repositoryRoot);
  const directory = path.dirname(target);
  await assertNotSymlink(directory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  await assertNotSymlink(target);
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  const content = `${JSON.stringify(marker, null, 2)}\n`;
  await writeFile(temporary, content, { mode: 0o600, flag: "wx" });
  try {
    await rename(temporary, target);
    await chmod(target, 0o600);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return target;
}
