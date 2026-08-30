import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createAgentApiJsonSchema,
  createAgentApiOpenApi,
} from "../packages/contracts/src/artifacts.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");
const outputs = [
  {
    path: resolve(repositoryRoot, "docs/agent-api/v1/agent-api.schema.json"),
    value: createAgentApiJsonSchema(),
  },
  {
    path: resolve(repositoryRoot, "docs/agent-api/v1/openapi.json"),
    value: createAgentApiOpenApi(),
  },
];

let stale = false;
for (const output of outputs) {
  const expected = `${JSON.stringify(output.value, null, 2)}\n`;
  if (checkOnly) {
    const existing = await readFile(output.path, "utf8").catch(() => undefined);
    if (existing !== expected) {
      stale = true;
      console.error(`${output.path} is missing or stale`);
    }
  } else {
    await mkdir(dirname(output.path), { recursive: true });
    await writeFile(output.path, expected, "utf8");
    console.log(`Generated ${output.path}`);
  }
}

if (stale) {
  console.error("Run npm run generate:contracts and commit the generated artifacts.");
  process.exitCode = 1;
}
