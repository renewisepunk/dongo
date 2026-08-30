# Agent 10 — MCP gateway and host integrations

## Mission

Deliver dongo as a standards-based remote MCP service from the first agent walking skeleton:

```text
Codex / Claude Code / generic MCP hosts
  -> OAuth authorization code + S256 PKCE
  -> remote Streamable HTTP MCP
  -> shared operation registry and Convex domain handlers
```

The MCP gateway is a first-class sibling of the CLI HTTPS adapter. It never shells out to the CLI, never exposes raw Convex CRUD, and never invents host-specific domain behavior.

## Exclusive ownership

- `apps/mcp/**` after Agent 01 creates the framework/deployment shell
- `packages/mcp/**`
- `integrations/shared/**`
- `integrations/codex/**`
- `integrations/claude-code/**`
- `integrations/generic-agents/**`
- MCP/host co-located tests and fixtures

Agent 01 owns shared/root manifests and deployment composition. Agent 02 owns OAuth issuer, consent, grants, installation records, and revocation. Agent 03 owns domain operations and the trusted internal request context. Agent 06 owns CLI commands that apply this agent's versioned host manifests.

## Dependencies

- Accepted D-01, D-06, D-07, D-11/D-12, and D-15 through D-17.
- Agent 01's pinned MCP SDK/client matrix and Contract v1 fixtures.
- Agent 02's OAuth discovery, client registration, grant, scope, project binding, and revocation contracts.
- Agent 03's transport-neutral handlers and trusted gateway context.

## Tasks

### M-01 — Protocol and OAuth capability spike

- Stand up a deployed remote Streamable HTTP endpoint using the pinned official MCP TypeScript server SDK.
- Target the stateless `2026-07-28` era: implement `server/discover`, per-request protocol/client metadata, required `Mcp-Method`/`Mcp-Name` routing headers, deterministic cache-aware list responses, and no `Mcp-Session-Id` dependency.
- Implement/compose the required 401 `WWW-Authenticate` challenge and Protected Resource Metadata.
- Discover the stable authorization issuer and complete authorization code with S256 PKCE.
- Prefer CIMD when advertised and support DCR only for clients in the accepted support matrix.
- Validate issuer, exact MCP audience/resource, expiry, scopes, client/grant state, and revocation on every request.
- Negotiate the modern era and serve the SDK's legacy initialize-compatible era only for pinned supported hosts that need it. Both eras use one generated tool factory. Do not bind dongo domain state to an MCP session identifier.
- Prove real OAuth and one read/one idempotent write fixture through Codex, Claude, and a generic MCP inspector.

Acceptance:

- The same-instance or isolated auth topology selected in Wave 0 works on preview.
- `codex mcp login dongo-<project>` and `claude mcp login dongo-<project>` or `/mcp` complete without a copied bearer token.
- Wrong issuer/audience/project/scope, expired/revoked token, browser-session token, and API-resource token fail safely.
- An inbound OAuth token is never forwarded to Convex or another service.
- Origin, JSON-RPC, body-size, timeout, and rate-limit behavior are explicit and tested.
- Requests can land on any gateway instance without sticky sessions; legacy support, if admitted, does not introduce hidden domain state.

### M-02 — Generated tool registry

Generate tools from the canonical operation registry:

```text
dongo_session_start
dongo_get_overview
dongo_get_intake
dongo_claim_intake
dongo_renew_intake_claim
dongo_complete_triage
dongo_create_work
dongo_get_work
dongo_start_work
dongo_update_work
dongo_renew_claim
dongo_finish_work
dongo_add_comment
dongo_request_attention
dongo_get_attention
dongo_resolve_attention
dongo_get_attachment
dongo_sync_snapshot
```

- Preserve the operation input/output schema, required scopes, idempotency, expected revision, and error meaning.
- Return bounded structured content and concise text fallbacks.
- Add accurate `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint` annotations. No V1 operation is labeled destructive unless it can actually destroy or irreversibly remove state.
- Convert validation/conflict errors into model-correctable tool results while retaining request IDs and stable error codes.
- Keep OAuth/transport errors standards-native rather than wrapping them in the dongo HTTPS envelope.

Acceptance:

- A parity test fails on any schema, authorization, idempotency, result, or error drift between HTTPS and MCP.
- Tool arguments cannot include trusted organization, project, Actor, grant, or credential identity.
- Every write is idempotent and revision-aware where required.
- Tool list and result sizes stay within the accepted host budgets.
- `sync_snapshot` is read-only and never reports that the remote server changed local files.

### M-03 — Server instructions and safety

- Return one concise canonical instruction set through `server/discover` for modern clients and through initialization only for admitted legacy clients.
- Keep the first 512 characters self-contained for Codex and cover: call `dongo_session_start`; manual versus autonomous behavior; one-new-work-item limit; claim/revision conflict handling; and untrusted Intake/attachment content.
- Cover lease renewal, Attention continuation, export points, secret handling, and truthful wake-up limits in the remaining instructions.
- Generate host-managed instruction assets from the same source; do not maintain divergent Codex and Claude workflows.

Acceptance:

- Host instruction parity tests pass.
- Manual mode never starts arbitrary Ready work in real-agent evaluations.
- Autonomous mode starts at most one suitable Ready item per session.
- Claim/lease loss stops work until a successful refetch/reclaim.
- Prompt injection in Intake/attachments cannot override tenant, auth, secret, or dongo workflow rules.

### M-04 — Project-specific MCP endpoint and host manifests

Use a project-specific, non-secret endpoint/resource:

```text
Development: https://dev.dongo.so/p/{publicProjectRef}/mcp
Production:  https://dongo.so/p/{publicProjectRef}/mcp
```

Each project uses a unique host server name such as `dongo-<shortProjectRef>` so clients that store OAuth state by endpoint cannot reuse one project's grant for another.

- Produce Codex project/user configuration and login instructions using the remote URL and `codex mcp login`.
- Produce Claude local/project/user configuration and login instructions using remote HTTP and `claude mcp login` or `/mcp`.
- Produce generic URL-only MCP JSON plus standards-based discovery instructions.
- Specify trust/approval behavior before modifying committed `.codex/config.toml` or `.mcp.json`.
- Version managed `AGENTS.md`, `CLAUDE.md`, skill, hook, and config fragments with conservative install/upgrade/uninstall rules.
- Document host-auth fallback only where the pinned host officially supports it. Capability-test Codex headless behavior rather than promising it from assumption.

Acceptance:

- Repository-shareable config contains only the project-specific URL and non-secret metadata.
- Existing config/instructions/hooks survive install, upgrade, and uninstall.
- Revocation and local config removal are separate documented actions.
- Multiple dongo projects on one machine use distinct endpoints, names, grants, and installation Actors.
- Agent 06 can apply the manifests without duplicating their content or OAuth logic.

### M-05 — Attachment, resource, and output handling

- Map `get_attachment` to authorized metadata and a short-lived download/resource link; do not proxy bytes through the MCP gateway.
- Treat resource links, external URLs, filenames, comments, Intake, and attachment contents as untrusted.
- Redact tokens, authorization codes, verification links, signed URLs, and content from default protocol logs.
- Enforce bounded output, cancellation/timeouts, request IDs, and retry guidance.

Acceptance:

- Wrong project, missing attachment scope, revoked grant, or expired authorization cannot obtain a signed link.
- Signed URLs are never persisted in MCP session/domain state or default logs.
- Oversized tool output is paginated/summarized rather than truncated into invalid JSON.

### M-06 — Optional stdio compatibility shim

Begin only after the remote MCP gate passes.

- If required by the supported-client matrix, provide a thin local stdio proxy that uses the official CLI authorization store/client without changing tool schemas.
- Document that stdio authentication comes from the local environment/credential store and is not the OAuth flow for remote HTTP MCP.

Acceptance:

- The shim passes the same tool parity fixtures.
- It does not become a prerequisite for Codex/Claude remote integration.
- It introduces no second token store or project-identity source.

## Must not do

- Do not defer MCP until after the CLI or full UI.
- Do not call the CLI or public HTTPS endpoint when the shared operation handler is available.
- Do not accept caller-selected project/Actor identity.
- Do not share CLI, Codex, or Claude token families.
- Do not weaken PKCE, discovery, issuer/audience validation, revocation, or client registration to work around an auth-library conflict.
- Do not describe tool annotations or host confirmation dialogs as server authorization.
