# dongo CLI

Interactive use starts with `dongo connect`. For unattended CI, create a
project credential in dongo’s Advanced CI/service settings, expose it through
the CI provider as the masked `DONGO_TOKEN` environment variable, and run:

```sh
dongo ci setup
```

The setup command authenticates once, writes only the non-secret project marker
to the checkout, and never copies the credential into repository files or a
local credential store.

The dongo CLI connects a Git repository through OAuth Device Authorization, exposes the complete agent operation surface, and writes deterministic repository exports.

## Install

```sh
npm install --global @wisepunk/dongo
dongo --version
dongo --help
```

During the package’s initial release window, npm or an agent’s package-safety
layer may warn that `@wisepunk/dongo` is newly published. Package age is a risk
signal, not proof of a bad package and not an instruction to bypass safeguards.
Before continuing, verify the exact scoped name (not an unscoped lookalike), the
published repository, version, and integrity metadata:

```sh
npm view @wisepunk/dongo name version repository dist.integrity
```

If the host requires explicit approval for a new package, surface that warning
and use the user’s approval; never substitute another package, add `--force`, or
disable a security policy merely to make installation proceed.

## Build a package from a checkout

Build and install the self-contained package archive so the command does not depend on workspace source files:

```sh
npm pack --workspace @wisepunk/dongo
npm install --global ./wisepunk-dongo-0.2.11.tgz
dongo --version
dongo --help
```

The archive contains one executable JavaScript bundle and this README. It requires Node.js 20 or newer and contains no runtime dependency on dongo's private workspace packages.

Before accepting a CLI change, run the same immutable-package gate used by CI:

```sh
npm run verify:cli-package
```

The gate inspects the archive, installs it into an isolated prefix, runs it from a clean Git repository with no credential, and compares a canonical file-content digest with `apps/cli/package-payload.sha256`. npm versions may encode different tar/gzip envelope metadata, so the archive digest identifies one exact artifact while the pinned payload digest proves that supported build hosts produced the same package contents. When an intentional CLI change alters the payload, review the built archive first and then update the pinned digest to the `received` value printed by the failing gate.

Production releases always run the CLI release reconciler. It compares the
verified local payload with npm, fails before production changes when a changed
payload has no new immutable version or package-level read-write authorization
on the pinned public registry, and publishes the
same verified archive only after the production stack passes its public smoke
gate. An unchanged package is verified against npm and skipped.

## Commands

```text
dongo connect [--project-ref REF] [--project-name NAME] [--repository-url URL] [--execution-mode manual|autonomous] [--agent-host codex] [--no-browser]
dongo project create --name NAME [--repository-url URL] [--execution-mode manual|autonomous] [--agent-host codex] [--no-browser]
dongo ci setup
dongo auth status
dongo auth logout
dongo doctor
dongo session-start
dongo overview
dongo intake get|claim|renew|complete [options]
dongo work create|get|start|update|renew|finish [options]
dongo comment add [options]
dongo attention request|get|wait|resolve [options]
dongo updates get|wait [--cursor N] [--timeout-seconds N]
dongo attachment get|fetch --attachment-id ID [--output PATH]
dongo sync
dongo integrate codex|claude|generic [--apply]
dongo runner install --harness codex|claude [--harness ...] [--approval ask|automatic]
dongo runner configure --approval ask|automatic
dongo runner status
dongo runner approve --job-id ID
dongo runner disable
dongo runner remove
```

`dongo attention request` uses the active Work lifecycle when `--work-id` and
`--revision` are supplied; that request pauses only the matching active Run.
Omit both to ask the authorizing owner a durable project-level question, or add
`--intake-id` to associate that owner Attention with untriaged Intake. The
general form requires no Work claim or Run and remains available after the
current CLI session exits.

Add `--json` to receive one JSON object on stdout. Progress and the one complete browser approval link are written to stderr. The normal flow opens that link, waits for browser approval, stores the resulting credential, writes a non-secret project marker, and returns control to the terminal. `--no-browser` supports SSH/headless sessions by printing the same complete link while polling continues; no code or token needs to be copied into the CLI.

Add `--agent-host codex` when the same owner action should explicitly approve the CLI and Codex for the selected project. The page names both clients and their access. Codex still completes its own PKCE login, stores a separate credential, and remains independently revocable; the CLI credential is never copied into Codex. Other hosts and connections without this flag retain their own approval.

Use `dongo project create --name NAME` when this repository should have a new
project instead of binding an existing one. The command carries explicit
creation intent into the approval page, then binds the new project and writes
the repository marker after approval. A current dongo browser session is reused,
so project approval does not require another account sign-in; the new CLI grant
is still scoped to that project and approved separately.

The standard Free allowance is one active project. Before creation, the approval
page shows the organization’s effective active-project allowance, including any
finite additional capacity granted by a dongo operator. If it is exhausted, dongo
returns a non-retryable `plan_limit` result with the current count and the safe
next choices: use the existing project, archive it, or upgrade when upgrades are
available. Rerunning authorization does not bypass the plan limit. To bind this
repository to an existing project instead, use
`dongo connect --project-ref REF`.

Every command and subcommand has focused help; for example, run
`dongo work update --help` or add `--json` to receive the same usage and command
schema in a success envelope. Argument validation reports all detectable
problems together before contacting dongo. In JSON mode, validation errors put
the complete issue list and expected command schema in `error.details`.

After a successful online command, the CLI performs one bounded, fail-open check
against the official scoped package on npm. When a newer stable version exists,
human output says to ask before installing, while JSON output includes a fixed
`update` advisory with `consentRequired: true` and an exact version-pinned install
command. The CLI never installs itself, never executes registry-provided text,
and does not turn an unavailable registry into a command failure. Remote MCP is
hosted by dongo and does not need a local package upgrade.

Work uses a canonical four-letter, three-digit identifier such as `dong008`.
Pass it to `dongo work get --identifier dong008`. Exact legacy identifiers
remain valid aliases for migrated work, while command output, copy actions, and
repository exports use the canonical compact identifier.

JSON output always uses one envelope: successes contain `ok`, `command`, and
`data`; failures contain `ok`, `command`, and `error`. When the CLI generates an
idempotency key for a mutation, it returns the key in `recovery.idempotencyKey`
and does not print it separately to stderr in JSON mode. Reuse that key only to
recover the exact same request.

`dongo attention wait --attention-id ID` is the active response-notification
mechanism for a running local adapter. It checks immediately, then after 5, 10,
20, and at most 30 seconds between later checks. It stops after five minutes by
default and returns `wait.status` as `resolved` or `timed_out`; use
`--timeout-seconds` to choose a bound from 1 to 3600 seconds. This command never
claims to restart a stopped process. A new agent session must call
`dongo_session_start`, which returns newly resolved Attention for that
installation, before continuing prior work.

`dongo updates get` and `dongo updates wait` retain compatibility with the
bounded project-update stream. The web app does not expose an agent-notification
action, and these commands do not wake, restart, prompt, assign, or prove
delivery to an agent harness. A stopped CLI receives nothing until its process
is started again and explicitly pulls current dongo state.

Every installed CLI connection targets the live service at `https://dongo.so`. There is no environment picker or custom-origin flag. Development infrastructure is available only to dongo's source-level internal harnesses, and a released CLI refuses a repository marker from any non-production origin before sending credentials.

The local runner is optional. `dongo runner install` registers this computer for
the connected repository and starts an unprivileged login-scoped user service.
It opens no inbound port and accepts only durable dongo jobs for the exact local
project binding. Before installing it, run `dongo integrate codex --apply` and/or
`dongo integrate claude --apply`, complete the host's printed login, and prove
`dongo_session_start` from that agent. The runner and agent use separate
credentials; never copy the CLI credential into an agent configuration. Ask-before-run is the default; `--approval automatic` is an
explicit opt-in for this repository only and starts only from a clean checkout.
An existing runner can change this local choice without replacing its credential
with `dongo runner configure --approval ask|automatic`. Inbox pickup remains a
separate owner action in **Project settings → Local runner**; turning it on
explicitly queues current unclaimed Intake as well as future items.
Git worktrees do not inherit ignored release configuration. Trusted deployment
access is therefore off by default, including after an upgrade. An owner can
review and enable the repository-scoped bridge during installation with
`--deployment-access repository`, or later with
`dongo runner configure --deployment-access repository`. The runner records
only detected provider names and the approved filenames `.env` and
`.env.local`; it never records their values. For each Work job it rereads only
an allow-list of GitHub, Convex, Cloudflare, and npm settings from the approved
checkout, validates the existing provider sessions inside the exact isolated
worktree, and passes those values only in the agent process environment. A
temporary owner-only npm configuration refers to the token by environment
variable and is deleted after the process exits. Missing, expired, changed, or
unsafe configuration stops before the agent starts and names the failed
provider without falling back to a different deployment target. Runner logs
redact every injected secret. Disable the bridge with
`dongo runner configure --deployment-access disabled`.
Installation records the exact supported Codex and/or Claude Code executable;
a queued job cannot replace its path, flags, environment, or instruction. Use
`dongo runner status` to inspect
redacted local health, `dongo runner approve --job-id ID` to approve one waiting
job on this computer, and `dongo runner remove` to stop the service, revoke its
subordinate credential, and remove local configuration. macOS launchd and Linux
user systemd are supported; native Windows is not part of the initial release.

On macOS, the installer uses a dedicated executable named `dongo` for the
user-level LaunchAgent. macOS may therefore show a one-time **Background Items
Added** notification for **dongo**. That item is the local Inbox runner: it runs
only after this user signs in, uses Node.js internally, and can be inspected in
**System Settings → General → Login Items & Extensions**. Older CLI releases
started launchd with the Node executable directly and may appear as **node**;
remove that runner, update dongo, and reinstall it to receive the clear service
identity. Choose a recognizable, non-sensitive computer label with
`--label "Studio Mac"` so Project settings is equally clear.

Runner commands explain their normal results in plain language: what this
computer can do, whether approval is required, whether work is waiting, and the
next useful action. Internal registration IDs, timestamps, repository paths,
and service details stay out of the default display. Agents, scripts, and
diagnostics can use `--json` for the complete stable result.

`dongo --version` (or `dongo -V`) prints the installed package version. Combining it with `--json` returns the same version in the stable command envelope without accessing repository or credential state.

## Credential safety

The npm CLI deliberately does not invoke macOS Keychain, Linux Secret Service, an installer, or a generic credential helper. Those mechanisms require a stable trusted application identity to avoid suspicious OS prompts; an npm process running through Node does not provide one.

Interactive credentials live under the user dongo configuration directory, never beneath a repository. On macOS/Linux the credential directory is forced to owner-only `0700` and each opaque credential file to owner-only `0600`; the CLI rejects symlinks, non-regular files, wrong ownership, broad permissions, unsafe repository-local configuration, and malformed or mismatched credential metadata. Writes use an exclusively created same-directory temporary file plus atomic rename so refresh-token rotation cannot activate a partial file.

This file is not encrypted. Its security boundary is the local OS user plus full-disk/backup protection. It does not defend against malware or another process already running as the same user. dongo reduces the impact with a 10-minute access token, a rotating 30-day refresh family, zero refresh-token reuse interval, exact project/resource/scopes, and immediate remote revocation. See [the full credential-storage decision](../../build-plan/07-cli-credential-storage.md).

Persistent interactive login on native Windows is release-blocked until dongo can create and verify an owner-only Windows ACL or ship a stable signed helper. WSL is supported only when the dongo configuration directory is on the Linux filesystem.

`DONGO_TOKEN` is accepted only as an explicit non-interactive CI/service override for an already connected production project. Interactive `connect` and `auth logout` reject it; the external system that supplied the service credential remains responsible for revocation. It is never copied into the user credential file.

`.agent-work/project.json` contains environment, project, installation, and credential-profile references only. The CLI validates its origin/audience binding before sending a bearer credential. `dongo auth logout` revokes the server grant before deleting local material; a revocation failure retains the local credential so logout can be retried safely.

All v1 mutations accept `--idempotency-key KEY`. If omitted, the CLI creates one key and reuses it for every safe transport retry in that invocation. Reuse the original key when recovering a mutation whose response may have been lost. Revision, claim, and lease conflicts are returned without blind retry. Exit codes distinguish usage/validation (`2`), authentication (`3`), insufficient scope (`4`), temporary failure (`5`), conflict (`6`), and cancellation (`130`).

`attachment get` returns safe metadata without printing its signed download URL. `attachment fetch` consumes that URL in memory, never forwards the dongo bearer credential, refuses redirects and symlink/`.git` paths, enforces the reserved byte size, and creates a new `0600` file without overwriting an existing path.

`dongo sync` writes only dongo-managed Markdown plus `.agent-work/manifest.json`. Writes are atomic and deterministic, signed artifact URLs are omitted, stale files are removed only when they retain the dongo-managed header, and the CLI performs no Git action.

Host integration commands render a project-specific non-secret MCP entry plus the checked-in managed instruction block. Codex configuration includes only the fixed public client ID and loopback callback, never a credential. Preview is the default and exposes only dongo-owned snippets, never unrelated existing file contents. `--apply` is the explicit consent to merge: unrelated JSON/TOML keys and prose are preserved, exact legacy URL-only Codex tables are upgraded, malformed markers and conflicting server ownership stop without overwrite, and symlink targets are refused. Codex and Claude receive a host-native OAuth login command; CLI credentials are never copied or passed to a host. Local host logout/removal and server-side installation revocation remain separate actions.

### Claude Code setup order

Run `dongo integrate claude` to review the proposed project-scoped changes.
After that preview, proceed in this order:

1. Apply the configuration with `dongo integrate claude --apply`.
2. Approve the project-scoped server only if Claude Code asks for project trust.
3. Complete the printed login command only if authentication is required.
4. Restart Claude Code only when it cannot load the connection in the current
   repository session.
5. Verify with `dongo_session_start` and accept success only when it identifies
   the intended project and Claude Code installation.

An integration result should name the completed step and the next required
action. It should not send a user back through approvals that already succeeded.
