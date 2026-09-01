# Claude Code connection

Run `dongo integrate claude` from the repository to preview the dongo-owned
project configuration and managed `CLAUDE.md` instructions. The preview is the
place to review the proposed files and rollback guidance; it does not change the
repository.

Treat this MCP connection as optional and project-scoped. Reuse a valid browser
account session instead of asking for account login again. Keep it distinct from
the current repository's `dongo connect` binding and from any project-capacity
decision on the account.

After reviewing the preview, complete these steps in order:

1. Apply the configuration with `dongo integrate claude --apply`.
2. Approve the project-scoped server only if Claude Code shows a project trust
   prompt.
3. Complete the login command printed by dongo only if Claude Code reports that
   authentication is required. For SSH/headless use, add `--no-browser` to that
   login command.
4. Restart Claude Code only when it cannot load the newly applied connection in
   the current repository session.
5. Verify by calling `dongo_session_start`. Setup is complete only when it names
   the intended project and Claude Code installation.

If verification fails, follow the reported step instead of repeating every
approval. A missing project approval returns to step 2, expired authentication
returns to step 3, and a connection that has not loaded returns to step 4. Never
copy the CLI credential into Claude Code.

Answered Attention arrives on the next explicit pull. A host that remains active
may call `dongo_get_attention` immediately and then after 5, 10, 20, and at most
30 seconds between checks, stopping after five minutes. A stopped host does not
restart itself.

New Intake becomes visible when Claude Code starts or resumes and calls
`dongo_session_start` or otherwise explicitly pulls current dongo state. dongo
does not wake or restart Claude Code, and the web app exposes no
agent-notification action.

The logout command printed by the integration clears Claude Code's local login.
The removal command deletes only this repository's dongo connection. Revoke the
dongo installation separately when access must be invalidated server-side.
