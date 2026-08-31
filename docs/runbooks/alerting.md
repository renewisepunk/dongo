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

## Credential-free development availability monitor

`.github/workflows/dev-availability.yml` is the bounded no-plan-upgrade path for service availability. It runs the existing credential-free `scripts/smoke-dev.mjs` contract against only `https://dev.dongo.so` and project resource `p58de816-dongo` at minutes 17 and 47 of every hour. The schedule intentionally avoids the start of the hour, when GitHub documents that scheduled runs may be delayed under load.

The workflow has read-only repository permission, uses no secret, does not call production, does not write an issue, and cannot expose application content. Its concurrency group does not cancel a prior run, so a later healthy probe cannot erase a failing run before notification. A manual boolean input can deliberately fail only after every live check succeeds; this is the bounded notification-route exercise and never changes dongo or Cloudflare state.

The workflow is not an active alert merely because the file exists. Activation and proof require all of the following:

1. The workflow exists on the repository's default branch and GitHub Actions is enabled.
2. The product owner who creates or activates the scheduled workflow enables GitHub Actions email notifications, preferably **Only notify for failed workflows**.
3. Run the workflow manually with `exercise_failure: true`. Confirm the exact failure-only email arrives and record only its workflow run ID and delivery time.
4. Rerun with `exercise_failure: false` and confirm the exact 14/14 development smoke result.
5. Observe one scheduled run at an off-hour minute before accepting the route.

Scheduled-workflow notifications go to the user who created the workflow, or to the user who later changes its cron schedule or re-enables it. This route therefore has an explicit human owner without adding a repository secret or a Cloudflare-wide recipient. It covers external availability and discovery/readiness regressions. The existing development logs/traces remain the diagnostic source for failure spikes inside healthy services; adding provider-side rate alerts still requires an approved development-only OTel destination.

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

Do not upgrade a plan, add a recipient, create a Health Check, push/activate the scheduled workflow, or enable a policy without explicit product-owner approval at the point of change. Until an exact development-only external route is activated and its delivery is proven, use the verified logs/traces plus the repeatable smoke gates for diagnosis, but continue to report alert routing as incomplete. Acceptable completion paths are: (a) the credential-free GitHub availability workflow plus failure-only email for the external service gate; (b) exact `dev.dongo.so` Health Checks plus a transition-only email policy after plan and recipient approval; or (c) a development-only OpenTelemetry/log destination with its own deduplicated alert rule and independently verified delivery.

References: [GitHub workflow notifications](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs), [GitHub Actions notification settings](https://docs.github.com/en/subscriptions-and-notifications/how-tos/managing-github-actions-notifications), [GitHub scheduled-workflow timing](https://docs.github.com/en/actions/how-tos/troubleshoot-workflows#scheduled-workflows-running-at-unexpected-times), [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/), [Workers Traces](https://developers.cloudflare.com/workers/observability/traces/), [notification-policy API](https://developers.cloudflare.com/api/resources/alerting/subresources/policies/), and [HTTP traffic alert limitations](https://developers.cloudflare.com/notifications/reference/traffic-alerts/).
