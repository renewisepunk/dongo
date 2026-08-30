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
  assert.notEqual(first.serverName, second.serverName);
  assert.notEqual(first.endpoint, second.endpoint);
  assert.match(first.codexConfigToml, /https:\/\/dev\.dongo\.so\/p\/project_abcdef\/mcp/);
  assert.doesNotMatch(
    `${first.codexConfigToml}${first.claudeProjectConfig}${first.genericMcpConfig}`,
    /authorization|bearer|token|secret|header/i,
  );
});
