import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { requireRunnerMutationAllowed } from "./runner-mutation-guard.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executable = (name) => process.platform === "win32" ? `${name}.cmd` : name;
const productionEnvironment = {
  ...process.env,
  CLOUDFLARE_ENV: "production",
  VITE_CONVEX_URL: "https://brainy-camel-172.convex.cloud",
  VITE_CONVEX_SITE_URL: "https://brainy-camel-172.convex.site",
  VITE_DONGO_ENVIRONMENT: "production",
  VITE_DONGO_PUBLIC_ORIGIN: "https://dongo.so",
  VITE_DONGO_GOOGLE_AUTH_CONFIGURED: "true",
};
const deployEnvironment = { ...productionEnvironment };
delete deployEnvironment.CLOUDFLARE_ENV;
const steps = [
  ["production web build", executable("npm"), ["run", "build", "--workspace", "@dongo/web"], productionEnvironment],
  ["production web Worker", executable("npx"), ["wrangler", "deploy", "--config", "apps/web/dist/server/wrangler.json"], deployEnvironment],
];

if (!existsSync(resolve(root, "apps/web/wrangler.jsonc"))) {
  console.error("The production web deploy must run from the dongo repository.");
  process.exit(2);
}

if (process.argv.includes("--plan")) {
  for (const [label, command, args, environment] of steps) {
    const prefix = environment.CLOUDFLARE_ENV ? "CLOUDFLARE_ENV=production " : "";
    console.log(`${label}: ${prefix}${command} ${args.join(" ")}`);
  }
  process.exit(0);
}

for (const [label, command, args, environment] of steps) {
  try {
    requireRunnerMutationAllowed(environment);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "dongo runner mutation guard failed.");
    process.exit(6);
  }
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: environment,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`${label} could not start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`${label} failed.`);
    process.exit(result.status ?? 1);
  }
}
