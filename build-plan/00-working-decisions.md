# Working decisions before implementation

These decisions resolve gaps that would otherwise make parallel agents produce incompatible implementations. They do not modify the PRD. They are recommended planning defaults and should be explicitly accepted or replaced before Wave 1.

## Blocking decisions

### D-01 — Canonical agent transport

Recommended: the versioned operation contract is canonical. It defines operation names, input/output schemas, authorization, idempotency, errors, and domain effects independently of transport.

- The official Dongo CLI uses the typed HTTPS adapter at `/api/agent/v1`.
- A hosted MCP server exposes the same operations over remote Streamable HTTP from the first walking skeleton.
- Codex, Claude Code, and generic MCP hosts connect directly to the MCP server; they do not call the CLI for remote Dongo operations.
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

Recommended: V1 promises no background wake-up. Agents pull at session start and before continuing prior Dongo work. A human response is available on the next explicit pull or session. An active adapter may poll only while its host session remains open. Product copy must not imply that a stopped local agent resumes itself.

### D-06 — Agent identity

Recommended: every CLI or MCP authorization grant is linked to one stable installation Actor. Each host session supplies a new opaque session ID used by Runs. The human authorizes the installation, but subsequent product activity is attributed to that installation Actor rather than to the human. Callers may report agent type and machine label, but never choose `actorId`, `organizationId`, or `projectId`; the server derives them from the validated grant and selected project.

### D-07 — Agent authorization bootstrap and storage

Recommended:

- `dongo connect` uses the OAuth Device Authorization Grant. Before opening `verification_uri_complete`, the CLI detects the repository and prepares a bounded, non-secret first-project proposal: name, safe repository URL when available, and execution mode. The proposal travels only as visible browser-link parameters; it is never treated as trusted token data.
- The CLI/agent selects the intended project before consent using, in order, an explicit `--project-ref`, this repository's valid non-secret marker, an exact normalized repository URL match, a unique project name/slug match, or the account's only active project. The browser authenticates the human and shows that fixed project, client, comparison code, scopes, resource, and Approve/Deny controls; it never offers a project picker during CLI approval. If matching is ambiguous, approval fails closed. If the account has no project, one explicit **Create & approve** action creates the personal organization and proposed first project, binds it to the pending device grant, and then approves.
- The token issued after approval remains project-bound. Dongo does not introduce an account-wide work token or let callers choose `organizationId`, `projectId`, or `actorId`; the browser-backed human identity creates the project and the authorization server binds the resulting stable project reference before token issuance.
- The CLI infers project context by default and accepts `--project-ref`, `--project-name`, `--repository-url`, and `--execution-mode manual|autonomous` overrides so agents and headless workflows can prepare the exact binding or first-project proposal before the human consent step. No code copy/paste or localhost callback is required.
- Remote MCP clients use the MCP OAuth authorization-code flow with S256 PKCE and the client registration mechanism negotiated from discovery. Prefer Client ID Metadata Documents (CIMD); retain Dynamic Client Registration only for supported-client compatibility.
- CLI, Codex, Claude, and other MCP hosts receive separate grants and token families. Tokens are never copied between clients.
- The npm CLI stores its bounded rotating OAuth credential in a Dongo-owned user file outside the repository (`0700` directory and `0600` file on POSIX), with atomic writes and fail-closed ownership/type/symlink/permission checks. It never invokes Keychain, Secret Service, an installer, or a generic helper in normal use. Keychain requires a future stable signed Dongo helper and explicit opt-in. Native Windows persistence remains gated on verified owner-only ACLs. MCP hosts own their credential storage. The complete rationale and threat model are canonical in `build-plan/07-cli-credential-storage.md`.
- `DONGO_TOKEN` is allowed only as an explicit non-interactive CI/service override; it is not the interactive onboarding path.
- `.agent-work/project.json`, `.codex/config.toml`, and `.mcp.json` contain non-secret project/server configuration only and may be committed after user confirmation.
- Pairing codes are not part of the planned interactive V1 flow. A failed OAuth flow is repaired through retry, reauthorization, or the isolated authorization-server topology—not a copied bearer token.

### D-08 — First-login tenancy

Recommended: first login creates the human profile but does not force a UI-first project form. The primary agent-first path starts in a repository with `dongo connect`; the CLI proposes the first project and the authenticated human creates and authorizes it in one consent action. The web project form remains a fallback for a legacy/manual device link or a human who starts in the web app. Project creation also creates the personal organization when needed. The subscription belongs to the organization. The free entitlement allows one active project; archived projects do not consume the active-project allowance.

### D-09 — Upload architecture

Recommended: browsers and native clients upload directly to R2. Small uploads use a short-lived presigned PUT; video/large files use multipart upload. Convex reserves quota, tracks upload state, and finalizes metadata only after size/checksum validation. Bytes never transit Convex, and a 250 MB file is never proxied through the app Worker.

### D-10 — Web and native release boundary

Recommended: ship a Web Beta after the walking skeleton and product-completeness waves. Full V1 follows after at least one native client provides the promised push path; iOS and Android can be implemented in parallel once the API is frozen. If faster public launch is preferred, explicitly change the V1 notification gate to browser push or email.

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

Convex remains authoritative. Export files are deterministic and marked as Dongo-managed. Sync may replace generated content but never imports edits, stages files, commits, or pushes. Local write failure after a successful cloud mutation is a warning repaired by the next explicit sync.

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
/app/:orgSlug/:projectSlug/work/:identifier
/app/:orgSlug/:projectSlug/search
/app/:orgSlug/:projectSlug/done
/app/:orgSlug/settings/*
/app/:orgSlug/:projectSlug/settings/*
```

Work detail is route-backed but rendered as a desktop side panel or mobile full-screen sheet, preserving back behavior, focus, and Overview scroll position.

### D-15 — MCP transport and tool policy

Recommended: ship authenticated project-specific remote Streamable HTTP endpoints at `https://dev.dongo.so/p/{publicProjectRef}/mcp` in development and `https://dongo.so/p/{publicProjectRef}/mcp` in production. Target the stateless MCP `2026-07-28` era with the official TypeScript SDK v2, explicit `server/discover` support, per-request protocol/client metadata, required routing headers, and no domain reliance on MCP sessions. Serve a legacy initialize-compatible era from the same tool factory only when Wave 0 proves a pinned Codex, Claude, or generic host still needs it. A unique URL/server name per project prevents clients that key OAuth storage by endpoint from reusing one project's grant for another. The server publishes concise cross-tool instructions, bounded structured results, stable tool names, and accurate `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint` annotations. Annotations improve host UX but never replace server authorization or invariant enforcement.

Initial access profiles map to explicit scopes: `dongo:work:read`, `dongo:work:write`, and `dongo:attachments:read`. The CLI may additionally request `offline_access` for refresh capability. The authorization server may return a narrower approved scope set; every HTTPS operation and MCP tool enforces its required scope server-side. Scope expansion always requires a new consent step.

The MCP resource server implements OAuth Protected Resource Metadata, validates issuer/audience/expiry/scopes on every request, never accepts a token minted for another resource, and never passes an inbound MCP token through to Convex or another downstream service.

### D-16 — OAuth provider feasibility gate

Decided on 2026-08-30: use the isolated authorization-server topology. The maintained Convex integration currently requires Better Auth `1.6.x`, while the maintained MCP/OAuth/device packages require the `1.7.x` line; the open Convex integration incompatibility means they must not share one Better Auth instance.

- Human authentication remains in the Convex-integrated Better Auth `1.6.x` instance.
- A separate Cloudflare authorization Worker uses the pinned Better Auth `1.7.x` OAuth Provider, OAuth Device Authorization integration, JWT support, and CIMD/DCR compatibility. It consumes a signed, short-lived, single-use assertion from the authenticated human/Convex boundary to establish the same Dongo user without copying the human session.
- CLI Device Authorization and every remote MCP host receive independent grants and refresh families. The CLI audience is the agent HTTPS API; each MCP grant is bound to its exact project-specific resource URL.
- The API and MCP resource servers receive only a token-verifier interface. Verification must check signature or introspection, exact issuer, time bounds, exact RFC 8707 resource, scopes, client/grant status, refresh-family revocation, and current Dongo installation binding. The inbound token is never forwarded to Convex.
- Better Auth remains responsible for discovery, PKCE, device-code polling semantics, token issuance, refresh rotation/replay handling, revocation, and maintained client discovery. Dongo owns project consent, grant-to-installation binding, and the signed internal gateway context.

The candidate line for implementation is Better Auth and all `@better-auth/*` OAuth packages `1.7.2`; update them only as one tested set. The isolated topology must still pass the complete local and preview gate for human Convex identity, device flow, refresh, revocation, MCP authorization, Codex, Claude, and a generic inspector. Do not hand-roll OAuth endpoints or weaken discovery, PKCE, audience validation, refresh rotation, or revocation.

### D-17 — Agent-first UI boundary

Recommended: before the agent protocol gate, web work is limited to sign-in, project create/select, device/MCP approval and consent, installation list/revocation, text Intake, minimal status, and Attention response. Full Overview/detail polish, media, search, administration breadth, billing, and native work begin only after CLI, Codex MCP, Claude MCP, and a generic MCP inspector pass the same agent golden path.

### D-18 — Public environment origins

Decided: Cloudflare serves development from `https://dev.dongo.so` and production from `https://dongo.so`. `https://www.dongo.so` redirects to the production apex. Convex deployment `wandering-camel-662` is the named development backend. Development and production use separate Worker environments, OAuth issuers/resources, secrets, R2 buckets, and Convex deployments; a dev token or cookie must never authenticate against production.

`dev.dongo.so` is currently unprovisioned and must be created as part of Wave 0 infrastructure setup. The existing `dongo.so` Worker remains untouched until an accepted production release artifact is promoted. Web, auth, API, and project-specific MCP routes share the environment origin but remain separate route/security boundaries behind the Cloudflare entry layer.

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
- [MCP 2026-07-28 specification release](https://blog.modelcontextprotocol.io/posts/2026-07-28/) and [authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) — stateless requests, `server/discover`, routing headers, CIMD preference, OAuth discovery, PKCE, resource indicators, audience validation, scopes, and refresh-token requirements.
- [Better Auth MCP documentation](https://better-auth.com/docs/beta/plugins/mcp) and [device authorization documentation](https://better-auth.com/docs/plugins/device-authorization) — MCP OAuth composition and CLI device flow.
- [Open Convex Better Auth OAuth-provider compatibility report](https://github.com/get-convex/better-auth/issues/395) — reason the exact integration is a blocking Wave 0 spike rather than an assumed dependency.
