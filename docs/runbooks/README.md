# dongo operational runbooks

These runbooks cover production at `https://dongo.so` / Convex `brainy-camel-172` and development at `https://dev.dongo.so` / Convex `wandering-camel-662`. They are diagnosis-first: preserve evidence, avoid copying credentials or user content into tickets, and prefer revocation or rollback over manual database repair.

Use [production release and rollback](production-release.md) for live changes. Development remains an independently deployable staging environment.

## First response

1. Record the UTC start time, affected environment, safe request IDs, Worker version IDs, and the failing public route. Never record OTPs, authorization/device codes, access or refresh tokens, signed attachment URLs, Intake text, comments, or attachment contents.
2. Check liveness and readiness separately:

   ```sh
   curl -fsS https://dev.dongo.so/api/auth/healthz
   curl -fsS https://dev.dongo.so/api/auth/readyz
   curl -fsS https://dev.dongo.so/api/agent/v1/healthz
   curl -fsS https://dev.dongo.so/api/agent/v1/readyz
   curl -fsS https://dev.dongo.so/api/mcp/healthz
   curl -fsS https://dev.dongo.so/api/mcp/readyz
   curl -fsS https://dev.dongo.so/api/files/healthz
   curl -fsS https://dev.dongo.so/api/files/readyz
   curl -fsS https://dev.dongo.so/api/notifications/healthz
   curl -fsS https://dev.dongo.so/api/notifications/readyz
   ```

3. Tail only the affected service and filter by safe request ID. Use `npx convex logs --deployment dev` for Convex. Do not paste broad logs into chat or support systems without reviewing them for private content.
4. If a recent deployment is implicated, follow [deployment and rollback](deploy-rollback.md). Otherwise route to [agent authentication](agent-auth.md) or [data delivery](data-delivery.md).

## Ownership map

| Symptom | Runbook |
|---|---|
| CLI device authorization, token refresh, logout, or repository marker | [Agent authentication](agent-auth.md) |
| MCP discovery, OAuth login, scopes, project binding, or host configuration | [Agent authentication](agent-auth.md) |
| New Intake update delivery, expired claims, export conflicts, uploads, attachments, or notifications | [Data delivery](data-delivery.md) |
| Production release, cutover, or live rollback | [Production release and rollback](production-release.md) |
| Development deployment, Worker/Convex outage, migration, or package rollback | [Development deployment and rollback](deploy-rollback.md) |
| Failure-spike detection, alert routing, or observability coverage | [Availability alerting](alerting.md) |

After recovery, run `npm run verify:no-secrets`, `npm run check`, `npm test`, and `npm run build`; then repeat the exact failed public journey.
