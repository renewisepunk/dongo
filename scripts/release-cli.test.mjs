import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { classifyRelease, compareStableVersions } from "./release-cli.mjs";

test("stable CLI versions compare numerically", () => {
  assert.equal(compareStableVersions("0.2.0", "0.1.9") > 0, true);
  assert.equal(compareStableVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareStableVersions("1.0.0", "1.0.1") < 0, true);
});

test("a matching published payload is an automatic no-op", () => {
  assert.deepEqual(classifyRelease({
    localVersion: "0.2.0",
    latestVersion: "0.2.0",
    exactVersionPublished: true,
    localPayload: "same",
    publishedPayload: "same",
  }), { action: "skip", reason: "published payload already matches" });
});

test("an unpublished newer CLI version is selected for publication", () => {
  assert.deepEqual(classifyRelease({
    localVersion: "0.2.0",
    latestVersion: "0.1.0",
    exactVersionPublished: false,
    localPayload: "new",
  }), { action: "publish", reason: "new verified CLI version" });
});

test("immutable collisions and stale versions fail closed", () => {
  assert.throws(() => classifyRelease({
    localVersion: "0.1.0",
    latestVersion: "0.1.0",
    exactVersionPublished: true,
    localPayload: "changed",
    publishedPayload: "published",
  }), /different immutable payload/u);
  assert.throws(() => classifyRelease({
    localVersion: "0.1.0",
    latestVersion: "0.2.0",
    exactVersionPublished: false,
    localPayload: "old",
  }), /must be newer/u);
});

test("production deployment orders authorization, smoke, and publication safely", async () => {
  const source = await readFile(new URL("./deploy-production.mjs", import.meta.url), "utf8");
  const preflight = source.indexOf("public CLI release preflight");
  const convex = source.indexOf("Convex production functions");
  const smoke = source.indexOf("production public smoke gate");
  const publication = source.indexOf('"public CLI release",');
  const activation = source.indexOf("agent release notice activation");
  assert.ok(preflight >= 0 && preflight < convex);
  assert.ok(convex < smoke && smoke < publication);
  assert.ok(publication < activation);
  assert.match(source, /scripts\/smoke-production\.mjs[\s\S]*--project-ref[\s\S]*productionPublicProjectRef/u);
});

test("public registry access and package-level publishing rights are pinned", async () => {
  const source = await readFile(new URL("./release-cli.mjs", import.meta.url), "utf8");
  assert.match(source, /const publicRegistry = "https:\/\/registry\.npmjs\.org\/"/u);
  assert.match(source, /"access", "list", "collaborators", packageName/u);
  assert.match(source, /collaborators\?\.\[username\] === "read-write"/u);
  assert.match(source, /`--@wisepunk:registry=\$\{publicRegistry\}`/u);
  assert.match(source, /return run\(npmCommand, \[\.\.\.args, \.\.\.publicRegistryArguments\]/u);
});

test("ambient registry overrides cannot redirect public release inspection", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "dongo-release-registry-test-"));
  const userConfig = join(temporaryRoot, "npmrc");
  await writeFile(userConfig, [
    "registry=http://127.0.0.1:9/",
    "@wisepunk:registry=http://127.0.0.1:9/",
    "",
  ].join("\n"), { mode: 0o600 });
  try {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("./release-cli.mjs", import.meta.url)), "--plan"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: {
        ...process.env,
        NPM_CONFIG_REGISTRY: "http://127.0.0.1:9/",
        NPM_CONFIG_USERCONFIG: userConfig,
      },
      encoding: "utf8",
      maxBuffer: 8 * 1_024 * 1_024,
    });
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(await readFile(new URL("../apps/cli/package.json", import.meta.url), "utf8"));
    const plan = JSON.parse(result.stdout.trim().split("\n").at(-1));
    assert.equal(plan.version, manifest.version);
    assert.ok(["publish", "skip"].includes(plan.action));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("an already-published payload is reverified on preflight and publish retries", async () => {
  const source = await readFile(new URL("./release-cli.mjs", import.meta.url), "utf8");
  assert.match(source, /release\.action === "skip" && mode !== "--plan"/u);
  assert.match(source, /verifyPublishedRelease\(temporaryRoot, release\)/u);
  assert.match(source, /verifyRegistryInstall\(temporaryRoot, release\.localVersion\)/u);
  assert.match(source, /run\("git", \["init", "--quiet"\], \{ cwd: repository/u);
  assert.match(source, /\["auth", "status", "--json"\], \{\s+cwd: repository/u);
});

test("CI always checks the public CLI release state", async () => {
  const workflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(workflow, /Verify the public CLI release state\n\s+run: npm run release:cli:plan/u);
});

test("the agent advisory and public package share one release version", async () => {
  const manifest = JSON.parse(await readFile(new URL("../apps/cli/package.json", import.meta.url), "utf8"));
  const releaseNotice = await readFile(new URL("../packages/mcp/src/release-notice.ts", import.meta.url), "utf8");
  const instructions = await readFile(new URL("../packages/mcp/src/instructions.ts", import.meta.url), "utf8");
  assert.match(releaseNotice, new RegExp(`version: "${manifest.version.replaceAll(".", "\\.")}"`, "u"));
  assert.match(releaseNotice, new RegExp(`npm install --global @wisepunk/dongo@${manifest.version.replaceAll(".", "\\.")}`, "u"));
  assert.match(releaseNotice, /sequence: \d+/u);
  assert.match(instructions, /Never install automatically/u);
  assert.match(instructions, /explicit user approval/u);
});

test("production deployment always verifies the agent release notice before mutation", async () => {
  const source = await readFile(new URL("./deploy-production.mjs", import.meta.url), "utf8");
  const noticePreflight = source.indexOf("agent release notice preflight");
  const convexDeploy = source.indexOf("Convex production functions");
  assert.ok(noticePreflight >= 0);
  assert.ok(convexDeploy > noticePreflight);
});

test("agent release activation uses the reviewed marker only after npm reconciliation", async () => {
  const source = await readFile(new URL("./activate-agent-release-notice.mjs", import.meta.url), "utf8");
  assert.match(source, /CURRENT_AGENT_RELEASE_NOTICE\.id/u);
  assert.match(source, /CURRENT_AGENT_RELEASE_NOTICE\.sequence/u);
  assert.match(source, /operators\/agentReleaseNotice:activate/u);
  assert.match(source, /"--prod"/u);
});
