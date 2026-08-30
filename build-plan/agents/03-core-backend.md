# Agent 03 — Core backend

## Mission

Build the authoritative Convex domain model, transactional lifecycle invariants, high-level transport-neutral human/agent operations, the versioned HTTPS adapter, trusted MCP-gateway request boundary, and bounded Overview/search queries.

## Exclusive ownership

- `convex/domains/intake/**`
- `convex/domains/work/**`
- `convex/domains/runs/**`
- `convex/domains/attention/**`
- `convex/domains/comments/**`
- `convex/domains/artifacts/**`
- `convex/domains/events/**`
- `convex/domains/search/**`
- `convex/http/agentV1/**`
- `convex/lib/errors.ts`
- `convex/lib/idempotency.ts`
- `convex/lib/leases.ts`
- `convex/lib/transitions.ts`
- `convex/lib/ranking.ts`

Agent 01 alone composes root schema/HTTP/cron files.

## Dependencies

- Accepted D-01 through D-06, D-11/D-12, and D-15/D-16.
- Contract v1 schemas and fixtures.
- Agent 02’s principal-resolution interface.

## Tasks

### B-01 — Schema fragments and indexed relations

- Define Intake, WorkItem, Run, AttentionRequest, Comment, Artifact, Event, idempotency, and Intake↔Work junction tables.
- Add project IDs where project-scoped query/search authorization requires them.
- Define indexes for every Overview, claim, attention, event, run, comment, installation/grant, service credential, search, and idempotency hot path.

Acceptance:

- Every relationship validates same organization/project.
- No Overview or API hot path scans an unbounded table.
- Event/idempotency payloads are bounded and serializable.

### B-02 — Intake and triage

- Create text Intake only from finalized attachments.
- Implement atomic leased claim, renewal/expiry, and `complete_triage` for create-many, link-existing, duplicate, clarification, and dismissal.

Acceptance:

- Two claim attempts produce one winner.
- Expired claims are reclaimable.
- Triage commits all links/items/status/events or nothing.
- Retries create no duplicate work.

### B-03 — Work, claims, Runs, ordering

- Implement create/get/update/reorder/cancel, atomic project-local numbering, expected revision, start, renew, wait, resume, fail, cancel, finish, and lazy/scheduled expiry reconciliation.
- Bind claims to the active Run, not only the Actor.

Acceptance:

- At most one active claim and running execution Run exist per WorkItem.
- Only the active Run may renew/update/wait/finish.
- Lease expiry terminalizes stale activity, clears the claim, and makes work reclaimable.
- Done/cancelled work has no live claim or running Run.
- Every WorkItem mutation increments revision and emits exactly one Event.

### B-04 — Attention, comments, artifacts, and response visibility

- Implement request/seen/respond/resolve/cancel behavior.
- Human response atomically creates an attributed comment and resolution link.
- Include resolved responses in agent startup/pull results until cursor acknowledgement.

Acceptance:

- Response content remains durable after resolution.
- Cross-project links are rejected.
- Respond/resolve conflicts cannot discard a concurrent update.
- Attention delivery intent is handed to Agent 05 through an outbox/delivery interface.

### B-05 — Overview and search

- Return bounded, stably ordered Needs You, Working, Ready, Inbox, and Recently Done aggregates.
- Enforce Needs You display precedence.
- Add project-scoped paginated text search across the PRD fields.

Acceptance:

- Expired activity is never labeled as active.
- Results cannot cross projects.
- Reorder conflict reports canonical order/version.

### B-06 — `/api/agent/v1`

- Expose validated JSON HTTP operations and `session_start` aggregation over the shared operation handlers.
- Validate OAuth access tokens for the API resource and revalidate installation/grant status, project scope, membership/project state, and required scopes in each transaction. Static credentials are accepted only for explicit CI/service installations.
- Require idempotency on mutations, map stable errors/status codes, add request IDs, sanitized logs, bounded cursors, and rate limits.
- Return temporary attachment metadata only; never stream bytes through Convex.

Acceptance:

- Every contract fixture passes.
- Foreign IDs do not reveal existence.
- Malformed/oversized JSON fails before domain logic.
- Tokens, signed URLs, OTPs, intake bodies, and comments never enter logs.
- Normal `session_start` is one round trip and starts no work by itself.

### B-07 — Trusted MCP gateway context

- Define the signed/short-lived internal request context Agent 10 may pass after validating an MCP token: request ID, issuer, MCP audience, grant/installation ID, scopes, client identity, and session attribution.
- Re-resolve the grant to the current project and installation Actor inside Convex before every operation.
- Expose the same operation handlers to the MCP registrar without making the gateway call the public HTTPS adapter.
- Reject expired/revoked grants, archived projects, removed membership/authority, wrong audience, insufficient scope, forged identity fields, and replayed internal context.

Acceptance:

- HTTPS and MCP fixtures produce equivalent domain effects, Events, conflicts, revisions, and idempotency behavior.
- An API-resource token cannot call MCP and an MCP-resource token cannot call the API.
- Tool arguments cannot override project, organization, grant, or Actor identity.
- Revocation takes effect on the next MCP operation even when the JWT signature and expiry remain valid.
- Inbound OAuth tokens are never stored, logged, or forwarded into Convex as downstream bearer credentials.

## Backend invariants

- Server time controls leases and timestamps.
- Server-derived Principal controls identity and tenancy.
- State, claim, and Run updates are transactional.
- State mutation and immutable Event append are transactional.
- Same idempotency key/payload returns the original result; another payload conflicts.
- External side effects never run inside domain transactions.
