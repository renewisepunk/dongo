import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { requireReleaseConvexTarget } from "./release-convex-target.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executable = (name) => process.platform === "win32" ? `${name}.cmd` : name;
const productionPublicProjectRef = "ps8dhbky-dongo-production-e2e";
const changelogCurationReminder = [
  "Review significant completed Work for the public changelog.",
  "Publish only exact owner-approved wording, or record",
  "`Public changelog: intentionally skipped` with a non-sensitive reason on the release Work.",
].join(" ");
const preflightSteps = [
  ["agent release notice preflight", executable("node"), ["scripts/verify-agent-release-notice.mjs"]],
  ["public CLI release preflight", executable("node"), ["scripts/release-cli.mjs", "--preflight"]],
];
const steps = [
  ["Convex production functions", executable("npx"), ["convex", "deploy", "--yes", "--message", "dongo production release"]],
  ["production auth migrations", executable("npx"), ["wrangler", "d1", "migrations", "apply", "AUTH_DB", "--remote", "--config", "apps/auth/wrangler.jsonc", "--env", "production"]],
  ["production authorization Worker", executable("npx"), ["wrangler", "deploy", "--config", "apps/auth/wrangler.jsonc", "--env", "production"]],
  ["production agent API Worker", executable("npx"), ["wrangler", "deploy", "--config", "apps/api/wrangler.jsonc", "--env", "production"]],
  ["production MCP Worker", executable("npx"), ["wrangler", "deploy", "--config", "apps/mcp/wrangler.jsonc", "--env", "production"]],
  ["production attachment Worker", executable("npx"), ["wrangler", "deploy", "--config", "apps/files/wrangler.jsonc", "--env", "production"]],
  ["production notification Worker", executable("npx"), ["wrangler", "deploy", "--config", "apps/notifications/wrangler.jsonc", "--env", "production"]],
  ["production web application", executable("node"), ["scripts/deploy-production-web.mjs"]],
  ["production public smoke gate", executable("node"), [
    "scripts/smoke-production.mjs",
    "--project-ref",
    productionPublicProjectRef,
  ]],
  ["public CLI release", executable("node"), ["scripts/release-cli.mjs", "--publish"]],
  ["agent release notice activation", executable("node"), ["scripts/activate-agent-release-notice.mjs"]],
];

if (!existsSync(resolve(root, "package.json")) || !existsSync(resolve(root, "convex/schema.ts"))) {
  console.error("The production deploy must run from the dongo repository.");
  process.exit(2);
}

let releaseTarget;
try {
  releaseTarget = requireReleaseConvexTarget({ root, stage: "production" });
} catch (error) {
  console.error(error instanceof Error ? error.message : "Production release target preflight failed.");
  process.exit(2);
}
const productionEnvironment = {
  ...releaseTarget.environment,
  CI: "true",
  CLOUDFLARE_ENV: "production",
};

if (process.argv.includes("--plan")) {
  console.log(`Convex target preflight: ${releaseTarget.target} (${releaseTarget.source})`);
  for (const [label, command, args] of [...preflightSteps, ...steps]) {
    console.log(`${label}: ${command} ${args.join(" ")}`);
  }
  console.log(`post-release changelog curation: ${changelogCurationReminder}`);
  process.exit(0);
}

const status = spawnSync("git", ["status", "--porcelain"], {
  cwd: root,
  encoding: "utf8",
});
if (status.status !== 0 || status.stdout.trim() !== "") {
  console.error("Production deploy requires a clean, committed worktree.");
  process.exit(2);
}

for (const [label, command, args] of [...preflightSteps, ...steps]) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: productionEnvironment,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`${label} could not start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`${label} failed; later production services were not deployed.`);
    process.exit(result.status ?? 1);
  }
}

console.log("\nProduction stack deployed and smoke-checked; its public CLI release was reconciled before the matching agent notice was activated.");
console.log(`Post-release changelog curation: ${changelogCurationReminder}`);
