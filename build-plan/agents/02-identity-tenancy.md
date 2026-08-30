# Agent 02 — Identity and tenancy

## Mission

Implement human authentication integration, organizations, memberships, projects, stable Actors, OAuth grants/installations, device and MCP consent, revocation, roles, non-interactive service credentials, and minimal entitlements.

## Exclusive ownership

- `convex/domains/identity/**`
- `convex/domains/projects/**`
- `convex/domains/credentials/**`
- `convex/domains/installations/**`
- `convex/domains/oauthBindings/**`
- `convex/lib/authz.ts`
- Better Auth domain/configuration fragments supplied to Agent 01
- `apps/web/src/features/auth/**`
- `apps/web/src/features/device-authorization/**`
- `apps/web/src/features/oauth-consent/**`
- `apps/web/src/features/installations/**`
- `apps/web/src/features/onboarding/**`
- `apps/web/src/features/organization-settings/**`
- `apps/web/src/features/project-settings/**`

## Dependencies

- Agent 01’s successful auth/runtime spike and Contract v1.
- Accepted decisions D-06 through D-08 and D-15 through D-17.
- Agent 03’s Principal and Event helper interfaces.

## Tasks

### I-01 — Human principal and Actor lifecycle

- Resolve Better Auth sessions to domain users and organization-scoped human Actors.
- Implement `requireHumanPrincipal`, membership checks, owner checks, and project access checks.
- Reject or ignore caller-supplied tenant/Actor identities.

Acceptance:

- Guessing IDs never crosses an organization or project boundary.
- Member and owner capabilities match the PRD.
- Session restore does not expose protected data before Convex authentication settles.

### I-02 — Organizations, memberships, and projects

- Implement first-login personal organization, onboarding, project creation/select/archive, slugs, repository URL, and `manual | autonomous` execution mode.
- Allocate the project identifier prefix and atomic next WorkItem number source with Agent 03.
- Enforce the free one-active-project entitlement atomically.

Acceptance:

- Concurrent project creation cannot exceed entitlement.
- Archived projects block new agent work and have deterministic UI routing.
- New and returning users reach the expected project.

### I-03 — OAuth grants, installations, and service credentials

- Register the official Dongo CLI as a public native client with Device Authorization and refresh-token grants; it has no client secret.
- In the candidate Better Auth composition, configure `mcp()` as the OAuth Provider and add `oauthDeviceAuthorization()` for the CLI. Do not register a second `oauthProvider()` plugin in the same instance.
- Resolve each approved CLI or MCP grant to one project-scoped installation and stable agent Actor.
- Implement pending/approved/denied/expired/revoked authorization state, grant metadata listing, last-use tracking, refresh-family revocation, and audit Events.
- Revalidate authorizing membership, role, project state, entitlement, client, scopes, and resource at approval and protected-request time. Token claims alone are not current authorization state.
- Keep API/MCP resources and token families distinct. Reject audience substitution and browser-session tokens at agent resources.
- Define and enforce `dongo:work:read`, `dongo:work:write`, and `dongo:attachments:read`; issue `offline_access` only when refresh capability was requested and approved. Scope expansion requires fresh consent.
- Implement static project/service credentials only for explicitly created non-interactive CI installations. Generate high entropy, store only a secure hash, display once, and bind to a separate installation Actor.

Acceptance:

- No access token, refresh token, device code, authorization code, or static credential is persisted in Events, logs, analytics, browser storage, or domain metadata.
- A device approval cannot be replayed, switched to another project, or approved by an unauthorized member.
- A grant or service credential cannot access another project, even in the same organization.
- Revocation or project archival blocks renewal and the next protected request.
- OAuth provider records and Dongo installation bindings cannot disagree silently; reconciliation fails closed.

### I-04 — Auth, approval, consent, and installation UI

- Implement Google OAuth and email OTP states, logout, callback errors, rate-limit feedback, first project, member/project selection, and execution mode.
- Preserve pending Device Authorization or MCP authorization across sign-in and return to the exact approval/consent request.
- Device approval shows the matching terminal/browser code, official CLI client, authorizing account, one selected project, requested access in plain language, Approve/Deny, and an unexpected-request warning.
- MCP consent shows the host/client identity, exact resource, one selected project, scopes, account, Approve/Deny, and safe invalid/expired/unauthorized states.
- Installation management shows client kind, project, scopes/access profile, authorized by, created/last-used time, pending/active/needs-reauth/revoked state, Reauthorize, Doctor guidance, and Revoke.
- Explain that server revocation invalidates access but does not remove local Codex/Claude/CLI configuration. Show separate cleanup instructions.
- Put one-time service credential creation behind an Advanced CI/service section.

Acceptance:

- Browser tests do not require live Google.
- OTP invalid/expired/resend/rate-limit flows are covered.
- OAuth token material never appears in the UI. Device confirmation codes and consent query data are short-lived, non-authorizing by themselves, and never stored persistently.
- Members never see owner-only actions, while the backend remains authoritative.

### I-05 — Entitlement/billing boundary

- Before Web Beta, expose plan and quota state without advertising unimplemented checkout.
- In Wave 5, implement the selected organization-level billing provider/portal boundary.

## Must not do

- Do not build custom RBAC beyond owner/member.
- Do not place authentication or role checks only in the client.
- Do not allow a token label, machine label, or session ID to become authorization identity.
- Do not implement OAuth cryptography or protocol endpoints from scratch when the selected maintained provider can supply them.
- Do not fall back to pairing or a copied bearer token when interactive OAuth fails.
