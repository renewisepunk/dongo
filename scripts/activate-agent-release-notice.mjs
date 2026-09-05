import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CURRENT_AGENT_RELEASE_NOTICE } from "../packages/mcp/src/release-notice.ts";
import { requireRunnerMutationAllowed } from "./runner-mutation-guard.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executable = process.platform === "win32" ? "npx.cmd" : "npx";
const args = JSON.stringify({
  releaseId: CURRENT_AGENT_RELEASE_NOTICE.id,
  releaseSequence: CURRENT_AGENT_RELEASE_NOTICE.sequence,
});
try {
  requireRunnerMutationAllowed(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : "dongo runner mutation guard failed.");
  process.exit(6);
}
const result = spawnSync(
  executable,
  ["convex", "run", "operators/agentReleaseNotice:activate", args, "--prod"],
  {
    cwd: root,
    env: { ...process.env, CI: "true" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  },
);
if (result.error) {
  console.error("Agent release notice activation could not start.");
  process.exit(1);
}
if (result.status !== 0) {
  console.error("Agent release notice activation failed.");
  process.exit(result.status ?? 1);
}
let activated;
try {
  activated = JSON.parse(result.stdout.trim());
} catch {
  console.error("Agent release notice activation returned an invalid response.");
  process.exit(1);
}
if (
  activated?.releaseId !== CURRENT_AGENT_RELEASE_NOTICE.id ||
  activated?.releaseSequence !== CURRENT_AGENT_RELEASE_NOTICE.sequence
) {
  console.error("Agent release notice activation did not confirm the reviewed marker.");
  process.exit(1);
}
console.log(JSON.stringify({
  ok: true,
  activated: activated.activated,
  releaseId: activated.releaseId,
  releaseSequence: activated.releaseSequence,
}));
