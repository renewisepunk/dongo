# Development deployment and rollback

## Guardrails

- This runbook targets `dev.dongo.so`, Convex `wandering-camel-662`, D1 `dongo-auth-dev`, and R2 `dongo-dev-attachments` only.
- Do not run `npm run deploy` while operating development; it runs the coherent production release. `npm run deploy:landing` is the explicit first-cutover root rollback.
- Never point a development Worker at production Convex, D1, R2, OAuth issuer/resource, secrets, routes, or cookies.
- Deploy an immutable commit after CI passes. Record the commit and returned Worker version IDs.

## Preflight

```sh
npm ci
npm run verify:no-secrets
npm run check
npm test
npm run build
openssl dgst -sha256 dongo-prd.md
```

The PRD digest must remain the repository’s recorded baseline. Review `git status --short` and every Wrangler route before proceeding.

Apply additive D1 migrations before code that requires them:

```sh
npx wrangler d1 migrations apply AUTH_DB --remote --config apps/auth/wrangler.jsonc
```

Wrangler captures a backup for each migration. Destructive or compatibility-breaking migrations require a separate rehearsal and are not part of a normal deploy.

Preview and deploy the development stack in dependency order with the canonical runner:

```sh
npm run deploy:dev:plan
npm run deploy:dev
```

Do not accept a web-only deploy as a coherent candidate when Convex, contracts, auth, API, MCP, files, or notification code changed. `npm run deploy:dev:web` is reserved for an explicitly isolated web iteration. The canonical runner stops at the first failed service so a partial candidate cannot be reported as complete.

Verify all health/readiness routes from the [runbook index](README.md), then repeat email OTP, CLI device authorization, MCP discovery/login, one read, one idempotent write, web Intake/Attention, attachment, notification, and sync journeys.

Run the public unauthenticated smoke gate with a real development project reference:

```sh
npm run smoke:dev -- --project-ref <public-project-ref>
npm run smoke:boundaries -- --project-ref <public-project-ref>
```

Every check must pass. In particular, notification readiness is a release blocker even when its separate health endpoint is live, and the boundary gate must continue to prove that development routes do not appear on the production origin.

## Worker rollback

List recent deployments for the affected Worker:

```sh
npx wrangler deployments list --name <worker-name> --json
```

Select the last known-good version ID from recorded release evidence, then roll back only that Worker:

```sh
npx wrangler rollback <version-id> --name <worker-name> --message "rollback: <safe incident id>" --yes
```

Recheck the affected readiness route and its upstream/downstream dependencies. A Worker rollback does not roll back Convex schema/functions, D1 migrations, R2 objects, secrets, routes, or another Worker. If versions are incompatible, restore the complete last known-good development release in reverse dependency order and validate the golden workflow.

## Convex or database incident

- Use `npx convex logs --deployment dev` to identify the failing function and safe request IDs.
- Convex changes are additive; redeploy the last known-good commit with `npx convex dev --once` only after confirming its schema is forward-compatible with current data.
- Do not delete or rewrite production/development records as rollback. Repair with an additive migration or bounded reconciliation function that has tests and an audit trail.
- For a failed D1 migration, Wrangler rolls that migration back. If already applied successfully, use the captured backup/recovery procedure rather than an ad hoc reverse SQL migration.

## CLI/package rollback

The CLI release artifact must be the exact packed archive accepted by CI:

```sh
npm pack --workspace @dongo/cli
```

Before publishing, install that archive into an isolated prefix and run `dongo --help`, `dongo auth status --json`, and the package test suite. Record the archive checksum and provenance.

If a published CLI is bad, deprecate that exact version in the registry, restore the last known-good version as the documented install target, and publish a fixed new version; do not silently replace an immutable package. Existing OAuth grants remain server-side installations and must not be copied into the replacement install. Run `dongo doctor --json` after upgrading or downgrading.

For Codex/Claude/generic integration rollback, use the installer’s printed rollback instructions. Remove only the dongo-owned MCP entry and versioned instruction block. Host OAuth logout removes host-local credentials; server-side revocation is a separate explicit action.
