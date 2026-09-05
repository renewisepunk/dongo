# Architecture and contracts

## Target shape

Use a TypeScript monorepo with a Convex modular monolith, a small public gateway layer, and thin first-party clients:

```text
apps/
  web/                  SolidStart application deployed to Cloudflare
  cli/                  published dongo CLI entry point
  mcp/                  remote Streamable HTTP MCP resource server/gateway
  ios/                  created only when the native wave starts
  android/              created only when the native wave starts

convex/
  schema.ts             composition only; Agent 01 owns it
  domains/
    identity/
    projects/
    intake/
    work/
    attention/
    comments/
    runs/
    events/
    credentials/
    installations/
    oauthBindings/
    media/
    notifications/
    search/
  http/
    agentV1.ts
    mcpContext.ts        trusted internal gateway context only
  lib/
    authz.ts
    errors.ts
    idempotency.ts
    leases.ts

packages/
  contracts/            transport-neutral operation and auth-context schemas, fixtures, errors
  client/               typed high-level HTTPS client
  cli-core/             commands, device auth, config, doctor
  mcp/                  tool registry, result mappers, instructions, auth context
  repo-export/          deterministic .agent-work writer
  ui/                   minimal shared web presentation primitives

integrations/
  shared/               canonical behavior and host-install manifests
  codex/
  claude-code/
  generic-agents/

tests/
  contract/
  integration/
  e2e/
  evals/
  security/

docs/
  adr/
  agent-api/
  runbooks/
```

The exact package manager and build tooling are chosen in Wave 0 by Agent 01. Do not create iOS or Android projects before their wave.

## Boundary rules

- Web presentation components consume feature adapters, not low-level Convex calls.
- Humans use Convex authentication and project membership authorization.
- Agents use either the typed `/api/agent/v1` adapter or the authenticated remote MCP server; no raw Convex CRUD is exposed.
- `/api/agent/v1` and MCP are generated/mapped from one operation registry. Neither is allowed to invent domain behavior, fields, or errors.
- The server derives tenant, project, grant/credential, scopes, and installation Actor identity.
- The public MCP gateway validates OAuth at its boundary and passes a trusted, short-lived internal request context to Convex; it never forwards the inbound OAuth token as a downstream credential.
- All mutations pass through authorization, validation, idempotency, invariant enforcement, event recording, and structured error mapping.
- Parallel Work starts remain project-scoped atomic mutations. The server
  combines project parallel policy, distinct session identity, reported host
  capability, isolated-workspace metadata, and current active-Run capacity; a
  host never grants itself concurrency merely by creating a worktree.
- R2 stores bytes; Convex stores metadata, quota reservations, ownership, and lifecycle state.
- Product Events are immutable audit/history records. Structured operational logs are separate and redact user content.

## Contracts to freeze in Wave 0

### Domain state matrix

Document allowed transitions and atomic effects for:

- Idea open → archived → open and open → promoted, with promoted terminal and
  exactly one atomically linked Intake;
- Intake new → claimed → processed/dismissed, including human edits to `new`
  or `claimed` that preserve the claim and advance the revision;
- WorkItem ready → working → done/cancelled;
- Run running → waiting/completed/failed/cancelled;
- claim acquisition, renewal, expiry, release, and reclaim;
- Attention open → seen → responded/resolved;
- retry after response loss;
- failure after cloud success but before local export.

Each transition specifies authorization, expected revision, idempotency behavior, emitted Event, claim effect, Run effect, export signal, and notification signal.

Work creation may optionally set one `parentWorkItemId`. The authoritative
mutation verifies that the parent exists in the same project, is not itself a
child, is not closed, and has fewer than 100 children before inserting the new
WorkItem. The relationship is immutable in this release. Parent and child
lifecycle transitions remain independent.

### Human-facing view models

Freeze typed aggregates for:

- current viewer, organization, project, role, and entitlement;
- private platform administration with a server-derived super-admin role,
  bounded privacy-safe account/organization usage, separate project and Work
  allowance revisions, and billing placeholders that carry no provider state;
- human Ideas backlog with explicit title, optional text/context/links,
  finalized attachments, state, rank, attribution, revision, archive/promotion
  metadata, and linked Intake provenance;
- Overview with Needs You precedence and stable section ordering;
- Intake with text, optional context and links, finalized attachments, immutable
  creator attribution, update time/revision, attributed update Events, and a
  server-authoritative deterministic non-empty `displayLabel` for human views;
- Work detail with source Intake, current/latest Run, comments (including finalized attachment references), artifacts, Attention, an optional direct-parent summary, and at most 100 direct-child summaries. Relationship summaries contain only project-scoped Work ID, canonical identifier, title, and state; they never recursively embed another WorkItem;
- active-Run visualization with agent identity, canonical Work, Run state,
  progress, elapsed/lease health, and safe workspace label; this read model is
  subscription-backed and never equates generic CLI activity with an active
  Run;
- project-scoped shared-resource arbitration with one active holder, FIFO
  waiters, safe resource labels, bounded renewable leases, and automatic
  terminal/expiry handoff without exposing local paths or fixture content;
- search result union;
- installation/grant metadata and Advanced CI/service one-time secret result;
- media upload initiation/finalization;
- notification preference/delivery state needed by clients.

### Work identifier contract

Canonical Work identifiers are project-scoped and match
`[a-z]{4}[0-9]{3}` with no separator, such as `dong012`. The four-letter code
uses the first four ASCII letters of the immutable lowercase project slug; if
needed, append ASCII letters from the legacy identifier prefix and then `x`
padding. New projects persist that derived compact prefix and existing projects
derive it identically. Sequences run from `001` through `999`.

Stored legacy identifiers remain exact aliases for lookup by project and work
number. Read models expose the compact value as `identifier` and retained old
values in `legacyIdentifiers`; display, copy, search results, links, snapshots,
and exports use the compact value. The same compact identifier may exist in two
projects, so neither form is globally unique.

Exhaustion fails before mutation with HTTP `409`, code
`identifier_exhausted`, message `This project has used all 999 work
identifiers`, `retryable: false`, and details containing `maxSequence: 999`,
the authoritative `nextSequence`, and `action: "use_another_project"`.
Idempotency replay is resolved before allocation, so replaying the successful
creation of sequence `999` still succeeds.

### Agent operations

Keep the high-level PRD operations and add only the missing lifecycle capabilities. These names are the canonical operation keys used by HTTPS, fixtures, telemetry, and MCP tool mapping:

```text
session_start
get_overview
get_intake
claim_intake
renew_intake_claim
complete_triage
create_work
get_work
start_work
update_work
renew_claim
finish_work
add_comment
request_attention
request_owner_attention
get_attention
resolve_attention
get_attachment
sync_snapshot
```

Human attention response remains a human-authenticated product mutation, not an agent-token operation.

Ideas are likewise human-only and intentionally absent from the versioned agent
operation registry. Authenticated product operations are
`ideas.listForHuman`, `getForHuman`, `create`, `update`, `reorder`, `archive`,
`restore`, and `promote`. Human summaries include `createdBy` and `updatedBy`
Actors plus revision/timestamps. Open list order uses explicit `position`;
Archived and Promoted UI history sort by newest transition. Promotion
atomically creates one Intake whose text is the Idea title followed, when
present, by a blank line and the Idea text; it also copies context and links and
dual-links the same finalized attachments without removing their Idea
association. It sets the Idea's
`promotedIntakeId`/`promotedAt` and the Intake's `sourceIdeaId`, and permanently
reuses that mapping for every replay or later promotion attempt. Agent Overview,
search, update delivery, snapshots, HTTPS, CLI, and MCP expose only the
resulting Intake, never the source backlog.

Editing Intake is likewise a human-authenticated Convex mutation, not an agent
operation. `updateForHuman` accepts `intakeId`, `expectedRevision`, optional
text/context/links, additive `addAttachmentIds`, and an idempotency key. It
returns the new revision and update time plus the attachment IDs actually
added. It emits `intake.updated`; an already attached file on that Intake is an
idempotent no-op, while files attached elsewhere, owned by another editor, not
available, outside the project, or beyond the 20-file total are rejected.

Human closure is also product-authenticated rather than part of the agent
operation registry. `intake.dismissForHuman` and `work.closeForHuman` require
membership, an expected revision, an idempotency key, a bounded reason, and an
optional note. They preserve the record and emit immutable closure Events.
Closing claimed Intake invalidates the triage claim. Cancelling Work closes any
owned Run, resolves open Attention, and cancels or requests cancellation of a
non-terminal local-runner job in the same atomic mutation.

### MCP tool contract

Agent 10 maps each operation to a namespaced tool such as `dongo_session_start`, `dongo_claim_intake`, and `dongo_finish_work`. The mapping must preserve the same input/output schema, authorization, idempotency requirement, and error meaning.

- Read tools return bounded structured content and enough concise text for hosts that do not use structured output well.
- Mutating tools require the same idempotency keys and expected revisions as HTTPS.
- Tools declare accurate read-only/destructive/idempotent/open-world hints, but the backend never trusts those hints as authorization.
- Tool descriptions state preconditions and conflict behavior without embedding a second copy of the product workflow.
- MCP server-wide instructions contain the cross-tool workflow, tenant boundary, manual/autonomous rule, claim-loss rule, and untrusted-content rule. Publish them through `server/discover` in the modern era and the initialization result for supported legacy hosts. The first 512 characters remain self-contained for Codex.
- A reviewed and globally activated agent release may append one bounded notice
  to the next eligible successful authenticated tool result for each MCP
  installation. The operation
  `structuredContent`, primary content, and error semantics remain unchanged;
  only a separate assistant-facing text block and optional `_meta` are additive.
  A signed identifier and monotonic sequence must exactly match the globally
  active Convex release channel before they are atomically suppressed per
  installation. Activation occurs only after the matching npm artifact is
  published and verified. All human-readable notice copy and the exact
  consent-first CLI action remain source-controlled in the MCP release bundle.
- Resources/prompts are optional enhancements. V1 portability is based on tools because tool support is the common host baseline.
- `sync_snapshot` is read-only remotely. Only the local CLI writes `.agent-work`; the remote server never claims it wrote repository files.

### Public transport topology

```text
dongo CLI
  -> OAuth Device Authorization (browser approval, terminal polling)
  -> optional named Codex preauthorization in the same explicit approval
  -> /api/agent/v1
  -> shared operation handlers

Codex / Claude / generic MCP host
  -> MCP OAuth authorization code + S256 PKCE
  -> remote Streamable HTTP /mcp
  -> modern stateless request, or tested legacy negotiation
  -> shared operation handlers

Human web/native client
  -> Better Auth session + Convex authorization
  -> the same domain invariants through human-facing operations
```

The authorization server may share a deployment with the human auth service only if Wave 0 proves compatibility. The MCP resource server and authorization server remain logically distinct even when deployed together.

The MCP gateway targets protocol revision `2026-07-28` using the official TypeScript SDK v2. It supports `server/discover`, validates the modern `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name` request metadata, and returns deterministic cache-aware list results. It does not rely on `Mcp-Session-Id` or hidden transport state. The same SDK handler may serve the legacy initialize era only for host versions admitted by the compatibility matrix; both eras use the same tool registry and authorization rules.

### OAuth discovery and token model

- Serve OAuth Protected Resource Metadata for the MCP resource and return the metadata URL in an RFC-compliant `WWW-Authenticate` challenge.
- Serve OAuth Authorization Server Metadata and, where enabled, OIDC discovery from one stable issuer.
- Prefer CIMD for public MCP client identity; keep DCR only for clients in the supported compatibility matrix.
- Fetch client metadata only from allowed HTTPS origins with SSRF protections, response-size/time limits, redirect limits, and no private-network access; validate every redirect URI exactly before issuing a code.
- Require authorization code plus S256 PKCE for MCP clients.
- Register the dongo CLI as a public native client using Device Authorization and refresh-token grants; it has no client secret.
- Register Codex's first-party setup as the fixed public native client `dongo-codex`, with the exact `http://127.0.0.1/callback` redirect and mandatory S256 PKCE. `dongo connect --agent-host codex` may preauthorize that client only for the exact signed human, selected project, pending CLI request, MCP resource, and bounded scopes shown on the combined approval page.
- Bind access tokens to their exact API or MCP audience, validate issuer/audience/expiry/scopes on every request, and rotate refresh tokens.
- Start with `dongo:work:read`, `dongo:work:write`, and `dongo:attachments:read`; reserve `offline_access` for clients that need refresh tokens. Each operation declares and enforces its required scopes.
- Use separate grants/token families for CLI, Codex, Claude, generic clients, CI/service credentials, and environments, even when one explicit screen records consent for both CLI and Codex.
- A grant selects exactly one project for V1. The project comes from validated grant context, never from a trusted tool argument.
- Model each grant as a durable installation Actor with human authorizer, client identity, machine label when available, creation/last-use timestamps, scopes, and revocation state.

### Security model

- Interactive CLI and MCP access uses short-lived audience-bound OAuth access tokens and independently revocable refresh-token families linked to installation Actors.
- The npm CLI stores its project-scoped rotating credential in its owner-only user configuration directory, outside every repository. POSIX directory/file modes are `0700`/`0600`, writes are atomic, and unsafe ownership/type/symlink/permission/binding fails closed. The CLI invokes no Keychain/helper process; a signed native helper is a separately gated future option. MCP clients own their token storage. No interactive token is displayed to the user or written to a repository. See `build-plan/07-cli-credential-storage.md`.
- Static project credentials remain a non-interactive CI/service boundary only. They are random, hashed at rest, shown once, scoped, and individually revocable.
- Pairing codes are outside the planned interactive V1 flow; OAuth retry/reauthorize is the recovery path.
- All queries/mutations explicitly validate organization and project access.
- Signed media URLs are short-lived bearer capabilities and never logged.
- Intake text, attachments, comments, Markdown, URLs, filenames, and terminal output are untrusted.
- Rate limits cover device-code issuance/polling, OAuth authorization/token/registration endpoints, agent authentication, OTP, upload initiation, search, and mutation bursts.
- Host capability and Run workspace metadata are claims from an authenticated
  installation, not authorization. The server still enforces project policy,
  one active WorkItem per session, atomic per-item ownership, capacity, and
  leases. Workspace metadata never includes an absolute path.
- Idea authorization is human membership authorization. Agent grants and scopes
  confer no Idea read or write capability. Attachment bytes/metadata remain
  hidden from agents while associated only with an Idea and become agent-visible
  only through the atomically promoted Intake under normal attachment checks.

## Environment model

Pinned public origins and current state:

| Environment | Product/auth origin | Convex | Current infrastructure state |
|---|---|---|---|
| Development | `https://dev.dongo.so` | `wandering-camel-662` | Convex CLI access verified; Cloudflare hostname still needs provisioning |
| Production | `https://dongo.so` | separate production deployment, to identify/provision before release | Apex currently serves the existing `dongo-coming-soon` Worker and must not be overwritten during development |

`https://www.dongo.so` is redirect-only. Project-specific MCP resources use `https://dev.dongo.so/p/{publicProjectRef}/mcp` in development and `https://dongo.so/p/{publicProjectRef}/mcp` in production. Web, auth, API, and MCP handlers may remain separate services behind the Cloudflare entry layer even though they share the public environment origin. Issuer, resource, cookie, CORS, callback, and allowed-origin values are explicit per environment.

Maintain isolated development, staging, and production resources for:

- Convex deployments;
- Cloudflare Workers/configuration;
- R2 buckets and lifecycle rules;
- Better Auth secrets and allowed origins;
- OAuth issuer, client metadata, JWKS/signing keys, resource identifiers, consent origins, and device verification routes;
- Google OAuth clients;
- Resend domains/keys;
- APNs/FCM credentials when native work begins;
- API/MCP base URLs, project-resource templates, internal gateway credentials, and signing credentials.

A staging CLI or MCP token must never authenticate against production, or vice versa. Issuers, audiences, keys, registered clients, device codes, consent records, and grants are environment-isolated.

## Contract-change process

1. Owner proposes a contract change with motivation and compatibility effect.
2. Agent 00 identifies affected owners.
3. Agent 01 updates schema, fixtures, and generated artifacts first.
4. Consumers update against fixtures.
5. Backend implements the same contract.
6. Agent 07 runs compatibility tests.
7. Agent 00 integrates in dependency order.
