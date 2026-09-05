# 2026-09-04 local-runner and release incident

Status: open; corrective release and final production acceptance are pending.

Scope: dongo and wiwi local-runner execution, isolated worktrees, release
credentials, browser review, and owner-visible status.

This report contains no credential values, authorization codes, private
checkout paths, or user content. Work identifiers and Git revisions are kept
only where they are useful for remediation and audit.

## Executive summary

On 2026-09-04, owners repeatedly saw Ready work remain idle, one of six slots
used, completed work remain active, agents ask again for authentication, and
newly launched jobs immediately return to Ready or Blocked. The failures looked
like one unreliable runner or one broad authentication problem. They were a
chain of independent defects across dispatch, process supervision, Run
ownership, sandboxing, deployment configuration, browser authorization,
shared-resource coordination, status modeling, and live acceptance coverage.

The first defect was real serialization: the released runner advertised project
capacity but awaited one job to completion before reserving another. That was
corrected by the 0.2.12 fan-out work in dong085. A live post-upgrade check then
proved that the runner could launch four concurrent Codex processes in distinct
worktrees. The continuing failures were therefore downstream of dispatch:

1. an old terminal runner job could be matched to a newer Run for the same Work
   and abandon it seconds after it started;
2. Codex could write the linked worktree but not the repository's separate Git
   common directory, so read-only remote checks passed while `git fetch` failed
   when it attempted to update `FETCH_HEAD`;
3. a macOS LaunchAgent that exited successfully was not restarted, although the
   product still described the runner as enabled;
4. clean worktrees did not contain ignored deployment configuration and release
   scripts could fall back to a local Convex target instead of failing closed;
5. provider, repository, runner, and browser authorization states were treated
   as one vague “authentication” state and were checked too late;
6. owner-visible status confused registered, connected, online, eligible, busy,
   at-capacity, process-alive, and Run-terminal states;
7. public smoke checks proved health and metadata but did not exercise a live
   device-authorization control-plane mutation, so a transient production auth
   500 was not detected by the advertised green smoke result.
8. the runner advertised a 20-second dispatcher long poll, but the API's
   internal Convex request timed out after 15 seconds, turning healthy idle and
   refill waits into repeated `temporarily_unavailable` recovery cycles.

No single retry, re-login, browser permission change, or queue restart could
repair that whole chain. Repeated retries instead created more historical jobs,
more reconciliation races, more Attention, and less trustworthy status.

## Customer and operator impact

- Ready work in both projects appeared eligible but was not started, or started
  and returned to Ready within seconds.
- The interface showed `0 / 6` or `1 / 6` while work was pending, then later
  showed a live runner as disconnected because it was busy or ineligible for an
  additional reservation.
- `dong067`, `dong072`, and `wiwi047` were among the WorkItems whose new Runs
  lost ownership immediately after a successful start.
- Agents spent substantial time implementing and verifying work, only to stop
  at Git integration, development deployment, browser acceptance, or production
  promotion.
- Owners were asked to reauthenticate GitHub and Cloudflare or change browser
  permissions repeatedly, including cases where the relevant credential or
  global permission was already healthy.
- Playwright and Chrome processes crashed or timed out under shared profile,
  port, and host-resource contention.
- Completed, integrated, or live milestones remained under Agent Activity when
  the Run had not reached a reconciled terminal state.
- A transient production authorization failure was visible to a real client but
  not to the public smoke suite.

The incident did not justify bypassing branch protection, weakening browser or
agent sandboxes, copying secrets into worktrees, or marking unfinished Work
Done. Those constraints correctly stopped unsafe completion; the product failed
to make the safe path reliable and understandable.

## What happened

### Observed sequence

1. The Intake runner waited or failed while Ready queues grew in dongo and
   wiwi. Project capacity advertised four or six slots, but one registration
   used at most one.
2. Early jobs reported `Local run failed`, `waiting for an online runner`, or
   `Codex is starting` without a reliable next action or recovery boundary.
3. Jobs that reached integration or release requested GitHub, Cloudflare, npm,
   Convex, or browser authorization individually. A successful owner action did
   not necessarily reach the already-running isolated process.
4. Work that was integrated or deployed continued to appear active because the
   agent had recorded a milestone but the Run/job/Work terminal transition had
   not reconciled.
5. The parallel dispatcher, aggregate runner state, terminal reconciliation,
   binding reconciliation, and trusted deployment bridge were implemented
   together and shipped as the 0.2.12 candidate through dong085.
6. After the upgrade, a manual LaunchAgent kickstart immediately produced four
   concurrent Codex children in separate worktrees. This proved that advertised
   fan-out was no longer the active bottleneck.
7. Those children exposed three deeper defects: launchd had stopped the enabled
   runner after a clean exit; old terminal jobs abandoned newer Runs; and Codex
   lacked write access to the shared Git common directory.
8. A release attempt from a clean worktree also exposed missing ignored
   configuration. It initialized a local Convex target and began an incoherent
   development sequence before being stopped. The fail-closed correction is
   tracked by dong084.
9. A real production client encountered a transient auth control-plane 500
   while the public smoke suite remained green because it checked readiness and
   metadata, not a device-code request.

### Causal map

```text
advertised parallel capacity
  -> serial reserve/handle loop (pre-0.2.12)
  -> Ready backlog and misleading free-slot display

0.2.12 fan-out
  -> several real isolated Codex processes
  -> exposed missing cross-process invariants
       -> old terminal job reconciles newer Run
       -> worktree writable, Git common dir denied
       -> shared ports/profiles/deploy targets contend

clean release worktree
  -> ignored owner config absent
  -> deployment selector unresolved
  -> local Convex fallback / partial development attempt

late capability checks + compressed status model
  -> repeated generic auth/browser prompts
  -> owner cannot distinguish retryable wait from structural failure
  -> retries amplify historical-job and Attention noise
```

## Root-cause analysis

### RC1 — advertised capacity was not an executable contract

**Symptom.** The Overview showed up to six slots while one or zero jobs ran.

**Mechanism.** The original CLI run loop awaited one complete job handler before
polling again. The general reserve endpoint also returned the registration's
existing active job, which was correct for a serial client but prevented one
registration from asking for another. Project capacity was a server policy, not
a proven host capability.

**Why detection failed.** Concurrency tests covered independent agent sessions
and project limits, but not one installed runner reserving several jobs,
launching several harness processes, isolating their worktrees, and refilling a
freed slot. The UI rendered configured capacity as if it were demonstrated
capacity.

**Correction.** dong085 introduced additive exact-job polling, active-job IDs,
a host limit, independent workers, global capacity accounting, aggregate local
state, six-slot tests, refill tests, restart tests, and compatibility with serial
clients. Live evidence proved four concurrent Codex children after restart.

**Invariant.** A UI may advertise `N` runnable slots only when the registered
runner protocol and host configuration can reserve, launch, supervise, and
refill `N` isolated jobs. Configured project capacity and currently usable host
capacity must be displayed separately.

### RC2 — stale and terminal job recovery was incomplete

**Symptom.** Work stayed Ready with an old `Local run failed` annotation, or a
lease-expired job was never made eligible for automatic pickup again.

**Mechanism.** The initial recovery path terminalized expired delivery or
execution leases but did not provide a bounded, explicit requeue policy for the
latest authorized automatic job. A dead service therefore left durable Work
but no eligible job to consume it.

**Why detection failed.** Tests proved expiry and terminal state separately,
not a complete disconnect, service return, atomic Work release, one-time requeue,
capacity wait, and later refill. The operator surface showed the historical
failure but not whether retry would occur.

**Correction.** PR #23 (`a6517c6`) added bounded recovery of the latest
lease-expired automatic Work job, with capacity checks and no unbounded retry
loop. Ask-mode, older historical, cancelled, and non-lease failures remain
deliberate manual retries.

**Invariant.** A reconnect may requeue at most the latest still-authorized
lease-expired automatic job once. The transition must be atomic, capacity-aware,
audited, and visibly distinguish “will retry” from “manual retry required.”

### RC3 — terminal reconciliation was associated with Work, not the exact Run

**Symptom.** `dongo_start_work` succeeded, then an immediate read or update saw
`claim_conflict`; the new Run had already been marked abandoned. This repeated
within roughly one to four seconds for `dong067`, `dong072`, and `wiwi047`.

**Mechanism.** Terminal reconciliation selected a runner job by WorkItem and a
timestamp lower bound. When Work was retried, an older failed job could satisfy
that broad test and terminate the newer active Run. Reserve polling made the
race repeat reliably.

**Why detection failed.** Tests covered a terminal job and its own current Run,
plus reconnect reconciliation. They did not create historical job A, start a
new job and Run B for the same Work, and then reconcile A after B started.

**Correction in progress.** Match the immutable association exactly. For a
runner Work job, the Run session must equal `dongo-runner-${job.id}` and the job
must be chronologically eligible for that exact Run. An old job may never mutate
a newer Run even when the WorkItem ID is the same.

**Invariant.** Only the exact runner job that created or owns a Run may renew,
wait, fail, cancel, complete, or release that Run. WorkItem identity and temporal
proximity are never sufficient ownership evidence.

### RC4 — macOS service state could disagree with product state

**Symptom.** A runner remained installed and enabled in dongo, but its launchd
process was absent. Queued jobs waited until an operator manually kickstarted
the service.

**Mechanism.** The LaunchAgent used `KeepAlive` with
`SuccessfulExit=false`. A clean process exit therefore meant “do not restart,”
even though the local config remained enabled. At the same time, disable and
bootout errors were swallowed, so configuration code could not prove the old
process was stopped. Replacing the policy with unconditional restart would be
unsafe because a revoked or terminally unauthorized runner could enter a
restart loop.

**Why detection failed.** Unit tests asserted generated launchd commands and
files with a fake command runner. They did not install the service, observe a
clean exit, prove restart while enabled, prove no restart after disable, or
simulate bootout failure and revocation.

**Correction in progress.** Use an owner-only enable sentinel with launchd
`PathState` keepalive. Disarm the sentinel on explicit disable, remove, or
terminal authorization failure; fail closed if stop/disable cannot be proven;
and keep network/transient failures under bounded in-process backoff.

**Invariant.** `enabled` means the supervisor will restart any unexpected
process exit, including exit 0. `disabled`, `removed`, revoked, or terminally
unauthorized means the restart sentinel is absent before process shutdown.
Failure to prove either transition is an operator-visible error, never success.

### RC5 — the sandbox covered the worktree but not Git's write boundary

**Symptom.** `git ls-remote` succeeded, while `git fetch origin main` failed
with an operation-not-permitted error updating `FETCH_HEAD`. Agents interpreted
the sequence as another GitHub authentication failure.

**Mechanism.** A linked worktree's files live in the job directory, but refs,
objects, locks, and `FETCH_HEAD` live in the canonical Git common directory.
Codex received write access only to the worktree. Remote reads needed network
and credentials; fetch additionally needed a write outside the granted sandbox.

**Why detection failed.** Worktree tests ran directly under the test process,
where both directories were writable. GitHub probes validated remote access but
did not perform a write-requiring Git operation inside the exact harness
sandbox. No acceptance test distinguished authorization denial from local
filesystem denial.

**Correction in progress.** Resolve and validate the same-repository,
owner-controlled, non-symlink canonical Git common directory before launch and
pass that one bounded directory as an additional writable location for new
Codex sessions. If an existing resumable session's grant cannot be proved,
discard and restart it conservatively instead of widening access dynamically.

**Invariant.** Every new repository job must prove it can write both the linked
worktree and its exact Git common directory before starting Work. No home,
workspace-parent, or unrelated repository directory may be granted.

### RC6 — clean worktrees lost trusted deployment identity and targets

**Symptom.** Release jobs asked again for GitHub or Cloudflare access, could not
see npm or Convex context, or treated development as a local Convex deployment.
One stopped attempt began from the wrong Convex target and reached an early
Worker stage before the incoherent release was halted.

**Mechanism.** Git shares committed history across worktrees, not ignored
`.env` files or host credential stores. Release scripts accepted an unresolved
deployment selector and allowed a tool's local-development fallback. Provider
checks happened late, after implementation and some release work.

**Why detection failed.** Release tests modeled command order and injected
known configuration. They did not start from the exact clean runner worktree
with ignored files absent. Development plan tests did not require one explicit,
remote Convex deployment identity before any mutation.

**Correction.** dong084 provides an explicit, disabled-by-default,
repository-approved bridge for allow-listed GitHub, Convex, Cloudflare, and npm
inputs. Values remain in memory, output is redacted, and probes run in the exact
job process. PR #24 (`344b9fe`) makes deployment targeting fail closed; it must
be integrated and released with the combined corrective CLI candidate.

**Invariant.** Before the first release mutation, the exact clean checkout must
prove every required provider and name the remote environment. An absent,
ambiguous, local, or changed target aborts the whole release before Convex,
Worker, database, or package mutation.

### RC7 — repository identity and authorization scopes were conflated

**Symptom.** “Use dongo” triggered connection/login even when the repository was
already connected. A reauthenticated host credential did not automatically
unblock an existing job, and one successful provider login was treated as proof
for other providers.

**Mechanism.** The system has independent states for the dongo CLI credential,
MCP installation, repository marker/binding, runner token, model harness,
GitHub CLI, Wrangler, Convex, npm, browser sign-in, and browser authorization.
Older repository profiles also derived identity from checkout-local paths, so a
new worktree could look like an unrelated connection. Checks were action-first
and late rather than state-first and capability-specific.

**Why detection failed.** Onboarding and service tests exercised each happy path
in isolation. They lacked a matrix of healthy, absent, expired, partial, and
stale states across a canonical checkout and linked worktrees. Prompts used the
generic word “authentication,” hiding which boundary failed.

**Correction.** dong078 derives repository identity from the shared Git common
directory, reconciles legitimate worktrees, uses a per-repository single-flight
connection lock, and rejects unrelated clones. dong077 makes onboarding inspect
state before connecting. dong076 and dong084 cover bounded host credential
inheritance and release preflight.

**Invariant.** A login or connect flow starts only after a named capability
probe fails. The UI and agent must state which principal, provider, repository,
process, and scope were tested and what one action will change.

### RC8 — browser authorization had three independent layers

**Symptom.** Owners allowed `dev.dongo.so` and `dongo.so`, yet existing runner
tasks continued to report a saved denial and repeatedly requested the same
change. Chrome and Playwright also crashed during parallel review.

**Mechanism.** Runner `browserReviewMode`, Chrome's global site allow-list, and
one Codex task's cached Browser Use decision are distinct. Changing the first
two does not mutate a stale decision in an already-running task. Browser
profiles and debug ports were also shared by otherwise isolated jobs.

**Why detection failed.** Browser E2E tests used controlled fixtures and new
contexts. They did not exercise Codex extension settings, task-scoped cached
denials, or concurrent jobs contending for a real profile and port.

**Correction.** dong080 documents and verifies fresh-session read-only browser
review. dong082 owns leases for non-isolatable review resources. Each Playwright
worktree requires a unique port and profile unless it holds the shared lease.

**Invariant.** Release work starts only after a fresh task proves access to each
documented origin. A fresh success plus an old task denial is a stale task
session, not a global-permission failure. Never ask the owner to change a setting
already proved correct.

### RC9 — source isolation was mistaken for resource isolation

**Symptom.** Parallel jobs experienced Playwright/Chrome crashes, host-load
timeouts, stale-server validation, and deployment contention.

**Mechanism.** Git worktrees isolate source files. They do not isolate a fixed
debug port, browser profile, live-provider conversation, deployment target,
package version, or constrained host CPU/memory. Tests could connect to another
worktree's existing Vite server and validate stale code.

**Why detection failed.** Most suites ran serially or assigned the default port.
The concurrency suite proved job count, not contention across real external
resources.

**Correction.** dong082 defines bounded leases for truly shared review and
release resources. Unshared implementation and unit tests remain parallel.

**Invariant.** Every external or process-global resource declares whether it is
unique per job or leased. A job may not use a default port/profile/target whose
owner cannot be proved. A lease reports holder, wait reason, timeout, and fair
handoff.

### RC10 — terminal truth was split across Work, Run, job, process, and Attention

**Symptom.** Comments said work was integrated or live while Agent Activity
still said Running. Answered blockers remained visually dominant. Dead jobs
appeared to consume slots, and a live process could have a failed Run.

**Mechanism.** “Implementation complete,” Git integration, deployment, and Work
Done are separate milestones. The runner job, Run, Work claim, harness process,
Attention, and cached queries each had an independent lifecycle. Terminal
reconciliation was delayed or wrong, and the UI collapsed states to Running,
Blocked, or failed.

**Why detection failed.** Component tests asserted individual labels and state
transitions. They did not verify a full cross-entity terminal convergence bound,
cache invalidation after answered Attention, or a vanished process with a stale
lease.

**Correction.** dong083 adds activity phases, update age, next action, process
exit presentation, periodic reconciliation, and prompt release of capacity.
The exact-job correction in RC3 is required before its reconciliation can be
trusted under retries.

**Invariant.** Within one bounded reconciliation interval, terminal process or
job state must produce one terminal Run, release the Work claim, restore or
complete Work as appropriate, release capacity, archive resolved Attention, and
invalidate Overview plus open-detail caches. Milestone prose never overrides
canonical state.

### RC11 — runner availability was modeled as a boolean

**Symptom.** Work detail said `No local runner is connected` while the exact
LaunchAgent PID was alive, protocol 0.3.0 was reporting, and current jobs
included `dong072`, `dong073`, and `dong086`.

**Mechanism.** The presentation path used an empty compatible/eligible harness
set as the fallback for “not connected.” Busy, at-capacity, wrong approval mode,
temporarily ineligible, recently seen, service alive, and no registration were
not separate display states.

**Why detection failed.** Fixtures covered no runner, offline runner, and a
simple online runner. They did not cover a connected runner whose current jobs
consume host/project capacity or whose eligibility changes while a detail
drawer is open.

**Correction required.** Derive and expose a typed availability reason. At a
minimum: not registered, service offline, online/waiting, online/busy,
at host capacity, at project capacity, harness unavailable, approval required,
and temporarily unhealthy. Keep registration presence independent of whether a
new job can be queued now.

**Invariant.** “No runner connected” is legal only when no active registration
exists. Capacity or eligibility may disable an action, but must never erase the
connected runner's identity or current jobs.

### RC12 — public smoke did not exercise the auth control plane

**Symptom.** A real production CLI received a transient authorization-server
500 while the public smoke result remained green.

**Mechanism.** `scripts/smoke-production.mjs` checks auth health/readiness,
authorization metadata, protected-resource metadata, and an unauthenticated MCP
challenge. It does not make a safe device-code request. Static metadata and
readiness can be healthy while the D1-backed authorization mutation path fails.

**Why detection failed.** Unit tests and package verification use controlled
stores or fake servers. The live release gate omitted the first state-changing
step used by every fresh CLI connection and had no synthetic alert for it.

**Correction required.** Add a bounded synthetic device-authorization probe
using a dedicated non-user client and immediately expire or deny the disposable
request. Verify expected status/schema, backing-store reachability, and safe
cleanup. Alert separately from broad service readiness.

**Invariant.** A green auth release requires one real, non-sensitive,
reversible transaction through every critical control-plane dependency, not
only health, readiness, and discovery documents.

### RC13 — the internal timeout was shorter than the runner long poll

**Symptom.** The wiwi runner preserved its exact active job and process but
cycled through `temporarily_unavailable`, reaching 56 consecutive failures.
The same installation could appear `running` while a new request was in flight,
then return to `recovering` when that request reached the same bound.

**Mechanism.** The CLI requests `runner_wait` with `waitSeconds=20`. The Convex
gateway may legitimately keep that operation open for the full 20 seconds while
checking for a refill job. Both `ApiConvexOperationExecutor` and the outer API
gateway used their generic timeout for `runner_wait`; they extended the timeout
only for `get_updates`. The first correction extended only the executor. In the
live acceptance run, the outer gateway still aborted the request first, relayed
that cancellation into the executor, and surfaced `request_cancelled`. A
healthy wait with no job therefore still could not complete through the API.

**Why detection failed.** Contract and runner tests covered the 20-second
advertised bound, and API tests covered signed forwarding, but no test composed
the runner wait with the API executor's upstream timeout. The local health file
retained only the safe error code, so the timeout looked like auth, capacity, or
transaction contention until the full call chain was inspected. Production
Convex history for the affected window showed no failed, retried, or optimistic-
concurrency executions.

**Correction.** Treat `runner_wait` as a bounded long-poll operation at every
API layer. The executor's upstream budget is the greater of the ordinary
timeout and the requested wait plus a five-second completion margin. After the
authenticated request body is validated, the outer gateway applies its larger
ten-second completion margin without moving validation ahead of authentication.
Exact-job zero-second polls retain the ordinary timeout at both layers.

**Invariant.** Every public long-poll duration must fit inside every downstream
timeout on its path, with bounded completion margin. A successful empty wait is
normal liveness, not a service failure.

### RC14 — process-tree diagnostics crossed the secret-output boundary

**Symptom.** During follow-up diagnosis, a macOS `pgrep -fl` process-tree check
included a live provider credential in the child process's rendered command
string. The value was not written to either repository or committed, but it
entered an internal task trace and therefore required rotation.

**Mechanism.** A release harness may launch a child with credential-bearing
environment assignments represented in the process command string. Tools and
flags that promise a “full” process listing report that string verbatim. A
process-tree query that appears read-only can therefore cross the same secret
boundary as shell tracing or an environment dump.

**Correction.** The active release was stopped at a safe boundary and durable
owner Attention recorded the exact rotation and verification path without the
credential value. Future diagnostics use an explicit allow-list of PID, PPID,
process group, state, elapsed time, and executable name only. Full argv,
environment, and broad process listings are prohibited during secret-bearing
release work.

**Invariant.** Operational process inspection is schema-bound and redacted.
“Read-only” does not make argv or environment safe to retain.

## Systemic causes

The individual defects shared five organizational causes:

1. **Policy was presented as capability.** Project capacity, enabled runner,
   browser review mode, and provider configuration described intent rather than
   a freshly proven end-to-end ability.
2. **Identity was too coarse.** WorkItem, repository URL, provider name, and
   “authenticated” were used where exact job, Run, common directory, process,
   credential principal, and task session were required.
3. **Local happy-path tests ended before real boundaries.** Fakes did not model
   launchd behavior, Codex sandbox grants, ignored worktree configuration,
   extension permission caches, or live authorization storage.
4. **Recovery was designed after terminalization, not as one state machine.**
   Expiry, retry, resume, requeue, Attention, and cleanup paths were individually
   reasonable but not proven against interleaving old and new attempts.
5. **Status optimized for brevity over operational truth.** The UI omitted the
   reason a slot was unusable, whether a process was alive, whether an owner
   action had taken effect, and what would happen automatically next.

## Prevention invariants

These invariants are release gates, not documentation suggestions:

1. `runner_job_id`, `external_session_id`, `run_id`, and Work claim form one
   immutable ownership tuple for the life of an attempt.
2. Historical or terminal attempt A cannot mutate active attempt B for the same
   WorkItem.
3. An enabled runner restarts after unexpected clean or failed exit; a disabled,
   removed, revoked, or terminally unauthorized runner cannot restart.
4. Service stop/disable is fail-closed and observable. Errors are not swallowed
   before local configuration changes.
5. New Codex jobs receive write access to exactly the validated worktree and its
   same-repository Git common directory, and to nothing broader.
6. A repository job proves `fetch`, commit-object creation, ref/lock access, and
   cleanup before it acquires Work ownership.
7. Release preflight resolves one explicit remote Convex deployment and every
   required provider inside the exact job process before any mutation.
8. Secrets remain in approved host stores or process memory; logs, worktrees,
   prompts, comments, artifacts, and Git never contain their values.
9. Each shared browser, port, live-provider, deploy, and publish resource is
   isolated or leased with bounded wait and visible ownership.
10. Configured project capacity, host capacity, active jobs, and reservable slots
    are distinct fields and cannot be inferred from one another.
11. Terminal state converges across process, job, Run, Work, Attention, capacity,
    and UI caches within one documented bound.
12. Login/connect/browser prompts name one failed capability and are suppressed
    when that exact capability passed in the current process/session.
13. Production smoke executes one safe transaction through each critical
    control plane, including device authorization, rather than relying only on
    health or metadata.
14. A retry is never the default response to an ownership conflict. Operators
    pause the Work until the invariant violation is fixed.
15. Every advertised long-poll duration is shorter than its API and internal
    gateway budgets, and an empty maximum-duration wait completes successfully.
16. Release diagnostics never retain full process argv or environment; an
    allow-listed process identity view is the only accepted evidence.

## Safe operator response

### During this incident

1. Pause the affected WorkItem. Do not select repeated Retry, create duplicate
   Work, manually alter Convex records, or mark the Work Done.
2. If the same Work is being terminated seconds after start, leave it Ready and
   stop its automatic retries until the exact job/Run association fix is live.
3. Capture safe facts only: Work identifier, runner job ID, Run/session ID,
   revision, service label, process-alive state, safe error code, and timestamp.
4. Compare three independent layers:
   - `dongo runner status` for registration, current jobs, and safe state;
   - the user service manager for process presence;
   - dongo Overview/Work detail for canonical Run and Work state.
5. Treat a successful `git ls-remote` followed by local `FETCH_HEAD` or lock
   permission denial as a sandbox write-boundary failure, not GitHub auth.
6. For a stopped enabled LaunchAgent, restart only the exact registered service
   after confirming it does not own live jobs. Do not repeatedly kickstart a
   service that immediately exits or has terminal authorization.
7. Before any deployment, inspect the plan. It must name the approved remote
   Convex deployment and exact environment. Stop if it proposes local Convex,
   an unknown target, or only a subset of the coherent stack.
8. Use the queue-creation kill switch in the local-runner runbook if new jobs
   must be stopped globally. Do not cancel already-running jobs without mapping
   each process to its exact job and Run.
9. Reauthenticate only the provider whose probe fails in the exact job context.
   Never paste a token or authorization code into dongo or chat.
10. For browser denial, compare runner read-only mode, global site permission,
    and a fresh task probe. Replace a stale task session instead of weakening a
    correct global policy.

### Recovery after the corrective release

1. Disable new runner queue creation and let valid jobs drain; preserve blocked
   job/Run mappings as incident evidence.
2. Deploy backend compatibility and exact-job reconciliation before upgrading
   local clients.
3. Integrate dong084/PR #24 so release plans fail closed on unresolved targets.
4. Publish the combined CLI version once; do not reuse 0.2.12 or compute payload
   provenance before every corrective CLI commit is present.
5. Upgrade each registered runner from its canonical checkout. Verify the owner
   enable sentinel, service restart semantics, exact common-directory grant,
   trusted deployment policy, and current version.
6. Re-enable queue creation for one canary project. Start two disposable Work
   attempts, terminate one process, and verify that only its exact Run changes.
7. Fill the canary to host capacity, release one slot, and prove prompt refill.
8. Requeue only the latest eligible lease-expired automatic jobs using supported
   product operations. Older failures remain historical evidence.
9. Repeat canary acceptance in wiwi before broad rollout.
10. Reconcile stale Attention and Work through normal operations, then verify
    Overview and open detail agree before closing the incident.

## Acceptance matrix

| Scenario | Required proof | Failure that it prevents |
|---|---|---|
| One Ready job | One exact job creates one exact Run and worktree | Basic delivery regression |
| Six Ready jobs | Six distinct sessions/worktrees run up to host and project limits | Serial dispatcher / false capacity |
| Slot refill | A seventh job starts after one terminal transition within the documented bound | Stalled Ready backlog |
| Old A, new B | Reconciling terminal job A cannot change Run B | Claim-conflict abandonment race |
| Runner clean exit | Enabled service restarts and reports the same registration | launchd clean-exit stop |
| Disable/revoke | Sentinel disarms, process stops, and no restart loop occurs | Revocation loop / false disable |
| Stop failure | Command fails visibly and config remains unchanged | Swallowed bootout failure |
| Linked worktree Git | Fetch, object/ref write, commit, and cleanup succeed in the harness sandbox | Git common-dir denial |
| Malicious common dir | Symlink, unrelated repo, wrong owner, and broad parent grants are rejected | Sandbox widening |
| Clean release worktree | Exact remote targets and all provider probes pass before mutation | Local Convex fallback / late auth |
| Missing deployment config | Whole release stops before the first mutation with a named safe error | Partial incoherent deploy |
| Expired one-provider credential | Only that provider is requested and a new job sees refreshed state | Generic repeated login |
| Existing repository binding | A linked worktree self-reconciles without browser connect | Duplicate dongo authorization |
| Stale browser denial | Fresh task succeeds without changing correct global permissions | Repeated browser blocker |
| Parallel browser tests | Unique ports/profiles or a visible lease prevent cross-worktree attachment | Stale UI validation / crashes |
| Shared release target | Only one holder mutates; other jobs show a bounded resource wait | Deployment collision |
| Terminal process | Job, Run, Work, Attention, capacity, Overview, and detail converge | Ghost active cards |
| Connected but busy | UI says connected/busy or at capacity, never disconnected | False “No runner connected” |
| Auth synthetic | Device-code request reaches live backing store and is safely expired/denied | Green smoke during auth 500 |
| Restart during active work | Exact jobs recover or fail once; no duplicates and no ownership drift | Restart amplification |
| Serial old client | Additive protocol preserves one-job behavior | Upgrade breakage |
| Empty 20-second runner wait | API and Convex complete normally without incrementing runner failures | False `temporarily_unavailable` recovery loop |
| Secret-bearing release process | PID/PPID/group/state/executable-only inspection; no argv or environment | Credential disclosure through diagnostic logs |

The matrix must run on macOS and Linux where service behavior differs, and at
least the launchd, Codex sandbox, Chrome extension, and live auth rows require
real-system acceptance rather than only in-process fakes.

## Prioritized remediation

| Priority | Remediation | Owner / Work | State at report time |
|---|---|---|---|
| P0 | Require exact immutable job/session/Run association and regression-test old A versus new B | dong085 | In progress |
| P0 | Replace launchd clean-exit policy with an enable sentinel; make disable/stop fail closed and prevent revoked restart loops | dong085 | In progress |
| P0 | Grant exactly the validated Git common directory to new Codex jobs; conservatively restart unprovable resumed sessions | dong085 | In progress |
| P0 | Make development and production targets fail closed before any mutation | dong084, PR #24 | Ready for integration |
| P0 | Add transactional production auth synthetic and alerting | Follow-up required | Unassigned |
| P0 | Carry the bounded `runner_wait` duration into the API-to-Convex timeout and verify both live runners remain stable | dong085 | Fix in progress |
| P1 | Keep terminal reconciliation and Agent Activity truthful after the exact ownership fix | dong083 | Implementation integrated; final acceptance pending |
| P1 | Render runner registration, liveness, busy, host capacity, project capacity, compatibility, and eligibility separately | Follow-up required; adjacent to dong083/dong085 | Unassigned |
| P1 | Use state-first, single-flight repository connection across linked worktrees | dong077 and dong078 | Implementation integrated; release follow-through pending |
| P1 | Preflight allow-listed host deployment credentials in the exact job process | dong084; GitHub adjacency in dong076 | Implementation integrated; corrective release pending |
| P1 | Prove fresh-task browser review and remove stale task denials from the recovery path | dong080 | Documentation and fresh-session proof integrated; lifecycle follow-up pending |
| P1 | Lease shared browser, live-provider, deployment, and publication resources | dong082 | Ready |
| P2 | Add real launchd/systemd lifecycle, Codex sandbox, Chrome permission-cache, and clean-worktree release test lanes | Follow-up required | Unassigned |
| P2 | Replace generic authentication and blocked copy with capability-specific diagnosis and next action | dong077/dong083 plus follow-up | Partial |
| P2 | Add an operator incident view for job/Run/session mapping and reconciliation age | Follow-up required | Unassigned |

No item is Done merely because its source commit is present. Each owner must
record protected integration, exact-revision development acceptance, required
production outcome, and clean shared-target proof under the repository's normal
completion contract.

## Evidence reviewed

- Owner screenshots and repeated reports from dongo and wiwi on 2026-09-04.
- Live runner status showing concurrent current jobs and four Codex child
  processes after kickstart.
- `packages/cli-core/src/runner.ts` dispatcher, worker, aggregate-state, and
  recovery behavior.
- `packages/cli-core/src/runner-service.ts` launchd/systemd install, disable, and
  remove behavior.
- `packages/cli-core/src/runner-workspaces.ts` linked-worktree identity and
  lifecycle.
- `packages/cli-core/src/runner-deployment-access.ts` trusted configuration and
  provider probes.
- `convex/domains/runner/index.ts` reservation, expiry, terminal reconciliation,
  and bounded requeue logic.
- `convex/domains/work/index.ts` concurrency and Agent Activity read model.
- `apps/web/src/features/overview/Overview.tsx` runner availability and detail
  presentation.
- `scripts/smoke-production.mjs` and `scripts/smoke-dev.mjs` live smoke scope.
- `pitfalls.md` and the local-runner, agent-auth, release, completion, and
  deployment runbooks.
- Integrated changes for dong078, dong083, dong084, and dong085, including PRs
  #22 and #23, plus the pending fail-closed PR #24.

## Exit criteria

This incident can close only when:

- every P0 correction is integrated and released as one coherent candidate;
- the complete acceptance matrix is green for dongo and wiwi, with real-system
  evidence for launchd, sandbox, browser, deployment, and auth boundaries;
- no old terminal job can mutate a newer Run in a forced retry test;
- an enabled runner survives clean exit and a revoked runner stays stopped;
- a clean release worktree cannot select local Convex or partially deploy;
- production auth synthetic monitoring detects the previously missed failure;
- owner-visible status agrees with service, process, job, Run, Work, Attention,
  and capacity state within the documented reconciliation bound;
- stale Work and Attention created during the incident are reconciled through
  supported operations; and
- `pitfalls.md` and the affected runbooks are updated with any final facts that
  differ from this open report.
