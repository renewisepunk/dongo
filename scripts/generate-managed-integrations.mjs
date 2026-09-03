import { readFile, writeFile } from "node:fs/promises";
import { DONGO_MCP_INSTRUCTIONS } from "../packages/mcp/src/instructions.ts";

const expected = `<!-- dongo-managed:v1:start -->\n${DONGO_MCP_INSTRUCTIONS}\n<!-- dongo-managed:v1:end -->\n`;
for (const path of ["shared/DONGO.managed.md", "codex/AGENTS.managed.md", "claude-code/CLAUDE.managed.md", "generic-agents/AGENTS.managed.md"]) {
  const target = new URL(`../integrations/${path}`, import.meta.url);
  if (process.argv.includes("--check")) {
    if (await readFile(target, "utf8") !== expected) throw new Error(`Stale managed integration: ${path}`);
  } else {
    await writeFile(target, expected);
  }
}
