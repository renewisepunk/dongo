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
- Development signup tests prove invalid or unlisted email creation fails closed
  only at `https://dev.dongo.so`, while existing-account sign-in and production
  signup behavior remain unchanged.
- Super-admin access is derived server-side; ordinary and cross-tenant users
  cannot read usage or mutate allowances, and returned/audited data excludes
  product content, credentials, emails in event payloads, and provider data.

## Concurrency and reliability gate

- Repeatable tests cover claim collision, renewal, expiry, reclaim, stale finish, and lease loss mid-work.
- Revision conflicts never silently overwrite.
- Every mutation is tested before and after simulated response loss.
- An idempotency key reused with a different payload fails.
- Subscription reconciliation yields exactly one Intake/comment/attention response.
- Notification retry produces one logical delivery per channel/escalation.
- R2 upload finalization cannot attach missing, partial, oversized, or cross-project objects.
- Backend outage and reconnect never falsely claim or start work.
- Browser and deployment-operator project allowance writes share one revision
  domain; interleaved stale writers conflict. Work allowance writes use an
  independent revision, 24-hour idempotency expires, and cleanup remains bounded.
- The historical Work-count migration completes before allowance acceptance;
  exact and saturated counters make repeated at-cap creation checks constant-read.

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
- Every production release automatically reconciles the public CLI: unchanged
  payloads match npm and skip, while changed payloads require a new unpublished
  version and package-level read-write authorization on the pinned public npm
  registry before production mutation. Publication
  happens only after the production smoke gate, reuses the exact verified
  archive, and proves registry integrity plus clean installed behavior.
- Online CLI commands check the official scoped npm package with a bounded,
  fail-open request. A newer stable version produces a fixed, version-pinned
  advisory that requires the agent to ask the user before installation; no
  client self-installs or executes registry-provided text.
- Production preflight and CI verify the reviewed agent release manifest, its
  monotonic identifier/sequence history, and exact public CLI version and
  command. After public smoke and npm reconciliation, production monotonically
  activates that exact marker. Existing modern and legacy MCP installations can
  receive the notice on their next eligible successful call without any change
  to canonical structured output; concurrent delivery occurs at most once,
  same-release redeploy and rollback do not repeat or regress it, and advisory
  failure never fails the underlying operation.
- Published CLI/MCP host packages use immutable artifacts and provenance where supported.
- Runbooks cover device-flow failure, MCP discovery/login failure, auth-provider isolation, revoked/expired tokens, refresh replay, corrupted host/repo config, export conflict, expired claim, backend outage, upload failure, notification failure, and package rollback.

## Local runner gate

- Runner jobs are command-free, project-derived, idempotent, revision-aware,
  leased, and cancellable. Terminal state is externally immutable; the sole
  internal exception is a one-attempt same-job recovery after an exact runner
  lease expiry, once the upgraded dispatcher no longer reports that job active.
- A runner proves both its current project-scoped OAuth grant and independently
  revocable subordinate registration credential.
- The runner opens no inbound port, runs without elevation, stores credentials
  outside repositories with owner-only permissions, and installs/removes cleanly
  through macOS launchd and Linux user-level systemd.
- The server cannot select an executable, arguments, environment, system prompt,
  repository path, sandbox bypass, or automatic approval mode.
- Local policy revalidates repository and executable identity immediately before
  launch. Changed, missing, symlinked, dirty, unsupported, or unauthorized state
  fails closed with a truthful code.
- Codex runs through stable non-interactive JSONL and resumes only an exact
  captured session ID for the same job and repository. Claude Code runs through
  print-mode streaming JSON under the same exact-ID rule.
- Ask-before-run is the default. Automatic execution requires explicit local
  approval for one repository and cannot be enabled remotely.
- Offline, reconnect, reboot, duplicate delivery, multiple-runner race, response
  loss, cancellation race, revocation, lease loss, unsafe output, and uninstall
  paths pass without duplicate execution or disclosure.
- A clean runner fills six isolated worktree slots, reports exact per-job
  liveness across restart, refills a released slot, remains compatible with a
  serial client, and never exceeds the smaller host/project safety bound.
- Two live-review Runs may keep implementing concurrently while a named shared
  fixture has one holder and FIFO waiters. Duplicate acquire delivery remains
  one claim; renewal prevents stale takeover; release, Work completion, failure,
  cancellation, lease expiry, and runner reconciliation hand the fixture to the
  next eligible waiter without consuming another Run slot or creating Attention.
- Server-visible events contain bounded, redacted lifecycle state only. Raw
  process output, local paths, session IDs, repository content, environment, and
  credentials remain local.
- The web distinguishes no runner, online, offline queued, waiting for local
  approval, starting, running, blocked, cancelled, failed, expired, and complete
  states without claiming to wake a sleeping machine.
- Both real harness journeys and the complete browser matrix pass against the
  exact development candidate before production promotion.

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
