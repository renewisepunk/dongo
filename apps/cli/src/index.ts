#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { runCli } from "./cli.ts";

export { runCli } from "./cli.ts";

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  try {
    process.exitCode = await runCli(process.argv.slice(2), { signal: controller.signal });
  } finally {
    process.removeListener("SIGINT", cancel);
  }
}
