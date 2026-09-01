# Production launch — 2026-08-31

## Verdict

The first Codex-first production release is live at `https://dongo.so` and is suitable for real use. Development remains independently available at `https://dev.dongo.so`.

The release includes the public marketing, get-started, help, and security pages; Google and email OTP authentication; responsive authenticated workspace; project-scoped remote MCP; packed CLI device authorization; issue lifecycle; human and agent comments; attention/continuation; repository export; and image attachment upload, inline preview, download, and agent metadata access. Native mobile applications and live push delivery remain outside this release.

## Production topology

| Component | Production target | Released version |
|---|---|---|
| Web | `dongo-web-production` | `694083b5-b930-4746-bc2b-7d6f31635073` |
| Authorization | `dongo-auth-production` | `ba80f3e5-7929-42e7-a616-167b68662003` |
| Agent API | `dongo-api-production` | `f57a195e-efb5-4c82-8732-a11569f481a6` |
| Remote MCP | `dongo-mcp-production` | `67583ee0-27cd-4233-9332-c225054f6cab` |
| Attachment edge | `dongo-files-production` | `b5540728-32c2-427a-939e-db2148773630` |
| Notifications | `dongo-notifications-production` | `1604a362-7be2-4eae-a84a-57f17cf5d8da` |
| Domain state | Convex `brainy-camel-172` | production deployment |
| OAuth database | D1 `dongo-auth` | production binding |
| Attachment storage | R2 `dongo-attachments` | production binding |

The previous landing Worker versions recorded before cutover were `f956c68f-9fdd-4e61-a507-9f637038b10f` and `8400a256-1850-40d8-b3a3-dbd338ee3e90`. The rollback procedure remains in [`../runbooks/production-release.md`](../runbooks/production-release.md).

## Release gates

- Complete source checks and tests passed after the final CLI branding change.
- The exact CLI archive gate passed with archive SHA-256 `385fae240e01e39145c2d53a2d47c4530c8684eda0e055c8f18a8c083486aab8` and canonical payload SHA-256 `6cde031f44e20b14e5a3c6882885dedab1bacb7e475177998bdc2b471de5b7fe`.
- The current web candidate passed 255/255 Playwright cases across Chromium, Firefox, and WebKit, including the public security and retention boundary on desktop and mobile.
- Production smoke passed 18/18 with project-scoped MCP discovery and authentication enforcement.
- Live development/production isolation passed 10/10 after cutover.
- The production root, get-started, help, auth, API, MCP, files, notifications, and canonical `www` redirect all passed their public checks.
- The credential-free production availability workflow checks the exact production services and project-scoped OAuth/MCP discovery boundaries twice an hour. Its first GitHub-hosted run passed on commit `a96317f` ([run 33437103370](https://github.com/renewisepunk/dongo/actions/runs/33437103370)).
- Main-branch CI passed for the public security release on commit `095979b` ([run 33455335131](https://github.com/renewisepunk/dongo/actions/runs/33455335131)).

## Live production journeys

### Human authentication

A fresh account completed email OTP authentication and reached first-project onboarding. Production OTP is delivered from `auth@dongo.so` through the apex domain onboarded in Cloudflare Email Service. A post-cutover request through the live Better Auth endpoint returned success. The issuer, callback, browser links, and application remain entirely on `https://dongo.so`.

Production notifications are delivered from `notifications@dongo.so` through the correct Wisepunk Resend account. Resend verified DKIM, SPF MX, and SPF TXT for the apex domain, and a pre-cutover delivery from that exact sender reached the controlled mailbox with provider message `c2a077d5-12a7-4fde-b1a4-d1c0d5f0e56e`.

Google sign-in is enabled in production after the exact callback `https://brainy-camel-172.convex.site/api/auth/callback/google` was registered and the owner completed the live browser journey back into the existing project. A credential-free provider probe independently returned Google's authorization origin with that exact callback. A read-only production data audit found one verified `rene@wisepunk.com` user and the Google provider attached to that same user, proving that an account created by email OTP was linked rather than duplicated.

The account-linking policy is explicit and fail-closed: implicit linking is allowed only when the provider verifies the same email and the existing local user is already email-verified. Forced trusted-provider linking, different-email linking, and profile replacement are disabled. Email OTP remains an independent sign-in fallback.

### Codex remote MCP

An isolated Codex client authenticated to the project-scoped production MCP endpoint, started a session under its own agent identity, created and completed `DONGOPRO-1`, published an attributed progress comment and report, and left the item truthfully Done.

The disposable grant was then revoked. A subsequent isolated call failed with `invalid_token`. Reauthorization created a different installation, actor, and binding; the old grant stayed revoked, and a new `dongo_session_start` succeeded under the new agent identity. This proves fresh identity, immediate revocation, and grant isolation in production.

### Packed CLI

The exact packed CLI was installed into an isolated prefix and run from this repository with its default production environment. Terminal → browser approval → authenticated terminal completed without a project picker, token copy, Keychain prompt, or credential helper. `auth status`, `doctor`, and `session-start` passed. The credential used an owner-only dongo file outside the repository. Logout revoked the disposable server installation and removed its local credential; the tracked repository marker was restored afterward.

Project-name inference now preserves the lowercase `dongo` brand in generated approval links and first-project proposals.

### Attachments

A human uploaded `apple-touch-icon.png` in a production issue comment. The edge accepted the upload, the comment persisted, and the workspace rendered a bounded 180×180 secure inline Blob preview with its explicit download control.

A fresh Codex MCP session resolved the same attachment through the agent contract as `image/png`, 2,301 bytes. No credential or durable download URL is stored in the issue or release evidence.

## Security and operating decisions

- Interactive CLI refresh credentials use a dongo-owned local user file with owner-only directory/file permissions (`0700`/`0600`). dongo does not invoke macOS Keychain or another platform credential helper.
- CLI and MCP authorization are installation grants. Agents act as their own attributed actors; they do not impersonate the human account.
- CLI authorization authenticates the installation. Project selection and creation are handled by the agent/CLI proposal and server, not by asking the human to choose a project on the consent screen.
- Production and development use different Workers, OAuth resources, origins, Convex deployments, and agent audiences.
- Attachment URLs are short-lived and capability-bound; issue data retains opaque attachment IDs.

### Published security boundary

`https://dongo.so/security` now publishes the repository-access boundary, project-scoped authorization model, exact data and retention matrix, infrastructure isolation, current assurance evidence, and controls dongo does not yet claim. The accompanying repository documents are [`../security/README.md`](../security/README.md), [`../security/architecture-and-isolation.md`](../security/architecture-and-isolation.md), [`../security/data-and-retention.md`](../security/data-and-retention.md), and [`../../SECURITY.md`](../../SECURITY.md).

The claim is deliberately narrow: dongo has zero repository-content ingestion by default, not zero product-data retention. Work, comments, attention state, authorization installations, and explicitly uploaded attachments persist because they are product state. Current v1 does not claim configurable retention, self-service project erasure, a contractual deletion SLA, customer-managed encryption keys, independent dongo SOC 2/ISO certification, or a complete-service penetration test.

GitHub private vulnerability reporting is enabled and verified for `renewisepunk/dongo`. The live page and security policy route reports to the confidential advisory form rather than a public issue.

## First-day use

1. Open `https://dongo.so`, sign in with Google or an email code, and create the real project.
2. Use the project’s get-started instructions to add its project-scoped MCP URL to Codex.
3. Authorize once in the browser. Codex then appears as its own agent identity and can create, update, comment on, and finish work.
4. Use the web workspace for review, human comments, pasted images, dragged files, and keyboard navigation.

The production test account/project is disposable validation data and must not be treated as the owner’s permanent workspace. The owner has now created `en8dgh2y-dongo`, and this repository's checked-in `.codex/config.toml`, `.mcp.json`, and `.agent-work/project.json` identify that real production project. The disposable Codex server entry has been removed.

## Explicitly deferred, non-blocking items

- Native iOS and Android clients and live push delivery.
- Manual VoiceOver review. Automated WCAG A/AA scans and keyboard journeys are green, but that does not substitute for the documented manual screen-reader pass.
- Repeating the production host lifecycle with Claude Code. Claude Code’s complete lifecycle is already proven in development; this release’s required production agent was Codex.

These items are visible follow-up work and do not block using the production web and Codex integration now.
