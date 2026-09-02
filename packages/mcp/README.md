# `@dongo/mcp`

Production-facing remote MCP adapter for dongo's canonical agent operations. It serves project-specific Streamable HTTP resources at `/p/{publicProjectRef}/mcp`, targets protocol `2026-07-28`, and deliberately uses the official SDK's stateless legacy fallback from the same server factory.

## Composition boundary

Use `createCanonicalDongoToolCatalog()` for the production catalog, then pass it to `createDongoMcpGateway` with the injected resource-server dependencies:

- `DongoTokenVerifier`
- `OperationExecutor`
- `DongoRateLimiter`
- `DongoReadinessProbe`

The production catalog reads runtime input/output schemas directly from `@dongo/contracts`.

There are no permissive defaults. `apps/mcp` constructs the live adapters only when all required configuration and secrets are present; otherwise it uses `createUnavailableDongoMcpWorker`.

`@dongo/contracts` owns operation names, scopes, runtime schemas, and TypeScript operation types. The adapter rejects missing operations, caller-selected identity fields, and write schemas without a required `idempotencyKey`.

## Authorization-server adapter

The MCP Worker is a resource server, not an authorization server. `BetterAuthIntrospectionTokenVerifier` calls a separate Better Auth 1.7 authorization Worker on every request and validates active state, strict issuer, expiry/not-before, exact RFC 8707 resource, scopes, client identity, and project-bound grant/installation claims. It uses confidential resource-server client authentication and has no positive cache.

The gateway rechecks exact issuer, resource, and project before dispatch. It passes a derived installation principal to `OperationExecutor`; the inbound bearer token and HTTP request are not part of that context. The authorization Worker separately owns RFC 8414 metadata, CIMD/DCR compatibility, authorization code with S256 PKCE, consent, refresh rotation/replay handling, and revocation. Do not implement OAuth token issuance inside this package and do not reuse a CLI grant.

Each reviewed and activated agent release may add a bounded, build-time notice
to the next eligible successful authenticated tool result for an MCP
installation. The notice is a
separate text and `_meta` block; canonical operation `structuredContent` is
unchanged. Convex requires an exact match with the globally activated monotonic
release and atomically suppresses the same or older per-installation sequence,
so parallel calls, retries, redeploys, and rollbacks do not create repeated or
stale alerts. Activation happens only after the advertised npm artifact is
published and verified. Delivery failure is fail-open and never changes the
operation result. A transport loss after the atomic claim can consume this
at-most-once advisory without displaying it. Notice
copy is source-controlled and cannot include Intake, comments, operation data,
registry text, environment values, or a remotely supplied command.

`ConvexHmacOperationExecutor` signs a versioned, bounded JSON envelope for `POST /internal/agent/v1/execute`. The signature covers timestamp, one-time UUID nonce, method, exact path, and the SHA-256 body hash. Convex must enforce the 60-second freshness window, atomically consume nonces, and re-resolve every signed installation, grant, actor, project, and scope before dispatch.

## Verification

```sh
npm run test --workspace @dongo/mcp
```

The suite drives both modern and admitted legacy paths through the official MCP client and covers catalog parity, protected-resource discovery, auth/scope/project failures, token non-forwarding, bounded results, additive release notices, resources, and managed host assets.
