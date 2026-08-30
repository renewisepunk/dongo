# Generic remote MCP setup

Substitute the trusted project values and merge `mcp.json` using the host's documented configuration mechanism. The only connection setting is the project-specific Streamable HTTP URL.

The host should connect without credentials, follow the `401` Bearer challenge to RFC 9728 Protected Resource Metadata, discover the authorization server, and complete OAuth authorization code with S256 PKCE. Prefer Client ID Metadata Documents when advertised; use Dynamic Client Registration only as a compatibility fallback. Include the exact MCP URL as the OAuth resource and accept only tokens issued for it.

The host must manage its own credential storage and must not import a Dongo CLI, Codex, or Claude grant. Clearing local authentication, removing the local server entry, and revoking the Dongo installation are three distinct actions.
