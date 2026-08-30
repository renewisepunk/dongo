# dongo

dongo turns unstructured human Intake into durable work that local coding agents can claim, discuss, and complete. Convex is authoritative; the CLI and remote MCP server expose the same versioned operation contract, while the web product stays focused on capture, truthful status, and decisions that need a person.

Development runs at [dev.dongo.so](https://dev.dongo.so) against Convex deployment `wandering-camel-662`. The existing [dongo.so](https://dongo.so) landing deployment is intentionally separate and must not be changed by development deploys.

## Product surfaces

- **Web:** email/Google sign-in, project onboarding, Intake capture, Overview, Work detail, Attention response, search, and administration.
- **CLI:** one-link OAuth Device Authorization, complete agent operations, secure credential storage, diagnostics, attachment download, and deterministic `.agent-work` export.
- **Remote MCP:** project-specific Streamable HTTP endpoints with OAuth discovery, PKCE/CIMD or supported DCR, per-installation grants, and the same operation semantics as the CLI.
- **Edge services:** isolated authorization, typed agent API, MCP gateway, direct R2 attachment delivery, and durable notification dispatch.

## Repository

```text
apps/web             SolidStart human product
apps/cli             self-contained dongo CLI package
apps/auth            isolated OAuth/device authorization Worker
apps/api             typed HTTPS agent resource server
apps/mcp             remote MCP Worker composition
apps/files           signed direct-to-R2 attachment Worker
apps/notifications   email/APNs/FCM delivery Worker
convex               schema, domain operations, subscriptions, schedulers
packages/contracts   canonical transport-neutral operation registry
packages/client      typed HTTPS client
packages/cli-core    device auth, secure storage, integrations, sync
packages/mcp         MCP tools, protocol, OAuth validation, Convex executor
packages/repo-export deterministic one-way Markdown exporter
integrations         managed Codex, Claude, and generic MCP instructions
build-plan           architecture, journeys, agent plans, and release gates
```

The original product requirements remain unchanged in [`dongo-prd.md`](dongo-prd.md). Implementation decisions and release evidence are additive documents under [`build-plan/`](build-plan/README.md).

## Local verification

Node.js 24 is used for repository development; the packed CLI supports Node.js 20 or newer.

```sh
npm ci
npm run verify:no-secrets
npm run check
npm test
npm run build
```

Run the public development smoke gate with a real project reference:

```sh
npm run smoke:dev -- --project-ref <public-project-ref>
```

The smoke gate requires every development service to be ready and validates OAuth authorization-server metadata, exact project Protected Resource Metadata, and the unauthenticated RFC 9728 MCP challenge.

## Install the CLI from this checkout

```sh
npm pack --workspace @dongo/cli
npm install --global ./dongo-cli-0.1.0.tgz
dongo --version
dongo connect --environment development --origin https://dev.dongo.so
dongo doctor
```

`dongo connect` opens one complete browser link. The browser shows the terminal comparison code, account, fixed agent-selected project, resource, and scopes; the terminal polls until explicit approval, stores its own grant in a private user credential file outside the repository, writes only a non-secret repository marker, and runs diagnostics. It never invokes Keychain or asks the user to approve a credential helper. SSH/headless environments can add `--no-browser` and open the same complete link elsewhere—no token is copied into the CLI. The threat model and exact storage contract are in [build-plan/07-cli-credential-storage.md](build-plan/07-cli-credential-storage.md).

## Connect an MCP host

Each project exposes a unique resource URL:

```text
https://dev.dongo.so/p/<public-project-ref>/mcp
```

After the CLI has connected this repository, preview host changes before applying them:

```sh
dongo integrate codex
dongo integrate claude
dongo integrate generic
```

Use `--apply` only after reviewing the exact managed configuration. dongo writes URL-only MCP entries and versioned instruction blocks; it never copies CLI credentials into Codex, Claude, or another host. Each host completes its own OAuth flow and receives an independently revocable installation Actor and token family.

## Security model

- Human Better Auth/Convex sessions and agent OAuth are isolated; a short-lived, signed, single-use assertion bridges authenticated project consent.
- The server derives organization, project, Actor, installation, and scopes from validated grants. Caller-provided identity is never trusted.
- Access tokens are short-lived and audience/resource-bound; refresh families rotate and are independently revocable.
- Every mutation is idempotent and revision/lease conflicts fail closed.
- Attachment links are short-lived and method-, project-, object-, size-, and checksum-bound. Large bytes never transit Convex.
- Credentials, OTPs, device/authorization codes, signed URLs, and private work content are excluded from repository files and default logs.
- `.agent-work` export is deterministic and one-way. dongo never stages, commits, pushes, or imports edits.

Operational recovery and rollback procedures live in [`docs/runbooks/`](docs/runbooks/README.md). The complete release criteria are in [`build-plan/03-release-gates.md`](build-plan/03-release-gates.md).
