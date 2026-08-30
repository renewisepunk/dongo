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

## Install from a checkout

Build and install the self-contained package archive so the command does not depend on workspace source files:

```sh
npm pack --workspace @dongo/cli
npm install --global ./dongo-cli-0.1.0.tgz
dongo --version
dongo --help
```

The archive contains one executable JavaScript bundle and this README. It requires Node.js 20 or newer and contains no runtime dependency on dongo's private workspace packages.

## Commands

```text
dongo connect [--environment development|production] [--origin URL] [--project-ref REF] [--project-name NAME] [--repository-url URL] [--execution-mode manual|autonomous] [--no-browser]
dongo auth status
dongo auth logout
dongo doctor
dongo session-start
dongo overview
dongo intake get|claim|renew|complete [options]
dongo work create|get|start|update|renew|finish [options]
dongo comment add [options]
dongo attention request|get|resolve [options]
dongo attachment get|fetch --attachment-id ID [--output PATH]
dongo sync
dongo integrate codex|claude|generic [--apply]
```

Add `--json` to receive one JSON object on stdout. Progress and the one complete browser approval link are written to stderr. The normal flow opens that link, waits for browser approval, stores the resulting credential, writes a non-secret project marker, and returns control to the terminal. `--no-browser` supports SSH/headless sessions by printing the same complete link while polling continues; no code or token needs to be copied into the CLI.

`dongo --version` (or `dongo -V`) prints the installed package version. Combining it with `--json` returns the same version in the stable command envelope without accessing repository or credential state.

## Credential safety

The npm CLI deliberately does not invoke macOS Keychain, Linux Secret Service, an installer, or a generic credential helper. Those mechanisms require a stable trusted application identity to avoid suspicious OS prompts; an npm process running through Node does not provide one.

Interactive credentials live under the user dongo configuration directory, never beneath a repository. On macOS/Linux the credential directory is forced to owner-only `0700` and each opaque credential file to owner-only `0600`; the CLI rejects symlinks, non-regular files, wrong ownership, broad permissions, unsafe repository-local configuration, and malformed or mismatched credential metadata. Writes use an exclusively created same-directory temporary file plus atomic rename so refresh-token rotation cannot activate a partial file.

This file is not encrypted. Its security boundary is the local OS user plus full-disk/backup protection. It does not defend against malware or another process already running as the same user. dongo reduces the impact with a 10-minute access token, a rotating 30-day refresh family, zero refresh-token reuse interval, exact project/resource/scopes, and immediate remote revocation. See [the full credential-storage decision](../../build-plan/07-cli-credential-storage.md).

Persistent interactive login on native Windows is release-blocked until dongo can create and verify an owner-only Windows ACL or ship a stable signed helper. WSL is supported only when the dongo configuration directory is on the Linux filesystem.

`DONGO_TOKEN` is accepted only as an explicit non-interactive CI/service override for an already connected fixed dongo environment. Interactive `connect`, custom origins, and `auth logout` reject it; the external system that supplied the service credential remains responsible for revocation. It is never copied into the user credential file.

`.agent-work/project.json` contains environment, project, installation, and credential-profile references only. The CLI validates its origin/audience binding before sending a bearer credential. `dongo auth logout` revokes the server grant before deleting local material; a revocation failure retains the local credential so logout can be retried safely.

All v1 mutations accept `--idempotency-key KEY`. If omitted, the CLI creates one key and reuses it for every safe transport retry in that invocation. Reuse the original key when recovering a mutation whose response may have been lost. Revision, claim, and lease conflicts are returned without blind retry. Exit codes distinguish usage/validation (`2`), authentication (`3`), insufficient scope (`4`), temporary failure (`5`), conflict (`6`), and cancellation (`130`).

`attachment get` returns safe metadata without printing its signed download URL. `attachment fetch` consumes that URL in memory, never forwards the dongo bearer credential, refuses redirects and symlink/`.git` paths, enforces the reserved byte size, and creates a new `0600` file without overwriting an existing path.

`dongo sync` writes only dongo-managed Markdown plus `.agent-work/manifest.json`. Writes are atomic and deterministic, signed artifact URLs are omitted, stale files are removed only when they retain the dongo-managed header, and the CLI performs no Git action.

Host integration commands render a project-specific URL-only MCP entry plus the checked-in managed instruction block. Preview is the default and exposes only dongo-owned snippets, never unrelated existing file contents. `--apply` is the explicit consent to merge: unrelated JSON/TOML keys and prose are preserved, malformed markers and conflicting server ownership stop without overwrite, and symlink targets are refused. Codex and Claude receive a host-native OAuth login command; CLI credentials are never copied or passed to a host. Local host logout/removal and server-side installation revocation remain separate actions.
