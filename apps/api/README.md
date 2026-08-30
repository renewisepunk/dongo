# Dongo CLI API Worker

Cloudflare Worker for the canonical CLI REST surface at
`https://dev.dongo.so/api/agent/v1/{operation}`.

The Worker introspects every bearer token against Better Auth, enforces the
exact generic API audience and operation scopes, rate-limits by bound
project/client, validates inputs with `@dongo/contracts`, and sends only a
signed trusted context to Convex. Bearer tokens are never forwarded or logged.

## Required secrets

- `BETTER_AUTH_RESOURCE_CLIENT_SECRET`: confidential secret for
  `dongo-api-resource-dev`; use a distinct high-entropy value from MCP.
- `DONGO_INTERNAL_GATEWAY_SECRET`: must match the Convex internal gateway.

Optional secret/config override:

- `DONGO_INTERNAL_GATEWAY_KEY_ID`: defaults to `v1` and currently accepts only
  `v1`.

The Auth D1 database must contain the generic resource
`https://dev.dongo.so/api/agent/v1`, the confidential resource client
`dongo-api-resource-dev`, and their `oauthClientResource` association.

## Probes

- `GET /api/agent/v1/healthz` reports process liveness.
- `GET /api/agent/v1/readyz` reports configuration readiness. A missing secret
  keeps liveness green while readiness and operation traffic fail closed.

## Local validation

```sh
npm run check --workspace @dongo/api-worker
npm run test --workspace @dongo/api-worker
npm run dry-run --workspace @dongo/api-worker
```
