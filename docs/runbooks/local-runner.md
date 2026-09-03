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
dongo runner install --harness codex
dongo runner install --harness codex --harness claude
dongo runner status
```

The registration is bound to that exact canonical repository root, not merely
to its Git remote or dongo project. Run installation and status commands from
the checkout that will execute jobs. A runner installed in another checkout or
repository does not cover this one. For automatic mode, use a dedicated clean
checkout or worktree when the normal checkout regularly contains unrelated
uncommitted work.

Ask-before-run is the default. A user may explicitly opt one local repository
into automatic starts with `--approval automatic`, or change an existing runner
in place with `dongo runner configure --approval automatic`. The selection is kept in the
owner-only local configuration and reported to the server for truthful status;
the server cannot elevate an ask-mode runner to automatic execution.

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

On macOS, dongo installs a user LaunchAgent. On Linux, it installs a user-level
systemd service. It does not use `sudo`, a system daemon, or a privileged path.
Native Windows is out of scope for the first release; WSL follows the Linux
user-service and Linux-filesystem security boundary.

### Codex execution

The Codex adapter resolves and records the exact local `codex` executable,
verifies its version and required non-interactive features, and starts work in
the exact approved repository with JSONL output and the `workspace-write`
sandbox. The fixed instruction is sent over standard input, not exposed in the
process list. It never uses approval or sandbox bypass flags. The only hosted
value added to the local instruction is the validated dongo Work or Intake
identifier.

The adapter records the stable `thread.started` identifier in owner-only local
storage. After a runner restart it resumes only when that identifier matches
the same registration, job, and canonical repository. Otherwise it reports a
truthful restart failure instead of guessing or resuming the most recent task.
Saved Codex authentication is resolved by Codex itself and is never copied into
dongo status or logs.

### Claude Code execution

The Claude Code adapter resolves and records the exact local `claude`
executable, verifies its version and required non-interactive features, and
runs print mode with streaming JSON in the exact approved repository. The
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

1. Run `dongo runner status`. Record only the registration ID, safe state,
   version, harness list, and last safe error code. Never record the local token.
2. Confirm `dongo doctor` succeeds in the same repository.
3. Confirm the configured harness executable is installed and authenticated as
   the local OS user. Model-provider credentials remain local to that harness.
4. Check the user service, not a system service:

   ```sh
   launchctl print gui/$(id -u) | grep so.dongo.runner
   systemctl --user status 'dongo-runner-*.service'
   ```

5. Raw harness output is retained only in owner-only rotating local logs under
   the dongo configuration directory. It is capped at 5 MiB per file with three
   retained rotations and is never uploaded as job status.

The runner waits for jobs for at most 20 seconds per request. Network failures
back off through approximately 1, 2, 5, 10, and 30 seconds with jitter. A job
delivery is reserved for 60 seconds until acknowledged; running jobs renew a
90-second lease. Cancellation, registration revocation, and parent installation
revocation outrank execution. A lost or expired lease requires the local process
to stop and refetch; it must never continue by guessing.

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
