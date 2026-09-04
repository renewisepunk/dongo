import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  discoverRunnerDeploymentPolicy,
  redactRunnerSecrets,
  resolveRunnerDeploymentEnvironment,
} from "../src/runner-deployment-access.ts";

async function releaseRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), "dongo-release-access-"));
  execFileSync("git", ["init", "--quiet", root]);
  execFileSync("git", ["-C", root, "remote", "add", "origin", "git@github.com:example/project.git"]);
  await mkdir(path.join(root, "convex"));
  await mkdir(path.join(root, "apps", "web"), { recursive: true });
  await mkdir(path.join(root, "apps", "cli"), { recursive: true });
  await mkdir(path.join(root, "node_modules", ".bin"), { recursive: true });
  await writeFile(path.join(root, "apps", "web", "wrangler.jsonc"), "{}\n");
  await writeFile(path.join(root, "apps", "cli", "package.json"), JSON.stringify({
    name: "@example/cli",
    version: "1.0.0",
    publishConfig: { access: "public" },
  }));
  await writeFile(path.join(root, ".env"), [
    "NPM_ACCESS_TOKEN=npm-secret-value",
    "CLOUDFLARE_API_TOKEN=cloudflare-secret-value",
    "GOOGLE_CLIENT_SECRET=must-not-cross-the-boundary",
    "",
  ].join("\n"), { mode: 0o600 });
  await writeFile(path.join(root, ".env.local"), [
    "CONVEX_DEPLOYMENT=dev:example",
    "CONVEX_URL=https://example.convex.cloud",
    "",
  ].join("\n"), { mode: 0o600 });
  return root;
}

test("repository deployment access discovers only fixed capabilities and safe source names", async () => {
  const root = await releaseRepository();
  const policy = await discoverRunnerDeploymentPolicy(root, "repository");
  assert.deepEqual(policy, {
    mode: "repository",
    capabilities: ["cloudflare", "convex", "github", "npm"],
    sources: [".env", ".env.local"],
  });
  assert.deepEqual(await discoverRunnerDeploymentPolicy(root, "disabled"), {
    mode: "disabled",
    capabilities: [],
    sources: [],
  });
});

test("deployment values cross only in memory and npm uses an owner-only placeholder file", async () => {
  const root = await releaseRepository();
  const jobRoot = await mkdtemp(path.join(os.tmpdir(), "dongo-release-job-"));
  const policy = await discoverRunnerDeploymentPolicy(root, "repository");
  const probes: Array<{ command: string; args: string[]; cwd: string; environment: NodeJS.ProcessEnv }> = [];
  const resolved = await resolveRunnerDeploymentEnvironment({
    trustedRepositoryRoot: root,
    jobRepositoryRoot: jobRoot,
    policy,
    hostEnvironment: {},
    githubEnvironment: { GH_TOKEN: "github-secret-value" },
    runProbe: async (probe) => {
      probes.push(probe);
      return true;
    },
  });
  assert.equal(resolved.environment.GH_TOKEN, "github-secret-value");
  assert.equal(resolved.environment.CONVEX_DEPLOYMENT, "dev:example");
  assert.equal(resolved.environment.CLOUDFLARE_API_TOKEN, "cloudflare-secret-value");
  assert.equal(resolved.environment.NPM_ACCESS_TOKEN, "npm-secret-value");
  assert.equal(resolved.environment.GOOGLE_CLIENT_SECRET, undefined);
  await assert.rejects(stat(path.join(jobRoot, ".env")), { code: "ENOENT" });
  await assert.rejects(stat(path.join(jobRoot, ".env.local")), { code: "ENOENT" });
  assert.deepEqual(probes.map(({ command, args }) => [path.basename(command), ...args]), [
    ["gh", "repo", "view", "--json", "nameWithOwner"],
    ["convex", "env", "list"],
    ["wrangler", "whoami"],
    ["npm", "whoami", "--registry", "https://registry.npmjs.org/"],
  ]);
  const npmConfig = resolved.environment.NPM_CONFIG_USERCONFIG;
  assert.ok(npmConfig);
  assert.equal((await lstat(npmConfig)).mode & 0o777, 0o600);
  const npmConfigContents = await readFile(npmConfig, "utf8");
  assert.match(npmConfigContents, /\$\{NPM_ACCESS_TOKEN\}/u);
  assert.doesNotMatch(npmConfigContents, /npm-secret-value/u);
  assert.doesNotMatch(JSON.stringify(policy), /secret|\/private|\/Users/u);
  await resolved.cleanup();
  await assert.rejects(lstat(npmConfig), { code: "ENOENT" });
});

test("missing and expired provider access fail before any harness can start", async () => {
  const root = await releaseRepository();
  const policy = await discoverRunnerDeploymentPolicy(root, "repository");
  await writeFile(path.join(root, ".env"), "CLOUDFLARE_API_TOKEN=cloudflare-secret-value\n", { mode: 0o600 });
  await assert.rejects(
    resolveRunnerDeploymentEnvironment({
      trustedRepositoryRoot: root,
      jobRepositoryRoot: root,
      policy,
      hostEnvironment: {},
      githubEnvironment: { GH_TOKEN: "github-secret-value" },
      runProbe: async () => true,
    }),
    (error: unknown) => error instanceof Error && error.message.includes("npm publishing credentials are missing"),
  );

  await writeFile(path.join(root, ".env"), [
    "NPM_ACCESS_TOKEN=npm-secret-value",
    "CLOUDFLARE_API_TOKEN=cloudflare-secret-value",
    "",
  ].join("\n"), { mode: 0o600 });
  await assert.rejects(
    resolveRunnerDeploymentEnvironment({
      trustedRepositoryRoot: root,
      jobRepositoryRoot: root,
      policy,
      hostEnvironment: {},
      githubEnvironment: { GH_TOKEN: "github-secret-value" },
      runProbe: async ({ command }) => !command.endsWith("wrangler"),
    }),
    (error: unknown) => error instanceof Error && error.message ===
      "Trusted Cloudflare deployment access is missing or expired on this computer. Refresh that provider's existing login, then retry the queued work.",
  );
});

test("changed or unsafe repository sources require fresh local approval", async () => {
  const root = await releaseRepository();
  const policy = await discoverRunnerDeploymentPolicy(root, "repository");
  await writeFile(path.join(root, ".env.production"), "CONVEX_DEPLOYMENT=prod:example\n");
  await symlink(path.join(root, ".env"), path.join(root, ".env.link"));
  await chmod(path.join(root, ".env"), 0o666);
  await assert.rejects(
    resolveRunnerDeploymentEnvironment({
      trustedRepositoryRoot: root,
      jobRepositoryRoot: root,
      policy,
      hostEnvironment: {},
      githubEnvironment: { GH_TOKEN: "github-secret-value" },
      runProbe: async () => true,
    }),
    /owner-controlled regular file/u,
  );
  await chmod(path.join(root, ".env"), 0o600);
  await writeFile(path.join(root, "package.json"), JSON.stringify({ publishConfig: { access: "public" } }));
  const narrowed = { ...policy, capabilities: policy.capabilities.filter((value) => value !== "npm") };
  await assert.rejects(
    resolveRunnerDeploymentEnvironment({
      trustedRepositoryRoot: root,
      jobRepositoryRoot: root,
      policy: narrowed,
      hostEnvironment: {},
      githubEnvironment: { GH_TOKEN: "github-secret-value" },
      runProbe: async () => true,
    }),
    /configuration changed/u,
  );
});

test("runner log redaction removes every injected secret without exposing policy values", () => {
  assert.equal(
    redactRunnerSecrets(
      "github-secret-value cloudflare-secret-value npm-secret-value",
      ["github-secret-value", "cloudflare-secret-value", "npm-secret-value"],
    ),
    "[redacted] [redacted] [redacted]",
  );
});
