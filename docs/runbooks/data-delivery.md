# Claims, export, attachments, and notifications

## Expired or lost claims

Claims are leases, not permanent ownership. A local agent must renew while actively working. If a lease expires, dongo closes stale activity, clears the claim, and makes the item reclaimable; the UI must not present it as currently working.

1. Run `dongo session-start --json` to refresh server truth.
2. Fetch the item and compare its current revision and claim status.
3. If reclaimable, start it normally. If another installation owns a live claim, do not bypass it.
4. A stale update or finish must return a conflict/lease error. Re-read, reconcile, and submit a new mutation with a new idempotency key.

Never patch claim rows directly. If reconciliation jobs are failing, inspect recent Convex function logs by safe request ID and recover the scheduler/backend before allowing more autonomous work.

## Parallel Run admission and visualization

Single-agent is the default. Owner-enabled parallel work allows only separate
sessions to claim separate WorkItems, up to the project's 2–8 concurrent-Run
safety cap. The cap is unrelated to the free-plan active-project allowance.

For an additional concurrent start, confirm all of the following from canonical
state:

1. Project `parallelExecution.enabled` is true and capacity remains.
2. The new external session is distinct and owns no active WorkItem.
3. That session reported both parallel execution and worktree isolation as
   supported.
4. The start reports `workspace.kind: "worktree"` with no absolute local path.
5. The target WorkItem is still eligible for an atomic claim.

`parallel_execution_unavailable`, `concurrency_limit`, and
`session_work_limit` are non-retryable for that attempted mutation. Refetch
policy, capacity, active Runs, session ownership, and the WorkItem before making
a later decision. Never repair one by inventing capabilities, rotating a session
ID, weakening a claim, or restarting authentication.

The human concurrency read returns `policy`, `capacity`, and `runs`. Render live
cards only from that authoritative subscribed state, with agent, canonical Work
identifier/title, Running/Waiting state, latest progress, elapsed time, lease
health, and safe workspace label. Use `Worktree · <branch>` when a safe branch
label is supplied, fall back to `Worktree · <worktree name>` when only that safe
label is supplied, use `Isolated workspace` when isolation is supported without
details, and use `Workspace details unavailable` otherwise. A shared checkout
keeps additional work serial. Generic CLI or installation presence is not an
active Run. dongo coordinates this state; the host creates agents, worktrees,
and branches.

## Intake edit conflicts and enrichment

Human Intake edits are allowed only before processing or dismissal, including
while an agent holds an active or stale triage claim. Saving preserves that
claim, emits an attributed `intake.updated` event, and increments the Intake
revision. An agent whose expected revision is now stale must refetch and review
the current text, context, links, and finalized attachments before completing
triage; never retry the stale mutation blindly.

When a human save receives `revision_conflict`, keep the unsaved draft, show the
canonical subscribed version, and offer an explicit merge/retry. When it
receives `invalid_transition`, keep the draft copyable but present the
processed/dismissed Intake as read-only. Do not implement last-write-wins or
discard either actor's changes silently.

Attachment enrichment is additive. Accept only available, unattached files
uploaded by the editing member for the same project and organization, with a
maximum of 20 total attachments. Re-adding an attachment already on that Intake
is a no-op; attaching a file used elsewhere is not. This slice does not remove
attachments. The saved Intake must retain text or at least one available
attachment.

Create, Inbox, detail, search, and source-Intake surfaces must consume the same
server-authoritative human `displayLabel`: first nonblank normalized text line,
then the first available filename, then `Untitled intake` for
legacy/deleted-data edge cases. Never persist fallback copy as user text. Live
Convex state is authoritative across surfaces.

## Ideas isolation and promotion

Ideas are human-only project data. Never include them in agent Overview, search,
snapshots, update delivery, HTTPS operations, CLI workflow commands, or MCP
tools. An attachment associated only with an Idea must remain unavailable to
agent reads and signed-download issuance.

Human Idea creation requires an idempotency key. Edit, reorder, archive,
restore, and promote additionally require the current revision. On revision
conflict, retain the human draft or intended order, refetch the canonical
Idea/list, and offer an explicit retry or merge. Do not use last-write-wins.
Only open Ideas may be edited, reordered, archived, or promoted; archived Ideas
may be restored, while promoted Ideas are terminal linked history.

Promotion must be one transaction:

1. Revalidate human project membership, current Idea revision/state, and every
   finalized attachment. Each attachment must be available, uploaded by the
   acting member in the same project/organization, associated with no other
   Idea/Intake/Work at capture time, and within the 20-file total.
2. Create one Intake from the canonical Idea. Its text is the title followed,
   when Idea text exists, by a blank line and that text; copy context and links.
   Associate the same finalized attachments with the Intake without removing
   their Idea provenance.
3. Store `idea.promotedIntakeId` and `promotedAt`, store
   `intake.sourceIdeaId`, and move the Idea to `promoted`.
4. Return the original result for exact-key replay. For any later promote key,
   return the same Intake with `created: false`.

Never create a second Intake for one Idea, even after a timeout or lost response.
Refetch the Idea before recovery. Promotion creates waiting Intake only; it does
not claim, assign, notify, or authorize an agent to start work.

## Retained Intake update stream

The versioned `intake_available` stream remains deployed for backward
compatibility, but the web app does not expose a human notification action.
The stream is bounded pull infrastructure, not a cross-harness wake mechanism,
and no UI may imply that it restarts, prompts, assigns, or reaches an agent.

For an active MCP or CLI host:

1. Start with `dongo_session_start`; its Overview is authoritative for existing
   Inbox Intake.
2. Legacy adapters may call MCP `dongo_get_updates` or CLI `dongo updates get`
   without a cursor. The cursorless pull starts at version 0 and drains retained
   signals. Refetch the Intake and ignore a signal whose item is no longer
   waiting in Inbox.
3. Pass the returned cursor unchanged. MCP may set `waitSeconds` between 0 and
   20. CLI may run `dongo updates wait --cursor N --timeout-seconds N` with a
   1–3600 second caller bound, defaulting to 300 seconds. The CLI composes server
   waits of at most 20 seconds. Each server wait checks after 1, 2, 4, and then
   at most 5 seconds between checks.
4. When `hasMore` is true, drain immediately with the returned cursor and MCP
   `waitSeconds: 0` or CLI `dongo updates get --cursor N` before waiting again.
5. On `updates_available`, refetch current Intake and existing Work before
   claiming. On `timed_out`, stop at the caller's deadline or begin another
   bounded wait only while the host remains active.

Never increment or guess the cursor, substitute an update ID for it, or use it
as an idempotency key. Reads require no idempotency key. A stopped agent learns
about current Inbox only when its host starts or resumes it and explicitly pulls
current dongo state. `dongo updates wait` works only while its CLI process
remains running.

Likewise, **An agent is waiting for updates** means the backend has a live
bounded wait for that installation. **No agent is waiting for live updates**
means only that no wait is open now; the Intake remains durable for the next
pull. Always pair stopped/offline state with **A stopped agent will not
restart**.

When delivery appears stuck, inspect update versions, returned cursors,
`hasMore`, wait status, and waiting-installation presence using safe identifiers.
Do not log Intake text or synthesize a cursor. A cursor validation error requires
refetching current server truth and restarting the retained-signal drain without
a cursor, not blind retry.

## Repository export conflict or corruption

Convex is authoritative and `.agent-work` export is one-way. `dongo sync` may replace only dongo-managed generated files; it never imports edits, stages, commits, or pushes.

Generated Work paths use the canonical `identifier`, which matches
`[a-z]{4}[0-9]{3}` (for example, `dong012`). Values in `legacyIdentifiers` are
exact project-scoped lookup aliases only: do not use them for new export paths,
rename a generated file to one, or synthesize another spelling. Search and copy
operations likewise return the canonical identifier even when an exact legacy
alias found the WorkItem.

```sh
dongo doctor --json
dongo sync --json
git status --short -- .agent-work
```

- If a generated file was edited, preserve a copy outside the managed tree, then rerun sync.
- If markers are malformed or a path is a symlink, stop. Do not follow the symlink or force-write through it.
- If cloud mutation succeeded but local write failed, rerun sync; do not repeat the cloud mutation.
- If a filename collision is reported, confirm that lookup and export stayed
  within one project, then inspect the canonical source identifiers and
  exporter version. The same compact identifier may validly exist in another
  project. Do not rename one generated file manually to conceal a collision.

## Upload or attachment failure

Uploads reserve quota before the browser/native client writes directly to R2. Convex must finalize metadata only after size/checksum validation. Signed links are short-lived and method-, project-, object-, and size-bound.

1. Check `/api/files/healthz` and `/api/files/readyz`.
2. Identify the safe request ID and attachment ID; do not record the signed URL or file contents.
3. Determine whether the reservation is pending, available, abandoned, or expired.
4. For an expired signature, request a new upload/download operation. Never extend or edit a signed URL.
5. Files through 32 MiB use one signed stream. Larger files use signed 8 MiB multipart parts. The web client retries a failed part against the same upload ID and retries completion safely; an explicit cancel aborts that upload before releasing the reservation.
6. If a browser loses the create response before learning the upload ID, it cannot resume that opaque R2 session. Abandon the Convex reservation and start a new one; the reservation expires after one hour and R2's incomplete-upload lifecycle performs the remaining cleanup.
7. If upload reached R2 but finalization failed, the Worker should remove that exact object. Verify cleanup by attachment/storage metadata, not bucket listing exposed to a client.
8. Quota, MIME, size, checksum, or ownership rejection is not retryable until the input is corrected. Checksummed browser uploads above 32 MiB are rejected until end-to-end multipart checksum verification is available.

Do not proxy large bytes through Convex or the app Worker, attach an unfinalized object, or grant a cross-project signed link.

## Notification failure

Notifications are scheduled from durable Attention events. The dispatcher claims due deliveries, signs a bounded private request to the notification Worker, records the provider result, and retries without creating a second logical delivery.

The signed delivery contract distinguishes Work, project, and optional Intake
targets. General owner Attention opens the project's Needs You surface so the
response card stays visible; an Intake association remains an opaque target
identifier and never adds raw Intake text to push payloads. Version-1 legacy
Work fields remain present as a bounded compatibility projection while Convex
and the notification Worker roll forward in dependency order.

1. Check `/api/notifications/healthz` and `/api/notifications/readyz`. The readiness response lists every provider's configuration state and the explicit `required` set. A live-but-not-ready response means dispatch or a required provider is absent or invalid. Development Web Beta requires dispatch plus Resend; before the native gate, change the required set to include APNs and FCM and supply their real credentials.
2. Inspect Convex delivery state and Worker logs using safe delivery/request IDs only. Notification payload text is private and must not enter logs.
3. Resolve configuration or provider availability before retrying. Do not mark a delivery sent manually.
4. Re-run the dispatcher; the same logical channel/escalation record must be reused.
5. Resolving the Attention must cancel or no-op any still-pending escalation.

For APNs/FCM token failures, disable or rotate only the affected device subscription. For email failures, verify the configured sender/domain and provider response class without logging recipient content or credentials.
