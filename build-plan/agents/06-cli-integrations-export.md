# Agent 06 — CLI, local integration, and repository export

## Mission

Provide the first-party terminal surface and reliable local repository behavior:

```text
Dongo CLI
  -> OAuth Device Authorization
  -> shared typed client
  -> /api/agent/v1
  -> deterministic .agent-work export
```

The CLI and remote MCP server are sibling consumers of one operation contract. The CLI does not proxy MCP traffic, and MCP does not shell out to the CLI. Agent 10 owns the remote MCP server, tool definitions, server instructions, and host manifests; this agent consumes those manifests when a CLI command configures a host.

## Exclusive ownership

- `packages/client/**`
- `packages/cli-core/**`
- `apps/cli/**`
- `packages/repo-export/**`
- CLI/client/export co-located tests
- host configuration merge/install code that consumes Agent 10's versioned manifests

## Dependencies

- Contract v1 operation, OAuth device, and installation fixtures.
- Agent 02 OAuth issuer/device/token/revocation contracts and approved CLI public client.
- Agent 03 `/api/agent/v1` staging endpoint.
- Agent 05 attachment fetch contract.
- Agent 10 host manifests and supported-client matrix for integration commands.

## Tasks

### C-01 — Shared client

- Implement typed high-level methods, timeouts, bounded jittered retries, `Retry-After`, request IDs, stable errors, and idempotency-key generation.
- Retry reads and safe/idempotent mutations only.
- Inject transport/clock for deterministic tests and redact access/refresh tokens, device and authorization codes, verification links, signed URLs, and content.

Acceptance:

- Every contract fixture passes against fake transport and staging.
- Response loss after committed mutation retries with the same key and produces one result.
- Revision/claim conflicts are surfaced, never silently overwritten.
- No secret appears in snapshots, thrown errors, JSON stdout, diagnostics, or verbose logs.

### C-02 — Repository detection and secure configuration

- Find the Git root and `.agent-work/project.json` from nested directories.
- Validate environment, issuer, API resource, project reference, and API origin; require explicit selection when ambiguous.
- Keep access tokens in memory or an explicitly bounded secure cache. Store rotating refresh material in the OS credential store, with a documented user-scoped `0600` fallback only when the OS store is unavailable.
- Prevent symlink/path escape and serialize refresh so concurrent commands cannot race token rotation.

Acceptance:

- The repository marker contains only non-secret environment/project/installation metadata.
- Missing/malformed/mismatched configuration is actionable.
- Commands behave consistently from root and nested paths.
- Staging and production issuers/audiences cannot be mixed.
- Secure-store failure never causes a fallback into the repository or stdout.

### C-03 — Connect, authorize, logout, and doctor

Implement resumable `dongo connect`:

```text
detect repo/environment
  -> request OAuth Device Authorization
  -> print and open verification_uri_complete
  -> show the short code for terminal/browser comparison
  -> poll at the server-provided interval and honor slow_down
  -> store rotating refresh material
  -> write non-secret project marker
  -> run session_start and doctor
```

Also implement `dongo auth status`, `dongo auth logout`, `dongo doctor`, and safe resume after interruption.

Acceptance:

- The normal path requires no code or token copy/paste.
- Browser-open failure prints one complete URL and keeps polling, so authorization works over SSH or from another device.
- Pending, denial, expiry, invalid client/grant, `slow_down`, Ctrl-C, polling network loss, and token-response loss have deterministic recovery.
- The browser says “Approved—you can close this window” and points back to the terminal; only the terminal reports Connected after storage, marker, and doctor succeed.
- `auth logout` revokes the CLI grant/token family and clears local material. Server-side Revoke also blocks the next request.
- Doctor reports safe issuer, resource, scopes, expiry, project, installation, and connectivity metadata without secrets.

### C-04 — Agent commands

Provide human and stable `--json` output for session start, Overview, Intake claim/renew/complete, Work create/get/start/update/renew/finish, comment, Attention request/get/resolve, attachment fetch, sync, config, auth status/logout, and doctor.

Acceptance:

- Machine stdout contains JSON only; diagnostics go to stderr.
- Exit codes distinguish validation, authentication, insufficient scope, conflict, temporary connectivity, and internal failure.
- Offline startup never claims or starts work.
- `session-start` needs one normal round trip, reports manual/autonomous explicitly, and performs no semantic triage itself.

### C-05 — Deterministic repository export

- Version `.agent-work/project.json` and generated files.
- Sanitize stable paths from immutable identifier + title slug.
- Include goal, outcome, source summaries, artifacts, and notes without secrets or temporary URLs.
- Write via temporary file + atomic rename and keep a managed manifest.
- Consume the same `sync_snapshot` contract exposed read-only through MCP.

Acceptance:

- Same snapshot produces byte-identical files.
- Unicode, hostile titles, quotes, multiline frontmatter, collisions, traversal, and symlink escape pass.
- Local write failure warns and next sync repairs it.
- CLI never imports Markdown or runs Git add/commit/push.

### C-06 — Host configuration commands

- Implement `dongo integrate codex`, `dongo integrate claude`, and generic setup by consuming versioned manifests owned by Agent 10.
- Detect the repository/project, add a project-unique remote MCP definition containing only the URL and non-secret metadata, start the host-native OAuth login where supported, install the managed instruction asset, verify a read-only `dongo_session_start`, and print rollback steps.
- Preserve unrelated `.codex/config.toml`, `.mcp.json`, `AGENTS.md`, `CLAUDE.md`, hooks, skills, and settings.
- Treat server Revoke and local configuration removal as separate explicit actions.

Acceptance:

- Codex configuration leads to `codex mcp login`; Claude configuration leads to `claude mcp login` or `/mcp`.
- No command copies the CLI token into an MCP host.
- Reinstall is idempotent; conservative uninstall removes only Dongo-owned content whose managed identity still matches.
- Existing host configuration survives install, upgrade, and uninstall.
- Host capability/version failures produce exact manual recovery instructions.

## Must not do

- Do not use pairing or static bearer tokens as the interactive fallback.
- Do not embed any token in host, repository, shell-completion, or adapter output.
- Do not duplicate MCP tool definitions or server instructions owned by Agent 10.
- Do not let host-login/configuration failure prevent ordinary CLI use.
- Do not keep working after claim/lease loss without a successful refetch/reclaim.
