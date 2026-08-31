# Production release and rollback

Production is `https://dongo.so`, Convex `brainy-camel-172`, D1 `dongo-auth`, and R2 `dongo-attachments`. Development remains isolated at `https://dev.dongo.so`.

## Non-negotiable gates

- Release only a clean, committed revision that passed unit/integration tests, static/type checks, the complete browser matrix, secret/runtime-log scans, contract parity, and environment-boundary verification.
- Prove the exact revision in development, including email OTP, CLI device authorization, Codex and Claude MCP authorization, refresh, isolated revocation, fresh-identity reauthorization, agent-authored work/comment lifecycle, attachments, and deterministic sync.
- Keep Google disabled in the production UI until its exact production redirect is registered and proven. Email OTP is the production sign-in path for the first release.
- Send production notification email from `notifications@dev.dongo.so`, the verified sending domain on the `rene@wisepunk.com` Resend account. Application links and auth remain on `https://dongo.so`; move the sender to `notifications@dongo.so` only after the apex domain is verified for sending in that same account.
- Record the current production landing Worker version and every new Worker version before cutover. Never print or retain secret values in release evidence.

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

`DONGO_ENABLE_DEV_BOOTSTRAP`, development URLs, development secrets, Google credentials, APNs, and FCM are not configured in production.

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
npm run verify:cli-package
CLOUDFLARE_ENV=production npm run build --workspace @dongo/web
npm run deploy:production:plan
git status --short
```

The worktree must be empty. Inspect `apps/web/dist/server/wrangler.json`: it must name `dongo-web-production`, route only `dongo.so` and `www.dongo.so`, and reference only `brainy-camel-172`. The production browser/server bundles must not contain `dev.dongo.so` or `wandering-camel-662`.

Record the current landing deployment immediately before cutover:

```sh
npx wrangler deployments list --name dongo-coming-soon --json
```

## Deploy and cut over

```sh
npm run deploy:production
```

The runner deploys production Convex functions, applies additive D1 migrations, deploys auth → API → MCP → files → notifications, then builds and deploys the web Worker last. It stops on the first failure. The old landing stays at the root until the final web step.

Run the public gate immediately:

```sh
npm run smoke:production
```

After the first production project is created, repeat it with the exact project reference:

```sh
npm run smoke:production -- --project-ref <public-project-ref>
```

Then prove email OTP to an address controlled by the owner, connect a fresh packed CLI with the default `dongo connect`, add a new project-scoped Codex MCP entry, authorize it, call `dongo_session_start`, create/update/finish one disposable work item as the agent, attach and preview one image, revoke that disposable installation, confirm it fails, and reauthorize it to a new installation/actor.

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
