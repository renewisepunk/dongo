# Acceptance and release gates

## Definition of done for every task

- Owned paths only, unless Agent 00 approved a cross-owner change.
- Acceptance criteria demonstrated by automated tests where practical.
- Authorization and failure states covered, not only the happy path.
- No secrets or user content in logs, snapshots, URLs, or error reports.
- New public behavior represented in contracts and fixtures first.
- Accessibility applies to UI work; idempotency and tenant isolation apply to mutations.
- Handoff includes touched paths, commands run, results, known risks, and requested follow-up.

## Agent protocol and authentication gate

- The exact pinned Better Auth + Convex human session still authenticates Convex after the chosen OAuth/MCP/device composition is installed.
- `dongo connect` opens `verification_uri_complete`, shows matching terminal/browser code, requires explicit fixed-project/scopes approval, resumes by polling, and stores its credential only in the documented dongo user credential file outside the repository.
- CLI approve, deny, expiry, `slow_down`, refresh rotation, logout, server revocation, local-file ownership/mode/type/symlink/corruption failure, interrupted atomic write, and SSH/headless flows pass. Clean macOS/Linux tests prove no Keychain, Secret Service, installer, helper process, or OS credential prompt occurs.
- MCP Protected Resource Metadata and authorization-server discovery are standards-compliant.
- MCP `2026-07-28` `server/discover`, per-request protocol metadata, method/tool routing headers, stateless handling, and cacheable deterministic list results pass. Any legacy era remains enabled only for a pinned supported host and uses the same tools/auth rules.
- Authorization code with S256 PKCE, issuer validation, exact redirect handling, resource/audience binding, scope enforcement, refresh rotation, and revocation pass adversarial tests.
- Codex connects over remote Streamable HTTP, authenticates with `codex mcp login dongo`, receives server-wide instructions through its negotiated era, and calls one read and one idempotent write tool.
- Claude connects over remote HTTP, authenticates with `claude mcp login dongo` or `/mcp`, and calls the same tools.
- A generic MCP inspector completes discovery, registration, authentication, tool listing, and tool calls.
- CIMD is preferred when supported; DCR fallback works only for clients in the pinned compatibility matrix.
- CLI, Codex, Claude, and generic grants are independently revocable and resolve to distinct installation Actors.
- If the OAuth provider cannot coexist with the Convex auth plugin, the isolated authorization-server fallback passes the same gate before domain breadth begins.

## Agent walking-skeleton gate

- Fresh human authentication and first project work.
- Text Intake appears optimistically and survives refresh.
- Clean one-link CLI authorization never exposes or commits a token.
- Codex and Claude authenticate independently against the remote MCP server without a static token in configuration.
- Intake and Work claims are atomic and expiring.
- Two simultaneous claim attempts produce one winner.
- CLI, Codex MCP, and Claude MCP each pass the same triage, start, update, Attention, response-read, and finish semantics.
- A generic MCP inspector passes the operation contract without host-specific behavior.
- Human Attention response is durable and attributed.
- A lost mutation response followed by retry creates no duplicate object/Event/Run.
- Expired activity is not presented as currently working.
- Markdown export is deterministic, safe, and contains no secret URL/token.
- Remote MCP `sync_snapshot` is read-only; only the local CLI reports a successful repository write.

## Web Beta gate

- Google OAuth and email OTP success/error/rate-limit paths pass.
- Owner/member access and cross-tenant denial pass for every server capability.
- Overview transitions reactively without duplicate items or full-page reload.
- Work detail deep links, back behavior, focus restoration, and scroll preservation pass.
- Comments, ordering, attention, and search handle conflicts and retry safely.
- Direct/multipart upload covers success, cancel, resume/retry, quota, expired signature, and abandoned cleanup.
- Safari, Chromium, and Firefox smoke suites pass.
- Phone, tablet, wide desktop, reduced motion, high zoom, keyboard, and screen-reader checks pass.
- No unhandled console errors, hydration warnings, cross-project flashes, or duplicate optimistic records.
- Codex, Claude Code, generic MCP, and CLI surfaces pass the same golden scenario.
- Configure, authenticate, reinstall, upgrade, local config removal, server revoke, reauthorize, rotate, and doctor flows pass on clean environments.

## Security gate

- No operation trusts caller-provided organization, project, or Actor identity.
- OAuth access tokens are short-lived and audience-bound; refresh tokens rotate and their families are revocable. Static CI/service credentials have adequate entropy, are hashed at rest, and use constant-time verification.
- Device and authorization codes are short-lived and single-use; revoked grants and CI/service credentials fail immediately.
- PKCE, state, issuer-mix-up, redirect, audience-confusion, refresh-replay, token-passthrough, insufficient-scope, and unauthorized-client tests pass.
- OTP, device authorization, OAuth authorization/token/registration, upload, search, HTTPS agent, and MCP endpoints are rate-limited.
- Signed media access expires and enforces object/project ownership.
- MIME, size, checksum, malicious filename, path traversal, symlink escape, Markdown/XSS, terminal escape, and unsafe URL tests pass.
- Intake and attachment content is treated as untrusted prompt input by every CLI/MCP host integration.
- Automated secret scanning finds nothing in repository, logs, snapshots, CI artifacts, or support bundles.

## Concurrency and reliability gate

- Repeatable tests cover claim collision, renewal, expiry, reclaim, stale finish, and lease loss mid-work.
- Revision conflicts never silently overwrite.
- Every mutation is tested before and after simulated response loss.
- An idempotency key reused with a different payload fails.
- Subscription reconciliation yields exactly one Intake/comment/attention response.
- Notification retry produces one logical delivery per channel/escalation.
- R2 upload finalization cannot attach missing, partial, oversized, or cross-project objects.
- Backend outage and reconnect never falsely claim or start work.

## Native gate

- iOS and Android authenticate with the supported Better Auth/Convex flow.
- Overview, capture, uploads, Work detail, comments, and Attention response match web semantics.
- APNs/FCM tokens rotate safely and can be disabled/revoked.
- Push deep-links to the correct organization/project/WorkItem after cold start and warm start.
- No notification payload contains private work text.
- Offline state is visible; reconnect cannot duplicate mutations.

## Operational gate

- Development, staging, and production resources are isolated.
- Development is served from `dev.dongo.so` against Convex `wandering-camel-662`; production is served from `dongo.so` against a separate production Convex deployment. `www.dongo.so` redirects only to the production apex.
- Development deploys cannot alter the existing `dongo.so` Worker/routes, and production promotion uses the exact immutable artifact already accepted on development/staging.
- One request traces CLI → HTTPS → Convex or MCP host → MCP gateway → Convex → Event without logging content or secrets.
- Alerts cover human/CLI/MCP auth failure spikes, OAuth discovery/token failures, API/MCP mutation failure rate, notification failure, upload finalization failure, and deployment failure.
- Staging deploy and rollback have been rehearsed.
- Database changes are additive across supported client versions.
- Published CLI/MCP host packages use immutable artifacts and provenance where supported.
- Runbooks cover device-flow failure, MCP discovery/login failure, auth-provider isolation, revoked/expired tokens, refresh replay, corrupted host/repo config, export conflict, expired claim, backend outage, upload failure, notification failure, and package rollback.

## V1 product gate

The exact PRD success flow passes against production candidates:

1. Sign in, create/select project, and authorize the CLI from one terminal-opened browser link without learning the API or copying a token.
2. Connect Codex or Claude to the remote MCP server and authorize that host through the same dongo web identity and project-consent experience.
3. Submit text plus screen recording in seconds.
4. A later local agent session notices and usefully triages it through CLI or MCP.
5. Agent claims work and Overview immediately presents truthful status.
6. Agent requests a decision; the human is notified and responds from web/native.
7. The local agent receives the response on the next documented pull boundary.
8. Work completes with outcome and artifacts; the authenticated CLI writes durable repository Markdown on sync.

Agent 00, Agent 07, and the product owner must all sign off. “Mostly passing” is not a release state for tenant isolation, secrets, claims, idempotency, or attention-response durability.
