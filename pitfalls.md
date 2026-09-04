# dongo pitfalls

This file records failure modes observed while operating the local runner and releasing work. It is an operational supplement to the runbooks, not a substitute for their gates.

## 2026-09-04 incident: why an enabled runner left work idle or blocked

The failures observed during the dongo and wiwi releases were a chain of independent capability and reconciliation gaps. The repeated prompts made them look like one authentication problem, while the idle capacity made them look like an agent limitation. Neither explanation was complete.

### Causal chain

1. **The local dispatcher was serial.** The runner advertised the project's multi-Run capacity but awaited one job handler before reserving another job. The service also returned a registration's existing job from the general reserve path. A single registered computer therefore used zero or one slot even when isolated worktrees and additional Ready work were available.
2. **Polling and capacity accounting were not designed as one concurrent system.** The dispatcher used zero-second reserve polling while a worker was active, which could hammer the service and make recovery/refill noisy. Server capacity counted active runner jobs but omitted already-live non-runner Runs, so the advertised project limit was not a truly global atomic limit.
3. **A transient service failure did not lead to useful recovery feedback.** The runner reported `temporarily_unavailable`, later recovered to `waiting`, and had no current jobs, but the UI did not explain the recovery or why Ready work was still not being consumed.
4. **Authentication was checked too late and at the wrong scope.** GitHub CLI, Wrangler, dongo CLI, repository binding, and browser access are separate capabilities. Jobs discovered invalid or invisible credentials only at integration or release time, after substantial work, and then each emitted its own authentication request.
5. **Isolated worktrees lacked an explicit trusted-configuration bridge.** Git history is shared, but ignored files are not. Release jobs could see source code yet fail to resolve the same Convex, Cloudflare, GitHub, or npm context as the owner's checkout.
6. **Browser authorization had three disagreeing layers.** Runner read-only mode, global Chrome site permission, and a task's cached Browser Use decision could disagree. Already-running tasks retained a stale denial after the global allow-list was correct, causing repeated requests and preventing self-review.
7. **Shared review and release resources were uncoordinated.** Parallel source work reused browser profiles, ports, Playwright processes, live-provider conversations, and deployment targets. This produced crashes, host-load timeouts, and unnecessary serialization or blocking.
8. **Recovery could mutate state before proving resumability.** Recovery of running or blocked work could prepare a missing deterministic worktree before the exact agent session had successfully resumed. That obscured whether the original workspace was recovered, replaced, or still absent.
9. **Registration status was last-writer-wins instead of an aggregate.** With multiple workers, whichever worker wrote last could make the whole computer look waiting, running, or failed even when sibling jobs had different liveness.
10. **Milestones were mistaken for terminal state.** Agent comments correctly said code was integrated or live, but the Run was not explicitly finished or its exit was not reconciled. Answered Attention remained visually dominant, and stale Runs continued to consume or appear to consume capacity.
11. **The UI compressed distinct states into `Running`, `Local run failed`, or `waiting for your blocked`.** It did not identify whether the process was alive, whether implementation was done, which external gate remained, whether the owner had already responded, or whether automatic recovery would occur.

### Product requirements derived from the incident

- Run a startup preflight before claiming release-bound work. Report each capability independently and authenticate only the layer proven invalid.
- Give runner jobs a non-echoing, allow-listed bridge to the owner's existing GitHub, Cloudflare, deployment, and browser-review capabilities. Verify the bridge inside the exact job process and worktree.
- Dispatch multiple jobs concurrently with one isolated worktree and one dongo session per WorkItem. Refill capacity automatically, while separately leasing genuinely shared resources.
- Use additive runner protocol changes so installed serial clients continue to work while newer dispatchers reserve and poll exact jobs independently.
- Reconcile process exit, Run state, runner-job state, Work state, Attention resolution, and cached UI queries within bounded time. A terminal job must release capacity without manual cleanup.
- Make recovery visible: show the failed component, last successful transition, retry policy, current process liveness, next automatic action, and exact owner action only when one is genuinely required.
- Test a clean-account installation as a product journey: already-authenticated, expired-auth, absent-auth, dirty checkout, multiple Ready items, six-slot fan-out, restart during work, stale browser decision, shared-resource contention, completion, and upgrade compatibility.
- Do not advertise six usable slots from a registered runner until an end-to-end probe has demonstrated concurrent reservation, isolated worktrees, independent sessions, and prompt refill on that installation.

## Check state before starting authentication

- Do not treat “use dongo” as a request to run `dongo connect` or open a login flow.
- Check the layers independently: installed CLI version, CLI authorization, repository binding, `dongo doctor`, hosted MCP availability, GitHub CLI access, Cloudflare/Wrangler access, and browser-review authorization.
- Start a new login or connection only after a specific layer is proven missing or invalid. Explain which layer failed and what the login will change.
- Browser sign-in, repository binding, CLI authorization, MCP authorization, GitHub authorization, and Cloudflare authorization are separate states. One succeeding does not prove the others.
- Treat Wrangler OAuth as host-scoped but verify it from the exact isolated runner checkout before resolving every matching release blocker. One successful trusted-terminal refresh should unblock all runners using that host credential; individual jobs should verify and resume, not each initiate another login flow.

## Isolated worktrees do not inherit ignored configuration

- A Git worktree shares repository history, not ignored files such as `.env` or `.env.local`.
- Before a runner attempts deployment, validate that the exact isolated release checkout can resolve its named Convex deployment and Cloudflare account. Never let a missing deployment target silently fall back to a local Convex backend.
- Reuse trusted owner configuration through an explicit, non-echoing mechanism. Do not copy secrets into worktrees, dongo comments, logs, artifacts, snapshots, commits, or command output.
- Report the missing capability or configuration source by safe name only. Do not print values while diagnosing.

## Parallel agents still need shared-resource coordination

- Separate worktrees make source edits parallel; they do not make every external resource parallel.
- Serialize only the scarce shared resource: production/development deployment, a fixed browser debug port, a shared Playwright browser profile, a live WhatsApp conversation, or a single test sender/receiver.
- Keep unrelated implementation, tests, review, and CI parallel. A project-wide single-job runner defeats the purpose of worktree isolation.
- Represent shared-resource ownership with a bounded claim or lease, a visible waiting reason, timeout/recovery behavior, and fair handoff. Do not improvise coordination by leaving unexplained “Running” cards.
- Map processes to their worktree and Run before sending `STOP`, `CONT`, or termination signals. Record any mistaken intervention honestly.

## A Run is not complete because its latest comment sounds complete

- “Implementation complete,” “pushed,” “merged,” and “release is live” describe milestones; none automatically closes the Run.
- Finish Work only after the agent has called the finish operation and the service has reconciled the Run, lease, runner job, and Work state.
- Agent Activity should distinguish actively executing, waiting for CI, waiting for a shared resource, waiting for the owner, paused, process exited, and stale/failed reconciliation.
- When Attention is answered and a replacement Run starts, invalidate both Overview and open-detail state. Move the answered request into clearly resolved history; never leave its dominant `BLOCKED` badge beside a current `Working` status or hide the resolution below the fold.
- A finished or vanished process must be reconciled within a bounded interval. Stale Attention from a dead process should be resolved or cancelled and must not continue consuming an active slot.
- When an old Run cannot resume, return the WorkItem to Ready with an explicit truthful reason. Start a fresh Run after the underlying capability is fixed.

## Release completion must be tied to one exact revision

- A feature branch, passing local tests, a PR, or a green pre-merge workflow is not the production outcome.
- Fetch the shared target again, prove the delivered commits are integrated, and verify from a clean checkout synchronized to the exact target revision.
- Run development deployment and acceptance first. Promote the same accepted revision to production, then run post-cutover checks before finishing Work.
- If another commit lands during acceptance, restart the necessary integration and release checks for the new shared target rather than describing the older candidate as current.
- A deployment failure that stops before later services mutate is not a release. Record exactly which stage changed and which did not.

## GitHub status can be internally inconsistent

- A workflow summary may become terminal before an individual job envelope updates.
- Prefer the job/check's own terminal state for required gates. When the envelope is stale, inspect constituent steps, timestamps, workflow conclusion, and check-run state; wait only for a bounded interval.
- Record status-propagation ambiguity as infrastructure evidence. Do not call a missing conclusion a pass, and do not wait forever after every constituent step is terminal.

## Browser review needs an explicit capability, not an ad hoc permission plea

- Configure browser review on the runner before launching a job that requires live acceptance.
- Treat runner authorization, the Chrome Browser Use site list, and the browser session attached to one Codex task as separate gates. `browserReviewMode: read_only` exposes and scopes the browser tool; an explicit **Allow browsing** entry in **Codex Settings → Google Chrome → Site permissions** authorizes the origin globally, but an already-running task can still retain a stale session-scoped denial.
- Preflight every repository-documented review origin from a fresh Browser Use session before starting release work. If a fresh session cannot open an origin such as `dev.dongo.so`, show the owner the exact settings path and current entry. If a fresh session succeeds while an older task reports `persisted_user_denied`, classify the older result as stale or task-scoped, recreate only that task's browser session, and do not tell the owner to change an already-correct global setting.
- Never report “browser permission changed” merely because the runner mode changed or an Attention option was selected. That option only asks the agent to retry; it does not mutate Codex settings. Prove the exact origin can be opened from the intended runner task, and preserve a truthful distinction between the owner-visible setting, a fresh-session probe, and the current task's cached result.
- Default to disabled. When the owner enables read-only review, restrict it to declared project origins and non-mutating actions; do not sign in again, change data, open unrelated tabs, or weaken browser security.
- Intake triage does not need browser control. Grant browser review only to repository Work whose acceptance criteria require it.
- A prior Attention response cannot retrofit browser access into a stopped process. Resolve the stale request and launch a fresh Run under the corrected runner configuration.
- Playwright and Chrome can crash when several jobs share a profile, port, or host resources. Use isolated profiles/ports where possible and a shared-resource lease where isolation is impossible.

## macOS background-service updates can race

- Changing runner configuration may require a LaunchAgent restart. A failed reload can leave the old service running even when the configuration write was rolled back safely.
- Inspect the exact registered service label and current jobs before intervening. Never restart a runner while it owns active work unless the recovery procedure explicitly preserves those Runs.
- With zero jobs, stop the exact service, apply configuration once, and verify the new process, registration, waiting state, and effective configuration.
- The background-item name shown by macOS comes from the installed executable or service identity. Use a product-specific executable name so the operating-system notice says `dongo`, not a generic runtime such as `node`.

## Keep diagnostics narrow and private

- Search the repository and known configuration locations first. Avoid broad home-directory scans that enumerate unrelated projects.
- List filenames or variable names only when that is sufficient. Never echo credential values, authorization codes, signed URLs, or token-bearing configuration.
- Prefer read-only checks before mutations: runner status, process state, Git status, remote revision, authentication status, and deployment plan.
- Every user-visible status should say what is happening now, what it is waiting for, whether a process is alive, what happens next, and whether the user must act.
