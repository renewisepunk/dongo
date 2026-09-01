# Data and retention

Last reviewed: 2026-09-01

## Retention matrix

| Data class | Stored by dongo | Current retention and control |
| --- | --- | --- |
| Repository source, diffs, Git objects, uncommitted edits, local paths, environment variables, shell history | No, not by default | The cloud contract has no operation that can collect these. A user or agent can still deliberately paste repository content into a work record or upload it as a file. |
| Repository URL | Optional project metadata | Retained with the project. A URL containing credentials is rejected. |
| Intake, work titles and goals, comments, status, attention, run summaries, artifacts, and actor attribution | Yes, in Convex | Persistent product state. Current v1 has no configurable retention window or self-service project-erasure flow. Treat it as retained until dongo supplies an explicit deletion process. |
| Account, organization, membership, and project metadata | Yes, in Convex and the authentication component | Persistent identity and authorization state. Member access can be removed; complete account/project deletion is not self-service in current v1. |
| MCP and CLI installations, scopes, grant bindings, and revocation history | Yes, in Convex and the OAuth service | Active while authorized. Revoked grants stop authorizing requests, but records are retained for state and investigation. |
| Interactive CLI credential | On the user's machine, not in the repository | Stored in an owner-only dongo file until logout, local deletion, expiry without refresh, or replacement. Server-side revocation invalidates it even if the local file remains. |
| MCP-host credential | In the MCP host's credential store | Controlled by that host. dongo maintains the matching server grant and can revoke it independently. |
| Non-interactive service credential | Hashed server record; plaintext shown only at creation | Retained until revoked. Static service credentials are not used for interactive CLI or MCP login. |
| Explicit attachment bytes | Yes, in private Cloudflare R2 | Finalized attachments are retained with the linked work record. Unlinked drafts can be discarded. Available linked attachments have no automatic customer-configurable expiry in current v1. |
| Pending upload reservations | Metadata in Convex; bytes may exist in R2 after upload begins | Reservation expires after one hour and metadata is reconciled every 15 minutes. Failed or cancelled paths attempt exact-object deletion. Current v1 does not publish a guaranteed orphan-object deletion SLA. |
| Attachment download capability | Returned to an authorized caller | Signed URL expires after five minutes and is scoped to one attachment object. URLs must never be committed, logged by application code, or posted in work comments. |
| MCP custom application events | Cloudflare Workers Logs | Operation/request/project identifiers, outcome, timing, and error class only. No tool input/output or work/attachment content. |
| Provider invocation logs and sampled traces | Cloudflare Workers observability | Provider-defined request/response metadata. Cloudflare documents three days on Workers Free and seven days on Workers Paid, with a maximum of seven days. |
| Email one-time codes and attention notifications | Processed by Cloudflare Email Service or Resend | Subject to the provider's service data handling. dongo does not publish a separate contractual retention period for provider email telemetry today. |
| Google sign-in metadata | Processed by Google OAuth and stored in the authentication component | Used only when the user selects Google sign-in. Account linking requires the local email to be verified and does not allow different-email linking. |

## What “zero retention” can safely mean

dongo can accurately promise that **repository contents are not ingested or retained by default** because the cloud API has no repository-reading capability. This is a technical boundary, not a policy preference.

dongo cannot accurately promise zero retention for all data. It is a shared tracker, so work records must persist across human and agent sessions. An explicitly attached screenshot or file also becomes stored project data. Any sales, security, or product language must preserve this distinction.

## Customer responsibility

Agents operate with the local permissions granted by their host. A connected agent can choose to include source excerpts, logs, URLs, or files in dongo comments and attachments. Teams should configure agent instructions and repository policies so secrets, regulated data, private source, and unnecessary personal data are not copied into the tracker.

If sensitive data is posted accidentally:

1. revoke the affected CLI or MCP installation if a credential may be involved;
2. do not repost the content in an issue or security report;
3. use private vulnerability reporting if the incident indicates a product boundary failure; and
4. treat current v1 work records and linked attachments as persistent until an explicit deletion workflow is available.

## Encryption and provider controls

All public production endpoints use HTTPS. Cloudflare documents automatic AES-256 encryption at rest for R2 objects and metadata and TLS in transit. Convex documents encryption at rest and in transit for customer data. OAuth server secrets and internal signing keys are deployment secrets, not source-controlled values.

Provider security and compliance certifications apply to those providers. They do not transfer to dongo as a product, and dongo does not currently claim its own independent certification.

## Roadmap controls required for compliance-heavy adoption

Before claiming enterprise retention or regulated-workload readiness, dongo needs:

- self-service project and account deletion with attachment-object deletion;
- a documented deletion SLA, backup behavior, and verified purge evidence;
- configurable work and attachment retention policies;
- a published subprocessor list and change-notification policy;
- a dongo data-processing agreement and security addendum;
- customer data-residency controls where required;
- SAML SSO, SCIM, enterprise role policy, and auditable administrator events;
- customer audit-log export and SIEM integration;
- independent penetration testing; and
- an appropriate independent assurance program such as SOC 2.

