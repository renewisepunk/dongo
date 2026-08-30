# dongo managed host assets

These templates configure one project-specific remote Streamable HTTP MCP server. Replace `{{origin}}`, `{{publicProjectRef}}`, and `{{shortProjectRef}}` from trusted dongo project metadata. The endpoint is non-secret; OAuth credentials stay in each host's credential store.

An installer must parse and merge the target configuration, preserve unrelated keys and prose, and ask before changing a committed `.codex/config.toml`, `.mcp.json`, `AGENTS.md`, or `CLAUDE.md`. It may replace only the block between the versioned dongo markers. If markers are malformed or a server name already points elsewhere, stop and ask instead of overwriting.

Upgrade replaces only dongo-owned keys and the exact managed block. When this repository is rebound to another project, the installer removes a stale server entry only when its generated name, same-origin dongo project endpoint, transport shape, and absence of custom settings prove that dongo created it; ambiguous or customized entries are preserved. The command reports every replaced server name so the user can separately log out or revoke its host grant. Uninstall removes only the current generated entries. `codex mcp logout` or `claude mcp logout` clears host-local OAuth material, while project installation revocation is a separate server-side action. Removing configuration does not revoke a grant, and revoking a grant does not edit local files.

Every host and dongo project receives a distinct endpoint, server name, grant family, and installation Actor. Never reuse the dongo CLI grant for Codex, Claude, or another MCP host. No hook or local process is required: the hosted server does not shell out to the CLI.
