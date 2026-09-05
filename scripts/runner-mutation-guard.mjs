import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

export function requireRunnerMutationAllowed(environment = process.env) {
  const guardPath = environment.DONGO_RUNNER_MUTATION_GUARD_FILE;
  const jobId = environment.DONGO_RUNNER_JOB_ID;
  if (!guardPath && !jobId) return { managed: false };
  if (!guardPath || !jobId || !isAbsolute(guardPath) || !/^[A-Za-z0-9_-]{1,200}$/u.test(jobId)) {
    throw new Error("The dongo runner mutation guard is incomplete; external mutation is disabled.");
  }
  let info;
  try {
    info = lstatSync(guardPath);
  } catch (error) {
    if (error?.code === "ENOENT") return { managed: true, jobId };
    throw new Error("The dongo runner mutation guard could not be verified; external mutation is disabled.");
  }
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && info.uid !== process.getuid())) {
    throw new Error("The dongo runner mutation guard is unsafe; external mutation is disabled.");
  }
  let value;
  try {
    value = JSON.parse(readFileSync(guardPath, "utf8"));
  } catch {
    throw new Error("The dongo runner mutation guard is invalid; external mutation is disabled.");
  }
  if (value?.schemaVersion !== 1 || value?.jobId !== jobId || typeof value?.quarantinedAt !== "string") {
    throw new Error("The dongo runner mutation guard does not match this job; external mutation is disabled.");
  }
  throw new Error("This dongo runner job is quarantined; no new external mutation may start.");
}
