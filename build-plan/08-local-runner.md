# Local runner contract for Codex and Claude Code

Status: accepted implementation contract
Last reviewed: 2026-09-02

## Outcome

The local runner closes the gap between durable dongo work and a stopped local
agent process. It is a small, unprivileged companion distributed with the dongo
CLI. It starts at user login, keeps a bounded outbound wait open against the
project-scoped agent API, launches a locally configured Codex or Claude Code
process only after local policy permits it, and reports safe execution state to
dongo.

The runner is not a remote shell. dongo coordinates a WorkItem and execution
lease; the local machine owns the repository path, executable, credentials,
agent permissions, sandbox, worktree, and process lifecycle.

## Initial scope

Included:

- Codex through stable `codex exec --json` and exact-ID `codex exec resume`;
- Claude Code through `claude --print --output-format stream-json` and exact-ID
  `--resume`;
- macOS user LaunchAgent and Linux user-level systemd service installation;
- one project-scoped runner registration per local repository connection;
- local ask-before-run and explicit per-repository automatic modes;
- a separate project-owner opt-in that targets new Inbox Intake to one exact
  automatic-mode registration and harness;
- durable queueing, status, cancellation, revocation, and bounded diagnostics.

Excluded:

- Windows service installation;
- OpenClaw, generic commands, user-provided adapter scripts, and other harnesses;
- server-provided executables, flags, prompts, environment variables, or shell;
- waking a sleeping or powered-off computer;
- claiming an existing interactive session without an exact supported ID;
- raw terminal, repository, diff, environment, or credential upload;
- SMS as an execution or authorization channel.

## Trust boundary

### Hosted dongo may

- identify the authorized project and WorkItem from server state;
- identify one newly created Intake when the project owner has enabled the
  exact automatic Intake policy, plus current unclaimed Intake only when the
  owner explicitly includes the waiting Inbox during activation;
- accept a human request to queue that Ready WorkItem for `codex` or `claude`;
- select an eligible online registration or leave the job durably unassigned;
- grant one revision-aware execution lease;
- accept bounded status events from the registration holding that lease;
- request cancellation and revoke a registration;
- retain the safe job state, actor attribution, timestamps, and final summary.

### Hosted dongo must never

- provide an executable path, command, flags, environment, or arbitrary prompt;
- receive a model-provider credential or copy another harness's session store;
- receive an absolute path or automatically collect repository contents;
- bypass the harness sandbox, approval policy, repository instructions, or Git
  safety rules;
- interpret presence as proof that a machine is awake or a process started;
- reassign a live lease because a second runner reports itself available.

### The local runner may

- resolve the approved repository and executable from owner-only local config;
- validate the repository identity and refuse a moved, replaced, or unsafe path;
- build a fixed instruction from the project and canonical Work identifier;
- create one isolated worktree and one agent session for every active job;
- start, monitor, interrupt, and terminate only the selected supported harness;
- retain raw process output locally under an owner-only bounded log policy;
- send redacted lifecycle events and a bounded human-readable final summary.

## Identity and authorization

The runner uses the repository's existing project-scoped CLI OAuth grant to
register a subordinate runner device. Registration creates a random runner
secret locally, stores only its verifier server-side, and binds the registration
to the installation Actor and project derived from the validated OAuth grant.
The secret is never printed, placed in the repository, accepted in a URL, or
reused across registrations.

Every runner request proves both the current project-scoped OAuth authorization
and the subordinate runner secret. Revoking the OAuth installation invalidates
all subordinate registrations. Revoking one runner registration stops only that
registration. Rotation replaces the runner secret atomically after proof of the
current credential. The server never accepts caller-provided organization,
project, Actor, or installation identity.

Local files use the existing dongo owner-only directory and atomic-write rules.
Repository markers remain non-secret. Service definitions contain only fixed,
locally approved executable paths and product-owned runner arguments;
credentials stay in the owner-only credential store.

Beginning with runner protocol version `0.1.1`, the macOS LaunchAgent's
executable is an owner-only fixed launcher named
`dongo`, not the underlying Node.js runtime. This gives the operating system a
truthful product identity for its Background Item notice without claiming a
signed application-bundle association dongo does not have. The launcher fixes
the locally approved Node and CLI paths plus the product-owned runner command;
server-controlled values still cannot become executable paths, flags, or shell
input. Default CLI output and Project settings explain the expected notice,
login scope, no-inbound-port boundary, and exact inspection, pause, and removal
controls.

## Versioned job shape

The transport-neutral v1 job is deliberately command-free:

```ts
type RunnerHarness = "codex" | "claude";
type RunnerApprovalMode = "ask" | "automatic";
type RunnerJobKind = "work" | "intake";
type RunnerJobState =
  | "queued"
  | "delivered"
  | "awaiting_local_approval"
  | "starting"
  | "running"
  | "blocked"
  | "cancel_requested"
  | "cancelled"
  | "failed"
  | "completed"
  | "expired";

type RunnerJob = {
  id: string;
  projectRef: string;
  kind: RunnerJobKind;
  workItemId?: string;
  workIdentifier?: string;
  intakeId?: string;
  targetRegistrationId?: string;
  harness: RunnerHarness;
  state: RunnerJobState;
  revision: number;
  requestedAt: number;
  expiresAt: number;
  registrationId?: string;
  deliveredAt?: number;
  leaseExpiresAt?: number;
  cancellationRequestedAt?: number;
  terminalAt?: number;
  safeSummary?: string;
  sessionReferencePresent: boolean;
};
```

`projectRef` and the Work or Intake target are returned for local validation and
display but are derived from the authorized server context. The job does not
copy Intake text, attachments, Work goals, or comments into a remote command.
The local instruction tells the selected harness to start a dongo session in
the approved repository and fetch the canonical target through its existing
project-scoped dongo integration. An Intake instruction is triage-only: create,
link, dismiss, or request Attention, then stop. It must not implement resulting
Work in that job. Eligible Ready Work is queued separately in autonomous mode.

## State machine

```text
queued
  -> delivered
  -> awaiting_local_approval -> starting -> running -> completed
                                        \-> blocked
                                        \-> failed

queued|delivered|awaiting_local_approval -> cancel_requested -> cancelled
starting|running|blocked                 -> cancel_requested -> cancelled|failed
queued|delivered|awaiting_local_approval -> expired
```

- Enqueue is idempotent for one WorkItem or Intake while a non-terminal job exists.
- Delivery is a reservation, not execution. The runner acknowledges before it
  asks locally or starts a process.
- Only the selected registration may advance the job after delivery.
- `starting` atomically acquires the execution lease. Lease loss stops local
  mutation and the harness process before any reclaim attempt.
- `blocked` retains the lease only for a short, explicit local condition. Human
  Attention inside the Work or Intake lifecycle uses normal dongo Attention;
  the exact local harness session resumes only after that Attention is resolved.
- Cancellation is cooperative first and forceful after a bounded grace period.
- Terminal states are immutable. Exact idempotency replay returns the original
  result; a changed payload fails.

Jobs expire after 24 hours when execution has not started. Presence expires 90
seconds after the latest authenticated check-in. A delivered job returns to
`queued` after its 60-second delivery reservation expires. A running execution
uses the existing Work lease and a runner job lease renewed together at a
bounded cadence.

## Outbound delivery

The first release uses authenticated long polling rather than a permanent
WebSocket. `runner_wait` checks immediately, then waits for at most 20 seconds
using bounded server intervals. The local loop immediately drains returned work
and backs off after transport failure through 1, 2, 5, 10, and at most 30
seconds with jitter. While backing off it reports `recovering`, the bounded
failure count, safe code, and next retry time locally; it advances `lastSeenAt`
only after a successful service response. Successful empty waits do not invoke a model and reopen
without an artificial delay. This reuses the deployed API boundary, survives
edge restarts, and keeps Convex authoritative without adding socket-local state.

An automatic Intake job is created transactionally for new Intake after the
owner opt-in. During activation, the owner may explicitly include the bounded
current unclaimed Inbox; already-queued or claimed items are not duplicated.
It is pinned to the selected registration, so another
runner cannot reserve it. Offline delivery remains durable and never implies
that dongo can wake a sleeping or powered-off computer. Revocation, a reported
approval-mode downgrade, or loss of the selected harness disables the policy
and cancels or requests cancellation of that registration's outstanding jobs.

Each wait updates bounded presence: registration ID, runner version, operating
system, supported harnesses, approval modes, and safe health codes. It never
includes hostnames, usernames, absolute paths, process arguments, environment,
or repository content. The web considers a runner online only while presence is
fresh.

## Local policy

Each registration has an owner-only local record containing:

- the exact repository root and repository identity captured during approval;
- the selected `codex` or `claude` executable resolved locally;
- approval mode, defaulting to `ask`;
- browser self-review mode, defaulting to `disabled` and limited to local
  `read_only` authorization for Work jobs;
- a local concurrent-job limit from 1 through 8, defaulting to 6; every parallel
  wait reports that host bound and the server reserves only up to the smaller of
  it and the project safety cap;
- trusted deployment access, defaulting to `disabled`, or an explicit
  repository policy containing only detected provider names and the safe
  source filenames `.env` and `.env.local`;
- the owner-only parent directory used for isolated runner worktrees;
- the active job set, including each bounded worktree and branch label;
- the last exact harness session ID created for each runner job, when available.

Server state may display the locally reported mode but cannot raise its
privilege. A remote request for automatic execution is ignored; only the local
record decides. Hosted job data cannot enable browser review or widen its
scope. Changing the executable, repository identity, automatic mode, browser
review mode, or deployment-access policy requires local confirmation and
rotates the policy revision.

Enabling repository deployment access is also a local owner action. It does not
copy ignored files into worktrees. Immediately before a Work harness launches,
the runner revalidates the approved checkout and imports only the fixed
GitHub/Convex/Cloudflare/npm allow-list into memory. Host environment values may
override those same named entries; no other shell environment crosses the
boundary. The exact worktree must then pass bounded provider probes. Changed
source discovery, unsafe file ownership or permissions, missing configuration,
or an expired provider session fails the job before launch with one provider-
specific safe code. Existing runner records migrate to disabled rather than
silently gaining access.

## Harness adapters

### Codex

The adapter resolves `codex` locally and verifies a supported version. It passes
the approved repository through `--cd`, selects `workspace-write` or a stricter
locally configured sandbox, uses `--json`, and sends the fixed instruction on
stdin. It never uses `--yolo`, `--dangerously-bypass-approvals-and-sandbox`,
`--skip-git-repo-check`, or a server-provided `-c` override. JSONL events are
parsed defensively with line and total-size limits. The adapter captures the
exact session ID and uses `codex exec resume <id>` only for a later continuation
of the same runner job and repository identity.

Immediately before each harness launch, the local runner reads the repository's
`origin` host and asks the owner's installed GitHub CLI for that host's current
token. A successful bounded probe contributes only `GH_TOKEN`, or `GH_HOST` plus
`GH_ENTERPRISE_TOKEN`, to the harness process environment so sandboxed child
commands can use the same authenticated GitHub identity as the login session.
This local bridge is refreshed per launch and is never represented in the
hosted job contract, process arguments, prompts, worktrees, runner state, or
logs. Any missing tool, unknown remote, failed login, timeout, oversized output,
or malformed token contributes no environment value.

When trusted deployment access is enabled, the same launch boundary also
resolves the fixed release inputs required by the detected repository:
`CONVEX_DEPLOYMENT`, `CONVEX_DEPLOY_KEY`, `CONVEX_SITE_URL`, `CONVEX_URL`,
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `NPM_ACCESS_TOKEN`, and
`NODE_AUTH_TOKEN`. GitHub access comes only from the existing `gh` identity.
The runner actively checks GitHub, Convex, Cloudflare, and npm before starting
the harness. It passes values only through the child environment, creates no
worktree configuration file, redacts exact injected values from stdout and
stderr, and removes its owner-only temporary npm placeholder configuration on
every exit path. The fixed prompt tells the agent that access already passed
preflight so it checks current state before requesting a new login.

### Claude Code

The adapter resolves `claude` locally and verifies a supported version. It runs
from the approved repository with `--print --output-format stream-json`, keeps
Claude Code's configured permission system, and sends the fixed instruction on
stdin. It never uses `--dangerously-skip-permissions`, a server-provided tool
allowlist, or a server-provided system prompt. Streaming JSON is parsed with the
same bounds. The adapter captures the exact `session_id` and uses `--resume
<id>` only for a later continuation of the same runner job and repository
identity.

When the local browser self-review mode is `read_only`, the fixed Work prompt
records the owner's bounded authorization to inspect only the application under
test in an available existing signed-in browser session. Navigation,
screenshots, DOM/accessibility inspection, responsive checks, and non-mutating
interactions are in scope. Intake jobs, unrelated tabs, new sign-ins,
state-changing submissions, permission grants, and browser-policy bypasses are
not. The mode is absent from the hosted job contract and defaults to disabled
for existing configurations.

For both adapters, missing authentication, unsupported versions, local approval
denial, an unsafe repository, worktree setup failure, or an unavailable
resume reference becomes a specific safe state. A resume failure may start a
new session only after recording that fallback; it must never silently continue
the most recent unrelated session.

## Status, logs, and retention

Server-visible events are structured and bounded:

```ts
type RunnerJobEvent = {
  sequence: number;
  state: RunnerJobState;
  occurredAt: number;
  code?: string;
  message?: string;
};
```

`code` comes from a fixed registry. `message` is runner-authored, terminal-control
stripped, secret-redacted, single-line, and limited to 500 UTF-8 bytes. No raw
stdout or stderr is uploaded. The final safe summary is limited to 2,000 bytes.
Detailed process logs remain local, owner-only, rotate at 5 MiB, retain at most
three files, and are deleted on runner removal.

Runner jobs and safe events follow the WorkItem's retained project history.
Presence samples are overwritten rather than appended. Revoked registration
records remain as bounded audit history without secrets. Local session IDs and
raw process logs are not server data.

## Failure, concurrency, and recovery

- Two enqueue requests for the same eligible WorkItem return one active job.
- Upgraded runners declare their active job IDs and atomically refill available
  capacity up to the smaller of their local host limit and the project
  `maxConcurrentRuns` policy. Older runners omit the active-job field and retain
  the original one-job-at-a-time behavior; the earlier parallel client remains
  compatible when it omits the additive host limit.
- Every concurrent job receives a deterministic, owner-only Git worktree, branch,
  harness session, log, cancellation controller, and dongo external session ID.
- Per-job polling names the exact job. A cancellation or lost lease interrupts
  only that job; the dispatcher and sibling jobs continue.
- Delivery capacity is enforced across registrations. Active runner Work jobs
  and live Runs for the same WorkItem count once, so reservation cannot launch
  models ahead of the authoritative project safety cap.
- A registration cannot deliver, start, update, or cancel a job from another
  project or registration.
- A WorkItem already claimed outside the runner fails start without launching a
  process.
- If the runner loses either lease, it interrupts the process and refetches; it
  never fabricates a new session ID to reclaim work.
- Restart reloads only owner-only local state, rediscovers every assigned job,
  and resumes each only when its server lease, deterministic worktree, and stored
  process/session facts agree. A missing worktree is a recovery failure and is
  never silently recreated for a job already reported as running or blocked.
- Server outage leaves the local process running only through a short bounded
  grace period. Failure to renew after that period interrupts it.
- Cancellation, revocation, or local disable always outranks queued execution.

## Observability

Safe metrics cover registrations online by version/platform, wait success and
failure, queue latency, delivery-reservation expiry, local-approval latency,
state-transition failures, lease loss, cancellation latency, harness exit class,
and redaction drops. Logs use request, registration, and job IDs only. They never
include user email, Work text, safe summary content, repository URL/path, session
ID, command arguments, or credentials.

Readiness remains independent from runner presence. A project with no online
runner is healthy; its queued jobs are visibly pending rather than treated as a
service outage.

## Compatibility and rollout

All schema and operation additions are additive. Existing CLI, API, MCP, Work,
Attention, and update-stream behavior remains valid. The old Intake pull signal
is not reinterpreted as a runner job. Older clients ignore runner fields. New
clients reject a server contract newer than they support before launching.

Development rollout order is schema/functions, agent API, CLI package, runner
service install, then web controls. Production uses the same accepted revision.
Disabling queue creation is the immediate kill switch. Revoking registrations
stops delivery. Because job data is additive and terminal records are retained,
rollback does not delete or rewrite Work history. A rolled-back UI must leave
existing jobs visible through the operator read path until compatible code is
restored.

## Release acceptance

- Contract fixtures prove every allowed and rejected state transition.
- Tenant, project, installation, registration, and lease boundaries fail closed.
- Registration secret storage, rotation, revocation, corruption, permissions,
  symlink, and response-loss paths pass on clean macOS and Linux environments.
- Real Codex and Claude Code runs prove new session, exact-ID continuation,
  structured output bounds, local approval, automatic local opt-in, Attention,
  disabled and read-only browser self-review, cancellation, failure,
  completion, and attribution.
- Offline, reconnect, edge restart, computer restart, duplicate delivery,
  multiple runners, stale lease, dirty repository, unsafe path, and uninstall
  journeys pass without duplicate execution or secret/content disclosure.
- The web renders no execution action without an eligible supported runner and
  labels offline, queued, waiting, running, blocked, and terminal states exactly.
- Full repository, contract, package, browser, development, security, rollback,
  production, and post-cutover gates pass for the exact committed candidate.
