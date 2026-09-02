# dongo agent API artifacts

`v1/openapi.json` and `v1/agent-api.schema.json` are generated from the
transport-neutral operation registry in `@dongo/contracts`. They are the
machine-readable contract for HTTPS clients and non-TypeScript SDK generation;
the MCP gateway maps the same registry to tools.

## Ideas are outside the agent API

Ideas are a human-only backlog and intentionally have no HTTPS agent operation,
MCP tool, CLI workflow command, Overview lane, search result, snapshot record,
or update signal. Do not infer Ideas from attachment metadata or add a client
side compatibility operation for them.

A human may deliberately promote one open Idea. The human mutation atomically
creates exactly one Intake, stores `idea.promotedIntakeId` and `promotedAt`, and
stores `intake.sourceIdeaId`. Exact idempotency replay returns the original
result; any later promotion attempt also returns the original Intake with
`created: false`. It never creates a second Intake for the Idea.

Agents see only the resulting Intake through existing Intake reads and follow
the normal revision, claim, untrusted-input, and execution-mode rules. Promotion
does not assign the Intake or grant permission to start Work. Attachments remain
unavailable to agents while associated only with an Idea; promotion makes the
same finalized attachment references available through the new Intake.

## Parallel execution and workspace reporting

Projects expose `parallelExecution` with `enabled`, `maxConcurrentRuns`, and
`requiresIsolatedWorkspaces: true`. New projects are disabled. When enabled,
`maxConcurrentRuns` is an owner-configured safety cap from 2 through 8,
defaulting to 4; it is not a subscription limit. Disabled projects have an
effective capacity of one Run. The free-plan active-project allowance is a
separate organization-level entitlement.

At `session_start`, a host may report:

```json
{
  "hostCapabilities": {
    "parallelExecution": "supported",
    "worktreeIsolation": "supported"
  }
}
```

Each capability is `supported` or `unsupported` on input. Omission is preserved
as `undisclosed` in the returned session view; never infer support from agent or
client branding. Unsupported and undisclosed hosts remain compatible with
serial execution.

The CLI equivalent is:

```sh
dongo session start --session-id SESSION --parallel-capability supported --worktree-capability supported
```

Provide both capability flags or neither.

`start_work` may report bounded workspace metadata:

```json
{
  "workspace": {
    "kind": "worktree",
    "worktreeName": "dong016-docs",
    "branch": "codex/dong016-docs"
  }
}
```

`kind` is `worktree`, `shared_checkout`, or `undisclosed`. `worktreeName` and
`branch` are optional bounded labels; never send an absolute local path. Run
snapshots return the normalized host capability and workspace values for live
human visualization.

The CLI passes the same fields with `dongo work start --workspace-kind
worktree [--worktree-name NAME] [--branch BRANCH]`. Worktree/branch labels
require `--workspace-kind`, and `--worktree-name` requires `worktree`.

Every Work start is still an atomic per-item claim, and one session may own at
most one active WorkItem. An additional concurrent start requires a distinct
session, project opt-in and remaining capacity, both capabilities reported as
`supported`, and `workspace.kind: "worktree"`. The stable errors are
`parallel_execution_unavailable`, `concurrency_limit`, and
`session_work_limit`; refetch policy/capacity and do not retry blindly. dongo
coordinates claims and Runs, while the host creates agents, worktrees, and
branches.

`parallel_execution_unavailable.details.reason` is `project_disabled`,
`host_unsupported`, `host_undisclosed`, or `isolated_workspace_required`.
`concurrency_limit` reports current `activeRuns` and `maxConcurrentRuns`.
`session_work_limit` reports the session's `activeWorkItemId`. These are
non-retryable responses to the attempted start; a later start is a new decision
made only after the relevant state changes and is refetched.

The one-active-item invariant is per session, not a project-wide recommendation
to serialize. When a user authorizes processing multiple independent issues and
`session_start.instructions.parallelExecution.mode` is `parallel`, a capable
coordinating host should use its native agent delegation to create distinct
sessions and isolated worktrees up to the smaller of remaining project
capacity, eligible issues, and available host slots. Each session receives one
Intake or WorkItem, performs its own duplicate check, and owns its own atomic
claim or start. As sessions finish, the coordinator may fill newly available
capacity until the authorized set is complete. Never rotate session IDs, share
an active Run, or fabricate workspace metadata to work around a rejection.

The human concurrency read model returns `policy`, `capacity`, and `runs` from
authoritative active-Run state. Live UI must not infer concurrency from generic
CLI activity or installation presence.

## New Intake update stream

`get_updates` is the transport-neutral read operation exposed to MCP hosts as
`dongo_get_updates` and to CLI users as `dongo updates get|wait`. Use it only
after `session_start`, whose Overview already contains current Inbox state.

- Omit `cursor` on the first call. It starts at version 0 and drains retained
  signals, closing the race between `session_start` and the first update pull.
  Pass the returned numeric cursor unchanged on every subsequent call; do not
  increment or guess it. Retained signals may be stale or overlap current
  Overview, so always refetch the referenced Intake.
- Set `waitSeconds` from 0 through 20. A positive value performs one bounded
  wait with server checks after 1, 2, 4, and at most 5 seconds between later
  checks.
- When `hasMore` is true, call again immediately with the returned cursor and
  `waitSeconds: 0` until the backlog is drained.
- Handle `updates_available`, `timed_out`, and `not_requested` explicitly. A
  stopped client is never restarted and receives current Inbox only on its next
  session start or pull.

`dongo updates get [--cursor N]` performs one immediate pull. `dongo updates
wait [--cursor N] [--timeout-seconds N]` composes server waits of at most 20
seconds within a 1–3600 second caller bound, defaulting to 300 seconds. Preserve
the cursor returned in the command's JSON data and drain `hasMore` immediately.
The wait command receives signals only while that CLI process remains running.

An `intake_available` update is a versioned hint to refetch Intake, inspect
existing Work, and then compete for the normal atomic claim. Its `normal` or
`important` priority does not assign the Intake or bypass concurrency. Reads do
not use idempotency keys, and the cursor is not an idempotency key.

The response contains `cursor`, `updates`, `hasMore`, `wait`, `delivery`, and
`serverTime`. Each update contains `id`, `version`, `kind`, `intakeId`,
`priority`, and `createdAt`. `wait` reports the status, requested seconds, and
elapsed milliseconds. `delivery.mechanism` is `bounded_pull`, and
`delivery.stoppedAgentsRestarted` is always false.

The versioned Intake signal and nudge mutation remain available for backward
compatibility with already-loaded clients, but the web app exposes no human
notification action. A signal is never evidence that an agent harness was
woken, restarted, prompted, assigned, or that it consumed the update.

## Human Intake enrichment and agent revisions

Intake DTOs expose current text plus optional `context` and normalized HTTP(S)
`links` (at most 100). Humans edit
those fields through the authenticated Convex product mutation
`updateForHuman`; there is intentionally no agent `update_intake` operation in
the HTTPS or MCP contract. Attachments can be added but not removed in this
slice, and only available files uploaded by the editing member in the same
project may be added. Re-adding a file already attached to that Intake is a
no-op. The final Intake must retain text or an available attachment and may have
at most 20 attachments.

Both `new` and `claimed` Intake are editable. A successful human save emits an
attributed `intake.updated` event, advances `revision` and `updatedAt`, and
preserves the existing claim. `processed` or `dismissed` edits return
`invalid_transition`; a stale expected revision returns `revision_conflict`
with expected/current revision details. Agents must refetch the Intake after a
revision conflict—and immediately before completing triage—and act on the
current text, context, links, and finalized attachment metadata.

Human create, overview, detail, search, and source-Intake views use the
server-authoritative `displayLabel`: the first nonblank normalized text line,
then the first available attachment filename, then `Untitled intake` for
legacy/deleted-data edge cases. This is a human read-model field, not an agent
Intake field, and the fallback never invents Intake text.

## Work identifiers

Canonical Work identifiers match `[a-z]{4}[0-9]{3}` with no separator, for
example `dong012`. They are project-scoped: the same compact identifier may
exist in another project and must never be resolved outside the authenticated
project.

The four-letter project code comes from the first four ASCII letters in the
project's immutable lowercase slug. When the slug supplies fewer than four,
append ASCII letters from the legacy `identifierPrefix`, then append `x` until
the code has four letters. Work numbers are zero-padded from `001` through
`999`.

The canonical identifier is returned as `identifier` and is the value to
display, copy, search, place in links, and use in snapshot/export filenames.
Existing Work created under the earlier `${identifierPrefix}-N` format remains
addressable by that exact project-scoped alias. Responses expose those retained
values in `legacyIdentifiers`; accept them for lookup and show them only as
compatibility metadata, never as the preferred ID.

Creating item `999` is valid. Attempting to allocate `1000` fails before a Work
mutation is committed with HTTP `409`, code `identifier_exhausted`, message
`This project has used all 999 work identifiers`, and `retryable: false`.
Details contain `maxSequence: 999`, the authoritative `nextSequence` (initially
`1000`), and `action: "use_another_project"`. An idempotent replay of the
already-created `999` request still returns its original result because replay
resolution precedes allocation.

Regenerate after an intentional contract change:

```sh
npm run generate:contracts
```

CI runs `npm run verify:contracts` and fails when the checked-in artifacts drift
from the registry. Do not edit the generated JSON by hand.
