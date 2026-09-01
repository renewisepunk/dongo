# First-day readiness — 2026-09-01

## Verdict

The first web-and-Codex release is live at `https://dongo.so` and can be used for real work. Google and email one-time-code sign-in are supported production paths. The public site, first-project onboarding, project workspace, remote MCP, CLI device authorization, work lifecycle, comments, attachments, image previews, help, security boundary, and keyboard navigation are deployed and proven.

## Already proven

- Production public/auth/API/MCP/files/notifications boundaries: 18/18 smoke checks.
- Development/production resource isolation: 10/10 boundary checks.
- First credential-free production availability run: [GitHub Actions 33437103370](https://github.com/renewisepunk/dongo/actions/runs/33437103370).
- A fresh human account completed email OTP and first-project onboarding.
- The same verified account then completed production Google sign-in through the registered callback and returned to its existing project; a read-only audit confirmed one user with Google linked to that identity rather than a duplicate account.
- Both production email paths use apex senders: `auth@dongo.so` is onboarded in Cloudflare Email Service, and `notifications@dongo.so` passed Resend DKIM/SPF verification and controlled-mailbox delivery.
- Codex authenticated as its own production installation actor, completed a real work lifecycle, and passed revoke/reauthorize isolation.
- A human production comment uploaded a PNG to R2, rendered its secure inline preview, and exposed only safe attachment metadata to Codex.
- The exact packed CLI completed browser authorization without a project picker, token copy, Keychain prompt, or platform credential helper.
- The `E` shortcut opens the selected issue at a human correction comment; state transitions remain agent-owned and truthfully represented.
- The owner account `rene@wisepunk.com` created the real production project `en8dgh2y-dongo`, set its repository to `https://github.com/renewisepunk/dongo`, and kept agent execution in Manual mode.
- This repository now points to that real project in `.agent-work/project.json`, `.codex/config.toml`, and `.mcp.json`; the historical development MCP entries were replaced without touching unrelated host configuration.
- A fresh Codex grant started a real production session as the independently attributed `Codex` installation, and CLI `auth status`, `doctor`, and `session-start` all passed against the same project.
- The public `https://dongo.so/security` route is live on Worker version `694083b5-b930-4746-bc2b-7d6f31635073`; it passed the 255-case cross-browser suite, automated WCAG A/AA checks, mobile layout checks, and an 18/18 post-deploy production smoke.
- The security material distinguishes zero repository-content ingestion by default from persistent product data, lists current retention behavior and missing enterprise controls, and links to the public architecture, retention, reporting, and release evidence.
- GitHub private vulnerability reporting is enabled for confidential disclosure. Main-branch CI passed on security release commit `095979b` ([run 33455335131](https://github.com/renewisepunk/dongo/actions/runs/33455335131)).

## Owner workspace — complete

`codex mcp list` now exposes one intended repository-scoped server, `dongo-en8dgh2y-dongo`, and it is authenticated through OAuth. The disposable production test server was logged out and removed. The real project begins empty; the first issue can now be created in the web workspace and handled by Codex as its own agent actor.

Keep the synthetic project `ps8dhbky-dongo-production-e2e` only for bounded availability checks; it is not the owner's workspace.

## Visible follow-up work, not a first-day blocker

- Paid plan checkout is not available yet; the free plan supports one active project.
- Native clients and live push delivery remain outside this release.
- Automated accessibility and keyboard gates are green; the documented manual VoiceOver pass remains outstanding.
- Claude Code's complete lifecycle is proven in development but has not been repeated on production; production Codex is the accepted first agent.

## Operating check

The scheduled production monitor runs at minutes 2 and 32 of every hour using no repository secret. On a failure, inspect the `dongo production availability` workflow first, then follow [`../runbooks/production-release.md`](../runbooks/production-release.md) for rollback or service-specific diagnosis.
