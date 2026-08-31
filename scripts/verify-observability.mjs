import { readFileSync } from "node:fs";

const developmentConfigs = [
  "apps/api/wrangler.jsonc",
  "apps/auth/wrangler.jsonc",
  "apps/files/wrangler.jsonc",
  "apps/mcp/wrangler.jsonc",
  "apps/notifications/wrangler.jsonc",
  "apps/web/wrangler.jsonc",
];

const failures = [];

for (const path of developmentConfigs) {
  let config;
  try {
    config = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    failures.push(`${path}: configuration is not parseable JSONC without comments`);
    continue;
  }

  const observability = config.observability;
  if (observability?.enabled !== true) {
    failures.push(`${path}: observability must be enabled`);
  }
  if (
    observability?.logs?.enabled !== true ||
    observability.logs.invocation_logs !== true ||
    observability.logs.head_sampling_rate !== 1
  ) {
    failures.push(`${path}: persistent invocation logs must be explicitly enabled at rate 1`);
  }
  const traceRate = observability?.traces?.head_sampling_rate;
  if (
    observability?.traces?.enabled !== true ||
    typeof traceRate !== "number" ||
    traceRate < 0.01 ||
    traceRate > 0.05
  ) {
    failures.push(`${path}: persistent traces must be explicitly enabled at a 0.01–0.05 rate`);
  }
}

if (failures.length > 0) {
  console.error("Development observability verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Development logs and traces are explicitly configured across ${developmentConfigs.length} Workers.`,
  );
}
