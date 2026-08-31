# V1 completion audit — 2026-08-31

This audit measures the current repository and live development stack against the unchanged PRD and [`build-plan/03-release-gates.md`](../../build-plan/03-release-gates.md). It is intentionally stricter than a progress summary.

The original PRD SHA-256 remains `b6a97c39aaf056dd6380e451b89fd76ff8883ac968ede5a1b0fab48eceb0f70a`.

## Current build-goal boundary

The product owner narrowed the active build goal on 2026-08-31 to an end-to-end development candidate. Native iOS and Android applications, push-notification delivery, staging, and production application deployment are explicitly outside this goal. Responsive mobile-web behavior remains in scope. This is an execution boundary for the current goal, not a change to the original PRD.

Rows below that concern native clients, staging, or production are retained as an honest account of the full PRD, but they do not block completion of the current dev-only goal.

## Current verdict

The development web, CLI, canonical operation layer, remote MCP server, edge services, email notification path, and repository export are substantially implemented and tested. The exact current candidate passes the automated suite recorded in [`dev-validation-2026-08-30.md`](dev-validation-2026-08-30.md).

The current dev-only goal is **not yet complete**. Its remaining evidence includes the complete cross-surface agent/human golden journey, live Google identity proof, live CLI logout isolation, a real browser-to-R2 media journey, and clean-host/package provenance. Native clients, push, staging, rollback rehearsal, and a production application candidate remain outstanding against the full PRD but are outside the current build goal.

## Requirement-by-requirement status

| Gate | Status | Authoritative evidence | What remains |
|---|---|---|---|
| Original scope preserved | Proven | The PRD digest matches the recorded baseline. | Keep the PRD unchanged; record implementation decisions only in additive documents. |
| Human email authentication | Proven in development | A fresh account completed email OTP, first-project provisioning, and CLI approval on the live development stack. Automated success, failure, resend, callback, and rate-limit journeys pass. | Repeat on the final staging/production candidate. |
| Human Google authentication | Partial | The live redirect reaches Google's normal account screen with the exact development callback. | Complete login with the intended Wisepunk Google identity and verify the resulting Convex profile and tenancy. |
| One-link CLI authentication | Proven in development | The packed CLI completed terminal → browser → authenticated terminal with no token copy, project picker, Keychain prompt, or repository credential. | Prove deny/expiry/headless and successful logout against disposable live grants on clean macOS and Linux hosts. |
| CLI credential storage | Proven on this macOS host and in automated tests | Owner-only external credential files, atomic refresh rotation, symlink/mode/ownership/corruption failures, and failed-revocation retention pass. | Complete the documented Linux desktop, Linux SSH/container, WSL, and release-blocked Windows matrix. |
| Codex remote MCP | Partial live proof | A distinct Codex installation completed session start, read, and a replay-safe comment write; the result exported through the CLI. | Run the complete triage, work lifecycle, Attention response, finish, refresh, revoke, and reauthorize journey. |
| Claude Code remote MCP | Proven through work lifecycle | A distinct Claude Code installation completed OAuth, session/read, replay-safe create/start/update/finish, and remained active after another installation was revoked. | Run Intake triage and the human Attention response portion, then prove refresh/revoke/reauthorize on a disposable Claude grant. |
| Generic remote MCP | Proven through auth/read/write/refresh/revoke | MCP Inspector completed strict discovery, session/read, replay-safe create, non-interactive refresh, and immediate revocation. Claude and CLI remained active afterward. | Run the complete triage, work, Attention response, and finish journey with a fresh disposable generic grant. |
| Canonical domain and concurrency | Proven by automated suite | Contract, Convex, API, MCP, client, claim, lease, revision, idempotency, response-loss, tenancy, and lifecycle tests pass on the current candidate. | Repeat stress and failure-injection gates on staging with the exact release artifacts. |
| Packed CLI lifecycle | Proven in development | The exact packed archive created, started, updated, and finished `DONGO-4`; every mutation replay returned the original result. A second deterministic sync returned identical hashes. | Complete live Intake triage and human Attention response, then prove logout/revoke with a disposable grant. |
| Web product behavior | Proven in automated browser matrix | 183 Playwright tests pass across Chromium, Firefox, and WebKit, including Overview, detail, responsive states, paste image, full-page drop, upload retry/cancel, search, settings, and auth/consent states. | Perform the live media and golden human/agent journeys, plus manual screen-reader, high-zoom, and performance review on the release candidate. |
| Attachments and R2 | Proven in unit/integration layers | Direct and multipart capability validation, upload, retry, abort, completion, cleanup, quota, checksum, origin, and cross-project failures pass. | Submit real text plus an image/video through the deployed browser, verify R2 finalization and agent retrieval, and exercise a real interrupted multipart upload. |
| Attention email | Proven in development | A real one-hour important escalation was dispatched once and delivered through the Wisepunk Resend account. | Complete the human response and next-pull agent continuation in the golden journey. |
| Native clients and push | Out of current goal; missing against full PRD | The shared notification contracts/providers and APNs/FCM server code exist, but native client source trees and enabled push credentials do not. | Deferred by the product owner for this dev-only goal. |
| Environment isolation | Proven for current development and landing origins | Static six-Worker checks, Wrangler deployment history, 14/14 development smoke, and 8/8 live boundary smoke pass. Production auth/API/MCP paths are absent. | Provision staging, produce an immutable candidate, rehearse rollback, and only then promote the accepted application artifact to production. |
| Operational release | Partially in current goal | Development runbooks, CI, safe logs, health/readiness, and per-service observability configuration exist. | For the dev-only goal, prove clean-machine CLI/package provenance and the relevant development observability checks. Staging rollback, production publication, and production support sign-off are deferred. |
| Exact PRD V1 success journey | Missing as one uninterrupted candidate run | Individual web, CLI, MCP, notification, and export slices are proven. | Run setup → text/video Intake → later triage → claim → truthful Working → human decision notification/response → next pull → finish → artifact/outcome → repository Markdown against the same candidate. |

## Required execution order

1. Finish the live authentication lifecycle: Google identity and disposable CLI logout/revocation.
2. Run the complete golden agent/human journey through CLI, Codex, Claude Code, and a generic MCP client, including lost-response replay and Attention response.
3. Run the deployed browser media journey with image/video, direct/multipart R2, agent download, retry, and cleanup evidence.
4. Complete clean-host CLI/package and manual accessibility/performance gates.
5. Accept the exact development candidate and record the remaining full-PRD work separately.

Until every in-scope development row above is proven against its required scope, the active build goal remains open. Native clients, push, staging, and production remain visible as deferred full-PRD work and are not completion conditions for this goal.
