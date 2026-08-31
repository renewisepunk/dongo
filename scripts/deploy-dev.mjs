import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const executable = (name) => process.platform === "win32" ? `${name}.cmd` : name;
const steps = [
  ["Convex functions", executable("npx"), ["convex", "dev", "--once"]],
  ["authorization Worker", executable("npx"), ["wrangler", "deploy", "--config", "apps/auth/wrangler.jsonc"]],
  ["agent API Worker", executable("npx"), ["wrangler", "deploy", "--config", "apps/api/wrangler.jsonc"]],
  ["MCP Worker", executable("npx"), ["wrangler", "deploy", "--config", "apps/mcp/wrangler.jsonc"]],
  ["attachment Worker", executable("npx"), ["wrangler", "deploy", "--config", "apps/files/wrangler.jsonc"]],
  ["notification Worker", executable("npx"), ["wrangler", "deploy", "--config", "apps/notifications/wrangler.jsonc"]],
  ["web Worker", executable("npm"), ["run", "deploy", "--workspace", "@dongo/web"]],
];

if (!existsSync(resolve(root, "package.json")) || !existsSync(resolve(root, "convex/schema.ts"))) {
  console.error("Run the development deploy from the dongo repository root.");
  process.exit(2);
}

if (process.argv.includes("--plan")) {
  for (const [label, command, args] of steps) {
    console.log(`${label}: ${command} ${args.join(" ")}`);
  }
  process.exit(0);
}

for (const [label, command, args] of steps) {
  console.log(`\n==> Deploying ${label} to development`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
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
