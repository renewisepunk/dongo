# Dongo managed host assets

These templates configure one project-specific remote Streamable HTTP MCP server. Replace `{{origin}}`, `{{publicProjectRef}}`, and `{{shortProjectRef}}` from trusted Dongo project metadata. The endpoint is non-secret; OAuth credentials stay in each host's credential store.

An installer must parse and merge the target configuration, preserve unrelated keys and prose, and ask before changing a committed `.codex/config.toml`, `.mcp.json`, `AGENTS.md`, or `CLAUDE.md`. It may replace only the block between the versioned Dongo markers. If markers are malformed or a server name already points elsewhere, stop and ask instead of overwriting.

Upgrade replaces only Dongo-owned keys and the exact managed block. Uninstall removes only those entries. `codex mcp logout` or `claude mcp logout` clears host-local OAuth material, while project installation revocation is a separate server-side action. Removing configuration does not revoke a grant, and revoking a grant does not edit local files.

Every host and Dongo project receives a distinct endpoint, server name, grant family, and installation Actor. Never reuse the Dongo CLI grant for Codex, Claude, or another MCP host. No hook or local process is required: the hosted server does not shell out to the CLI.
