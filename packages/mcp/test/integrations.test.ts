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

test("checked-in host configs contain no static credentials", async () => {
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
  assert.match(DONGO_MCP_INSTRUCTIONS, /follow the complete lifecycle/u);
  assert.match(DONGO_MCP_INSTRUCTIONS, /request clarification, or dismiss it, then refetch and complete triage/u);
  assert.match(DONGO_MCP_INSTRUCTIONS, /per-session safety rule, not a project-wide instruction to serialize/u);
  assert.match(DONGO_MCP_INSTRUCTIONS, /use the host's native delegation mechanism/u);
  assert.match(DONGO_MCP_INSTRUCTIONS, /exactly one independent issue, beginning from its exact Intake or WorkItem/u);
  assert.match(DONGO_MCP_INSTRUCTIONS, /Refill available capacity as sessions finish/u);
  assert.match(DONGO_MCP_INSTRUCTIONS, /dongo_get_attention immediately, then after 5, 10, 20/u);
  assert.match(DONGO_MCP_INSTRUCTIONS, /stopping after five minutes/u);
  assert.match(DONGO_MCP_INSTRUCTIONS, /stopped local agent does not wake itself/u);
  assert.match(DONGO_MCP_INSTRUCTIONS, /optional local runner/u);
  assert.match(DONGO_MCP_INSTRUCTIONS, /does not inject into, interrupt, or restart this conversation/u);
  assert.match(DONGO_MCP_INSTRUCTIONS, /another repository's runner does not apply/u);
  assert.match(DONGO_MCP_INSTRUCTIONS, /Each active job runs in its own local Git worktree and agent session/u);
  assert.match(DONGO_MCP_INSTRUCTIONS, /Humans may enrich waiting or claimed Intake/u);
  assert.match(DONGO_MCP_INSTRUCTIONS, /save preserves the claim but advances the Intake revision/u);
  assert.match(DONGO_MCP_INSTRUCTIONS, /review the current text, context, links, and finalized attachments/u);
  assert.match(DONGO_MCP_INSTRUCTIONS, /@wisepunk\/dongo@0\.2\.11/u);
  assert.match(DONGO_MCP_INSTRUCTIONS, /ask whether they want to install it/u);
  assert.match(DONGO_MCP_INSTRUCTIONS, /Never install automatically/u);
  assert.match(DONGO_MCP_INSTRUCTIONS, /next eligible successful tool result/u);
  assert.match(DONGO_MCP_INSTRUCTIONS, /after dongo activates/u);
  assert.match(DONGO_MCP_INSTRUCTIONS, /does not wake a stopped agent/u);
  assert.match(DONGO_MCP_INSTRUCTIONS, /even when the owner is also present in the agent host/u);
  assert.match(DONGO_MCP_INSTRUCTIONS, /dongo_request_owner_attention/u);
  assert.match(DONGO_MCP_INSTRUCTIONS, /Continue any independent, authorized work/u);
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
  assert.equal(first.integrationVersion, "0.1.13");
  assert.notEqual(first.serverName, second.serverName);
  assert.notEqual(first.endpoint, second.endpoint);
  assert.match(first.codexConfigToml, /https:\/\/dev\.dongo\.so\/p\/project_abcdef\/mcp/);
  assert.match(first.codexConfigToml, /oauth\.client_id = "dongo-codex"/u);
  assert.match(first.codexConfigToml, /oauth\.callback_url = "http:\/\/127\.0\.0\.1\/callback"/u);
  assert.doesNotMatch(
    `${first.codexConfigToml}${first.claudeProjectConfig}${first.genericMcpConfig}`,
    /authorization|bearer|token|secret|header/i,
  );
});
