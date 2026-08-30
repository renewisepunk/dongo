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
  assert.equal(preview.endpoint, "https://dev.dongo.so/p/project_abcdef/mcp");
  assert.deepEqual(preview.files.map((file) => file.path), [".codex/config.toml", "AGENTS.md"]);
  assert.doesNotMatch(preview.files[0]?.managedContent ?? "", /authorization|bearer|token|secret|header/i);
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
  const config = await readFile(path.join(root, ".codex", "config.toml"), "utf8");
  const agents = await readFile(path.join(root, "AGENTS.md"), "utf8");
  assert.match(config, /model = "gpt"/);
  assert.match(config, /\[mcp_servers\.dongo-abcdef\]/);
  assert.match(agents, /# Existing guidance/);
  assert.equal(agents.split("<!-- dongo-managed:v1:start -->").length - 1, 1);

  const second = await configureIntegration(input(root, "codex", true));
  assert.equal(second.files.every((file) => !file.changed), true);
});

test("Claude JSON merge preserves unrelated servers and conflicting ownership changes nothing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dongo-integrate-claude-"));
  await import("node:fs/promises").then((fs) =>
    fs.writeFile(path.join(root, ".mcp.json"), `${JSON.stringify({ mcpServers: { other: { type: "http", url: "https://other.example/mcp" } }, custom: true }, null, 2)}\n`),
  );
  await chmod(path.join(root, ".mcp.json"), 0o600);
  await configureIntegration(input(root, "claude", true));
  const merged = JSON.parse(await readFile(path.join(root, ".mcp.json"), "utf8"));
  assert.equal(merged.custom, true);
  assert.equal(merged.mcpServers.other.url, "https://other.example/mcp");
  assert.equal(merged.mcpServers["dongo-abcdef"].url, "https://dev.dongo.so/p/project_abcdef/mcp");
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
