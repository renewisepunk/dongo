import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const failures = [];
const expectedWorkerNames = new Map([
  ["apps/api/wrangler.jsonc", "dongo-api-dev"],
  ["apps/auth/wrangler.jsonc", "dongo-auth-dev"],
  ["apps/files/wrangler.jsonc", "dongo-files-dev"],
  ["apps/mcp/wrangler.jsonc", "dongo-mcp"],
  ["apps/notifications/wrangler.jsonc", "dongo-notifications-dev"],
  ["apps/web/wrangler.jsonc", "dongo-web-dev"],
]);
const appConfigs = readdirSync("apps", { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join("apps", entry.name, "wrangler.jsonc"))
  .filter((path) => existsSync(path))
  .sort();

for (const path of appConfigs) {
  const contents = readFileSync(path, "utf8");
  const workerName = contents.match(/"name"\s*:\s*"([^"]+)"/u)?.[1];
  if (workerName !== expectedWorkerNames.get(path)) {
    failures.push(`${path}: development Worker identity changed`);
  }
  for (const match of contents.matchAll(/"pattern"\s*:\s*"([^"]+)"/gu)) {
    const pattern = match[1];
    if (pattern !== "dev.dongo.so" && !pattern?.startsWith("dev.dongo.so/")) {
      failures.push(`${path}: development route targets ${pattern}`);
    }
  }
  if (/"https:\/\/dongo\.so(?:\/|"|$)/u.test(contents)) {
    failures.push(`${path}: development config contains the production origin`);
  }
  if (
    /"CONVEX_[A-Z_]+"\s*:/u.test(contents) &&
    !contents.includes("wandering-camel-662")
  ) {
    failures.push(`${path}: Convex binding is not the named development deployment`);
  }
}
for (const path of expectedWorkerNames.keys()) {
  if (!appConfigs.includes(path)) failures.push(`${path}: development Worker config is missing`);
}

const landingConfig = readFileSync("wrangler.jsonc", "utf8");
const landingRoutes = [...landingConfig.matchAll(/"pattern"\s*:\s*"([^"]+)"/gu)]
  .map((match) => match[1])
  .sort();
if (!/"name"\s*:\s*"dongo-coming-soon"/u.test(landingConfig)) {
  failures.push("wrangler.jsonc: production landing Worker identity changed");
}
if (JSON.stringify(landingRoutes) !== JSON.stringify(["dongo.so", "www.dongo.so"])) {
  failures.push("wrangler.jsonc: production landing routes changed");
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
if (packageJson.scripts?.deploy !== "npm run deploy:landing") {
  failures.push("package.json: default deploy must remain the landing deploy");
}
if (packageJson.scripts?.["deploy:dev"] !== "npm run deploy --workspace @dongo/web") {
  failures.push("package.json: development deploy must remain explicitly scoped to the web app");
}

if (failures.length > 0) {
  console.error("Environment boundary verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Development routes are isolated across ${appConfigs.length} Workers; production remains the landing Worker.`,
  );
}
