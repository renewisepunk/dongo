# Agent 07 — Quality, security, observability, and release

## Mission

Turn contracts and lifecycle rules into executable evidence from Wave 0 onward. Own cross-feature tests, adversarial verification, CI, staging validation, observability requirements, release provenance, canary, and rollback.

## Exclusive ownership

- `tests/contract/**`
- `tests/integration/**`
- `tests/e2e/**`
- `tests/evals/**`
- `tests/security/**`
- shared test helpers/fixtures after coordinating with feature owners
- `.github/workflows/**`
- `docs/runbooks/**`
- release manifests and checklists

Feature agents retain ownership of co-located unit/component tests.

## Start in Wave 0

- Convert the state matrix and contracts into model/contract tests before implementation.
- Establish fast local lanes and separate credentialed OAuth/MCP/staging/R2/native lanes.
- Define performance, accessibility, browser, reliability, and security budgets.

## Test plans

### Q-01 — Contract and state models

- Test every operation’s success, invalid, unauthenticated, insufficient-scope, forbidden, wrong-tenant, wrong-role, archived-project, revoked-grant/token, wrong audience, conflict, and retry behavior through HTTPS and MCP.
- Model Intake, WorkItem, Run, claim, Attention, idempotency, and upload transitions.

Acceptance:

- Tests assert invariants after failed operations, not only response codes.
- Contract fixtures run against fake transport and deployed preview.
- HTTPS and MCP parity tests fail on schema, authorization, idempotency, error, Event, or result drift.

### Q-02 — Concurrency and failure injection

- Simultaneous intake/work claims, lease renewal/expiry/reclaim, stale finish, lease loss while coding, expected-revision conflicts, response loss before/after commit, and idempotency payload mismatch.
- Use real staging concurrency in addition to mocked/unit tests.

Acceptance:

- Exactly one claim/Run wins.
- Failures never leave contradictory WorkItem/Run/claim state.
- Timing-only/flaky assertions are rejected.

### Q-03 — Product, OAuth, and host E2E

- Human auth/project; CLI Device Authorization approve/deny/expire/slow-down/refresh/logout/revoke/headless; Codex/Claude/generic MCP discovery, PKCE, registration, login, tool calls, refresh, revoke/reauth; text Intake; media; triage; Overview; Work detail; comments; Attention; conflicts; search; installation settings; export; and native deep links.

Acceptance:

- Required journeys in `../03-release-gates.md` pass on staging.
- Browser tests use an auth test adapter rather than live Google.

### Q-04 — CLI/MCP behavioral evaluations

- Deterministic managed-block/configure/authenticate/upgrade/uninstall, CLI sequences, MCP tool parity, server instructions, offline/conflict recovery, and export goldens.
- Opt-in real Codex/Claude scenarios: duplicate, split, material/non-material ambiguity, manual refusal, autonomous ranking, response continuation, prompt injection, and lease loss.

Acceptance:

- Safety invariants score 100%: no secret output, cross-project call, unauthorized manual start, or continuation after claim loss.
- Semantic thresholds are agreed before release and failures are manually reviewed.

### Q-05 — Security suite

- OAuth issuer/audience/resource substitution, PKCE downgrade, state/redirect/authorization-code replay, device phishing and poll flooding, refresh replay/family revocation, JWKS rollover, token-in-query rejection, cross-environment tokens, DCR abuse, and SSRF/rebinding/redirect/size/rate controls for CIMD metadata fetches.
- Static service credential entropy/hash/constant-time verification, local file permissions, secret redaction, rate limits, signed URL expiry, MIME/size/checksum, malicious filenames, Markdown/XSS, unsafe URLs, terminal escapes, SSRF-safe origins, traversal/symlinks, dependency and secret scanning.

Acceptance:

- No server operation trusts caller identity/tenancy fields.
- Logs/CI/support artifacts pass secret-pattern scanning.
- Threat model explicitly covers malicious Intake/attachments as prompt injection.

## Observability requirements

Trace request ID, versioned operation, safe issuer/audience/scope class, grant/installation or service-credential ID (never token), safe project/actor identifiers, latency/result/error, conflicts, retries, MCP client/CLI version, authorization/revocation, and delivery state. Do not log access/refresh/device/authorization codes, verification links, Intake text, comments, OTPs, signed URLs, or attachment contents by default.

Acceptance:

- One request traces CLI → HTTP → Convex or MCP host → gateway → Convex mutation → Event.
- Alerts cover human/CLI/MCP auth spikes, discovery/token/refresh failures, API/MCP failures, notification failures, upload finalization, and deployment failure.

## CI and release

PR gates: format, lint, typecheck, unit, contracts, OAuth/MCP conformance, state transitions, export/host goldens, web/CLI/MCP builds, dependency audit, and secret scan.

Deployment order:

1. Additive backend/schema.
2. Staging contract/smoke tests.
3. OAuth issuer, discovery, JWKS, and resource metadata.
4. Approval/consent/installations UI.
5. Compatible API/MCP gateway.
6. CLI and host packages.
7. Clean-machine/client-matrix tests.
8. Native candidates when applicable.
9. Internal canary.
10. Immutable production promotion.

Release requires successful rollback rehearsal and the full `../03-release-gates.md` checklist.
