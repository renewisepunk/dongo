# Generic remote MCP setup

Substitute the trusted project values and merge `mcp.json` using the host's documented configuration mechanism. The only connection setting is the project-specific Streamable HTTP URL.

The host should connect without credentials, follow the `401` Bearer challenge to RFC 9728 Protected Resource Metadata, discover the authorization server, and complete OAuth authorization code with S256 PKCE. Prefer Client ID Metadata Documents when advertised; use Dynamic Client Registration only as a compatibility fallback. Include the exact MCP URL as the OAuth resource and accept only tokens issued for it.

The host must manage its own credential storage and must not import a dongo CLI, Codex, or Claude grant. Clearing local authentication, removing the local server entry, and revoking the dongo installation are three distinct actions.

This MCP connection is optional and project-scoped. Reuse a valid browser
account session for approval without treating it as the repository binding. A
different repository still needs `dongo connect`; an active-project plan limit
requires an upgrade, archive, or exact existing-project choice rather than a new
account login.

New Intake becomes visible when the agent host starts or resumes and calls
`dongo_session_start` or otherwise explicitly pulls current dongo state. dongo
does not wake or restart an arbitrary host, and the web app exposes no
agent-notification action.
