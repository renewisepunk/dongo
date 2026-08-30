# dongo MCP Worker

Cloudflare Worker entry point for `@dongo/mcp`. It composes the canonical runtime contracts, RFC 7662 Better Auth introspection, the signed Convex internal gateway, and a Cloudflare Rate Limiting binding. Missing or invalid configuration keeps `/healthz` live while `/readyz` and project MCP endpoints fail closed.

Required environment bindings:

- `AUTHORIZATION_SERVER_ISSUER`
- `AUTHORIZATION_SERVER_METADATA_JSON` (the public RFC 8414 document, mirrored exactly)
- `BETTER_AUTH_INTROSPECTION_URL`
- `BETTER_AUTH_RESOURCE_CLIENT_ID`
- `CONVEX_SITE_URL`

Required secrets, provisioned out of band:

- `BETTER_AUTH_RESOURCE_CLIENT_SECRET`
- `DONGO_INTERNAL_GATEWAY_SECRET` (at least 32 UTF-8 bytes)

`DONGO_INTERNAL_GATEWAY_KEY_ID` defaults to `v1`. The checked-in `MCP_RATE_LIMITER` binding permits 120 gateway requests per client/project per minute. Introspection is deliberately uncached so revoked grants and clients fail on the next request. Never reuse a CLI access or refresh token for these bindings.

`wrangler.jsonc` has no deployment route and this package does not deploy itself. Before promotion, provision the bindings above, regenerate `src/worker-configuration.d.ts`, run the package tests, and verify the Worker bundle with a Wrangler dry run.
