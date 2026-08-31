# Production launch — 2026-08-31

## Verdict

The first Codex-first production release is live at `https://dongo.so` and is suitable for real use. Development remains independently available at `https://dev.dongo.so`.

The release includes the public marketing, get-started, and help pages; email OTP authentication; responsive authenticated workspace; project-scoped remote MCP; packed CLI device authorization; issue lifecycle; human and agent comments; attention/continuation; repository export; and image attachment upload, inline preview, download, and agent metadata access. Native mobile applications and live push delivery remain outside this release.

## Production topology

| Component | Production target | Released version |
|---|---|---|
| Web | `dongo-web-production` | `1771d7f5-d03e-4ca4-8042-a6aed8dfd235` |
| Authorization | `dongo-auth-production` | `d96dd602-f4b9-45fb-adf6-833aab5281ce` |
| Agent API | `dongo-api-production` | `f57a195e-efb5-4c82-8732-a11569f481a6` |
| Remote MCP | `dongo-mcp-production` | `67583ee0-27cd-4233-9332-c225054f6cab` |
| Attachment edge | `dongo-files-production` | `b5540728-32c2-427a-939e-db2148773630` |
| Notifications | `dongo-notifications-production` | `6f112da9-4ba8-40dd-b674-79507138e266` |
| Domain state | Convex `brainy-camel-172` | production deployment |
| OAuth database | D1 `dongo-auth` | production binding |
| Attachment storage | R2 `dongo-attachments` | production binding |

The previous landing Worker versions recorded before cutover were `f956c68f-9fdd-4e61-a507-9f637038b10f` and `8400a256-1850-40d8-b3a3-dbd338ee3e90`. The rollback procedure remains in [`../runbooks/production-release.md`](../runbooks/production-release.md).

## Release gates

- Complete source checks and tests passed after the final CLI branding change.
- The exact CLI archive gate passed with archive SHA-256 `645dec2dec439d1ca342333da656678b55fa401d6af35fe042def644619abe0b` and canonical payload SHA-256 `8027c6af5d178d583737f56ed3729cd04c822182b7ab9e2d2394f0757912f135`.
- The current web candidate previously passed 249/249 Playwright cases across Chromium, Firefox, and WebKit.
- Production smoke passed 18/18 with project-scoped MCP discovery and authentication enforcement.
- Live development/production isolation passed 10/10 after cutover.
- The production root, get-started, help, auth, API, MCP, files, notifications, and canonical `www` redirect all passed their public checks.
- The credential-free production availability workflow checks the exact production services and project-scoped OAuth/MCP discovery boundaries twice an hour. Its first GitHub-hosted run passed on commit `a96317f` ([run 33437103370](https://github.com/renewisepunk/dongo/actions/runs/33437103370)).

## Live production journeys

### Human authentication

A fresh account completed email OTP authentication and reached first-project onboarding. Production OTP is currently delivered from `auth@dev.dongo.so`, a verified sender on the correct Wisepunk Resend account. The issuer, callback, browser links, and application remain entirely on `https://dongo.so`.

Google remains intentionally disabled in production until the exact production redirect URI is registered and proven. Email OTP is the supported first-release sign-in path.

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

## First-day use

1. Open `https://dongo.so`, sign in by email code, and create the real project.
2. Use the project’s get-started instructions to add its project-scoped MCP URL to Codex.
3. Authorize once in the browser. Codex then appears as its own agent identity and can create, update, comment on, and finish work.
4. Use the web workspace for review, human comments, pasted images, dragged files, and keyboard navigation.

The production test account/project is disposable validation data and must not be treated as the owner’s permanent workspace. This repository's checked-in `.codex/config.toml`, `.mcp.json`, and `.agent-work/project.json` still identify the historical development project; replace them through the real production project's generated setup only after the owner has signed in and created that project.

## Explicitly deferred, non-blocking items

- Native iOS and Android clients and live push delivery.
- Production Google login until its exact redirect is configured and validated.
- Moving email senders from the verified `dev.dongo.so` subdomain to the apex after apex sender verification.
- Manual VoiceOver review. Automated WCAG A/AA scans and keyboard journeys are green, but that does not substitute for the documented manual screen-reader pass.
- Repeating the production host lifecycle with Claude Code. Claude Code’s complete lifecycle is already proven in development; this release’s required production agent was Codex.

These items are visible follow-up work and do not block using the production web and Codex integration now.
