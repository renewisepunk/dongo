# dongo local runner

The local runner is an optional, unprivileged user service for launching Codex
or Claude Code in one explicitly connected repository. It maintains outbound
HTTPS requests to dongo and opens no inbound port. Hosted dongo sends only a
project-scoped job identity, Work identifier, harness choice, lifecycle state,
revision, and expiry metadata. It cannot send a command, arguments, environment
variables, repository path, model credential, or arbitrary prompt.

## Install and inspect

First give each selected harness its own project-scoped dongo connection and
prove it from that harness. The runner credential and the agent's MCP credential
are deliberately separate; never copy the CLI credential into an agent or a
temporary agent configuration directory.

```sh
dongo integrate codex --apply
codex mcp login <the project-scoped server printed by dongo> --scopes dongo:work:read,dongo:work:write,dongo:attachments:read

# Or for Claude Code:
dongo integrate claude --apply
claude mcp login <the project-scoped server printed by dongo>
```

From Codex or Claude Code, call `dongo_session_start` and confirm that it returns
the intended project. Then, from the connected repository, install one or both
supported harnesses:

```sh
dongo runner install --harness codex --label "Studio Mac"
dongo runner install --harness codex --browser-review read-only --label "Studio Mac"
dongo runner install --harness codex --harness claude --label "Studio Mac"
dongo runner status
```

Choose a recognizable, non-sensitive label so the owner can distinguish this
computer from other runners in Project settings.

The registration is bound to that exact canonical repository root, not merely
to its Git remote or dongo project. Run installation and status commands from
the checkout that anchors the runner. A runner installed in another checkout
or repository does not cover this one. Each job itself runs in a separate Git
worktree under dongo's owner-only local data directory, so unrelated changes in
the registered checkout are never shared with automatic jobs.

When project parallel execution is enabled, one runner fills available capacity
with separate agent processes and worktrees up to the project safety limit
(maximum eight). `dongo runner status` lists every active job and its approval
command when needed. Project settings reports `N active of M` or `at capacity`;
`online · waiting for work` means the runner is healthy and has no active jobs.

Ask-before-run is the default. A user may explicitly opt one local repository
into automatic starts with `--approval automatic`, or change an existing runner
in place with `dongo runner configure --approval automatic`. The selection is kept in the
owner-only local configuration and reported to the server for truthful status;
the server cannot elevate an ask-mode runner to automatic execution.

Browser self-review is a separate local permission and defaults to `disabled`.
Enable it only from the runner's registered checkout:

```sh
dongo runner configure --browser-review read-only
```

This allows Codex Work jobs—not Intake triage—to reuse an available signed-in
browser session for non-mutating inspection of the application under test. It
covers navigation, screenshots, DOM and accessibility inspection, responsive
checks, and other read-only interactions on a job-started local server or the
repository-documented development and production deployments. It does not
authorize signing in to another account, reading unrelated tabs, submitting a
state-changing form, granting browser or site permissions, or bypassing a
browser safety decision. The setting lives only in owner-readable local runner
configuration; a hosted job cannot enable or widen it. Disable it with
`dongo runner configure --browser-review disabled`.

Automatic Inbox processing is a second, project-level opt-in and remains off
after installation. Runner status and settings must say this explicitly;
generic online presence is not proof that Inbox items are routed. An organization
owner enables it from **Project settings → Local runner** by selecting one active
automatic-mode computer and one installed harness. That explicit action queues
the bounded current unclaimed Inbox and all new Intake. A separate **Process
waiting Inbox now** action safely retries unclaimed items that do not already
have a live job. Each job is targeted to that exact registration and
uses a fixed triage-only instruction; resulting Ready Work is a separate job
and is automatically queued only when the project is in autonomous mode.

On macOS, dongo installs a user LaunchAgent through a fixed executable named
`dongo`. A one-time **Background Items Added** notification for **dongo** is
expected. This is the local Inbox runner; Node.js is only its internal runtime.
The item is visible in **System Settings → General → Login Items & Extensions**.
If macOS displays `node`, the runner came from an older CLI: remove it with
`dongo runner remove`, update the CLI through the owner-approved version-pinned
procedure, and install it again. On Linux, dongo installs a user-level systemd
service. Neither platform uses `sudo`, a system daemon, a privileged path, or an
inbound port. Native Windows is out of scope for the first release; WSL follows
the Linux user-service and Linux-filesystem security boundary.

An enabled service restarts after both failing and unexpected clean exits. Its
restart policy is bound to an owner-only local enable marker. Disable, removal,
or terminal remote authorization loss disarms that marker before the process
stops, and a stop failure preserves local material for a safe retry instead of
claiming the runner was removed.

### Codex execution

The Codex adapter resolves and records the exact local `codex` executable,
verifies its version and required non-interactive features, and starts work in
the job's isolated worktree with JSONL output and the `workspace-write`
sandbox. The runner validates the linked worktree and approved checkout share
the same owner-controlled, non-symlinked canonical Git common directory, then
adds exactly that metadata directory to the writable sandbox. It never grants
the parent worktree area or an unrelated path. The fixed instruction is sent over standard input, not exposed in the
process list. It never uses approval or sandbox bypass flags. The only hosted
values added to the local instruction are the validated dongo Work or Intake
identifier and, for Work only, the bounded browser self-review authorization
when the owner explicitly enabled it in local runner configuration.

The adapter records the stable `thread.started` identifier in owner-only local
storage. After a runner restart it resumes only when that identifier matches
the same registration, job, and canonical repository. Otherwise it reports a
truthful restart failure instead of guessing or resuming the most recent task.
Saved Codex authentication is resolved by Codex itself and is never copied into
dongo status or logs.

The Codex workspace sandbox cannot read the macOS Keychain entry used by an
interactive GitHub CLI, even though the login-scoped runner can. For a repository
whose `origin` host is authenticated in `gh`, the runner therefore resolves the
current token with `gh auth token --hostname` immediately before each harness
launch and passes it only in that child process environment. This lets `gh` and
the configured Git credential helper use the owner's current CLI identity without
weakening the harness sandbox. The token is never placed in a job, prompt,
argument, worktree, dongo state, or runner log. Missing `git`, missing `gh`, an
unknown remote shape, an unauthenticated host, a malformed result, or a bounded
probe failure produces no credential environment and preserves the normal
fail-closed agent workflow. Re-authentication takes effect on the next launch;
the runner does not need to be reinstalled.

### Claude Code execution

The Claude Code adapter resolves and records the exact local `claude`
executable, verifies its version and required non-interactive features, and
runs print mode with streaming JSON in the job's isolated worktree. The
fixed instruction is sent over standard input. It uses Claude Code's
`acceptEdits` permission mode so repository edits can proceed while
side-effecting commands retain Claude's configured permission policy. It never
uses `--dangerously-skip-permissions`.

The adapter persists a validated `session_id` only from Claude's documented
initialization or result events. Restart recovery uses `--resume` only for the
same registration, job, and canonical repository. Raw stream events and model
output remain in the bounded owner-only local log; hosted status contains only
fixed safe outcome text.

For both harnesses, dongo verifies the authoritative WorkItem or Intake after
the local process exits. A zero exit code cannot complete the runner job unless
the Work is Done or the Intake is processed or dismissed. An open Attention
request moves the runner job to Blocked and the exact local harness session
resumes only after the response is available.
Lease loss, cancellation, runner shutdown, or an API failure stops and joins
the local process before the manager may retry.

Runner-launched Work must publish its first concise dongo update before
substantive repository work, then update on each meaningful phase or next-step
change and at least every five minutes during a long bounded check. An unchanged
update must not be repeated just to reset its age, and progress must never be
invented. Until the first agent-authored update arrives, Agent Activity shows a
fixed redacted harness-liveness message backed by the matched runner heartbeat;
it never uploads or summarizes raw harness output. Once the agent reports
progress, that authored update and its own timestamp remain authoritative.

## Approve, disable, and remove

When status shows `awaiting_local_approval`, approve the exact local job:

```sh
dongo runner approve --job-id JOB_ID
```

The approval file is owner-only, bound to the current registration and exact
job, and consumed once. A web action cannot substitute for local approval.

Automatic mode refuses to launch from a dirty repository. Ask-before-run mode
can be used when a person has reviewed and deliberately approved the exact
local checkout state.

Use `dongo runner disable` to stop login startup while retaining the revocable
registration. Use `dongo runner remove` to stop the service, revoke the runner
credential, remove the service definition, and delete the local configuration,
session references, pending approvals/results, and rotating logs for that
project.
If remote revocation fails, dongo retains the local credential so removal can be
retried safely.

Disabling automatic Inbox processing in project settings stops future Intake
jobs but does not cancel jobs already queued. Revoking the selected runner,
changing it away from automatic approval, or removing the selected harness
also disables the opt-in. dongo never silently transfers this trust to another
computer.

## Diagnosis

Overview is server-subscribed in real time, while a local runner checks for work
with a bounded outbound pull. A live Inbox item therefore does not prove that a
runner can claim it. Overview and Intake detail name the current-project cause:
no runner, automatic pickup off, offline or stale heartbeat, local approval,
incompatible harness, full agent capacity, queued delivery, startup, or active
execution. A sleeping or absent process cannot be woken by the web app.

When two browser profiles use different dongo accounts, always open the complete
`dongo connect` link in the profile that can access the project requested by the
terminal. The approval page shows the signed-in identity, organization, project,
and repository. It refuses to substitute another account's sole project. Deny a
mismatch; do not approve and repair it afterward.

1. Run `dongo doctor` in the exact checkout. A Git remote that differs from the
   local project marker reports `repository-binding` and fails before credential
   or network use. Reconnect with `dongo connect --project-ref
   <intended-project-ref>`; dongo does not reuse the stale marker or overwrite it
   before the server-authoritative repository agrees.
2. Run `dongo runner status`. Record only the registration ID, safe state,
   version, harness list, and last safe error code. Never record the local token.
3. Confirm the configured harness executable is installed and authenticated as
   the local OS user. Model-provider credentials remain local to that harness.
4. Check the user service, not a system service:

   ```sh
   launchctl print gui/$(id -u) | grep so.dongo.runner
   systemctl --user status 'dongo-runner-*.service'
   ```

   Resolve the exact service PID from that bounded service-manager output. If
   process liveness needs a second check, print only allow-listed identity
   fields:

   ```sh
   ps -p "$DONGO_RUNNER_PID" -o pid=,ppid=,pgid=,state=,etime=,comm=
   ```

   Never use `pgrep -fl`, `ps e`, `ps -E`, wide/full-command output, or an
   environment dump during a credential-bearing runner or release. Those modes
   can copy child environment assignments or arguments into terminal and task
   logs. If this happens, stop at the next safe release boundary and rotate the
   exposed credential through its owner runbook; redaction after capture is not
   recovery.

5. Raw harness output is retained only in owner-only rotating local logs under
   the dongo configuration directory. It is capped at 5 MiB per file with three
   retained rotations and is never uploaded as job status.

The runner waits for jobs for at most 20 seconds per request. Network failures
back off through approximately 1, 2, 5, 10, and 30 seconds with jitter. A job
delivery is reserved for 60 seconds until acknowledged; running jobs renew a
90-second lease. Cancellation, registration revocation, and parent installation
revocation outrank execution. A lost or expired lease requires the local process
to stop and refetch; it must never continue by guessing.

Before a live step uses a resource that repository instructions identify as
shared, acquire its stable safe key with `dongo resource acquire`. Proceed only
when the result is `held`. A `waiting` result is a normal FIFO wait: retain the
returned Work revision, renew by acquiring again before the lease expires, and
continue unrelated implementation or tests when possible. Release with
`dongo resource release` in success and failure cleanup. Run completion,
cancellation, failure, claim expiry, and runner reconciliation also release the
claim server-side; the next eligible waiter is promoted automatically. Prefer
unique worktree-local ports and profiles over leasing whenever they are truly
isolated. Never put credentials, private conversation IDs, messages, local
paths, or other sensitive data in resource keys or labels.

When one live step needs multiple shared resources, acquire the stable keys in
lexical order and release in reverse order. If any acquisition waits or fails,
release every resource already acquired before retrying. This prevents two Runs
from holding different fixtures while each waits indefinitely for the other.

When an automatic-mode runner reconnects, the server may requeue the latest
explicitly authorized Work job once if its only terminal reason is an expired
runner lease and the Work is still Ready and unclaimed. The retry remains
targeted to the same active registration and passes through the normal atomic
project and host capacity checks. Repeated lease expiry, older historical jobs,
ask-mode runners, cancellation, and harness or workspace failures stay terminal
and require a deliberate human Retry instead of forming an unbounded loop.

## Recovery and rollback

- To stop all new queue creation immediately, set the Convex environment switch
  to `false` for the affected environment. Missing or `true` enables queueing;
  any other configured value fails closed. This does not start, cancel, or alter
  existing jobs.

  ```sh
  npx convex env set --deployment dev DONGO_RUNNER_QUEUE_ENABLED false
  npx convex env set --prod DONGO_RUNNER_QUEUE_ENABLED false
  ```

  Re-enable an accepted environment by setting the same value to `true`. Confirm
  the target deployment shown by the CLI before applying either command.
- For a stuck pre-start job, cancel it in the web app and inspect local runner
  status. Do not edit Convex state manually.
- For a compromised computer or token, revoke the runner or its parent
  installation in dongo. The next authenticated contact fails closed and local
  execution stops.
- For a bad release, disable the local runner queue creation kill switch first,
  then revoke affected registrations. Roll back the CLI and backend together
  only to a revision that preserves the additive runner tables and operation
  schemas.
- A disabled or removed runner does not affect ordinary MCP, CLI, Intake, Work,
  or Attention workflows.
