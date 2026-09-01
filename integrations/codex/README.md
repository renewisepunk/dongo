# Codex remote MCP setup

Preferred interactive setup after substituting the trusted project values:

```sh
codex mcp add dongo-{{shortProjectRef}} --url {{origin}}/p/{{publicProjectRef}}/mcp --oauth-resource {{origin}}/p/{{publicProjectRef}}/mcp --oauth-client-registration auto
codex mcp login dongo-{{shortProjectRef}} --scopes dongo:work:read,dongo:work:write,dongo:attachments:read --oauth-client-registration auto
```

Alternatively, merge `config.toml` into a trusted user or project Codex configuration and run only the login command. Do not add `bearer_token_env_var` or copy a dongo CLI credential. Codex owns this OAuth grant and its secure storage.

`dongo integrate codex` previews both `.codex/config.toml` and the dongo-owned
managed block in `AGENTS.md`. After validating the preview, `--apply` writes
both changes atomically per file while preserving unrelated configuration and
instructions.

The Codex MCP connection is optional and project-scoped. A browser account that
is already signed in can approve this additional host connection without
repeating account login. Do not confuse that account session with the current
repository's separate `dongo connect` binding, and do not use a Codex approval
to repair an active-project plan limit.

Answered Attention arrives on the next explicit pull. A host that remains active
may call `dongo_get_attention` immediately and then after 5, 10, 20, and at most
30 seconds between checks, stopping after five minutes. A stopped host does not
restart itself.

New Intake becomes visible when Codex starts or resumes and calls
`dongo_session_start` or otherwise explicitly pulls current dongo state. dongo
does not wake or restart Codex, and the web app exposes no agent-notification
action.

To remove local configuration, run `codex mcp logout dongo-{{shortProjectRef}}` and `codex mcp remove dongo-{{shortProjectRef}}`. Revoke the project installation separately in dongo when server-side invalidation is intended.
