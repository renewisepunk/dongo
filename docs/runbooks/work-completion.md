# Repository Work completion

Done means integrated into the intended shared target and accepted live when
release is required. For this repository the target is `origin/main` and the
release requirements in [production-release.md](production-release.md) apply.
Local commits, passing tests, feature-branch pushes, PRs, and coordinator
handoffs do not meet that outcome.

From the clean integration checkout, run:

```sh
npm run verify:work-completion -- --target origin/main --commit FULL_INTEGRATED_SHA
```

Repeat `--commit` for each delivered integration commit. The helper fetches the
explicit shared target, rejects dirty/untracked state and missing/unmerged
commits, requires HEAD to equal the fetched target, and checks the remote again
before returning timestamped JSON evidence. It never merges, resets, deletes,
pushes, or calls dongo. Fetch failures are not successful offline checks.

For cherry-picks, rebases, and squashes, record each source commit and its actual
integrated commit, inspect the resulting diff, and verify behavior before using
the integrated SHA. The helper cannot determine missing task scope or later
reverts. It proves point-in-time Git facts, not live acceptance or a signed
attestation. Attach its evidence, test results, exact accepted revision, and
development/production outcomes to the active Run before `finish_work`.

## Pending coordination

Record `Implementation ready; integration/release pending`, exact branch and
commits, changed scope, checks, target, remaining gates, and responsible
coordinator on the existing Work. The implementation session remains active and
renews its lease while the coordinator integrates/releases under a separate Run.
Return integrated SHAs, source mappings, and acceptance evidence to that owning
session; do not share its Run or finish to free a concurrency slot.

Request Attention only for real human decisions/blockers. Routine coordinator
work does not require owner Attention. If the host must stop, persist the
handoff first and disclose that its lease may expire. On return pull answered
Attention, refetch Work and repository state, and atomically reclaim when
eligible before changes or completion. Do not create duplicate Work, cancel an
unfinished item, or reimplement already-committed changes to conceal the handoff.

Explicit user-authorized draft/local-only or no-merge scope remains a limited
exception and must not be described as shipped. Missing credentials or failed
gates are blockers, not exceptions. Non-repository tasks use evidence relevant
to their requested outcome.

## Agent guidance and compatibility

`packages/mcp/src/instructions.ts` supplies the shared completion preconditions
to MCP, managed host integrations, and both local runner adapters. Regenerate
the checked-in assets with `node scripts/generate-managed-integrations.mjs`;
`--check` and the MCP integration tests detect stale assets. Update an installed
host only through the supported integration preview/apply flow after the new
CLI is released, preserving unrelated instructions, host configuration, and
credentials. Keep installed portable skills current with their reviewed source.

This correction changes guidance and local verification, not the operation
schema or state machine. `finish_work` keeps its existing transport-neutral
authorization, claim, revision, and idempotency semantics. The remote service
cannot independently inspect Git or a deployment and is not a hard merge gate.
