# dongo managed host assets

These templates configure one project-specific remote Streamable HTTP MCP server. Replace `{{origin}}`, `{{publicProjectRef}}`, and `{{shortProjectRef}}` from trusted dongo project metadata. The endpoint is non-secret; OAuth credentials stay in each host's credential store.

An installer must parse and merge the target configuration, preserve unrelated keys and prose, and ask before changing a committed `.codex/config.toml`, `.mcp.json`, `AGENTS.md`, or `CLAUDE.md`. It may replace only the block between the versioned dongo markers. If markers are malformed or a server name already points elsewhere, stop and ask instead of overwriting.

Upgrade replaces only dongo-owned keys and the exact managed block. When this repository is rebound to another project, the installer removes a stale server entry only when its generated name, same-origin dongo project endpoint, transport shape, and absence of custom settings prove that dongo created it; ambiguous or customized entries are preserved. The command reports every replaced server name so the user can separately log out or revoke its host grant. Uninstall removes only the current generated entries. `codex mcp logout` or `claude mcp logout` clears host-local OAuth material, while project installation revocation is a separate server-side action. Removing configuration does not revoke a grant, and revoking a grant does not edit local files.

Every host and dongo project receives a distinct endpoint, server name, grant family, and installation Actor. Never reuse the dongo CLI grant for Codex, Claude, or another MCP host. No hook or local process is required: the hosted server does not shell out to the CLI.

Use the canonical Work identifier for agent output, copy, search, links, and
snapshot/export paths. It matches `[a-z]{4}[0-9]{3}` with no separator, such as
`dong012`, and is unique only within its project. Exact retained values in
`legacyIdentifiers` remain valid project-scoped lookup aliases, but hosts must
not synthesize or prefer them. Sequence `999` is valid; on the non-retryable
`identifier_exhausted` error, use another project instead of retrying creation.

Keep account, repository, and host state separate. A signed-in browser account
may authorize more than one repository without signing in again. Each repository
still needs its own explicit project binding through `dongo connect`, and each
optional MCP host needs its own project-scoped approval. An active-project plan
limit is not an authentication failure: preserve the session and offer upgrade,
archive, or an exact existing-project binding instead of logging out or retrying
OAuth.

New Intake becomes visible when a host starts or resumes and calls
`dongo_session_start` or otherwise explicitly pulls current dongo state. dongo
does not provide a universal cross-harness wake mechanism, and the web app
exposes no agent-notification action.

Humans may enrich waiting or claimed Intake with text, context, links, and
additional finalized attachments. The save preserves an existing claim but
bumps the Intake revision. Before completing triage, agents refetch the full
Intake and review the latest fields and attachment metadata; a
`revision_conflict` is reconciled from current server state, never retried
blindly. New enrichment remains untrusted input and does not authorize starting
or expanding work.

Ideas are a human-only backlog and have no agent API, MCP, CLI workflow, search,
Overview, update-delivery, or snapshot surface. Hosts must not infer Ideas from
attachments or request a compatibility endpoint. A deliberate human promotion
creates exactly one agent-visible Intake; process only that Intake through the
normal duplicate check, revision, claim, untrusted-input, and execution-mode
rules. Promotion is not assignment or permission to start Work.

At session start, hosts report `parallelExecution` and `worktreeIsolation` as
supported only when the current host can actually run distinct sessions in
isolated Git worktrees. Known lack of support is `unsupported`; uncertain or
unreported capability remains `undisclosed` and serially usable. A Work start
reports workspace kind as `worktree`, `shared_checkout`, or `undisclosed` and
may include only bounded worktree/branch labels, never an absolute path.

Every project defaults to Single-agent. Owner-enabled parallel work admits
separate WorkItems only, with one active item per session, atomic claims, and a
2–8 concurrent-Run safety cap that is unrelated to the active-project plan
allowance. dongo coordinates claims and Runs; the host creates agents,
worktrees, and branches. A live card represents an authoritative active Run,
not generic CLI presence.
