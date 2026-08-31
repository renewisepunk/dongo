# Development alerting and observability

This runbook covers only the development application at `dev.dongo.so`. It does not authorize an account-wide or `dongo.so` production notification policy.

## Runtime coverage

Every development Worker must keep persistent invocation logs enabled at a sampling rate of 1 and persistent traces enabled at a sampling rate from 0.01 through 0.05. CI enforces this with:

```sh
npm run verify:observability
```

The enforced Workers are web, authorization, agent API, MCP, attachments, and notifications. A coherent development deployment must be followed by both public smoke gates. A successful `wrangler tail` probe must show the expected Worker/version and a redacted Authorization header, with no request body, Intake, comment, attachment content, token, signed URL, or raw exception message.

Cloudflare invocation records can contain network metadata such as IP, location, TLS, and user-agent fields. Treat broad tail output as private operational data: filter it in place, never paste it into a work item, and retain only the safe request ID, Worker version ID, route class, status, timing, and outcome needed for diagnosis.

## Required signals

| Signal | Source | Safe correlation | Initial response |
|---|---|---|---|
| Human, CLI, or MCP authentication failures spike | authorization Worker logs/traces and Better Auth result class | request ID plus opaque grant/installation ID | Follow [agent authentication](agent-auth.md); never record email, code, cookie, or token. |
| OAuth discovery, client-metadata, consent, or token failures spike | authorization Worker route class and bounded error code | request ID plus client class | Verify issuer, resource, exact redirect, PKCE, and pinned-client rules before reauthorization. |
| Agent API or MCP mutation failures spike | API/MCP logs/traces and Convex gateway result | request ID plus operation name and opaque installation ID | Check readiness, dependency status, conflicts, and idempotency replay before retrying. |
| Notification dispatch or provider delivery fails | Convex delivery record and notification Worker | safe delivery ID, provider class, attempt count | Follow [data delivery](data-delivery.md); do not log recipient or message content. |
| Upload initialization, part, completion, or finalization fails | attachment Worker plus Convex attachment metadata | request ID plus attachment ID and phase | Verify exact-object cleanup and reservation state without exposing the signed capability. |
| A development deployment fails or a readiness gate regresses | CI/deploy job, Worker version, and smoke gates | commit, job ID, Worker version ID | Stop promotion and follow [deployment and rollback](deploy-rollback.md). |

An alert is useful only when it names one of these safe signals, has an owner and destination, deduplicates repeated failures, and links to the relevant runbook. A dashboard graph without routing is observability evidence, not alert coverage.

## Cloudflare notification-policy boundary

Cloudflare notification policies are account or zone resources. Cloudflare's native HTTP traffic alerts cannot currently isolate one hostname or path, so an error-rate policy for the `dongo.so` zone would mix development and production traffic. Do not create that broad policy as a substitute for a development-only application alert.

Listing policies requires `Notifications Read` (or an equivalent account-settings permission); creating or changing one requires `Notifications Write`. Before any policy change:

1. Confirm the active Cloudflare identity is `rene@wisepunk.com` with `npx wrangler whoami`.
2. Use a credential with the minimum Notification permission and keep it outside the repository, shell history, logs, and command arguments.
3. List existing policies through Cloudflare's documented `GET /accounts/{account_id}/alerting/v3/policies` endpoint and preserve unrelated policies.
4. Verify the candidate alert can target development only. If it cannot, stop and use a development-only OpenTelemetry/log destination with its own alert rule instead.
5. Review destination, threshold, deduplication window, and safe payload fields before enabling the policy.
6. Trigger one synthetic bounded failure, observe one notification, resolve it, and record only safe IDs and timestamps.

The normal Wrangler OAuth profile currently used for development Worker deploys does not carry Notifications Read/Write. That is intentional evidence of least privilege, but it means account alert state cannot be claimed as inspected or deployed through that profile.

### Read-only account audit — 2026-08-31

The authenticated Cloudflare dashboard was inspected without changing policy, recipient, product plan, or zone configuration:

- the account contained six unrelated email policies (billing budget and image-transformation types) and no dongo/development policy;
- the complete 54-type notification catalog contained no Workers application-error alert that can filter to `dev.dongo.so` or its readiness paths;
- the only native candidate that can isolate development is `Health Checks status notification`, backed by explicit Health Check resources for the exact development hostname and paths;
- the `dongo.so` Health Checks page reported that Health Checks are provided through Smart Shield and presented `Upgrade to Pro`, so no Health Check or alert was created;
- no broad `dongo.so` HTTP-traffic policy is acceptable because it would mix development and production landing traffic.

Do not upgrade a plan, add a recipient, create a Health Check, or enable a policy without explicit product-owner approval at the point of change. Until an exact development-only external route is approved, use the verified logs/traces plus the repeatable smoke gates for diagnosis, but continue to report alert routing as incomplete. Acceptable completion paths are either: (a) exact `dev.dongo.so` Health Checks plus a transition-only email policy after plan and recipient approval, or (b) a development-only OpenTelemetry/log destination with its own deduplicated alert rule and independently verified delivery.

Cloudflare references: [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/), [Workers Traces](https://developers.cloudflare.com/workers/observability/traces/), [notification-policy API](https://developers.cloudflare.com/api/resources/alerting/subresources/policies/), and [HTTP traffic alert limitations](https://developers.cloudflare.com/notifications/reference/traffic-alerts/).
