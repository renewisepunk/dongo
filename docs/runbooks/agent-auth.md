# Agent authentication and host recovery

## CLI device authorization

Expected flow:

```sh
dongo connect --environment development --origin https://dev.dongo.so
dongo auth status --json
dongo doctor --json
```

The terminal opens one `verification_uri_complete` link, displays a comparison code, and polls. The browser must show the same code, dongo CLI client, intended account, project, API resource, and requested scopes. Approval is not connection: the terminal reports success only after secure credential storage, repository marker creation, and doctor checks pass.

For SSH/headless use, add `--no-browser` and open the printed complete link on a trusted browser. Never send the code or link to another person and never substitute a copied bearer token.

### Pending, slow, denied, or expired

- `authorization_pending` is normal; leave the process running.
- `slow_down` must increase the polling interval. Repeated `slow_down` after the client has backed off indicates an authorization-server regression.
- `access_denied` stores nothing. Confirm the user deliberately denied it, then start a new request if needed.
- `authorization_expired` stores nothing. Run `dongo connect` again; never reuse the old code.
- If the browser says Approved but the terminal fails, run `dongo auth status --json` and `dongo doctor --json`. Do not approve a second installation until the first result is understood.

### Credential-file or marker failure

The npm CLI uses only its dongo-owned user credential directory. On macOS/Linux it requires an owner-only `0700` directory and owner-only `0600` regular file outside the repository. It does not use Keychain, Secret Service, an installer, or a generic helper; any such prompt is unexpected and must be denied and reported as a release-blocking regression.

Do not move the credential into the repository, relax permissions, follow a symlink, edit token JSON, restore an older credential from backup, or substitute a copied token. A wrong owner, broad mode, non-regular file, symlink, malformed schema, issuer/resource mismatch, or repository-profile mismatch fails closed. Follow the migration and threat model in `build-plan/07-cli-credential-storage.md`.

`.agent-work/project.json` is non-secret and may be recreated by a new successful `dongo connect`. Before replacing it, verify the repository root and remove only the dongo-owned marker. Never remove `.git`, unrelated `.agent-work` data, or credential-store entries by hand. Use:

```sh
dongo auth logout --json
dongo connect --environment development --origin https://dev.dongo.so
```

Logout revokes server access before local deletion. If revocation fails, local material is intentionally retained so logout can be retried.

## Revoked, expired, or replayed tokens

- A revoked installation must fail on its next API or MCP request; introspection is deliberately not positively cached.
- An expired access token should refresh once using the stored refresh family.
- Refresh replay or family revocation requires a new authorization. Do not restore an old refresh token from backup or another machine.
- Revoke only the affected installation from **Project settings → Agent access**. CLI, Codex, Claude, and generic MCP grants must remain independent.

Confirm recovery with `dongo doctor --json` and `dongo session-start --json`. Safe output may include installation/project identifiers and request IDs, but never token material.

## MCP discovery and OAuth login

For project ref `<project-ref>`, the exact development resource is:

```text
https://dev.dongo.so/p/<project-ref>/mcp
```

Unauthenticated access must return `401` with a `resource_metadata` link. Verify discovery without credentials:

```sh
curl -i https://dev.dongo.so/p/<project-ref>/mcp
curl -fsS https://dev.dongo.so/.well-known/oauth-protected-resource/p/<project-ref>/mcp
curl -fsS https://dev.dongo.so/.well-known/oauth-authorization-server/api/auth
```

The protected-resource document must identify the exact MCP URL, authorization server `https://dev.dongo.so/api/auth`, and the supported dongo scopes. A resource, issuer, redirect, PKCE, client, project, or scope mismatch must be repaired at discovery/configuration; never weaken validation.

Preview host changes first:

```sh
dongo integrate codex
dongo integrate claude
dongo integrate generic
```

Apply only after reviewing the exact files:

```sh
dongo integrate codex --apply
dongo integrate claude --apply
```

The installer may alter only its named MCP entry and versioned dongo instruction block. A name collision, malformed marker, symlink target, or unexpected existing URL is a hard stop. Follow the printed rollback steps; do not overwrite unrelated TOML, JSON, `AGENTS.md`, or `CLAUDE.md` content.

After host-native OAuth, call one read-only session-start tool. Then verify one idempotent write using a fresh test work item. If login succeeds but tools fail, compare the exact resource URL and approved scopes before reauthorizing.

Native host loopback callbacks must remain top-level redirects to the host-provided `redirect_uri`. Never embed, probe, proxy, or fetch a localhost callback from the dongo web app: Chrome's Local Network Access protection applies to public-origin fetches, subresources, and subframes that reach loopback and can show the suspicious device-access prompt. Authorization API fetches therefore use `redirect: "manual"` and accept only the provider's JSON continuation; `followOAuthResult` performs the one explicit top-level navigation. The plain final localhost page is served by the host, not dongo, and can only be branded when the host offers an explicit post-callback redirect or customizable callback response.

If Chrome shows “Access other apps and services on this device,” deny it and treat the flow as a release-blocking regression. Do not teach the user to grant that permission. Confirm in DevTools that no `fetch`, XHR, iframe, image, script, preflight, or service-worker request from `dev.dongo.so` targets a loopback address. A single document navigation to the exact registered callback after consent is expected.

### Claude Code CIMD loopback compatibility

Claude Code currently identifies itself with the exact Client ID Metadata Document `https://claude.ai/oauth/claude-code-client-metadata`. That document declares `http://localhost/callback`, while the native CLI binds an available ephemeral port and sends `http://localhost:<port>/callback` in the authorization request. Claude's documented default is a random callback port, and RFC 8252 requires native loopback clients to be able to use an ephemeral port. RFC 8252 recommends an IP literal over `localhost`; this is a compatibility exception for Claude's current behavior, not a general localhost policy.

The authorization Worker may admit the port-bearing URI only when all of these conditions are true:

- the request is for `/api/auth/oauth2/authorize`;
- `client_id` is the exact Claude Code metadata URL above;
- `redirect_uri` is exactly `http://localhost:<1-65535>/callback` with no credentials, query, or fragment;
- the freshly fetched, redirect-free, size-bounded metadata document has the same `client_id` and already declares the portless `http://localhost/callback` URI;
- the normal authorization-code, S256 PKCE, state, resource, scope, consent, expiry, and token-audience checks still pass.

Only that one requested URI is added to the in-memory metadata used for the current authorization server instance. It is not persisted as a wildcard, does not apply to DCR clients or any other CIMD client, and does not permit another host, scheme, path, or portless request. Unit tests must keep every negative case above. If a future Claude release publishes the exact runtime callback or switches to a loopback IP literal, remove this exception after the pinned-host compatibility gate passes.

When Claude reports `invalid_client`, verify that its metadata fetch returned `200 application/json` without redirects. When it reports a redirect mismatch, compare the requested callback shape to the exact rule above; do not add a wildcard or disable exact redirect validation. Complete login with `claude mcp login <name>`, verify `claude mcp get <name>` reports connected, then prove one read and one idempotent write tool. Do not print or retain the authorization URL because it contains short-lived OAuth request material.

## Human/agent auth isolation

Human sign-in runs in the Convex-integrated Better Auth instance. CLI/MCP OAuth runs in the isolated Cloudflare authorization Worker. A signed, short-lived, single-use bridge assertion is the only session handoff. Human browser cookies are not agent credentials, and agent access/refresh tokens are never sent to Convex.

A valid authorization-Worker cookie is not sufficient by itself: it may belong to an account used earlier in the same browser. Before device or MCP authorization reuses that session, the web client mints the current Convex profile assertion and compares its `profileId` with the authorization-Worker session's `convexProfileId` (falling back to the Worker user ID for bridge-created legacy rows). An exact match may continue. A missing or different profile must consume the new assertion and replace the browser's authorization-Worker session before the device request is claimed or a project is selected. Never fall back to “any authenticated Worker session.”

The characteristic mismatch is a consent page that displays the current Convex account while `/dongo/select-project` returns `403`, because the stale Worker cookie and the signed project assertion name different profiles. Treat this as an identity-binding failure, not a project, scope, or redirect error. Verify the two profile IDs, repair the bridge, and restart the short-lived authorization request; do not retry approval blindly or weaken the project-selection check.

If human sign-in works but device/MCP authorization fails, inspect the bridge and authorization Worker. If device/MCP works but Convex human queries fail, inspect the human Better Auth/Convex token path. Do not merge the auth instances, share secrets, or mint a manual token as a workaround.
