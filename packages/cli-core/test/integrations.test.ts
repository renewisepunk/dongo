import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CliCoreError, configureIntegration } from "../src/index.ts";

function input(repositoryRoot: string, host: "codex" | "claude" | "generic", apply: boolean) {
  return {
    repositoryRoot,
    productOrigin: "https://dev.dongo.so",
    publicProjectRef: "project_abcdef",
    host,
    apply,
  } as const;
}

test("integration preview renders checked-in host assets without writing or credentials", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dongo-integrate-preview-"));
  const preview = await configureIntegration(input(root, "codex", false));
  assert.equal(preview.applied, false);
  assert.equal(preview.serverName, "dongo-abcdef");
  assert.doesNotMatch(
    JSON.stringify({
      serverName: preview.serverName,
      lifecycle: preview.lifecycle,
      files: preview.files,
    }),
    /\b(?:Dongo|DONGO)\b(?![-_.])/u,
  );
  assert.equal(preview.endpoint, "https://dev.dongo.so/p/project_abcdef/mcp");
  assert.deepEqual(preview.files.map((file) => file.path), [".codex/config.toml", "AGENTS.md"]);
  assert.doesNotMatch(preview.files[0]?.managedContent ?? "", /authorization|bearer|token|secret|header/i);
  assert.match(preview.files[1]?.managedContent ?? "", /durable system of record for repository planning and execution/u);
  assert.match(preview.files[1]?.managedContent ?? "", /attach every repository change to its active Run before editing/u);
  assert.match(preview.files[1]?.managedContent ?? "", /implementation and relevant verification are complete/u);
  assert.equal(preview.lifecycle.state, "preview_ready");
  assert.equal(preview.lifecycle.connectionState, "unverified");
  assert.deepEqual(preview.lifecycle.steps.map(({ id, status }) => ({ id, status })), [
    { id: "apply_configuration", status: "action_required" },
    { id: "approve_project_server", status: "conditional" },
    { id: "complete_login", status: "conditional" },
    { id: "restart_host", status: "conditional" },
    { id: "verify_connection", status: "pending" },
  ]);
  assert.equal(preview.lifecycle.steps[0]?.command, "dongo integrate codex --apply");
  assert.equal(preview.lifecycle.steps[2]?.command, preview.loginCommand);
  await assert.rejects(readFile(path.join(root, ".codex", "config.toml"), "utf8"), { code: "ENOENT" });
});

test("Codex apply preserves unrelated TOML and prose and is idempotent", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dongo-integrate-codex-"));
  await mkdir(path.join(root, ".codex"));
  await import("node:fs/promises").then((fs) =>
    Promise.all([
      fs.writeFile(path.join(root, ".codex", "config.toml"), "model = \"gpt\"\n"),
      fs.writeFile(path.join(root, "AGENTS.md"), "# Existing guidance\n"),
    ]),
  );
  const applied = await configureIntegration(input(root, "codex", true));
  assert.equal(applied.files.every((file) => file.changed), true);
  assert.equal(applied.lifecycle.state, "configuration_applied");
  assert.equal(applied.lifecycle.connectionState, "unverified");
  assert.equal(applied.lifecycle.steps[0]?.status, "complete");
  assert.equal(applied.lifecycle.steps[0]?.command, undefined);
  assert.match(applied.lifecycle.summary, /Connection verification is still required/u);
  const config = await readFile(path.join(root, ".codex", "config.toml"), "utf8");
  const agents = await readFile(path.join(root, "AGENTS.md"), "utf8");
  assert.match(config, /model = "gpt"/);
  assert.match(config, /\[mcp_servers\.dongo-abcdef\]/);
  assert.match(agents, /# Existing guidance/);
  assert.equal(agents.split("<!-- dongo-managed:v1:start -->").length - 1, 1);

  const second = await configureIntegration(input(root, "codex", true));
  assert.equal(second.files.every((file) => !file.changed), true);
});

test("Codex apply replaces only an exact stale dongo project table", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dongo-integrate-codex-replace-"));
  await mkdir(path.join(root, ".codex"));
  await import("node:fs/promises").then((fs) =>
    fs.writeFile(
      path.join(root, ".codex", "config.toml"),
      [
        "model = \"gpt\"",
        "",
        "[mcp_servers.other]",
        "url = \"https://other.example/mcp\"",
        "",
        "[mcp_servers.dongo-oldproject]",
        "url = \"https://dev.dongo.so/p/oldproject/mcp\"",
        "",
        "[mcp_servers.dongo-custom]",
        "url = \"https://dev.dongo.so/p/custom/mcp\"",
        "enabled = false",
        "",
      ].join("\n"),
    ),
  );
  const applied = await configureIntegration(input(root, "codex", true));
  assert.deepEqual(applied.replacedServers, ["dongo-oldproject"]);
  const config = await readFile(path.join(root, ".codex", "config.toml"), "utf8");
  assert.doesNotMatch(config, /dongo-oldproject/u);
  assert.match(config, /mcp_servers\.other/u);
  assert.match(config, /mcp_servers\.dongo-custom/u);
  assert.match(config, /mcp_servers\.dongo-abcdef/u);
});

test("Codex production apply replaces an exact stale development dongo project table", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dongo-integrate-codex-promote-"));
  await mkdir(path.join(root, ".codex"));
  await import("node:fs/promises").then((fs) =>
    fs.writeFile(
      path.join(root, ".codex", "config.toml"),
      [
        "[mcp_servers.dongo-oldproject]",
        'url = "https://dev.dongo.so/p/oldproject/mcp"',
        "",
      ].join("\n"),
    ),
  );
  const applied = await configureIntegration({
    ...input(root, "codex", true),
    productOrigin: "https://dongo.so",
  });
  assert.deepEqual(applied.replacedServers, ["dongo-oldproject"]);
  const config = await readFile(path.join(root, ".codex", "config.toml"), "utf8");
  assert.doesNotMatch(config, /dongo-oldproject/u);
  assert.match(config, /mcp_servers\.dongo-abcdef/u);
  assert.match(config, /https:\/\/dongo\.so\/p\/project_abcdef\/mcp/u);
});

test("Claude JSON merge preserves unrelated servers and conflicting ownership changes nothing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dongo-integrate-claude-"));
  await import("node:fs/promises").then((fs) =>
    fs.writeFile(path.join(root, ".mcp.json"), `${JSON.stringify({ mcpServers: { other: { type: "http", url: "https://other.example/mcp" } }, custom: true }, null, 2)}\n`),
  );
  await chmod(path.join(root, ".mcp.json"), 0o600);
  await configureIntegration(input(root, "claude", true));
  const merged = JSON.parse(await readFile(path.join(root, ".mcp.json"), "utf8"));
  const claude = await readFile(path.join(root, "CLAUDE.md"), "utf8");
  assert.equal(merged.custom, true);
  assert.equal(merged.mcpServers.other.url, "https://other.example/mcp");
  assert.equal(merged.mcpServers["dongo-abcdef"].url, "https://dev.dongo.so/p/project_abcdef/mcp");
  assert.match(claude, /durable system of record for repository planning and execution/u);
  assert.match(claude, /Record meaningful progress, blockers, Attention requests, and outcomes/u);
  assert.equal((await lstat(path.join(root, ".mcp.json"))).mode & 0o777, 0o600);

  merged.mcpServers["dongo-abcdef"].url = "https://attacker.example/mcp";
  await import("node:fs/promises").then((fs) => fs.writeFile(path.join(root, ".mcp.json"), `${JSON.stringify(merged, null, 2)}\n`));
  const before = await readFile(path.join(root, ".mcp.json"), "utf8");
  await assert.rejects(configureIntegration(input(root, "claude", true)), (error: unknown) => {
    assert.ok(error instanceof CliCoreError);
    assert.equal(error.code, "conflict");
    return true;
  });
  assert.equal(await readFile(path.join(root, ".mcp.json"), "utf8"), before);
});

test("Claude apply replaces only an exact stale dongo project entry", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dongo-integrate-claude-replace-"));
  await import("node:fs/promises").then((fs) =>
    fs.writeFile(
      path.join(root, ".mcp.json"),
      `${JSON.stringify({
        mcpServers: {
          other: { type: "http", url: "https://other.example/mcp" },
          "dongo-oldproject": { type: "http", url: "https://dev.dongo.so/p/oldproject/mcp" },
          "dongo-custom": { type: "http", url: "https://dev.dongo.so/p/custom/mcp", headers: { custom: "value" } },
        },
      }, null, 2)}\n`,
    ),
  );
  const applied = await configureIntegration(input(root, "claude", true));
  assert.deepEqual(applied.replacedServers, ["dongo-oldproject"]);
  const config = JSON.parse(await readFile(path.join(root, ".mcp.json"), "utf8"));
  assert.equal(config.mcpServers["dongo-oldproject"], undefined);
  assert.equal(config.mcpServers.other.url, "https://other.example/mcp");
  assert.equal(config.mcpServers["dongo-custom"].headers.custom, "value");
  assert.equal(config.mcpServers["dongo-abcdef"].url, "https://dev.dongo.so/p/project_abcdef/mcp");
});

test("integration apply refuses symlink targets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dongo-integrate-link-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "dongo-integrate-outside-"));
  await symlink(outside, path.join(root, ".codex"));
  await assert.rejects(configureIntegration(input(root, "codex", true)), /unsafe/);
});

test("preview never reflects unrelated existing configuration or prose", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dongo-integrate-redact-"));
  await import("node:fs/promises").then((fs) =>
    Promise.all([
      fs.writeFile(path.join(root, ".mcp.json"), JSON.stringify({ mcpServers: { private: { headers: { authorization: "Bearer existing-secret" } } } })),
      fs.writeFile(path.join(root, "AGENTS.md"), "private-existing-instruction-secret\n"),
    ]),
  );
  const preview = await configureIntegration(input(root, "generic", false));
  assert.doesNotMatch(JSON.stringify(preview), /existing-secret|private-existing-instruction-secret/);
});
