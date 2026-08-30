import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, rm } from "node:fs/promises";
import path from "node:path";

import type { OperationOutput } from "@dongo/contracts";

import { CliCoreError } from "./errors.ts";

export interface AttachmentFetchResult {
  attachmentId: string;
  filename: string;
  contentType: string;
  byteSize: number;
  path: string;
  sha256: string;
}

const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

function safeFilename(value: string, fallback: string): string {
  const name = path.basename(value).replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, "-").replace(/^-+|-+$/g, "");
  return name.slice(0, 180) || fallback;
}

function assertInside(root: string, target: string): string {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative) || relative.split(path.sep)[0] === ".git") {
    throw new CliCoreError({ code: "unsafe_path", message: "Attachment output must be inside the repository and outside .git." });
  }
  return relative;
}

async function prepareParent(root: string, target: string): Promise<void> {
  const relative = assertInside(root, target);
  const parts = path.dirname(relative).split(path.sep).filter((part) => part && part !== ".");
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new CliCoreError({ code: "unsafe_path", message: "Attachment output directory is unsafe." });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(current, { mode: 0o700 });
    }
  }
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink() || info.isFile() || info.isDirectory()) {
      throw new CliCoreError({ code: "conflict", message: "Attachment output already exists; choose another --output path.", exitCode: 6 });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function validateDownloadUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CliCoreError({ code: "validation", message: "dongo returned an invalid attachment download location." });
  }
  const local = url.protocol === "http:" && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !local) || url.username || url.password) {
    throw new CliCoreError({ code: "validation", message: "dongo returned an unsafe attachment download location." });
  }
  return url.toString();
}

export async function fetchAttachmentFile(input: {
  repositoryRoot: string;
  access: OperationOutput<"get_attachment">;
  output?: string;
  fetch: typeof globalThis.fetch;
  signal?: AbortSignal;
}): Promise<AttachmentFetchResult> {
  if (input.access.byteSize < 0 || input.access.byteSize > MAX_ATTACHMENT_BYTES) {
    throw new CliCoreError({ code: "validation", message: "Attachment exceeds the CLI download limit." });
  }
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const defaultName = `${input.access.attachmentId}-${safeFilename(input.access.filename, "attachment")}`;
  const target = input.output
    ? path.resolve(repositoryRoot, input.output)
    : path.join(repositoryRoot, ".agent-work", "attachments", defaultName);
  const relativePath = assertInside(repositoryRoot, target);
  await prepareParent(repositoryRoot, target);

  let response: Response;
  try {
    response = await input.fetch(validateDownloadUrl(input.access.downloadUrl), {
      method: "GET",
      redirect: "error",
      signal: input.signal,
    });
  } catch (cause) {
    if (input.signal?.aborted) {
      throw new CliCoreError({ code: "cancelled", message: "Attachment download was cancelled.", exitCode: 130 });
    }
    throw new CliCoreError({
      code: "temporary_failure",
      message: "Could not download the dongo attachment.",
      retryable: true,
      exitCode: 5,
      cause,
    });
  }
  if (!response.ok || !response.body) {
    throw new CliCoreError({
      code: "temporary_failure",
      message: `Attachment download failed with HTTP ${response.status}.`,
      retryable: response.status >= 500 || response.status === 429,
      exitCode: 5,
    });
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > input.access.byteSize) {
    throw new CliCoreError({ code: "validation", message: "Attachment download is larger than its reserved size." });
  }

  const temporary = `${target}.dongo-${process.pid}-${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  const hash = createHash("sha256");
  let byteSize = 0;
  try {
    const reader = response.body.getReader();
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      byteSize += part.value.byteLength;
      if (byteSize > input.access.byteSize || byteSize > MAX_ATTACHMENT_BYTES) {
        await reader.cancel();
        throw new CliCoreError({ code: "validation", message: "Attachment download exceeded its reserved size." });
      }
      hash.update(part.value);
      await handle.write(part.value);
    }
    if (byteSize !== input.access.byteSize) {
      throw new CliCoreError({ code: "validation", message: "Attachment download size did not match its metadata." });
    }
    await handle.sync();
    await handle.close();
    try {
      await link(temporary, target);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "EEXIST") {
        throw new CliCoreError({ code: "conflict", message: "Attachment output already exists; choose another --output path.", exitCode: 6 });
      }
      throw cause;
    }
    await rm(temporary);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(temporary, { force: true });
    if (error instanceof CliCoreError) throw error;
    if (input.signal?.aborted) {
      throw new CliCoreError({ code: "cancelled", message: "Attachment download was cancelled.", exitCode: 130 });
    }
    throw new CliCoreError({
      code: "temporary_failure",
      message: "Attachment download was interrupted before it could be saved.",
      retryable: true,
      exitCode: 5,
      cause: error,
    });
  }
  return {
    attachmentId: input.access.attachmentId,
    filename: input.access.filename,
    contentType: input.access.contentType,
    byteSize,
    path: relativePath,
    sha256: hash.digest("hex"),
  };
}
