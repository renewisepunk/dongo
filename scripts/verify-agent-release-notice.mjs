import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CURRENT_AGENT_RELEASE_NOTICE } from "../packages/mcp/src/release-notice.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const noticePath = "packages/mcp/src/release-notice.ts";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}
function git(args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  invariant(result.status === 0, "Agent release notice history is unavailable.");
  return result.stdout;
}

function marker(source) {
  const sequence = /\bsequence:\s*(\d+),/u.exec(source)?.[1];
  const id = /\bid:\s*"([a-z0-9][a-z0-9._-]{0,79})",/u.exec(source)?.[1];
  invariant(sequence !== undefined && id !== undefined, "Agent release notice marker is invalid.");
  return { sequence: Number(sequence), id };
}

export function verifyAgentReleaseNotice() {
  const cliPackage = JSON.parse(
    readFileSync(resolve(root, "apps/cli/package.json"), "utf8"),
  );
  invariant(
    CURRENT_AGENT_RELEASE_NOTICE.cli.version === cliPackage.version,
    "Agent release notice CLI version must match apps/cli/package.json.",
  );
  invariant(
    CURRENT_AGENT_RELEASE_NOTICE.cli.installCommand ===
      `npm install --global @wisepunk/dongo@${cliPackage.version}`,
    "Agent release notice must use the exact pinned public CLI command.",
  );

  const currentSource = readFileSync(resolve(root, noticePath), "utf8");
  const revisions = git(["log", "--format=%H", "--", noticePath])
    .trim()
    .split("\n")
    .filter(Boolean);
  let priorSource;
  if (revisions[0] !== undefined) {
    const latestSource = git(["show", `${revisions[0]}:${noticePath}`]);
    if (latestSource !== currentSource) {
      priorSource = latestSource;
    } else if (revisions[1] !== undefined) {
      priorSource = git(["show", `${revisions[1]}:${noticePath}`]);
    }
  }
  if (priorSource !== undefined && priorSource !== currentSource) {
    const prior = marker(priorSource);
    invariant(
      CURRENT_AGENT_RELEASE_NOTICE.sequence > prior.sequence,
      "Changed agent release metadata must increase its monotonic sequence.",
    );
    invariant(
      CURRENT_AGENT_RELEASE_NOTICE.id !== prior.id,
      "Changed agent release metadata must use a new release identifier.",
    );
  }

  return {
    ok: true,
    id: CURRENT_AGENT_RELEASE_NOTICE.id,
    sequence: CURRENT_AGENT_RELEASE_NOTICE.sequence,
    cliVersion: CURRENT_AGENT_RELEASE_NOTICE.cli.version,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(verifyAgentReleaseNotice()));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Agent release notice verification failed.");
    process.exit(1);
  }
}
