# Local runner threat model

Status: implementation gate
Last reviewed: 2026-09-02

This internal threat model applies to the Codex and Claude Code local runner
described in [`../../build-plan/08-local-runner.md`](../../build-plan/08-local-runner.md).
It does not describe a production capability until the corresponding release
gate has passed.

## Assets

- repository contents, history, working tree, and local filesystem access;
- Codex and Claude Code credentials, sessions, configuration, and usage;
- dongo OAuth and subordinate runner credentials;
- local process control and user-session startup configuration;
- Work ownership, execution leases, results, and human trust in displayed state.

## Adversaries and failure sources

- another dongo tenant, member, installation, or revoked runner;
- a malicious or compromised hosted component attempting command injection;
- malicious Work, Intake, comments, attachments, filenames, or repository text;
- a local unprivileged process reading or replacing config, logs, or executables;
- a symlink, moved repository, PATH change, or executable substitution;
- response loss, replay, concurrent runners, clock skew, restart, and lease loss;
- terminal escape, credential, environment, or source disclosure in streamed data;
- a person misunderstanding queued, online, running, resumed, or completed state.

## Required mitigations

| Threat | Required control |
|---|---|
| Remote command execution | The job schema has no command, flags, executable, environment, system prompt, or arbitrary instruction. Local code constructs a fixed instruction and argument vector. |
| Cross-tenant or cross-project execution | Derive every identity from OAuth and the runner credential; verify project, registration, WorkItem or Intake, and lease on every transition. |
| Automatic Intake sent to the wrong computer | Keep automatic Intake off by default; require an owner to select one active locally automatic registration and harness; target every job to that registration; disable the policy on revoke, approval downgrade, or harness removal. |
| Credential theft | Store owner-only, atomically, outside repositories; reject unsafe ownership, mode, type, symlink, or corruption; never print or upload secrets. |
| Executable or repository substitution | Persist and revalidate locally approved canonical identities; fail closed when the path, repository, or executable changes. |
| Duplicate execution | Idempotent enqueue, atomic delivery reservation, one execution lease, exact replay, and reconciliation after uncertain responses. |
| Stale runner continues work | Renew runner and Work leases together; interrupt after bounded renewal grace; do not reclaim blindly. |
| Permission bypass | Preserve harness permissions and sandbox; prohibit Codex and Claude bypass flags in code and tests. |
| Prompt injection | Treat all project content as untrusted; the fixed launcher instruction requires normal dongo retrieval and repository policy, not obedience to queue metadata. |
| Data exfiltration | Upload structured bounded state only; redact before transport; keep raw process output local and bounded. |
| Misleading UI | Separate durable queued, fresh presence, local approval, process running, and Work completion facts. Never claim wake or resume without evidence. |
| Persistence abuse | User-level startup only, explicit install/remove, no root, no inbound port, bounded update path, visible version and revocation. |
| Cancellation race | Revision-aware cancel request, cooperative signal, bounded termination, terminal reconciliation, immutable terminal state. |

## Security invariants

1. No server-controlled value reaches `spawn` as an executable or argument.
2. No runner starts until the local repository and harness policy both validate.
3. Runner automatic mode is enabled only by a local owner action and cannot be
   raised remotely. The separate project owner opt-in may only select a runner
   already reporting that local mode and never falls over to another runner.
4. One job owns at most one local process and one active dongo Run.
5. Revocation, cancellation, and lease loss prevent further state mutation.
6. Raw stdout, stderr, session IDs, paths, repository text, and environment never
   enter hosted logs or events.
7. A missing compatible runner produces a durable queued state, never a success.
8. Existing CLI and MCP grants cannot impersonate a runner without the
   subordinate runner credential.

## Release-blocking tests

- mutate every authenticated identity and prove cross-boundary denial;
- inject shell metacharacters, newlines, terminal control, oversized JSON, fake
  session IDs, paths, and credential patterns into every server-controlled field;
- replace approved paths with files, symlinks, other repositories, and changed
  executables between validation and launch;
- replay enqueue/deliver/start/update/cancel/finish before and after simulated
  response loss;
- race two runners and two cancellation requests against start and completion;
- expire and revoke OAuth, runner credentials, delivery reservations, runner
  leases, and Work claims at every transition;
- prove Codex and Claude permission-bypass flags never appear in launched
  arguments and cannot be introduced through configuration;
- scan server logs, events, browser payloads, support output, and repository
  artifacts for credentials, session IDs, paths, and process output;
- install, reboot, disable, remove, and repair on clean macOS and Linux users
  without elevated privileges.

Any failed or ambiguous invariant blocks development acceptance and production
promotion.
