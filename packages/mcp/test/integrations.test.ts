import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DONGO_MCP_INSTRUCTIONS,
  renderDongoManagedIntegrationBundle,
} from "../src/index.js";

const integrationsRoot = new URL("../../../../integrations/", import.meta.url);

async function integrationFile(path: string): Promise<string> {
  return readFile(new URL(path, integrationsRoot), "utf8");
}

test("checked-in host configs are URL-only and contain no static credentials", async () => {
  for (const path of [
    "codex/config.toml",
    "claude-code/mcp.json",
    "generic-agents/mcp.json",
  ]) {
    const file = await integrationFile(path);
    assert.match(file, /\{\{origin\}\}\/p\/\{\{publicProjectRef\}\}\/mcp/);
    assert.doesNotMatch(file, /authorization|bearer|token|secret|header/i);
    assert.doesNotMatch(file, /command|stdio/i);
  }
});

test("all host instruction blocks exactly match canonical server instructions", async () => {
  const expected = `<!-- dongo-managed:v1:start -->\n${DONGO_MCP_INSTRUCTIONS}\n<!-- dongo-managed:v1:end -->\n`;
  for (const path of [
    "shared/DONGO.managed.md",
    "codex/AGENTS.managed.md",
    "claude-code/CLAUDE.managed.md",
    "generic-agents/AGENTS.managed.md",
  ]) {
    assert.equal(await integrationFile(path), expected);
  }
  assert.match(DONGO_MCP_INSTRUCTIONS, /durable system of record for repository planning and execution/u);
  assert.match(DONGO_MCP_INSTRUCTIONS, /inspect existing Intake and Work for relevant or duplicate items/u);
  assert.match(DONGO_MCP_INSTRUCTIONS, /attach every repository change to its active Run before editing/u);
  assert.match(DONGO_MCP_INSTRUCTIONS, /Record meaningful progress, blockers, Attention requests, and outcomes/u);
  assert.match(DONGO_MCP_INSTRUCTIONS, /only after the requested implementation and relevant verification are complete/u);
  assert.match(DONGO_MCP_INSTRUCTIONS, /dongo_get_attention immediately, then after 5, 10, 20/u);
  assert.match(DONGO_MCP_INSTRUCTIONS, /stopping after five minutes/u);
  assert.match(DONGO_MCP_INSTRUCTIONS, /stopped local agent does not wake itself/u);
  assert.match(DONGO_MCP_INSTRUCTIONS, /Humans may enrich waiting or claimed Intake/u);
  assert.match(DONGO_MCP_INSTRUCTIONS, /save preserves the claim but advances the Intake revision/u);
  assert.match(DONGO_MCP_INSTRUCTIONS, /review the current text, context, links, and finalized attachments/u);
});

test("renderer creates distinct non-secret project host assets", () => {
  const first = renderDongoManagedIntegrationBundle({
    origin: new URL("https://dev.dongo.so/"),
    publicProjectRef: "project_abcdef",
    shortProjectRef: "abcdef",
  });
  const second = renderDongoManagedIntegrationBundle({
    origin: new URL("https://dev.dongo.so/"),
    publicProjectRef: "project_uvwxyz",
    shortProjectRef: "uvwxyz",
  });
  assert.equal(first.integrationVersion, "0.1.8");
  assert.notEqual(first.serverName, second.serverName);
  assert.notEqual(first.endpoint, second.endpoint);
  assert.match(first.codexConfigToml, /https:\/\/dev\.dongo\.so\/p\/project_abcdef\/mcp/);
  assert.doesNotMatch(
    `${first.codexConfigToml}${first.claudeProjectConfig}${first.genericMcpConfig}`,
    /authorization|bearer|token|secret|header/i,
  );
});
