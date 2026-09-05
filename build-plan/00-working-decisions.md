# Working decisions before implementation

These decisions resolve gaps that would otherwise make parallel agents produce incompatible implementations. They do not modify the PRD. They are recommended planning defaults and should be explicitly accepted or replaced before Wave 1.

## Blocking decisions

### D-01 — Canonical agent transport

Recommended: the versioned operation contract is canonical. It defines operation names, input/output schemas, authorization, idempotency, errors, and domain effects independently of transport.

- The official dongo CLI uses the typed HTTPS adapter at `/api/agent/v1`.
- A hosted MCP server exposes the same operations over remote Streamable HTTP from the first walking skeleton.
- Codex, Claude Code, and generic MCP hosts connect directly to the MCP server; they do not call the CLI for remote dongo operations.
- CLI and MCP handlers call the same internal domain operations and pass the same contract fixtures.
- A local stdio MCP shim is optional compatibility work after the remote server is stable.

### D-02 — Attention response

Recommended: a human response creates an attributed comment and atomically records `resolvedByActorId`, `resolutionCommentId`, and `resolvedAt` on the AttentionRequest. “Resolve without response” is a separate owner/member action. The agent startup response includes newly resolved attention relevant to the installation’s prior Runs.

### D-03 — Overview membership

Recommended: Needs You has display precedence. A WorkItem with open attention appears once under Needs You, while its underlying WorkItem state remains `ready` or `working` and is visible in detail.

### D-04 — Claims, Runs, and live activity

Recommended:

- `start_work` atomically acquires a lease, creates a running Run, and moves the WorkItem to `working`.
- `renew_claim` quietly extends the lease without creating export noise.
- lease expiry closes the Run as failed/abandoned, clears the claim, and makes the item reclaimable;
- waiting for a human closes or pauses the active Run and releases the execution claim;
- `finish_work` atomically closes the Run, clears the claim, and records the final WorkItem state;
- Overview never labels an expired claim or stale Run as active.

Intake claims use the same expiring-lease principle.

### D-05 — Local wake-up semantics

Decided: V1 promises no background wake-up. Agents pull at session start and before continuing prior dongo work. A human response is available on the next explicit pull or session. The supported active notification mechanism is `dongo attention wait --attention-id ID`: it reads immediately, backs off through 5, 10, 20, and at most 30 seconds between checks, and stops after five minutes by default (with a caller-bounded maximum of one hour). MCP adapters that remain active may apply the same bounded schedule with `dongo_get_attention`. A timed-out waiter exits cleanly and must be restarted explicitly. Product copy must not imply that a stopped local agent resumes itself.

### D-06 — Agent identity

Recommended: every CLI or MCP authorization grant is linked to one stable installation Actor. Each host session supplies a new opaque session ID used by Runs. The human authorizes the installation, but subsequent product activity is attributed to that installation Actor rather than to the human. Callers may report agent type and machine label, but never choose `actorId`, `organizationId`, or `projectId`; the server derives them from the validated grant and selected project.

### D-07 — Agent authorization bootstrap and storage

Recommended:

- `dongo connect` uses the OAuth Device Authorization Grant. Before opening `verification_uri_complete`, the CLI detects the repository and prepares a bounded, non-secret first-project proposal: name, safe repository URL when available, and execution mode. The proposal travels only as visible browser-link parameters; it is never treated as trusted token data.
- The CLI/agent selects the intended project before consent using, in order, an explicit `--project-ref`, this repository's valid non-secret marker, an exact normalized repository URL match, a unique project name/slug match, or—only when the terminal supplied none of those selection signals—the account's only active project. An explicit reference, repository, or name is fail-closed: a browser signed in to another account must never substitute that account's sole project. The browser prominently shows the signed-in identity, organization, fixed project, requested repository, client, comparison code, scopes, and Approve/Deny controls; it never offers a project picker during CLI approval. An inaccessible or conflicting binding disables approval and directs the owner to open the same terminal link in the browser profile with access, without disclosing another tenant's data. If the account has no project, one explicit **Create & approve** action creates the personal organization and proposed first project, binds it to the pending device grant, and then approves.
- The token issued after approval remains project-bound. dongo does not introduce an account-wide work token or let callers choose `organizationId`, `projectId`, or `actorId`; the browser-backed human identity creates the project and the authorization server binds the resulting stable project reference before token issuance.
- The CLI infers project context by default and accepts `--project-ref`, `--project-name`, `--repository-url`, and `--execution-mode manual|autonomous` overrides so agents and headless workflows can prepare the exact binding or first-project proposal before the human consent step. No code copy/paste or localhost callback is required.
- `--agent-host codex` is an explicit combined-approval intent. The device page names both the CLI and Codex, and one Approve action records consent for the fixed `dongo-codex` public native client only after the signed human identity, selected project, and still-pending CLI device request all match. Codex then performs its own authorization-code exchange and secure token storage without another dongo consent page. Existing flows without the flag and every other MCP host retain their normal separate approval.
- Remote MCP clients use the MCP OAuth authorization-code flow with S256 PKCE and the client registration mechanism negotiated from discovery. Prefer Client ID Metadata Documents (CIMD); retain Dynamic Client Registration only for supported-client compatibility.
- Native MCP loopback callbacks are reached only by a standards-normal top-level browser redirect. dongo never frames, fetches, probes, or proxies a localhost callback from the web origin; authorization API fetches use manual redirect handling so even a provider regression cannot follow the callback as a subrequest. Those request types trigger Chrome Local Network Access/device-access permission UI. The MCP host owns the final localhost response and its presentation.
- Claude Code's current CIMD/CLI callback mismatch receives one pinned compatibility exception: only its exact metadata client ID may add its exact requested `http://localhost:<port>/callback` URI after the fetched metadata proves the declared portless callback. The exact callback is revalidated from the bounded provider-signed `oauth_query` during consent and post-login continuation because CIMD is resolved again in those phases; it is never taken from `Referer`, cached as an ephemeral port, or persisted as a wildcard. This never relaxes PKCE, state, resource, scope, consent, expiry, or audience validation.
- CLI, Codex, Claude, and other MCP hosts receive separate grants and token families. A combined human approval may authorize more than one named client, but tokens are never copied between clients and each installation remains independently revocable.
- The npm CLI stores its bounded rotating OAuth credential in a dongo-owned user file outside the repository (`0700` directory and `0600` file on POSIX), with atomic writes and fail-closed ownership/type/symlink/permission checks. It never invokes Keychain, Secret Service, an installer, or a generic helper in normal use. Keychain requires a future stable signed dongo helper and explicit opt-in. Native Windows persistence remains gated on verified owner-only ACLs. MCP hosts own their credential storage. The complete rationale and threat model are canonical in `build-plan/07-cli-credential-storage.md`.
- `DONGO_TOKEN` is allowed only as an explicit non-interactive CI/service override; it is not the interactive onboarding path.
- `.agent-work/project.json`, `.codex/config.toml`, and `.mcp.json` contain non-secret project/server configuration only and may be committed after user confirmation.
- Pairing codes are not part of the planned interactive V1 flow. A failed OAuth flow is repaired through retry, reauthorization, or the isolated authorization-server topology—not a copied bearer token.

### D-08 — First-login tenancy

Recommended: first login creates the human profile but does not force a UI-first project form. The primary agent-first path starts in a repository with `dongo connect`; the CLI proposes the first project and the authenticated human creates and authorizes it in one consent action. The web project form remains a fallback for a legacy/manual device link or a human who starts in the web app. Project creation also creates the personal organization when needed. The subscription belongs to the organization. The free entitlement allows one active project; archived projects do not consume the active-project allowance.

### D-09 — Upload architecture

Recommended: browsers and native clients upload directly to R2. Small uploads use a short-lived presigned PUT; video/large files use multipart upload. Convex reserves quota, tracks upload state, and finalizes metadata only after size/checksum validation. Bytes never transit Convex, and a 250 MB file is never proxied through the app Worker.

### D-10 — Web and native release boundary

Decided: ship a Web Beta after the walking skeleton and product-completeness waves. Development readiness requires signed notification dispatch plus Resend email; APNs and FCM remain explicitly disabled and visibly not configured until native work begins. Full V1 follows only after the native gate changes both providers to required, supplies real credentials, and proves deep-linked push. iOS and Android can be implemented in parallel once the API is frozen.

## Contract decisions

### D-11 — API compatibility

The HTTPS agent adapter uses a typed envelope:

```ts
type Result<T> =
  | { ok: true; data: T; requestId: string; apiVersion: "v1" }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        retryable: boolean;
        details?: unknown;
      };
      requestId: string;
    };
```

V1 changes are additive. Stable domain error codes include unauthorized, forbidden, insufficient scope, not found, validation, revision conflict, claim conflict, lease expired, idempotency conflict, quota exceeded, upload incomplete, and rate limited. The envelope is not wrapped around OAuth or MCP protocol messages: OAuth discovery/challenges/errors and MCP JSON-RPC/tool results remain standards-native while preserving the same domain meaning.

### D-12 — Idempotency and optimistic UI

Every mutation accepts a client-generated idempotency key. Repeating a key with the same canonical payload returns the original result. Reusing it with another payload returns `idempotency_conflict`. Optimistic web records use the same client mutation ID so subscription reconciliation produces exactly one visible object.

### D-13 — Repository export

Convex remains authoritative. Export files are deterministic and marked as dongo-managed. Sync may replace generated content but never imports edits, stages files, commits, or pushes. Local write failure after a successful cloud mutation is a warning repaired by the next explicit sync.

New Work uses a project-scoped canonical identifier matching `[a-z]{4}[0-9]{3}`, such as `dong012`. The four-letter code is the first four ASCII letters of the immutable lowercase project slug; if the slug supplies fewer than four, append ASCII letters from the legacy identifier prefix and then `x` padding. Sequences run from `001` through `999`. Existing stored identifiers remain exact project-scoped lookup aliases in `legacyIdentifiers`, while display, copy, search, links, snapshots, and exports use the canonical `identifier`. Never synthesize a legacy alias or resolve either form outside the authenticated project.

Creating sequence `999` is valid. A new allocation after it fails before mutation with HTTP `409`, code `identifier_exhausted`, message `This project has used all 999 work identifiers`, `retryable: false`, and details containing `maxSequence: 999`, the authoritative `nextSequence`, and `action: "use_another_project"`. Replaying the successful idempotency key for item `999` still returns the original result because replay resolution happens before allocation.

### D-14 — Route and deep-link model

Recommended routes:

```text
/login
/device
/device/approve
/oauth/consent
/oauth/complete
/onboarding
/app/:orgSlug/:projectSlug
/app/:orgSlug/:projectSlug/ideas
/app/:orgSlug/:projectSlug/work/:identifier
/app/:orgSlug/:projectSlug/search
/app/:orgSlug/:projectSlug/done
/app/:orgSlug/settings/*
/app/:orgSlug/:projectSlug/settings/*
```

Work detail is route-backed but rendered as a desktop side panel or mobile full-screen sheet, preserving back behavior, focus, and Overview scroll position.

Ideas use `/app/:orgSlug/:projectSlug/ideas`; selected detail is query-backed as
`?idea={ideaId}` so filtering, Back, direct links, and responsive panel/sheet
behavior remain predictable without mixing Ideas into Overview or Inbox.

### D-15 — MCP transport and tool policy

Recommended: ship authenticated project-specific remote Streamable HTTP endpoints at `https://dev.dongo.so/p/{publicProjectRef}/mcp` in development and `https://dongo.so/p/{publicProjectRef}/mcp` in production. Target the stateless MCP `2026-07-28` era with the official TypeScript SDK v2, explicit `server/discover` support, per-request protocol/client metadata, required routing headers, and no domain reliance on MCP sessions. Serve a legacy initialize-compatible era from the same tool factory only when Wave 0 proves a pinned Codex, Claude, or generic host still needs it. A unique URL/server name per project prevents clients that key OAuth storage by endpoint from reusing one project's grant for another. The server publishes concise cross-tool instructions, bounded structured results, stable tool names, and accurate `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint` annotations. Annotations improve host UX but never replace server authorization or invariant enforcement.

Initial access profiles map to explicit scopes: `dongo:work:read`, `dongo:work:write`, and `dongo:attachments:read`. The CLI may additionally request `offline_access` for refresh capability. The authorization server may return a narrower approved scope set; every HTTPS operation and MCP tool enforces its required scope server-side. Scope expansion always requires a new consent step.

The MCP resource server implements OAuth Protected Resource Metadata, validates issuer/audience/expiry/scopes on every request, never accepts a token minted for another resource, and never passes an inbound MCP token through to Convex or another downstream service.

### D-16 — OAuth provider feasibility gate

Decided on 2026-08-30: use the isolated authorization-server topology. The maintained Convex integration currently requires Better Auth `1.6.x`, while the maintained MCP/OAuth/device packages require the `1.7.x` line; the open Convex integration incompatibility means they must not share one Better Auth instance.

- Human authentication remains in the Convex-integrated Better Auth `1.6.x` instance.
- A separate Cloudflare authorization Worker uses the pinned Better Auth `1.7.x` OAuth Provider, OAuth Device Authorization integration, JWT support, and CIMD/DCR compatibility. It consumes a signed, short-lived, single-use assertion from the authenticated human/Convex boundary to establish the same dongo user without copying the human session.
- CLI Device Authorization and every remote MCP host receive independent grants and refresh families. The CLI audience is the agent HTTPS API; each MCP grant is bound to its exact project-specific resource URL.
- The API and MCP resource servers receive only a token-verifier interface. Verification must check signature or introspection, exact issuer, time bounds, exact RFC 8707 resource, scopes, client/grant status, refresh-family revocation, and current dongo installation binding. The inbound token is never forwarded to Convex.
- Better Auth remains responsible for discovery, PKCE, device-code polling semantics, token issuance, refresh rotation/replay handling, revocation, and maintained client discovery. dongo owns project consent, grant-to-installation binding, and the signed internal gateway context.

The candidate line for implementation is Better Auth and all `@better-auth/*` OAuth packages `1.7.2`; update them only as one tested set. The isolated topology must still pass the complete local and preview gate for human Convex identity, device flow, refresh, revocation, MCP authorization, Codex, Claude, and a generic inspector. Do not hand-roll OAuth endpoints or weaken discovery, PKCE, audience validation, refresh rotation, or revocation.

### D-17 — Agent-first UI boundary

Recommended: before the agent protocol gate, web work is limited to sign-in, project create/select, device/MCP approval and consent, installation list/revocation, text Intake, minimal status, and Attention response. Full Overview/detail polish, media, search, administration breadth, billing, and native work begin only after CLI, Codex MCP, Claude MCP, and a generic MCP inspector pass the same agent golden path.

### D-18 — Public environment origins

Decided: Cloudflare serves development from `https://dev.dongo.so` and production from `https://dongo.so`. `https://www.dongo.so` redirects to the production apex. Convex deployment `wandering-camel-662` is the named development backend. Development and production use separate Worker environments, OAuth issuers/resources, secrets, R2 buckets, and Convex deployments; a dev token or cookie must never authenticate against production.

`dev.dongo.so` is currently unprovisioned and must be created as part of Wave 0 infrastructure setup. The existing `dongo.so` Worker remains untouched until an accepted production release artifact is promoted. Web, auth, API, and project-specific MCP routes share the environment origin but remain separate route/security boundaries behind the Cloudflare entry layer.

### D-19 — Editable unprocessed Intake

Decided: any authorized project member may enrich Intake while it is `new` or `claimed`; `processed` and `dismissed` Intake is read-only. Editable fields are text, optional context, and up to 100 normalized HTTP(S) links. Attachments are additive in this slice: an editor may attach finalized files they uploaded for the same project, but may not remove an existing attachment. The saved Intake must still contain text or at least one available attachment, and may contain no more than 20 attachments.

Every save is idempotent, requires the expected revision, records the human Actor through an immutable `intake.updated` Event, bumps `revision` and `updatedAt`, and preserves an existing active or stale claim. An agent triaging the Intake must therefore refetch after `revision_conflict` and use the current text, context, links, and finalized attachments before completing triage. Processed/dismissed edits fail with `invalid_transition`; a stale save fails with `revision_conflict` and the expected/current revisions.

Convex subscriptions are authoritative. The human editor keeps an unsaved draft when live state changes, sees the current server version, and explicitly retries or merges instead of silently overwriting another human or agent. The server-authoritative human `displayLabel` is deterministic and never empty: use the first nonblank normalized text line, otherwise the first available attachment filename, otherwise the neutral `Untitled intake` fallback for legacy/deleted-data edge cases. Create, list, detail, search, and source-Intake surfaces use that value.

### D-20 — Safe parallel agent execution

Decided: every project starts in **Single-agent** mode. An owner may opt into
**Allow parallel work** and choose a `maxConcurrentRuns` safety cap from 2
through 8; the default is 4. The cap is operational safety policy, not a paid
plan entitlement. Disabled projects have an effective cap of 1. The existing
free-plan active-project allowance remains a separate organization-level limit.

Parallel execution means different agent sessions may hold different WorkItems.
One session may own at most one active WorkItem, and no two sessions may own the
same item. Every start remains an atomic claim. An additional concurrent start
is admitted only when the project opted in, capacity remains, the new session is
distinct, the host explicitly reports support for both parallel execution and
worktree isolation, and the Run reports isolated-worktree metadata. Missing,
unsupported, or undisclosed capabilities fail closed for parallel admission but
remain fully usable for serial work.

The one-active-item invariant is deliberately scoped to a single external
session. It is not guidance for a coordinating host to serialize an explicitly
authorized set of independent issues. When session start reports parallel mode,
the host should use its native delegation and isolated-worktree facilities up to
the smaller of eligible work, remaining project capacity, and available host
slots. Every delegated session receives one item, performs its own duplicate
check and atomic claim or start, and retains a stable external session ID. The
coordinator may refill capacity as sessions finish, but may not rotate IDs,
share Runs, or invent workspace metadata to evade an invariant.

dongo coordinates policy, atomic claims, Runs, and live state; it does not spawn
agents, create Git worktrees, choose branches, or inspect repository paths. The
host owns those actions and must report capability and bounded workspace
metadata truthfully. Never transmit an absolute local path. Human live views are
derived from authoritative active Runs and subscriptions, not inferred from
transport labels, host presence, or generic CLI activity.

Parallel source isolation does not make process-global or external acceptance
fixtures independent. Agents claim only genuinely exclusive resources through
the additive project-scoped resource operations. Keys are stable,
non-sensitive repository conventions such as `browser:shared-profile`,
`provider:conversation:test`, or `release:development`; labels are bounded safe
display text. One Run holds a key at a time, waiters are FIFO, both held and
waiting claims have short renewable leases, and terminal or expired Runs release
all claims before the next eligible waiter is promoted. Waiting updates the Run
to `waiting_for_resource` without consuming Attention or reducing unrelated
project concurrency.

### D-22 — No generic agent-notification control

Decided: the Inbox does not show a **Notify agent** action. dongo has no
universal primitive that can wake Codex, Claude Code, a CLI process, or an
arbitrary agent harness, so a human control must not imply that it can. Existing
bounded update-stream operations remain deployed for backward compatibility,
but they are pull infrastructure rather than proof of wake-up, delivery,
assignment, or consumption. A stopped agent sees current Intake only after its
host starts or resumes it and explicitly pulls dongo state. A future control may
return only after each supported harness has a separately implemented,
observable, and tested wake-and-pickup adapter with truthful unavailable states.

### D-23 — Finite operator-managed project capacity

Decided: the standard Free entitlement remains one active project per
organization. A deployment operator may grant a finite 1–100 active-project
override to an existing organization, located through the exact normalized
email of an owner account. The override does not change the organization to
Paid, raise storage quota, meter people or agents, or expose a public entitlement
mutation. Operator changes are deployment-admin-only, revision checked, and
recorded through the organization system Actor without copying the email into
event data. Lowering an allowance never archives or deletes existing projects;
it blocks creation and unarchive until usage returns within the effective limit.

### D-24 — Outbound local runner for Codex and Claude Code

Decided: dongo may start local agent work only through an explicitly installed,
unprivileged `dongo runner` process. The runner starts at user login, opens an
authenticated outbound long-poll connection, and maps one project-scoped dongo
grant to one locally approved repository. It never opens a listening port. The
first release supports only Codex and Claude Code on macOS and Linux; Windows,
OpenClaw, SMS execution, generic command adapters, and arbitrary executables are
outside this contract.

A queued runner job contains only server-derived identifiers, a fixed operation
kind, the selected supported harness, timestamps, and revision/lease metadata.
It never contains an executable, command-line arguments, environment variables,
model credentials, repository contents, or a remotely supplied shell command.
The local runner resolves its executable and absolute repository path from
owner-only local configuration, constructs a bounded product-owned instruction,
and starts the harness under that harness's own authentication and permission
model. Ask-before-run is the default. Automatic execution is an explicit local
opt-in for one approved repository and harness. Automatic processing of Inbox
Intake is a second, off-by-default owner opt-in bound to one active
automatic-mode registration and one installed harness. Enabling it explicitly
queues the bounded current unclaimed Inbox as well as future Intake; existing
jobs and claimed Intake are never duplicated. Each newly created Intake receives a targeted
triage-only job; autonomous Work created by that triage is queued as a separate
job. Downgrading, changing, or revoking the chosen runner disables the project
opt-in rather than silently moving it to another computer.

Runner jobs are durable, idempotent, revision-aware, leased, cancellable, and
woken. Codex uses its stable non-interactive JSONL interface and resumes only by
audited. One job can have one live execution; reconnect and response loss return
the existing result. Offline or sleeping machines leave jobs queued, and the UI
must say so. Overview and Intake detail derive the current-project reason from
runner registration, automatic Inbox policy, heartbeat, harness, job state, and
project capacity. They distinguish no connected runner, pickup disabled,
offline or stale runner, local approval, incompatible harness, full capacity,
queued delivery, startup, and active execution instead of collapsing them into
“waiting for local agent.” Presence is a bounded server fact, not proof that a
process can be woken. Codex uses its stable non-interactive JSONL interface and resumes only by
woken. Codex uses its stable non-interactive JSONL interface and resumes only by
an exact captured session ID. Claude Code uses print-mode streaming JSON and
resumes only by an exact captured session ID. Missing or incompatible session
references start a new session and are presented truthfully.

The complete contract, state machine, security boundary, retention, and rollout
requirements are recorded in [`08-local-runner.md`](08-local-runner.md).

### D-30 — Visible local-runner identity

Decided: operating-system persistence must identify itself as dongo rather than
the implementation runtime. The macOS LaunchAgent starts through an owner-only
fixed launcher whose executable name is `dongo`; Node.js remains an internal
runtime detail and cannot receive server-controlled arguments. Installation and
status output must explain the expected **Background Items Added** notification,
the login-scoped and non-privileged boundary, where macOS exposes the item, and
the exact status, pause, and removal commands. Project settings uses the same
language, asks for a recognizable non-sensitive computer label, names the list
by its authority rather than its registration mechanism, and makes runner
activity distinct from Work completion.

The CLI remains unbundled and unsigned, so it must not claim association with a
signed app bundle or add `AssociatedBundleIdentifiers` without a matching team
identity. Apple documents that an unattributed legacy LaunchAgent is displayed
from the executable named by `Program` or `ProgramArguments`; the fixed launcher
provides the truthful dongo name without weakening the existing user-level
launchd boundary.

### D-25 — Direct Work breakdown

Decided: one WorkItem may contain at most 100 direct child WorkItems. This is a
single-level planning relationship, not an arbitrary tree: a child cannot have
children, the parent and child must belong to the same project, and a completed
or cancelled parent cannot receive new children. Each child receives its own
canonical identifier, rank, revision, lifecycle, Run, Attention, comments, and
artifacts. A parent's lifecycle does not automatically start, block, complete,
cancel, or reorder its children, and child state does not implicitly change the
parent.

Humans add children from the parent Work detail and can navigate in both
directions. Children remain visible in the normal Overview lanes so existing
claim and execution behavior is unchanged. Agents use the existing additive
`parentWorkItemId` input on `create_work`; Work read models expose bounded
`parentWorkItem` and `childWorkItems` summaries without recursively embedding
Work records.

The stored `parentId` and create input existed before this decision, so existing
records require no data rewrite: records without a parent remain root Work and
any prior same-project link is preserved. New creation enforces the direct-only
and 100-child bounds; bounded read summaries make prior links visible without
recursive expansion. The response fields are additive, and contract parsing
defaults a missing child list to empty for one compatibility cycle. This release
adds no reparenting, dependency blocking, automatic parent completion, bulk
lifecycle operation, or cross-project link.

### D-26 — Private platform administration and total Work allowance

Decided: development account creation is restricted to an exact email allowlist
only when the configured public origin is `https://dev.dongo.so`; invalid
configuration fails closed and production signup behavior is unchanged.
`rene@wisepunk.com` is the initial stored `super_admin`. Every administration
query and mutation derives that role from the authenticated Convex profile, and
unauthorized callers receive no private dashboard data.

The private administration view exposes bounded, privacy-safe account and
organization aggregates plus an explicit `not_configured` billing placeholder.
It never returns Work, Intake, comment, attachment, credential, or raw provider
content. Free organizations may create 250 total Work items over their lifetime.
Closing Work does not restore capacity. Operators may set finite 1–1,000 Work
overrides and the existing 1–100 active-project overrides. Convex owns usage,
effective allowances, revision checks, and enforcement across human and agent
creation. Project-capacity writers share one revision domain; allowance changes
are idempotent, audited without account email or content, and never delete data.
Historical Work counts are migrated in bounded 1,001-row steps and stored as an
exact value or a safe 1,000-item lower bound before release acceptance.

### D-28 — Owner-controlled organization names and canonical slugs

Decided: first-project onboarding asks for the organization name instead of
silently binding it to the account profile. Convex derives the canonical slug
from that validated name inside the organization mutation. The readable slug is
used when available; a deterministic identity suffix is added only on a global
collision. Client-provided legacy slugs remain accepted for compatibility but
are not used by the new onboarding path.

An owner rename changes the organization name and slug atomically, records the
prior and new slug in the organization event, and navigates the browser to the
new canonical route. The organization ID, memberships, project IDs, project
slugs, public project references, grants, and tenant authorization remain
unchanged. Members cannot rename an organization. Existing bookmarks containing
the old organization slug are not redirected in this release.

### D-21 — Human Ideas backlog

Decided: Ideas are a dedicated human-only project backlog, not Intake, Work, or
an agent-visible planning queue. An Idea has an explicit title, optional text,
context, normalized HTTP(S) links, and finalized attachments. Humans may create,
edit, order, filter, archive, and restore Ideas through authenticated product
operations. Agent Overview, search, snapshots, update signals, HTTPS operations,
MCP tools, and CLI workflow commands never list or mutate Ideas.

Idea states are `open`, `archived`, and terminal `promoted`. Only open Ideas are
editable, reorderable, archivable, or eligible for promotion. Archived Ideas
may be restored. Promotion is a deliberate human action that atomically creates
one Intake from the current canonical Idea, records durable two-way provenance,
and makes the Idea terminal. One Idea permanently maps to exactly one Intake:
replaying the same idempotency key returns the original result, and a later
promotion attempt with another key safely returns the same Intake with
`created: false` rather than creating a duplicate.

All human writes are idempotent, and every mutation of an existing Idea is
revision-aware. Promotion keeps the original Idea as linked history and makes
its finalized attachments agent-visible only through the created Intake. It
does not assign, claim, or authorize starting work; the Intake enters the normal
human-to-agent triage boundary.

### D-27 — Next-call agent release notices

Decided: an already-authorized MCP installation can learn about a new reviewed
and activated agent release through one additive notice on its next eligible
successful authenticated dongo tool result. The canonical operation
`structuredContent`, error meaning,
and primary content remain unchanged. The notice is a separate bounded text
block plus optional MCP metadata, so both modern and admitted legacy hosts can
surface it without reconnecting or rereading initialization instructions.

Notice content is a checked-in build-time manifest with a unique identifier and
monotonically increasing sequence. Only the identifier and sequence cross the
signed internal gateway. A global Convex channel advances monotonically only
after the matching npm artifact has been published and verified; claims must
exactly match that active marker. Convex then atomically records the highest
delivered sequence per MCP installation. Concurrent calls yield at most one
notice, while retries, same-release redeploys, new installations after a
rollback, and rollbacks themselves do not repeat or regress it. A notice failure
is fail-open and leaves the successful operation untouched. Because the receipt
is at-most-once, a connection loss after the atomic claim can suppress a notice
the host did not receive; normal work never depends on the advisory.

The notice states that hosted MCP is already current and needs no installation
or restart. It may recommend checking a local CLI, but suggests the exact scoped
and version-pinned command only when the detected stable CLI is older, and it
always requires explicit human approval before installation. Registry data,
project content, environment values, and operation results can never author the
notice. Delivery is once per installation, not once per every concurrent task;
it does not push, wake, restart, or assign an agent.

### D-28 — General agent-to-owner Attention

Decided: every agent request that needs an owner decision belongs in durable
dongo Attention, including when that owner is simultaneously present in the
agent host. The existing `request_attention` operation remains the special
Work lifecycle path: it requires the exact Work revision and an active Run
owned by the installation, and pauses only that Run.

The separate `request_owner_attention` operation creates project-level
Attention without a Work claim, Run, or live agent session. It may associate
the request with an untriaged Intake but never claims or mutates that Intake.
Human responses to general Attention are stored on the request itself rather
than fabricating a Work comment. Requests appear in the owner's Needs You view,
remain durable after the requesting session ends, and are returned to the
requesting installation on a later explicit pull. They do not pause unrelated
work or wake a stopped agent. General Attention uses the same notification
policy as Work Attention: enabled-device push is immediate, and unresolved
Important requests receive the one-hour email escalation. Delivery identifies
the durable project or optional Intake target without fabricating Work.

### D-29 — Human issue closure preserves history

Decided: authorized project members may close issue-like records without
deleting them. Open Intake closes as `dismissed` with an explicit
no-longer-relevant, incorrect, or other reason. Ready Work may be marked `done`
only when the person confirms it was completed, or `cancelled` with one of the
same non-completion reasons. Active Work may be cancelled, which atomically
releases its Run claim and requests cancellation of any live local-runner job;
an active Run remains the authority for declaring its own work completed.

Every close is idempotent and revision-aware, records the human Actor, time,
reason, optional note, and immutable Event, and resolves open Attention on that
record. Closed records remain readable and searchable. Completed and cancelled
Work share the Closed history surface but retain distinct states and labels;
dismissed Intake becomes read-only and leaves Inbox. No self-service close
operation hard-deletes content or restores Free-plan Work capacity.

### D-30 — Bounded paid cross-project overview

Decided: signed-in people have one optional **All projects** route, reached from
the existing project selector. It groups only their accessible active projects
by organization and keeps the project-scoped Overview as the primary working
surface. Each entitled project shows one priority item using the existing
Needs You, active Working, Ready, then Inbox precedence, with direct navigation
to that project's canonical Overview or item detail.

Cross-project live status is a Paid organization entitlement. Free
organizations remain visible as navigation groups without exposing aggregated
live state, including when an operator has raised their active-project
allowance; that allowance does not silently change plan entitlements. The query
derives projects only through the current human's memberships, ignores archived
projects, accepts no caller-supplied organization or project IDs, and fails
closed before reading project status for an unentitled organization.

One subscription covers the entire route. It returns at most 20 organizations
after one membership lookahead, reads at most 24 active projects per snapshot,
applies constant per-project lane lookups, and returns a truthful truncation
indicator instead of allowing query and subscription work to grow without
bound. Wide screens use scannable project columns; narrow screens preserve the
same organization and project order in one stack without hiding status or
navigation from keyboard or screen-reader users.

## Decisions that may wait until after the walking skeleton

- Billing provider and checkout/customer-portal UX.
- Browser push versus native-only push for Web Beta.
- Search pagination/highlight details.
- Media retention cleanup schedule.
- iOS-first, Android-first, or simultaneous native beta.
- Optional local stdio MCP shim and legacy clients outside the Wave 0 support matrix.
- Production Convex deployment identity and release provisioning; development uses `wandering-camel-662` now.

## Research baseline for these decisions

Checked 2026-08-30:

- [OpenAI Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp) — remote Streamable HTTP, OAuth, CIMD/DCR, server instructions, project configuration, and `codex mcp login`.
- [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp) — remote HTTP recommendation, project configuration, OAuth storage/refresh, and `claude mcp login`.
- [RFC 8252 native-app OAuth](https://www.rfc-editor.org/rfc/rfc8252#section-7.3) — browser-based authorization, loopback callback ports, PKCE, and the preference for loopback IP literals over `localhost`.
- [Chrome Local Network Access](https://developer.chrome.com/blog/local-network-access) — public-origin requests to loopback require a permission; the shipped request classes include `fetch`, subresources, and subframes, which dongo must never use for an OAuth callback.
- [MCP 2026-07-28 specification release](https://blog.modelcontextprotocol.io/posts/2026-07-28/) and [authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) — stateless requests, `server/discover`, routing headers, CIMD preference, OAuth discovery, PKCE, resource indicators, audience validation, scopes, and refresh-token requirements.
- [Better Auth MCP documentation](https://better-auth.com/docs/beta/plugins/mcp) and [device authorization documentation](https://better-auth.com/docs/plugins/device-authorization) — MCP OAuth composition and CLI device flow.
- [Open Convex Better Auth OAuth-provider compatibility report](https://github.com/get-convex/better-auth/issues/395) — reason the exact integration is a blocking Wave 0 spike rather than an assumed dependency.
