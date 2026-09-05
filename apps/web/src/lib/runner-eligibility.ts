import type {
  ProjectConcurrencySnapshot,
  RunnerJob,
  RunnerRegistration,
  RunnerSnapshot,
} from "./project-data";

export type IntakeRunnerEligibility = {
  code:
    | "queued"
    | "delivered"
    | "awaiting_local_approval"
    | "starting"
    | "running"
    | "blocked"
    | "cancel_requested"
    | "cancelled"
    | "failed"
    | "expired"
    | "no_runner"
    | "automatic_pickup_disabled"
    | "configured_runner_unavailable"
    | "runner_offline"
    | "approval_required"
    | "incompatible_harness"
    | "capacity_full"
    | "not_queued";
  label: string;
  detail: string;
  tone: "amber" | "green" | "danger";
};

const ACTIVE_JOB_STATES = new Set<RunnerJob["state"]>([
  "queued",
  "delivered",
  "awaiting_local_approval",
  "starting",
  "running",
  "blocked",
  "cancel_requested",
]);

function isOnline(registration: RunnerRegistration, serverTime: number): boolean {
  return registration.status === "active" && (
    (registration.waitingUntil !== undefined && registration.waitingUntil > serverTime)
    || (registration.lastSeenAt !== undefined && registration.lastSeenAt >= serverTime - 45_000)
  );
}

function runnerName(registration: RunnerRegistration | undefined): string {
  return registration?.label || "Configured runner";
}

function lastSeenDetail(registration: RunnerRegistration, serverTime: number): string {
  if (registration.lastSeenAt === undefined) return "It has not checked in yet.";
  const elapsedSeconds = Math.max(0, Math.floor((serverTime - registration.lastSeenAt) / 1_000));
  if (elapsedSeconds < 60) return `Last checked in ${elapsedSeconds} seconds ago.`;
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  return `Last checked in ${elapsedMinutes} minute${elapsedMinutes === 1 ? "" : "s"} ago.`;
}

function activeIntakeJob(intakeId: string, snapshot: RunnerSnapshot): RunnerJob | undefined {
  const jobs = snapshot.jobs
    .filter((job) => job.kind === "intake" && job.intakeId === intakeId)
    .sort((left, right) => right.updatedAt - left.updatedAt);
  return jobs.find((job) => ACTIVE_JOB_STATES.has(job.state))
    ?? jobs.find((job) => job.state === "failed" || job.state === "expired" || job.state === "cancelled");
}

export function intakeRunnerEligibility(
  intakeId: string,
  snapshot: RunnerSnapshot,
  concurrency?: ProjectConcurrencySnapshot,
): IntakeRunnerEligibility {
  const job = activeIntakeJob(intakeId, snapshot);
  const jobRunner = snapshot.registrations.find((runner) =>
    runner.id === (job?.registrationId ?? job?.targetRegistrationId));
  if (job) {
    const label = runnerName(jobRunner);
    switch (job.state) {
      case "queued":
        if (jobRunner && !isOnline(jobRunner, snapshot.serverTime)) {
          return { code: "runner_offline", label: `${label} is offline`, detail: `${lastSeenDetail(jobRunner, snapshot.serverTime)} The job remains queued until that runner is online.`, tone: "amber" };
        }
        return { code: "queued", label: `queued for ${label}`, detail: "The web view is live. A healthy local runner picks up queued work on its next bounded pull, within 20 seconds.", tone: "amber" };
      case "delivered":
        return { code: "delivered", label: `delivered to ${label}`, detail: "The runner has received the job and is preparing the local agent session.", tone: "amber" };
      case "awaiting_local_approval":
        return { code: "awaiting_local_approval", label: `waiting for approval on ${label}`, detail: "Approve the queued job on that computer, or change this project's local runner to automatic approval.", tone: "amber" };
      case "starting":
        return { code: "starting", label: `${label} is starting the agent`, detail: "The runner is creating the isolated workspace and launching the selected agent harness.", tone: "amber" };
      case "running":
        return { code: "running", label: `agent running on ${label}`, detail: "The local runner accepted this Intake and the agent is now working.", tone: "green" };
      case "blocked":
        return { code: "blocked", label: `${label} needs attention`, detail: job.safeMessage || "The local job is blocked. Open Local runner settings for the safe diagnostic and recovery action.", tone: "danger" };
      case "cancel_requested":
        return { code: "cancel_requested", label: `cancelling on ${label}`, detail: "dongo has requested cancellation and is waiting for the local runner to confirm it.", tone: "amber" };
      case "failed":
        return { code: "failed", label: `local job failed on ${label}`, detail: job.safeMessage || "Open Local runner settings for the safe diagnostic and retry action.", tone: "danger" };
      case "expired":
        return { code: "expired", label: `local job expired on ${label}`, detail: "The runner did not claim or finish the job before its bounded expiry. Check the runner and retry pickup.", tone: "danger" };
      case "cancelled":
        return { code: "cancelled", label: `local job cancelled on ${label}`, detail: "Queue this Intake again when you want a local agent to process it.", tone: "amber" };
      default:
        break;
    }
  }

  const policy = snapshot.automaticIntake;
  const activeRunners = snapshot.registrations.filter((runner) => runner.status === "active");
  if (activeRunners.length === 0) {
    return { code: "no_runner", label: "no runner connected to this project", detail: "Install and start a local runner from this exact repository. A runner connected to another project or account cannot pick this up.", tone: "amber" };
  }
  if (!policy.enabled) {
    return { code: "automatic_pickup_disabled", label: "automatic pickup is off", detail: "This project has a runner, but new Inbox items are not queued automatically. Enable automatic Inbox pickup in Local runner settings.", tone: "amber" };
  }
  const target = activeRunners.find((runner) => runner.id === policy.registrationId);
  if (!target) {
    return { code: "configured_runner_unavailable", label: "configured runner is unavailable", detail: "The automatic pickup target was removed or revoked. Select an active runner for this project.", tone: "danger" };
  }
  if (policy.harness && !target.harnesses.includes(policy.harness)) {
    return { code: "incompatible_harness", label: `${runnerName(target)} cannot run ${policy.harness === "claude" ? "Claude Code" : "Codex"}`, detail: "Select a harness installed on the configured runner, or reconnect the runner after installing it.", tone: "danger" };
  }
  if (target.approvalMode !== "automatic") {
    return { code: "approval_required", label: `${runnerName(target)} requires local approval`, detail: "Automatic Inbox pickup requires that runner to use automatic approval.", tone: "amber" };
  }
  if (!isOnline(target, snapshot.serverTime)) {
    return { code: "runner_offline", label: `${runnerName(target)} is offline`, detail: `${lastSeenDetail(target, snapshot.serverTime)} Start or repair the runner on that computer.`, tone: "amber" };
  }
  if (concurrency && concurrency.capacity.remaining === 0) {
    return { code: "capacity_full", label: `all ${concurrency.capacity.maxConcurrentRuns} agent slots are busy`, detail: "Automatic pickup can proceed after another Run finishes and capacity becomes available.", tone: "amber" };
  }
  return { code: "not_queued", label: "not queued for automatic pickup", detail: "The runner is online, but no active local job exists for this Intake. Re-save automatic pickup or queue it from Local runner settings.", tone: "danger" };
}
