# Codex remote MCP setup

Preferred interactive setup after substituting the trusted project values:

```sh
codex mcp add dongo-{{shortProjectRef}} --url {{origin}}/p/{{publicProjectRef}}/mcp --oauth-resource {{origin}}/p/{{publicProjectRef}}/mcp --oauth-client-registration auto
codex mcp login dongo-{{shortProjectRef}} --scopes dongo:work:read,dongo:work:write,dongo:attachments:read --oauth-client-registration auto
```

Alternatively, merge `config.toml` into a trusted user or project Codex configuration and run only the login command. Do not add `bearer_token_env_var` or copy a Dongo CLI credential. Codex owns this OAuth grant and its secure storage.

To remove local configuration, run `codex mcp logout dongo-{{shortProjectRef}}` and `codex mcp remove dongo-{{shortProjectRef}}`. Revoke the project installation separately in Dongo when server-side invalidation is intended.
