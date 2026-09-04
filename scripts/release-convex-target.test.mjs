import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { requireReleaseConvexTarget } from "./release-convex-target.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const deployDev = fileURLToPath(new URL("./deploy-dev.mjs", import.meta.url));
const deployProduction = fileURLToPath(new URL("./deploy-production.mjs", import.meta.url));

test("development release requires the exact named remote target", () => {
  assert.throws(
    () => requireReleaseConvexTarget({ root: repositoryRoot, stage: "development", environment: {} }),
    /CONVEX_DEPLOYMENT is missing[\s\S]*dev:wandering-camel-662[\s\S]*local Convex fallback is forbidden/u,
  );
  assert.throws(
    () => requireReleaseConvexTarget({
      root: repositoryRoot,
      stage: "development",
      environment: { CONVEX_DEPLOYMENT: "local:local-dongo" },
    }),
    /does not select the expected named target dev:wandering-camel-662/u,
  );
});

test("production release rejects cross-environment selectors and deploy keys without exposing them", () => {
  const secret = "prod:not-the-target|do-not-print-this-secret";
  assert.throws(
    () => requireReleaseConvexTarget({
      root: repositoryRoot,
      stage: "production",
      environment: {
        CONVEX_DEPLOYMENT: "prod:brainy-camel-172",
        CONVEX_DEPLOY_KEY: secret,
      },
    }),
    (error) => {
      assert.match(error.message, /CONVEX_DEPLOY_KEY[\s\S]*cannot be verified/u);
      assert.doesNotMatch(error.message, /do-not-print-this-secret/u);
      return true;
    },
  );
});

test("an isolated worktree can resolve an owner-controlled ignored selector without printing adjacent secrets", async () => {
  const root = await fixtureRoot();
  const secret = "secret-that-must-stay-private";
  try {
    await writeFile(join(root, ".env.local"), [
      "CONVEX_DEPLOYMENT=dev:wandering-camel-662",
      `UNRELATED_SECRET=${secret}`,
      "",
    ].join("\n"), { mode: 0o600 });
    const result = spawnSync(process.execPath, [deployDev, "--plan"], {
      cwd: root,
      env: environmentWithoutConvex(),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Convex target preflight: dev:wandering-camel-662 \(\.env\.local\)/u);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(secret, "u"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a Convex-generated local selector stops development before any child command", async () => {
  const root = await fixtureRoot();
  try {
    await writeFile(join(root, ".env.local"), "CONVEX_DEPLOYMENT=local:local-dongo\n", { mode: 0o600 });
    const marker = join(root, "spawned");
    const bin = await fakeCommandDirectory(marker, root);
    const result = spawnSync(process.execPath, [deployDev], {
      cwd: root,
      env: { ...environmentWithoutConvex(), PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` },
      encoding: "utf8",
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /blocked before mutation[\s\S]*Local, cross-environment, and unknown targets are forbidden/u);
    await assert.rejects(readFile(marker), /ENOENT/u);
    assert.equal(await readFile(join(root, ".env.local"), "utf8"), "CONVEX_DEPLOYMENT=local:local-dongo\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the in-memory trusted bridge overrides a stale generated local selector", async () => {
  const root = await fixtureRoot();
  try {
    await writeFile(join(root, ".env.local"), "CONVEX_DEPLOYMENT=local:local-dongo\n", { mode: 0o600 });
    const resolved = requireReleaseConvexTarget({
      root,
      stage: "development",
      environment: { CONVEX_DEPLOYMENT: "dev:wandering-camel-662" },
    });
    assert.equal(resolved.target, "dev:wandering-camel-662");
    assert.equal(resolved.source, "process environment");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("production rejects a missing or mismatched selector before git or release preflights run", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "dongo-production-target-test-"));
  const marker = join(temporaryRoot, "spawned");
  try {
    const bin = await fakeCommandDirectory(marker, temporaryRoot);
    for (const selector of [undefined, "dev:wandering-camel-662"]) {
      await rm(marker, { force: true });
      const environment = { ...environmentWithoutConvex(), PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` };
      if (selector) environment.CONVEX_DEPLOYMENT = selector;
      const result = spawnSync(process.execPath, [deployProduction], {
        cwd: temporaryRoot,
        env: environment,
        encoding: "utf8",
      });
      assert.equal(result.status, 2);
      assert.match(result.stderr, /Production release blocked before mutation/u);
      await assert.rejects(readFile(marker), /ENOENT/u);
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("production plan accepts only the explicit named production target and remains non-mutating", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "dongo-production-plan-test-"));
  const marker = join(temporaryRoot, "spawned");
  try {
    const bin = await fakeCommandDirectory(marker, temporaryRoot);
    const result = spawnSync(process.execPath, [deployProduction, "--plan"], {
      cwd: temporaryRoot,
      env: {
        ...environmentWithoutConvex(),
        PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
        CONVEX_DEPLOYMENT: "prod:brainy-camel-172",
      },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Convex target preflight: prod:brainy-camel-172 \(process environment\)/u);
    await assert.rejects(readFile(marker), /ENOENT/u);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("unsafe ignored configuration is rejected even when it names the correct target", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX file ownership and mode assertion");
  const root = await fixtureRoot();
  try {
    const source = join(root, "target.env");
    await writeFile(source, "CONVEX_DEPLOYMENT=dev:wandering-camel-662\n", { mode: 0o600 });
    await symlink(source, join(root, ".env.local"));
    assert.throws(
      () => requireReleaseConvexTarget({ root, stage: "development", environment: {} }),
      /owner-controlled[\s\S]*regular file/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), "dongo-isolated-release-test-"));
  await mkdir(join(root, "convex"));
  await writeFile(join(root, "package.json"), "{}\n");
  await writeFile(join(root, "convex", "schema.ts"), "export {};\n");
  return root;
}

async function fakeCommandDirectory(marker, parent) {
  const bin = join(parent ?? await mkdtemp(join(tmpdir(), "dongo-fake-release-bin-")), "bin");
  await mkdir(bin, { recursive: true });
  for (const name of ["git", "npx", "npm"]) {
    const target = join(bin, name);
    await writeFile(target, `#!/bin/sh\nprintf invoked > '${marker}'\nexit 99\n`);
    await chmod(target, 0o700);
  }
  return bin;
}

function environmentWithoutConvex() {
  const environment = { ...process.env };
  delete environment.CONVEX_DEPLOYMENT;
  delete environment.CONVEX_DEPLOY_KEY;
  return environment;
}
