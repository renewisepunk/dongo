# dongo security overview

Last reviewed: 2026-09-01  
Applies to: production at `https://dongo.so`

## The short version

dongo is a work-coordination service, not a repository host, remote shell, background code scanner, or model provider.

The dongo cloud contract has no operation that can list or read repository files, inspect Git history, run a command, read environment variables, or access a developer's home directory. The remote MCP server exposes 18 fixed work-management operations. The CLI may inspect limited repository metadata locally and may write a deterministic `.agent-work` export locally, but neither action gives the dongo service general access to the repository.

This is a **zero repository-content ingestion by default** model. It is not a blanket zero-data-retention claim. dongo retains the structured work data that makes the product useful, the repository URL when supplied as project metadata, account and authorization records, and files that a human explicitly attaches.

## What crosses the cloud boundary

| Data | Sent to dongo? | Why |
| --- | --- | --- |
| Work titles, goals, comments, status, attention requests, actor identity, and artifacts | Yes | These are the shared coordination record. |
| Repository URL | Optional | Identifies the project and helps local setup. It does not grant repository access. |
| Files or images | Only when explicitly attached | Supports human–agent review and evidence. |
| OAuth installation, scope, project, and revocation metadata | Yes | Authorizes and audits each CLI or MCP installation. |
| Repository source, diffs, uncommitted edits, Git objects, local paths, shell history, environment variables, and secrets | No automatic path exists | These stay on the agent host unless a user or agent deliberately pastes them into work text or uploads them as an attachment. |

## Security properties implemented today

- **One project per grant.** Every interactive CLI or MCP installation receives its own grant, actor, scopes, and exact project resource.
- **OAuth boundary validation.** The MCP gateway requires HTTPS discovery, PKCE-capable authorization metadata, exact issuer, expiry, exact audience/resource, allowed scopes, active grant, and matching project on every authenticated request.
- **No bearer-token passthrough.** The inbound OAuth token is introspected at the authorization boundary and is never forwarded to Convex or another downstream service. Internal calls use a short-lived, signed request context.
- **Immediate server revocation.** The gateway performs live introspection without a positive token cache. A revoked installation fails its next authenticated request.
- **Independent agent identity.** CLI and MCP installations act as their own agents. They do not impersonate the human who approved them.
- **Bounded MCP capability.** The public MCP catalog contains work, attention, comment, snapshot, and explicit attachment-read operations. It contains no shell, filesystem, Git, browser, repository-provider, or arbitrary network tool.
- **Private CLI credential file.** Interactive CLI credentials live outside the repository in a dongo-owned user directory. On POSIX systems the directory and file are restricted to `0700` and `0600`; unsafe ownership, type, symlink, permission, or project binding fails closed. The CLI does not invoke macOS Keychain or a credential helper.
- **Explicit attachment access.** Attachment bytes live in Cloudflare R2. dongo returns a five-minute, signed download URL only after a project and scope check; the MCP gateway does not proxy the bytes.
- **Environment isolation.** Development and production use separate hostnames, OAuth issuers, resources, secrets, Workers, R2 buckets, and Convex deployments. A development token is not accepted in production.
- **Content-safe operational events.** MCP application events record operation name, request ID, project ID, outcome, duration, and error class—not tool input, output, work text, attachment content, bearer tokens, or raw exception messages.
- **Automated release checks.** CI rejects likely committed secrets and raw exception messages in runtime logs, verifies the generated agent contract, and runs authentication, authorization, tenant-isolation, attachment, and cross-environment boundary tests.

## Data retention: precise claims

dongo's present retention model is described in [Data and retention](data-and-retention.md). The important distinction is:

- repository source and local machine data are not collected by the service by default;
- shared work records are persistent product data;
- finalized attachments are retained with the linked work record;
- OAuth and installation records are retained to support active access and revocation history; and
- Cloudflare Workers invocation logs and sampled traces are retained by Cloudflare for the plan-defined window, currently up to seven days.

dongo does not currently offer customer-configurable retention windows, a self-service project-erasure flow, customer-managed encryption keys, or a contractual deletion SLA. Do not represent the current service as universal zero data retention.

## Infrastructure and subprocessors

Production currently uses:

- **Cloudflare Workers** for the public web, authorization, API, MCP, attachment, and notification edge services;
- **Cloudflare D1** for OAuth server state;
- **Cloudflare R2** for explicitly uploaded attachment bytes;
- **Convex** for accounts, organizations, projects, work records, comments, attention, installation bindings, and attachment metadata;
- **Cloudflare Email Service** for one-time-code email;
- **Resend** for attention notification email; and
- **Google OAuth** when a user chooses Google sign-in.

Cloudflare states that R2 objects and metadata are encrypted at rest with AES-256 and protected in transit with TLS. Convex states that customer data is encrypted at rest and in transit and that Convex is SOC 2 Type II compliant. Those provider controls support dongo's infrastructure; they do **not** make dongo itself SOC 2 or ISO 27001 certified.

## Current assurance level

The production implementation, tests, security documentation, and release evidence are public and inspectable. dongo does not currently claim:

- SOC 2, ISO 27001, HIPAA, PCI DSS, or another independent certification for dongo itself;
- an independent penetration test of the complete dongo service;
- SAML SSO, SCIM provisioning, enterprise role customization, or customer SIEM export;
- customer-selected data residency or dedicated single-tenant infrastructure;
- customer-managed encryption keys;
- a signed data-processing agreement or published dongo subprocessor change policy; or
- configurable retention and guaranteed deletion timelines.

Teams whose policy requires any of those controls should treat them as blockers until dongo provides the required evidence or contract.

## Detailed documents

- [Architecture and tenant isolation](architecture-and-isolation.md)
- [Data and retention](data-and-retention.md)
- [Security policy and private reporting](../../SECURITY.md)
- [Production release evidence](../release/production-launch-2026-08-31.md)
- [Agent authorization runbook](../runbooks/agent-auth.md)
- [CLI credential-storage threat model](../../build-plan/07-cli-credential-storage.md)

## External standards and provider evidence

- [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
- [RFC 9728: OAuth 2.0 Protected Resource Metadata](https://www.rfc-editor.org/rfc/rfc9728)
- [Cloudflare R2 data security](https://developers.cloudflare.com/r2/reference/data-security/)
- [Cloudflare Workers Logs retention](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
- [Convex platform security](https://www.convex.dev/security)

