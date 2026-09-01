# CLI credential storage decision

Status: accepted for V1 implementation  
Decision date: 2026-08-30  
Scope: interactive dongo CLI credentials only; MCP hosts own their credential storage
Supersedes: the earlier assumption that the npm CLI should use macOS Keychain/Linux Secret Service by default

## 1. Decision

The V1 npm-distributed dongo CLI stores its project-scoped OAuth credential in a dongo-owned, user-scoped credential file outside every repository.

On POSIX systems:

- configuration directory: `${XDG_CONFIG_HOME:-~/.config}/dongo`;
- credential directory: `credentials/`, forced to owner-only `0700`;
- one opaque filename per product-origin + repository-root profile;
- credential file: forced to owner-only `0600`;
- writes: create a new same-directory temporary file with exclusive creation, then atomically rename;
- reads: reject symlinks, non-regular files, wrong ownership, and group/other permissions before parsing;
- interactive credentials never appear in argv, inherited child environments, repository files, browser storage, JSON output, logs, analytics, support bundles, or error text. The separately documented `DONGO_TOKEN` CI/service override is the only intentional credential environment variable and remains externally managed.

Normal use must not invoke Keychain, Secret Service, a password manager, an installer, Swift, PowerShell, or an external credential helper. It must never produce an OS credential prompt. The human journey remains browser approval followed by terminal `Connected`.

`DONGO_TOKEN` remains an explicit, externally managed, non-interactive CI/service override. It is never the interactive login path and is never copied into dongo's local credential file.

Keychain support may return only through a separately shipped, stable, signed dongo helper whose identity and upgrade behavior pass platform security review. It must be explicit opt-in until it proves prompt-free on clean machines. The npm process must not simulate a dongo identity by trusting a generic system binary.

## 2. Why this is the best V1 tradeoff

There is no universal CLI credential-storage convention:

| CLI | Current documented behavior | Relevant lesson for dongo |
| --- | --- | --- |
| Claude Code | Uses macOS Keychain on macOS, a `0600` JSON file on Linux, and a file inheriting the user-profile ACL on Windows. | Even one leading agent CLI uses platform-specific storage. An owner-only file is a normal, disclosed design—not an exceptional fallback. |
| GitHub CLI | Prefers the system credential store and can fall back to plaintext; `--insecure-storage` forces the file path. | A mature native CLI can use a keyring but must disclose its actual store and retain a headless path. |
| Wrangler | Defaults to a plaintext TOML credential file. `--use-keyring` encrypts a file and stores its key in the OS keyring. | Cloud/agent CLIs commonly prioritize predictable browser-to-terminal operation; keyring can be an explicit hardening mode. |
| Stripe CLI | Persists its restricted CLI key in user configuration. | A browser-paired CLI can use a bounded local file when the server credential is restricted and revocable. |
| AWS CLI SSO | Caches the SSO token under `~/.aws/sso/cache`. | Disk caching is normal for headless-capable developer tooling when server credentials expire and can be renewed/revoked. |
| gcloud | Stores user credentials in the gcloud user configuration directory and warns that filesystem readers can use them. | The limitation of user-file storage should be stated plainly, not disguised. |
| Docker CLI | Uses an external platform credential helper when available/configured and otherwise stores encoded credentials in `config.json`. | A helper protocol is a useful future extension, but an external helper is a real dependency and must not appear unexpectedly. |

Primary sources:

- [OAuth 2.0 Security Best Current Practice, RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html)
- [OAuth 2.0 Device Authorization Grant, RFC 8628](https://www.rfc-editor.org/rfc/rfc8628.html)
- [OAuth 2.0 for Native Apps, RFC 8252](https://www.rfc-editor.org/rfc/rfc8252.html)
- [Apple Keychain access-control lists](https://developer.apple.com/documentation/security/access-control-lists)
- [Apple guidance for Keychain access prompts](https://support.apple.com/guide/keychain-access/if-youre-asked-for-access-to-your-keychain-kyca1243/mac)
- [Apple distribution signing and stable application identity](https://developer.apple.com/documentation/xcode/creating-distribution-signed-code-for-the-mac)
- [Claude Code authentication and credential management](https://code.claude.com/docs/en/authentication)
- [GitHub CLI `gh auth login`](https://cli.github.com/manual/gh_auth_login)
- [Wrangler login and keyring storage](https://developers.cloudflare.com/workers/wrangler/commands/general/)
- [Stripe CLI authentication](https://docs.stripe.com/api/authentication?lang=cli)
- [AWS CLI IAM Identity Center token cache](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html)
- [gcloud CLI authentication and stored credentials](https://docs.cloud.google.com/sdk/docs/authenticate)
- [Docker CLI credential stores and helper protocol](https://docs.docker.com/reference/cli/docker/login/)
- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- [Node.js file-mode semantics and Windows caveat](https://nodejs.org/api/fs.html#file-modes)

### 2.1 Alternatives considered

| Alternative | At-rest protection | Prompt/dependency risk | Headless behavior | Decision |
| --- | --- | --- | --- | --- |
| Generic `security`/Swift/Secret Service helper by default | Potentially stronger when the caller is trusted | High for this npm client; the helper identity is not dongo and may prompt or require installation | Fragile across SSH, containers, locked stores, and desktop-less Linux | Rejected |
| Encrypt the file with a key stored beside it | No meaningful improvement against filesystem disclosure | Low | Predictable | Rejected as security theater |
| Encrypt the file with a key in Keychain | Stronger at rest if retrieval is trustworthy | Reintroduces the same prompt/caller problem | Same keyring availability problem | Rejected for V1 |
| Store only the refresh token in an environment variable | Depends on the shell/launcher | No OS prompt, but leaks through inheritance/misconfiguration and creates ongoing setup work | Useful only when an external secret manager owns it | CI/service override only |
| Keep credentials only in memory | Strong after process exit | No prompt | Every command requires browser login | Rejected as unusable |
| Owner-only dongo user file plus rotating, revocable OAuth | Honest local-user boundary; not malware-proof | No helper or installer | Predictable on macOS, Linux, SSH, and containers | **Selected for V1** |
| Signed dongo native helper | Potentially strongest transparent platform storage | Low only after signing/upgrade/clean-host gates pass | Requires a maintained per-platform distribution | Future option |

The selected design wins because it is the only V1 option that is transparent about its boundary, works consistently for agents and headless terminals, creates no trust-damaging prompt, and can be implemented without pretending that an npm process is a native trusted application. Its weaker same-user-malware boundary is explicit and is reduced through short lifetimes, rotation, exact binding, replay detection, and remote revocation.

## 3. Why the original Keychain implementation is rejected

Keychain itself is not the problem. The caller identity is.

Apple Keychain items use ACLs that decide which applications may retrieve an item. If the calling app is not trusted, macOS may prompt the human to Deny, Allow Once, or Always Allow. Apple also documents special treatment for unsigned or invalid applications. An npm CLI executes inside a changing Node/npm process and does not have a stable dongo Developer ID identity.

The attempted implementation invoked generic Apple tools. Trusting `/usr/bin/security` or `/usr/bin/swift` does not establish a dongo security boundary: another process running as the same user can invoke the same generic binary with the discoverable service/account identifiers. It can also generate exactly the sort of unexpected Keychain prompt that users correctly associate with credential theft.

Therefore:

- an unexpected Keychain dialog is a release blocker, not onboarding copy to explain;
- users must never be told to type a Keychain password, click Always Allow, repair an ACL, install a helper, or open Keychain Access for ordinary dongo use;
- dongo will not call a generic system binary to impersonate a first-party credential helper;
- encryption with a key stored beside the encrypted file is rejected as security theater;
- encryption with a key in Keychain has the same unsigned-caller/prompt problem and is rejected for the npm client.

## 4. Threat model

### 4.1 Assets

- short-lived OAuth access token;
- rotating OAuth refresh token;
- exact issuer, resource, client, scope, and token endpoint metadata;
- the non-secret repository marker that selects the matching credential profile.

The refresh token is the highest-value local asset because it can mint new access tokens until expiry, family revocation, or replay detection.

### 4.2 Threats V1 must prevent

- accidental commit of a credential with the repository;
- exposure through command arguments, environment inheritance, terminal output, logs, crash text, browser URLs, or support bundles;
- another local OS user casually reading the credential;
- symlink/path substitution that redirects reads or writes outside dongo's credential directory or into a repository;
- partial/corrupt writes during process termination;
- concurrent refresh commands losing a rotated refresh token;
- a credential from one repository, product origin, environment, API audience, or installation being reused for another;
- restored/stolen stale refresh tokens remaining silently valid;
- a revoked installation continuing to pass resource-server validation;
- an implementation silently changing storage backends or triggering an OS prompt.

### 4.3 Threats V1 cannot prevent with any ordinary npm CLI file store

- malware or another process already running as the same OS user;
- root/administrator access;
- an unlocked, unattended machine;
- memory inspection of a running dongo process;
- compromise of the installed dongo/npm/Node supply chain;
- unencrypted machine backups or disk images made by the user/administrator;
- a hostile kernel, filesystem, or endpoint-management product.

Keychain can improve protection for data at rest and against unrelated processes only when the retrieving client has a trustworthy platform identity. The rejected generic-helper implementation did not provide that property. Full-disk encryption, locked user sessions, encrypted backups, npm provenance, and server-side token controls remain important defenses.

## 5. Credential and repository binding

The credential profile is derived from:

```text
normalized product origin + absolute repository root
```

The derived profile is hashed before becoming a filename. The credential document contains the exact:

- schema version;
- public OAuth client ID;
- issuer;
- API resource/audience;
- token and revocation endpoints;
- short-lived access token and expiry;
- rotating refresh token when `offline_access` was approved;
- approved scope set.

The repository contains only `.agent-work/project.json`, which holds non-secret environment, project, installation, and credential-profile identifiers. Every command validates that marker against compiled environment endpoints and the expected repository-derived profile before loading or transmitting a credential.

Moving/copying a repository to a different absolute root intentionally requires a new connection. Copying only `.agent-work/project.json` never copies authority.

## 6. Filesystem contract

### 6.1 POSIX

The implementation must:

1. create the dongo configuration and credential directories with `0700`;
2. resolve the prospective configuration path against its nearest existing ancestor, reject a repository-local result, then `lstat` and reject a symlink or non-directory at the credential-directory boundary;
3. verify ownership with the current effective user ID;
4. force `0700` after creation in case the process umask or pre-existing mode differs;
5. map the credential profile to a SHA-256 filename so untrusted input never becomes a path;
6. read through a no-follow file descriptor where supported, then verify regular-file type, owner, and exact absence of group/other bits;
7. write a random same-directory temporary file with exclusive creation and `0600`;
8. flush and close the temporary file, then atomically rename over the prior complete version and flush the credential directory where the filesystem supports directory sync;
9. verify the final file remains a regular owner-only file;
10. remove only dongo's exact credential file after successful server revocation.

Temporary files must never be treated as credentials. Recovery may delete only stale dongo-named temporary files in the exact credential directory.

### 6.2 Windows

Node documents that POSIX owner/group/other mode distinctions are not implemented on Windows. dongo must not claim that `0600` provides the same guarantee there.

Windows persistent interactive login remains release-blocked until one of these is implemented and tested on a clean Windows host:

- an owner-only ACL created and then independently verified for `%LOCALAPPDATA%\dongo\credentials`; or
- a stable, signed dongo Credential Manager helper.

WSL follows the POSIX contract only when the credential directory is on the Linux filesystem, not a broadly mounted Windows path. `DONGO_TOKEN` remains available for externally managed non-interactive environments, but is not a substitute for an interactive Windows design.

## 7. OAuth/server controls that make local-file storage acceptable

Local permissions are only one layer. The authorization server and resource server must enforce:

- public-client treatment: no embedded client secret;
- explicit browser consent for one client, one account, one agent-selected project, one exact resource, and one scope set;
- 10-minute access-token lifetime;
- 30-day maximum refresh-token lifetime for V1;
- refresh-token rotation on every refresh;
- zero refresh-token reuse interval and family invalidation/re-authentication on replay;
- exact issuer, RFC 8707 resource/audience, scope, client, project, installation, and expiry checks;
- one independently revocable token family per CLI/MCP host installation;
- immediate server-side installation/grant revocation with no positive introspection cache;
- no scope expansion without fresh browser consent;
- rate limiting and safe audit metadata without tokens or work content.

[RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html) requires public clients that receive refresh tokens to use sender-constrained refresh tokens or refresh-token rotation. dongo V1 uses rotation and replay detection. DPoP/sender-constrained tokens remain a future hardening option; they help only if the private key receives better protection than the token itself.

## 8. User experience contract

Normal output:

```text
Opened https://dev.dongo.so/device?...
Confirm code ABCD-EFGH in the browser.
Connected to Fixture Studio / dongo.
```

Normal output must not say:

- enter a Keychain password;
- approve or repair a credential helper;
- install Swift/Xcode/Secret Service/keyring tooling;
- copy an access or refresh token;
- choose a weaker fallback after an unexplained failure.

`dongo auth status` may report `local-user-file`, the config root, and the non-secret repository marker, but never the credential filename or token. Documentation must plainly say that the file is not encrypted and is protected by the OS user boundary and strict permissions.

If permissions, ownership, file type, schema, issuer, resource, or marker binding is wrong, dongo fails closed with a stable remediation message. It never relaxes permissions, follows a symlink, changes backends, or starts a new device flow merely because one command could not read the credential.

## 9. Lifecycle

### Connect

1. Detect the repository and resolve the exact project proposal/reference.
2. Complete Device Authorization in the external browser.
3. Validate the token response.
4. Create the user credential directory and atomically store the bounded credential.
5. Write the non-secret repository marker.
6. Start a server session and report Connected only when marker, credential, and server context agree.

If local storage fails after browser approval, report that the connection did not complete and store no partial marker/credential. A retry may start a fresh device request; it must not print token material.

### Refresh

1. Acquire the per-profile owner-only refresh lock.
2. Reload the latest complete credential after taking the lock.
3. Reuse an access token only while it has more than the safety window remaining.
4. Exchange the current refresh token exactly once.
5. Atomically persist the rotated refresh token and new access token before releasing the lock.
6. If the response is lost or the rotated credential cannot be persisted, require reauthorization rather than restoring an older refresh token.

The authorization worker also has a release-critical wire-format contract. The
value returned to the CLI is an opaque, prefixed, encrypted token whose
encrypted body is the same value stored (hashed) by the OAuth provider. The
encrypted envelope carries the exact grant context needed to pin the next
access token to its original account, client, resource, project, installation,
and scopes. Refresh decoding restores that request-local context, but returns
the encrypted database token unchanged for lookup. The raw provider token and
grant context are never serialized separately to the client.

The pinned OAuth provider version currently concatenates its configured prefix
with `formatRefreshToken.encrypt(...)` synchronously. An async formatter is
therefore unsafe: JavaScript coerces the unresolved Promise into the literal
string `[object Promise]`, creating a credential that succeeds once and fails
at the first refresh. dongo avoids that upstream boundary by generating the
encrypted database token in the provider's awaited `generateRefreshToken`
hook and keeping the formatting hook synchronous and identity-only. A
regression test asserts the actual prefix + formatter sequence never contains
`[object Promise]`, then decodes the token and proves the exact stored value and
grant are recovered. Malformed or pre-fix development tokens fail as
`invalid_grant` and require a fresh browser connection; they must not cause a
worker 500 or be migrated because their missing grant context cannot be
reconstructed safely.

### Logout

1. Load the current bounded credential.
2. Revoke the refresh family at the exact stored revocation endpoint.
3. Delete the exact local file only after successful revocation.
4. If revocation fails, retain the file so logout can be retried and state does not become falsely reassuring.

### Dashboard revoke

Server revoke blocks the next API request/refresh. The inert local file may remain until `dongo auth logout` or a new `dongo connect` replaces it. `auth status`/`doctor` must report reauthorization required without exposing the rejected credential.

## 10. Migration from development Keychain builds

The Keychain implementation was used only during development and must not become a user migration flow.

- New builds never probe, read, update, delete, or prompt for the old Keychain item.
- There is no automatic Keychain-to-file migration because reading the old entry can itself trigger the suspicious prompt being removed.
- The user denies any lingering prompt and runs one fresh `dongo connect`; the new grant is written directly to the user credential file.
- Old server grants are revoked from dongo installation settings or expire within the bounded refresh lifetime.
- Removing the exact development Keychain item is a separate, explicit maintenance action requiring user approval; it is never required for dongo to function.
- Published release notes state that no public release ever depended on the experimental Keychain entry.

## 11. Acceptance and release gates

### Automated unit/integration

- default interactive storage spawns no credential helper or installer process;
- packed CLI login and three independent follow-up commands produce no Keychain/Secret Service/system prompt;
- credential directory is outside the repository, `0700`, current-user-owned, and not a symlink;
- credential file is a regular current-user-owned `0600` file with an opaque name;
- symlink, directory substitution, wrong ownership, broad permissions, malformed JSON, unsupported schema, issuer/resource mismatch, and marker/profile mismatch fail closed;
- secrets never occur in argv, environment, stdout/stderr, JSON results, errors, logs, snapshots, repository scans, or package metadata;
- interrupted writes leave either the prior complete credential or the next complete credential, never a partial active file;
- simultaneous expired-token commands cause one refresh and all observe the persisted rotation;
- the OAuth provider's real prefix + formatter sequence yields encrypted token material, never `[object Promise]`, and a full expiry/refresh/rotation test passes against the deployed development worker;
- restored/replayed old refresh tokens fail and require reauthorization;
- logout failure retains local state; logout success revokes first and then removes only the exact file;
- `DONGO_TOKEN` takes precedence for CI and causes no credential-file write;
- Windows does not claim POSIX security or ship persistent login until the ACL gate passes.

### Clean-host manual matrix

| Host | Required proof |
| --- | --- |
| macOS clean user | Browser approval → Connected; no Keychain dialog, password prompt, Swift/Xcode install, or Keychain item creation; repeated commands work. |
| Linux desktop | Same flow without Secret Service dependency or desktop keyring prompt. |
| Linux SSH/container | `--no-browser` flow works with the credential directory on the Linux filesystem. |
| Windows | Explicitly blocked until owner-only ACL behavior is implemented and verified. |
| WSL | Passes only on the Linux filesystem and documents the boundary. |

### Operational

- security documentation and `auth status` identify the active storage class honestly;
- revoke, replay, expiry, and token-endpoint alerts use only safe grant/installation identifiers;
- package provenance and no-secret scans pass for the exact immutable CLI artifact;
- support never asks a user to paste a credential, approve a Keychain prompt, or modify a credential file.

## 12. Future signed-helper path

A future native helper is optional, not assumed. Before it can become available it must have:

- Developer ID/code signing and a stable designated requirement on macOS;
- a fixed dongo-owned executable identity, not Node, Swift, `security`, shell, or another generic interpreter;
- versioned stdin/stdout credential-helper protocol with secrets never in argv/env;
- signed update and rollback path;
- clean-install, upgrade, downgrade, path-change, multiple-repository, locked-screen, SSH, and uninstall tests;
- explicit opt-in and a reversible migration that does not leave two active copies;
- no prompt in the normal read/write/refresh path;
- documented behavior when the OS store is locked or unavailable;
- equivalent audited designs for Linux and Windows, or platform-specific availability labels.

Until every gate passes, the signed-helper work cannot change the V1 default.
