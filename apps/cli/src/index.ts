#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { runCli } from "./cli.ts";

export { runCli } from "./cli.ts";

export function isEntrypoint(moduleUrl: string, entryPath: string | undefined): boolean {
  if (!entryPath) return false;
  try {
    return moduleUrl === pathToFileURL(realpathSync(entryPath)).href;
  } catch {
    return moduleUrl === pathToFileURL(entryPath).href;
  }
}

if (isEntrypoint(import.meta.url, process.argv[1])) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    process.exitCode = await runCli(process.argv.slice(2), { signal: controller.signal });
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}
