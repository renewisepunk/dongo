# Production release and rollback

Production is `https://dongo.so`, Convex `brainy-camel-172`, D1 `dongo-auth`, and R2 `dongo-attachments`. Development remains isolated at `https://dev.dongo.so`.

## Non-negotiable gates

- Release only a clean, committed revision that passed unit/integration tests, static/type checks, the complete browser matrix, secret/runtime-log scans, contract parity, and environment-boundary verification.
- Prove the exact revision in development, including email OTP, CLI device authorization, Codex and Claude MCP authorization, refresh, isolated revocation, fresh-identity reauthorization, agent-authored work/comment lifecycle, attachments, and deterministic sync.
- Expose Google in the production UI only while its exact production redirect is registered and the complete journey is proven. Keep email OTP available as an independent fallback.
- Send production OTP email from `auth@dongo.so`, using the apex domain onboarded in Cloudflare Email Service. The Worker binding permits only that exact production address; development remains restricted to `auth@dev.dongo.so`.
- Send production notification email from `notifications@dongo.so`, using the apex domain verified through DKIM and SPF on the `rene@wisepunk.com` Resend account. Development remains on `notifications@dev.dongo.so`.
- Record the current production landing Worker version and every new Worker version before cutover. Never print or retain secret values in release evidence.
- Always reconcile the public `@wisepunk/dongo` CLI. A changed package payload
  requires a new unpublished stable version and npm publisher authorization;
  the preflight must fail before any production mutation when either is absent.
- Always verify the checked-in agent release notice before mutation. When the
  public CLI version changes, update its unique identifier, monotonically
  increasing sequence, bounded reviewed summary, and exact pinned command.
- After an accepted major release, the release coordinator must complete the
  owner-reviewed public changelog decision in
  [`changelog.md`](changelog.md): publish only exact approved wording, or record
  an intentional skip on the release Work.

## One-time preparation

The preparation command creates cryptographically independent production secrets, bootstraps each new Worker with no routes and `workers_dev` disabled, and configures the previously empty production Convex environment. It refuses to run when production Convex variables already exist.

The correct Wisepunk Resend credential is supplied only through the process environment:

```sh
DONGO_RESEND_API_KEY="$(/Users/Workspace/CLI-TOOLS/scripts/get-secret.sh RESEND_API_KEY)" \
  npm run prepare:production -- --apply
```

The temporary secret files are owner-only, overwritten, and removed before the command exits. The prepared Workers have no public trigger and receive no traffic. Required secret relationships are:

- one internal gateway secret shared by Convex, auth, API, MCP, and files;
- one human-assertion secret shared by auth and Convex;
- independent MCP and API resource-client secrets, each shared only with auth;
- one attachment signing secret shared by files and Convex;
- one notification dispatch secret shared by notifications and Convex;
- independent Better Auth secrets for the human Convex service and OAuth authorization Worker;
- the Resend API key only in the notifications Worker.

`DONGO_ENABLE_DEV_BOOTSTRAP`, development URLs, development secrets, APNs, and FCM are not configured in production. The Google client credentials are isolated in production Convex. Set `VITE_DONGO_GOOGLE_AUTH_CONFIGURED` to `true` only after the exact callback is registered and the complete identity journey passes; if that proof regresses, set it back to `false` and redeploy the web Worker while leaving email OTP available.

Google-to-OTP migration is same-email only. Keep `account.accountLinking` explicit: the provider and existing local account must both report verified email ownership, different-email linking is disabled, and no provider is force-trusted. After the first live migration, confirm the production user table still has one matching user and that the Google provider row references that existing user without printing provider tokens or account identifiers.

## npm publisher authorization

Keep the npm granular access token only as `NPM_ACCESS_TOKEN` in the ignored
repository `.env`. The token must have read-write access to `@wisepunk/dongo`
and be permitted to publish under the npm account's current two-factor policy.
Never commit it, paste it into a command, write its resolved value to an npm
configuration file, or include it in release evidence.

Do not assume `npm login` selected this token. `npm login` can replace the active
credential in `~/.npmrc` with a different token that requires an interactive
WebAuthn approval. When the CLI release plan reports `action: "publish"`, use an
owner-only temporary npm configuration whose token remains a literal environment
placeholder. This makes the release use `NPM_ACCESS_TOKEN` regardless of the
credential currently stored by npm:

```sh
set -eu
chmod 600 .env
release_npm_config="$(mktemp "${TMPDIR:-/tmp}/dongo-npmrc.XXXXXX")"
chmod 600 "$release_npm_config"
trap 'unset NPM_ACCESS_TOKEN; rm -f "$release_npm_config"' EXIT HUP INT TERM

{
  printf '%s\n' 'registry=https://registry.npmjs.org/'
  printf '%s\n' '//registry.npmjs.org/:_authToken=${NPM_ACCESS_TOKEN}'
} > "$release_npm_config"

NPM_ACCESS_TOKEN="$(
  node --env-file=.env --eval \
    'if (!process.env.NPM_ACCESS_TOKEN) process.exit(2); process.stdout.write(process.env.NPM_ACCESS_TOKEN)'
)"
export NPM_ACCESS_TOKEN

NPM_CONFIG_USERCONFIG="$release_npm_config" \
  node scripts/release-cli.mjs --preflight
NPM_CONFIG_USERCONFIG="$release_npm_config" \
  CONVEX_DEPLOYMENT=prod:brainy-camel-172 \
  npm run deploy:production
```

Do not enable shell tracing while running this block. The Node subprocess reads
the local `.env` without executing it and returns only `NPM_ACCESS_TOKEN`; other
local credentials are not exported into the release environment. The trap
unsets the token and deletes the temporary npm configuration on success,
failure, or interruption. If authorization fails, verify the token's package and
organization scope, expiry, and two-factor setting in npm before replacing the
ignored `.env` value. Never weaken the release preflight or publish a separately
packed archive to work around an authorization failure.

## Preflight

```sh
npm ci
npm run verify:no-secrets
npm run check
npm test
npm run verify:contracts
npm run verify:environment-boundaries
npm run verify:observability
npm run verify:runtime-logs
npm run verify:agent-release-notice
npm run verify:cli-package
npm run release:cli:plan
CLOUDFLARE_ENV=production npm run build --workspace @dongo/web
CONVEX_DEPLOYMENT=prod:brainy-camel-172 npm run deploy:production:plan
git status --short
```

The production plan and deploy both verify the exact named selector
`prod:brainy-camel-172` before any child command. The selector may come from the
automatic runner's in-memory trusted bridge or an explicit process environment
as above. A deploy key, when present, must identify the same named target. The
runner never prints the key. A missing, development, local, or mismatched target
is a hard preflight failure; never let Convex infer a target during a production
release.

The worktree must be empty. Inspect `apps/web/dist/server/wrangler.json`: it must name `dongo-web-production`, route only `dongo.so` and `www.dongo.so`, and reference only `brainy-camel-172`. The production browser/server bundles must not contain `dev.dongo.so` or `wandering-camel-662`.

Record the current landing deployment immediately before cutover:

```sh
npx wrangler deployments list --name dongo-coming-soon --json
```

## Deploy and cut over

```sh
CONVEX_DEPLOYMENT=prod:brainy-camel-172 npm run deploy:production
```

The runner first validates the agent release notice, then verifies whether the public CLI must be published and confirms
npm authentication plus package-level read-write access on the pinned public
registry when needed. It then deploys production Convex functions,
applies additive D1 migrations, deploys auth → API → MCP → files →
notifications, and builds and deploys the web Worker. It stops on the first
failure. After the production stack passes the public smoke gate, it publishes
the exact verified CLI archive when its payload changed, confirms npm integrity,
and installs the registry copy into a clean prefix to verify version, help, and
unauthenticated status. An unchanged CLI is verified against npm and skipped.
Only then does it monotonically activate the exact reviewed agent-release marker
in Convex. A failure before that final activation leaves the notice unavailable
and unconsumed; rollback never lowers the active marker. The old landing stays
at the root until the final web step.

The runner executes all 18 public checks with the production smoke project
before any CLI publication. Repeat that exact gate immediately with the accepted
release evidence:

```sh
npm run smoke:production -- --project-ref ps8dhbky-dongo-production-e2e
```

Then prove email OTP to an address controlled by the owner, connect a fresh packed CLI with the default `dongo connect`, add a new project-scoped Codex MCP entry, authorize it, call `dongo_session_start`, create/update/finish one disposable work item as the agent, attach and preview one image, revoke that disposable installation, confirm it fails, and reauthorize it to a new installation/actor.

After the production release is accepted and the affected Work is completed,
perform the changelog curation step printed by the deployment command. The
release coordinator verifies a bounded candidate list from production evidence
and requests owner approval for the exact public copy. Publish only that copy
through project settings and verify `/changelog` in production. If the release
does not meet the inclusion criteria, record
`Public changelog: intentionally skipped` and a short, non-sensitive reason on
the release Work. Changelog publication is never an automatic deployment step.

For an agent-release change, keep one already-authorized MCP client open across
the MCP deployment and final activation. Its first eligible successful
post-activation dongo tool call must keep the canonical structured result
unchanged and include the reviewed release notice. A second call from that
installation must omit the notice. Confirm that
the copy says hosted MCP is already current and that a local CLI is only checked
and offered through explicit user approval. This is an at-most-once next-call
advisory, not a push, wake, or transport-acknowledged delivery guarantee.

## Rollback

If root rendering fails but production services remain compatible, roll back `dongo-web-production` to the recorded last-good version:

```sh
npx wrangler deployments list --name dongo-web-production --json
npx wrangler rollback <version-id> --name dongo-web-production --message "rollback: <safe incident id>" --yes
```

For the first-release cutover, restore the known landing immediately by redeploying the recorded root configuration:

```sh
npm run deploy:landing
```

That reassigns the apex and `www` custom domains to `dongo-coming-soon`; the more-specific production service routes may remain deployed for diagnosis. Confirm the root and `www` redirect before continuing.

For a service regression, roll back only the affected production Worker to its recorded last-good version, then recheck its readiness and both adjacent dependencies. A Worker rollback does not reverse Convex, D1, R2, secrets, or another Worker. Convex and D1 changes must remain forward-compatible; repair data with additive code/migrations and an audit trail, never ad hoc deletion.

After any rollback, verify development still passes `npm run smoke:dev -- --project-ref p58de816-dongo` and record only safe request IDs, commit IDs, version IDs, HTTP status, and timestamps.
