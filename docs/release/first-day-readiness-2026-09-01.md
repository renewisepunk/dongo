# First-day readiness — 2026-09-01

## Verdict

The first web-and-Codex release is live at `https://dongo.so` and can be used for real work. Email one-time-code sign-in is the supported production path. The public site, first-project onboarding, project workspace, remote MCP, CLI device authorization, work lifecycle, comments, attachments, image previews, help, and keyboard navigation are deployed and proven.

## Already proven

- Production public/auth/API/MCP/files/notifications boundaries: 18/18 smoke checks.
- Development/production resource isolation: 10/10 boundary checks.
- First credential-free production availability run: [GitHub Actions 33437103370](https://github.com/renewisepunk/dongo/actions/runs/33437103370).
- A fresh human account completed email OTP and first-project onboarding.
- Both production email paths use apex senders: `auth@dongo.so` is onboarded in Cloudflare Email Service, and `notifications@dongo.so` passed Resend DKIM/SPF verification and controlled-mailbox delivery.
- Codex authenticated as its own production installation actor, completed a real work lifecycle, and passed revoke/reauthorize isolation.
- A human production comment uploaded a PNG to R2, rendered its secure inline preview, and exposed only safe attachment metadata to Codex.
- The exact packed CLI completed browser authorization without a project picker, token copy, Keychain prompt, or platform credential helper.
- The `E` shortcut opens the selected issue at a human correction comment; state transitions remain agent-owned and truthfully represented.

## Owner setup for the real workspace

1. Sign in at `https://dongo.so` with the owner's real email and create the real `dongo` project.
2. Open that project's **Get started** page and apply its generated Codex configuration in this repository.
3. Confirm `codex mcp list` shows one intended dongo project for this repository, then run one read-only `dongo_session_start`.
4. Create the first real issue in the web workspace and let Codex update it as its own attributed agent actor.

Do not reuse the synthetic project `ps8dhbky-dongo-production-e2e` as the owner's permanent workspace. Do not mechanically rewrite the checked-in development project identifiers before the real production project exists.

## Visible follow-up work, not a first-day blocker

- Production Google sign-in remains disabled in the UI until the staged callback `https://brainy-camel-172.convex.site/api/auth/callback/google` is added to the existing Wisepunk OAuth client and the live identity is proven. The production provider already generates that exact callback; email OTP is available now.
- Paid plan checkout is not available yet; the free plan supports one active project.
- Native clients and live push delivery remain outside this release.
- Automated accessibility and keyboard gates are green; the documented manual VoiceOver pass remains outstanding.
- Claude Code's complete lifecycle is proven in development but has not been repeated on production; production Codex is the accepted first agent.

## Operating check

The scheduled production monitor runs at minutes 2 and 32 of every hour using no repository secret. On a failure, inspect the `dongo production availability` workflow first, then follow [`../runbooks/production-release.md`](../runbooks/production-release.md) for rollback or service-specific diagnosis.
