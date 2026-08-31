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

const availabilityWorkflowPath = ".github/workflows/dev-availability.yml";
let availabilityWorkflow = "";
try {
  availabilityWorkflow = readFileSync(availabilityWorkflowPath, "utf8");
} catch {
  failures.push(`${availabilityWorkflowPath}: exact development availability workflow is missing`);
}

const requiredWorkflowFragments = [
  'cron: "17,47 * * * *"',
  "workflow_dispatch:",
  "contents: read",
  "cancel-in-progress: false",
  "node scripts/smoke-dev.mjs --project-ref p58de816-dongo",
  "github.event_name == 'workflow_dispatch' && inputs.exercise_failure",
  "Synthetic dongo development alert",
];

for (const fragment of requiredWorkflowFragments) {
  if (availabilityWorkflow && !availabilityWorkflow.includes(fragment)) {
    failures.push(`${availabilityWorkflowPath}: missing required fragment ${JSON.stringify(fragment)}`);
  }
}

for (const prohibitedFragment of [
  "secrets.",
  "DONGO_TOKEN",
  "smoke:boundaries",
  "https://dongo.so",
  "pull_request:",
  "push:",
]) {
  if (availabilityWorkflow.includes(prohibitedFragment)) {
    failures.push(
      `${availabilityWorkflowPath}: prohibited fragment ${JSON.stringify(prohibitedFragment)}`,
    );
  }
}

if (failures.length > 0) {
  console.error("Development observability verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Development logs and traces are explicitly configured across ${developmentConfigs.length} Workers; the exact scheduled availability workflow is bounded and credential-free.`,
  );
}
