import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executable = (name) => process.platform === "win32" ? `${name}.cmd` : name;
const productionEnvironment = {
  ...process.env,
  CI: "true",
  CLOUDFLARE_ENV: "production",
};
const steps = [
  ["Convex production functions", executable("npx"), ["convex", "deploy", "--message", "dongo production release"]],
  ["production auth migrations", executable("npx"), ["wrangler", "d1", "migrations", "apply", "AUTH_DB", "--remote", "--config", "apps/auth/wrangler.jsonc", "--env", "production"]],
  ["production authorization Worker", executable("npx"), ["wrangler", "deploy", "--config", "apps/auth/wrangler.jsonc", "--env", "production"]],
  ["production agent API Worker", executable("npx"), ["wrangler", "deploy", "--config", "apps/api/wrangler.jsonc", "--env", "production"]],
  ["production MCP Worker", executable("npx"), ["wrangler", "deploy", "--config", "apps/mcp/wrangler.jsonc", "--env", "production"]],
  ["production attachment Worker", executable("npx"), ["wrangler", "deploy", "--config", "apps/files/wrangler.jsonc", "--env", "production"]],
  ["production notification Worker", executable("npx"), ["wrangler", "deploy", "--config", "apps/notifications/wrangler.jsonc", "--env", "production"]],
  ["production web application", executable("node"), ["scripts/deploy-production-web.mjs"]],
];

if (!existsSync(resolve(root, "package.json")) || !existsSync(resolve(root, "convex/schema.ts"))) {
  console.error("The production deploy must run from the dongo repository.");
  process.exit(2);
}

if (process.argv.includes("--plan")) {
  for (const [label, command, args] of steps) {
    console.log(`${label}: ${command} ${args.join(" ")}`);
  }
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

for (const [label, command, args] of steps) {
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

console.log("\nProduction stack deployed. Run the production smoke gate before announcing availability.");
