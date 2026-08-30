# Agent 01 — Platform and contracts

## Mission

Create the repository foundation, prove the selected runtime/auth stack, and provide versioned contracts and fixtures that let backend, web, CLI, test, and native agents work independently.

## Exclusive ownership

- root package/workspace manifests and lockfile
- root TypeScript, lint, formatting, test, and generated-code configuration
- `apps/web` framework/deployment configuration and top-level providers
- `apps/mcp` framework/deployment configuration and top-level route composition after Agent 10 supplies its registrar
- `convex/schema.ts`, `convex/http.ts`, `convex/crons.ts`, `convex/convex.config.ts` composition files
- `packages/contracts/**`
- `packages/ui/**`
- `docs/agent-api/**`

Domain agents provide schema fragments, route registrars, and cron targets; this agent composes them.

## Wave 0 tasks

### P-01 — Capability and version spike

- Pin candidate versions for SolidStart, Cloudflare Vite/Workers, Convex, Better Auth, the maintained Convex integration, Better Auth MCP/device/CIMD packages, the MCP TypeScript SDK v2, Codex, and Claude.
- Test the exact Better Auth composition in which `mcp()` supplies the OAuth Provider and `oauthDeviceAuthorization()` adds the registered public CLI grant. Do not also register `oauthProvider()` beside `mcp()` in that instance.
- Prove local and preview builds, Google OAuth callback shape, email OTP path, authenticated Convex identity, logout, and session restore before and after the proposed OAuth/MCP/device plugins are installed.
- Prove one CLI Device Authorization flow and one remote Streamable HTTP MCP authorization-code+S256-PKCE flow through the intended custom-domain topology.
- Exercise CIMD and the required DCR fallback, OAuth Protected Resource Metadata, authorization-server metadata, JWKS, refresh rotation, revocation, and distinct API/MCP audiences.
- Prove the SDK's modern `2026-07-28` handler and `server/discover`; enable and test legacy negotiation only when a pinned supported host needs it.
- If the same-instance Better Auth composition breaks the Convex identity path, prove the isolated authorization-server fallback from D-16 instead of weakening the protocol.
- Record incompatible versions and required environment variables.

Acceptance:

- A disposable authenticated route works locally and on preview.
- Authenticated and unauthenticated Convex calls behave correctly.
- The authenticated Convex token route remains functional with the selected OAuth topology on a deployed preview, not only at typecheck/build time.
- Codex, Claude, and a generic MCP inspector authenticate and call the same fixture operation.
- Callback cookies/origins work through the intended custom-domain topology.
- The chosen versions are pinned, not floating.

### P-02 — Workspace foundation

- Establish the monorepo directories from `../01-architecture-and-contracts.md`.
- Create deterministic commands for format, lint, typecheck, unit, contract, web build, CLI build, MCP build/conformance, and E2E.
- Add environment validation and explicit dev/staging/prod profiles.
- Establish modular Convex schema/route/cron composition.

Acceptance:

- A clean checkout installs and runs documented commands deterministically.
- Feature agents do not need to edit root manifests or composition files.
- Generated artifacts are reproducible and never hand-edited.

### P-03 — Contract v1

- Define the transport-neutral operation registry, request/response schemas, view models, scope/effect/idempotency metadata, error codes, request IDs, pagination, revisions, and idempotency fields.
- Publish fixtures for success, validation, authorization, insufficient scope, claim conflict, revision conflict, lease expiry, quota, and retry.
- Publish standards-native fixtures for device authorization and polling errors, authorization/token/refresh/revocation, protected-resource and authorization-server discovery, OAuth challenges, and MCP JSON-RPC mapping. OAuth and MCP responses are not wrapped in the Dongo HTTPS envelope.
- Produce machine-readable JSON Schema/OpenAPI artifacts for non-TypeScript clients.

Acceptance:

- Every public operation has positive and failure examples.
- Contracts contain no trusted caller-provided Actor or tenancy identity.
- Fixtures import no Convex implementation code.
- Additive compatibility tests detect breaking changes.
- Parity tests fail when the HTTPS schema, MCP tool schema, or operation registry drifts.

### P-04 — Minimal UI foundation

- Define tokens and only the required primitives: buttons, fields/OTP, dialog/sheet, toast, actor/status presentation, attachment/progress UI, empty/error states, Markdown rendering, and accessible sortable controls.

Acceptance:

- Keyboard, visible focus, reduced motion, focus trap/restore, contrast, sanitized Markdown, and non-drag reorder alternatives are tested.

## Ongoing service rule

Other agents submit dependency, schema-composition, route-registration, and shared-UI requests. Agent 01 batches these at checkpoints to keep lockfiles and merge hotspots stable.

## Must not do

- Do not add speculative packages or generic design-system breadth.
- Do not encode domain behavior in shared presentation primitives.
- Do not accept a contract change without fixtures and compatibility impact.
