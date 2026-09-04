import type { CoreService, RunnerBrowserReviewMode, RunnerDeploymentPolicy, RunnerLocalState } from "@dongo/cli-core";
import type { RunnerApprovalMode, RunnerHarness } from "@dongo/contracts";

type RunnerInstallResult = Awaited<ReturnType<CoreService["runnerInstall"]>>;
type RunnerStatusResult = Awaited<ReturnType<CoreService["runnerStatus"]>>;
type RunnerApproveResult = Awaited<ReturnType<CoreService["runnerApprove"]>>;
type RunnerConfigureResult = Awaited<ReturnType<CoreService["runnerConfigure"]>>;

function harnessLabel(harness: RunnerHarness): string {
  return harness === "codex" ? "Codex" : "Claude Code";
}

function naturalList(values: string[]): string {
  if (values.length === 0) return "your configured agent";
  if (values.length === 1) return values[0] ?? "your configured agent";
  return `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`;
}

function agentLabel(harnesses: RunnerHarness[]): string {
  return naturalList(harnesses.map(harnessLabel));
}

function approvalExplanation(mode: RunnerApprovalMode | undefined): string {
  return mode === "automatic"
    ? "Your agents can start automatically in isolated Git worktrees."
    : "You’ll be asked on this computer before an agent starts working.";
}

function browserReviewExplanation(mode: RunnerBrowserReviewMode | undefined): string {
  return mode === "read_only"
    ? "Read-only browser self-review is on. Codex may inspect this app in your existing signed-in browser session, but may not change data, access unrelated tabs, or bypass browser safety decisions."
    : "Browser self-review is off. An agent will ask you when live browser verification is required.";
}

function deploymentAccessExplanation(policy: RunnerDeploymentPolicy | undefined): string {
  if (policy?.mode !== "repository") {
    return "Trusted deployment access is off. Agents cannot use checkout-local provider credentials from isolated worktrees.";
  }
  const capabilities = policy.capabilities.length ? naturalList(policy.capabilities) : "no providers";
  const sources = policy.sources.length ? policy.sources.join(", ") : "no environment files";
  return `Trusted deployment access is on for ${capabilities}. Approved sources: ${sources}. Values are checked before launch, passed only in memory, redacted from runner logs, and never copied into worktrees.`;
}

function backgroundServiceExplanation(platform: "darwin" | "linux" | undefined): string[] {
  if (platform === "darwin") {
    return [
      "macOS may show “Background Items Added” for “dongo.” That is this user-level dongo runner, not an unknown Node.js service.",
      "Manage it in System Settings → General → Login Items & Extensions, or use dongo runner disable and dongo runner remove.",
    ];
  }
  if (platform === "linux") {
    return [
      "A user-level dongo service now starts when you sign in; it is not a system-wide service.",
      "Inspect it with dongo runner status, pause it with dongo runner disable, or revoke and remove it with dongo runner remove.",
    ];
  }
  return [];
}

function stateExplanation(state: RunnerLocalState | undefined): string {
  if (!state) return "No recent activity yet.";
  const jobs = state.currentJobs ?? (state.currentJob ? [state.currentJob] : []);
  if (jobs.length > 0) {
    const counts = new Map<string, number>();
    for (const job of jobs) counts.set(job.state, (counts.get(job.state) ?? 0) + 1);
    const summary = [...counts.entries()]
      .map(([jobState, count]) => `${count} ${jobState.replaceAll("_", " ")}`)
      .join(", ");
    const approvals = jobs
      .filter((job) => job.state === "awaiting_local_approval" && /^[A-Za-z0-9_-]+$/u.test(job.id))
      .map((job) => `Approve ${job.workIdentifier && /^[a-z]{4}[0-9]{3}$/u.test(job.workIdentifier) ? job.workIdentifier : "this job"}: dongo runner approve --job-id ${job.id}`);
    return [
      `${jobs.length} agent ${jobs.length === 1 ? "job is" : "jobs are"} active in separate worktrees (${summary}).`,
      ...approvals,
    ].join("\n");
  }
  switch (state.status) {
    case "disabled":
      return "It is paused and will not pick up new work.";
    case "starting":
      return "It is starting in the background.";
    case "waiting":
      return "It is online and waiting for work.";
    case "awaiting_local_approval":
      return "A job is waiting for your approval.";
    case "running":
      return "An agent is working on the current job.";
    case "blocked":
      return "The current job is blocked and needs attention in dongo.";
    case "error":
      return "The runner hit a problem. Use dongo runner status --json for technical details.";
    case "stopped":
      return "The background runner is stopped.";
  }
}

export function renderRunnerInstallOutput(result: RunnerInstallResult): string {
  return [
    "dongo runner is ready.",
    "",
    `This computer can now run queued dongo work with ${agentLabel(result.harnesses)} in this repository—even after you close this terminal. Eligible jobs run concurrently in separate Git worktrees, up to the project safety limit.`,
    approvalExplanation(result.approvalMode),
    browserReviewExplanation(result.browserReviewMode),
    deploymentAccessExplanation(result.deploymentPolicy),
    ...backgroundServiceExplanation(result.registration.platform),
    result.approvalMode === "automatic"
      ? "To receive new Inbox items automatically, finish setup in Project settings → Local runner."
      : "New Inbox items are not routed here automatically. To enable that, first run: dongo runner configure --approval automatic",
    "If this computer is offline, the issue waits until it comes back.",
    "",
    "Check it anytime: dongo runner status",
  ].join("\n") + "\n";
}

export function renderRunnerStatusOutput(result: RunnerStatusResult): string {
  if (!result.installed) {
    return [
      "No dongo runner is set up for this repository.",
      "",
      "Set one up to let this computer work on dongo issues, even after you close the terminal.",
      "Start with: dongo runner install --help",
    ].join("\n") + "\n";
  }

  return [
    result.enabled ? "dongo runner is on." : "dongo runner is paused.",
    "",
    `This computer is set up to work on issues with ${agentLabel(result.harnesses)}.`,
    approvalExplanation(result.approvalMode),
    browserReviewExplanation(result.browserReviewMode),
    deploymentAccessExplanation(result.deploymentPolicy),
    ...backgroundServiceExplanation(result.servicePlatform),
    stateExplanation(result.state),
    result.approvalMode === "automatic"
      ? "Confirm Inbox routing in Project settings → Local runner."
      : "New Inbox items are not routed here automatically. Enable local trust with: dongo runner configure --approval automatic",
  ].join("\n") + "\n";
}

export function renderRunnerApproveOutput(result: RunnerApproveResult): string {
  const work = result.workIdentifier && /^[a-z]{4}[0-9]{3}$/u.test(result.workIdentifier)
    ? result.workIdentifier
    : undefined;
  return work
    ? `Job approved.\nAn agent can now start working on ${work} on this computer.\n`
    : "Job approved.\nAn agent can now start working on it on this computer.\n";
}

export function renderRunnerConfigureOutput(result: RunnerConfigureResult): string {
  return [
    result.changed
      ? "dongo runner settings were updated."
      : "dongo runner settings were already configured this way.",
    "",
    approvalExplanation(result.approvalMode),
    browserReviewExplanation(result.browserReviewMode),
    deploymentAccessExplanation(result.deploymentPolicy),
    result.approvalMode === "automatic"
      ? `${agentLabel(result.harnesses)} can start in isolated Git worktrees. Confirm Inbox routing in Project settings → Local runner.`
      : "Automatic Inbox processing is off for this computer.",
  ].join("\n") + "\n";
}

export function renderRunnerDisableOutput(): string {
  return [
    "dongo runner is paused.",
    "",
    "This computer will not pick up new issues, but its dongo connection is still saved.",
    "Remove it completely with: dongo runner remove",
  ].join("\n") + "\n";
}

export function renderRunnerRemoveOutput(): string {
  return [
    "dongo runner was removed.",
    "",
    "This computer will no longer pick up issues for this repository, and its runner access was revoked.",
  ].join("\n") + "\n";
}

export function renderRunnerRunOutput(): string {
  return "dongo runner stopped.\n";
}
