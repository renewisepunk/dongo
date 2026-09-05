import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { requireReleaseConvexTarget } from "./release-convex-target.mjs";
import { requireRunnerMutationAllowed } from "./runner-mutation-guard.mjs";

const root = process.cwd();
const executable = (name) => process.platform === "win32" ? `${name}.cmd` : name;
const steps = [
  ["Convex functions", executable("npx"), ["convex", "dev", "--once"]],
  ["authorization Worker", executable("npx"), ["wrangler", "deploy", "--config", "apps/auth/wrangler.jsonc"]],
  ["agent API Worker", executable("npx"), ["wrangler", "deploy", "--config", "apps/api/wrangler.jsonc"]],
  ["MCP Worker", executable("npx"), ["wrangler", "deploy", "--config", "apps/mcp/wrangler.jsonc"]],
  ["attachment Worker", executable("npx"), ["wrangler", "deploy", "--config", "apps/files/wrangler.jsonc"]],
  ["notification Worker", executable("npx"), ["wrangler", "deploy", "--config", "apps/notifications/wrangler.jsonc"]],
  ["web build", executable("npm"), ["run", "build", "--workspace", "@dongo/web"]],
  ["web Worker", executable("npx"), ["wrangler", "deploy", "--config", "apps/web/dist/server/wrangler.json"]],
];

if (!existsSync(resolve(root, "package.json")) || !existsSync(resolve(root, "convex/schema.ts"))) {
  console.error("Run the development deploy from the dongo repository root.");
  process.exit(2);
}

let releaseTarget;
try {
  releaseTarget = requireReleaseConvexTarget({ root, stage: "development" });
} catch (error) {
  console.error(error instanceof Error ? error.message : "Development release target preflight failed.");
  process.exit(2);
}

if (process.argv.includes("--plan")) {
  console.log(`Convex target preflight: ${releaseTarget.target} (${releaseTarget.source})`);
  for (const [label, command, args] of steps) {
    console.log(`${label}: ${command} ${args.join(" ")}`);
  }
  process.exit(0);
}

for (const [label, command, args] of steps) {
  try {
    requireRunnerMutationAllowed(releaseTarget.environment);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "dongo runner mutation guard failed.");
    process.exit(6);
  }
  console.log(`\n==> Deploying ${label} to development`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: releaseTarget.environment,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`${label} could not start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`${label} failed; later development services were not deployed.`);
    process.exit(result.status ?? 1);
  }
}

console.log("\nDevelopment stack deployed coherently. Run both smoke gates before accepting it.");
