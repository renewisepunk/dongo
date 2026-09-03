# Codex remote MCP setup

Preferred interactive setup after substituting the trusted project values:

```sh
dongo connect --agent-host codex
dongo integrate codex --apply
codex mcp login dongo-{{shortProjectRef}} --scopes dongo:work:read,dongo:work:write,dongo:attachments:read
```

The first command presents one explicit dongo CLI + Codex approval. The checked-in `config.toml` then supplies Codex's fixed public native client ID and loopback callback; login still performs S256 PKCE and stores Codex's separate credential, but no second dongo approval is needed. Alternatively, omit `--agent-host codex` and complete the normal Codex consent during login. Do not add `bearer_token_env_var` or copy a dongo CLI credential. Codex owns this OAuth grant and its secure storage.

`dongo integrate codex` previews both `.codex/config.toml` and the dongo-owned
managed block in `AGENTS.md`. After validating the preview, `--apply` writes
both changes atomically per file while preserving unrelated configuration and
instructions.

The Codex MCP connection is optional and project-scoped. Combined approval does
not combine credentials: CLI and Codex tokens remain separate and independently
revocable. Do not confuse the browser account session with the current
repository's binding, and do not use a Codex approval to repair an active-project
plan limit.

Answered Attention arrives on the next explicit pull. A host that remains active
may call `dongo_get_attention` immediately and then after 5, 10, 20, and at most
30 seconds between checks, stopping after five minutes. A stopped host does not
restart itself.

New Intake becomes visible when Codex starts or resumes and calls
`dongo_session_start` or otherwise explicitly pulls current dongo state. dongo
does not wake or restart that Codex conversation, and the web app exposes no
action that injects a notification into it.

The optional local runner is a separate path. Installed from the exact connected
repository in automatic mode and selected by an owner for Inbox pickup, it may
launch a new repository-scoped Codex job while that computer is awake. It does
not inject into or restart an existing Codex conversation. A runner registered
for another repository does not apply, and automatic jobs wait while the
registered checkout contains uncommitted files.

When the owner asks Codex to process multiple independent Intake or Work items,
do not apply the one-active-WorkItem rule to the whole effort. If session start
reports parallel mode and Codex can create isolated worktree sessions, use its
native delegation to give each session exactly one item, up to available dongo
capacity and Codex agent slots. Each delegated session owns its own stable
session ID, duplicate check, claim or start, workspace, Run, verification, and
outcome; refill capacity as sessions finish until the authorized set is done.

To remove local configuration, run `codex mcp logout dongo-{{shortProjectRef}}` and `codex mcp remove dongo-{{shortProjectRef}}`. Revoke the project installation separately in dongo when server-side invalidation is intended.
