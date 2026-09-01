# dongo

dongo turns unstructured human Intake into durable work that local coding agents can claim, discuss, and complete. Convex is authoritative; the CLI and remote MCP server expose the same versioned operation contract, while the web product stays focused on capture, truthful status, and decisions that need a person.

Production runs at [dongo.so](https://dongo.so) against the isolated Convex production deployment `brainy-camel-172`. Development remains available at [dev.dongo.so](https://dev.dongo.so) against `wandering-camel-662`; development deploys cannot modify the production routes or resources.

## Product surfaces

- **Web:** email-code sign-in, project onboarding, Intake capture, Overview, Work detail, Attention response, search, and administration. Google sign-in is proven in development and remains disabled in production until its exact production callback is registered.
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

Run the public smoke gates with known synthetic project references:

```sh
npm run smoke:dev -- --project-ref <public-project-ref>
npm run smoke:production -- --project-ref <production-project-ref>
npm run smoke:boundaries -- --development-project-ref <public-project-ref> --production-project-ref <production-project-ref>
```

Each environment smoke gate requires every service to be ready and validates OAuth authorization-server metadata, exact project Protected Resource Metadata, and the unauthenticated RFC 9728 MCP challenge. The boundary gate proves that development and production remain independently routed and that `www` redirects to the production apex.

## Deploy one coherent development candidate

Preview the exact development-only release plan, then deploy it:

```sh
npm run deploy:dev:plan
npm run deploy:dev
```

The coherent deploy updates Convex first, followed by the authorization, API, MCP, attachment, notification, and web Workers in dependency order. This prevents a strict shared-contract change from leaving an older API or MCP bundle in front of newer Convex functions. It cannot modify `dongo.so` or `www.dongo.so`. `npm run deploy:dev:web` remains available for an explicitly web-only development iteration; it is not a complete candidate release.

Production has its own plan and coherent deployment. Use it only for an accepted candidate:

```sh
npm run deploy:production:plan
npm run deploy:production
```

The default `npm run deploy` points to that production release path. Rollback and environment checks are documented in [`docs/runbooks/production-release.md`](docs/runbooks/production-release.md).

## Get started with skills

The shortest path is to install the Dongo skills in the coding agent you already
use, then ask it to set up Dongo for the current repository:

```text
Install the dongo-onboarding and dongo-workflow skills from
https://github.com/renewisepunk/dongo-skills

Set up Dongo for this repository.
```

The agent installs the CLI when needed, connects the repository, configures its
own MCP host, and verifies the result. You approve the Dongo project and agent
installation in the browser. CLI and MCP grants remain separate, and a host that
cannot reload MCP servers dynamically may need one restart.

## Manual CLI setup

```sh
npm install --global @wisepunk/dongo
dongo --version
dongo connect
dongo doctor
```

`dongo connect` always connects to the live service at `dongo.so` and opens a browser for project approval. Authentication stays outside the repository, which receives only a non-secret connection marker. SSH and headless environments can use `--no-browser`. Development infrastructure is private to dongo's own source-level test harnesses and is not selectable from the installed CLI.

## Manual MCP setup

Each project exposes a unique resource URL:

```text
https://dongo.so/p/<public-project-ref>/mcp
```

After the CLI has connected this repository, preview host changes before applying them:

```sh
dongo integrate codex
dongo integrate claude
dongo integrate generic
```

Use `--apply` only after reviewing the managed configuration. dongo adds the project connection without copying CLI authentication into Codex, Claude, or another host. Each host authorizes its own connection.

## Security model

- Repository content stays local unless a person or authorized agent deliberately shares it.
- Agent connections are approved for one project and can be revoked independently.
- People and agent installations act under separate identities.
- Work, comments, decisions, and explicit attachments become durable project data.
- Local agent permissions and repository data-handling rules still apply.

See the customer-facing [security and privacy overview](https://dongo.so/security) or [report a vulnerability privately](SECURITY.md).
