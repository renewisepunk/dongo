# Claims, export, attachments, and notifications

## Expired or lost claims

Claims are leases, not permanent ownership. A local agent must renew while actively working. If a lease expires, Dongo closes stale activity, clears the claim, and makes the item reclaimable; the UI must not present it as currently working.

1. Run `dongo session-start --json` to refresh server truth.
2. Fetch the item and compare its current revision and claim status.
3. If reclaimable, start it normally. If another installation owns a live claim, do not bypass it.
4. A stale update or finish must return a conflict/lease error. Re-read, reconcile, and submit a new mutation with a new idempotency key.

Never patch claim rows directly. If reconciliation jobs are failing, inspect recent Convex function logs by safe request ID and recover the scheduler/backend before allowing more autonomous work.

## Repository export conflict or corruption

Convex is authoritative and `.agent-work` export is one-way. `dongo sync` may replace only Dongo-managed generated files; it never imports edits, stages, commits, or pushes.

```sh
dongo doctor --json
dongo sync --json
git status --short -- .agent-work
```

- If a generated file was edited, preserve a copy outside the managed tree, then rerun sync.
- If markers are malformed or a path is a symlink, stop. Do not follow the symlink or force-write through it.
- If cloud mutation succeeded but local write failed, rerun sync; do not repeat the cloud mutation.
- If a filename collision is reported, inspect the source identifiers and exporter version. Do not rename one generated file manually to conceal it.

## Upload or attachment failure

Uploads reserve quota before the browser/native client writes directly to R2. Convex must finalize metadata only after size/checksum validation. Signed links are short-lived and method-, project-, object-, and size-bound.

1. Check `/api/files/healthz` and `/api/files/readyz`.
2. Identify the safe request ID and attachment ID; do not record the signed URL or file contents.
3. Determine whether the reservation is pending, available, abandoned, or expired.
4. For an expired signature, request a new upload/download operation. Never extend or edit a signed URL.
5. For interrupted multipart upload, resume only the same reservation when the client supports it; otherwise abandon it and start a new reservation.
6. If upload reached R2 but finalization failed, the Worker should remove that exact object. Verify cleanup by attachment/storage metadata, not bucket listing exposed to a client.
7. Quota, MIME, size, checksum, or ownership rejection is not retryable until the input is corrected.

Do not proxy large bytes through Convex or the app Worker, attach an unfinalized object, or grant a cross-project signed link.

## Notification failure

Notifications are scheduled from durable Attention events. The dispatcher claims due deliveries, signs a bounded private request to the notification Worker, records the provider result, and retries without creating a second logical delivery.

1. Check `/api/notifications/healthz` and `/api/notifications/readyz`. A live-but-not-ready response means required provider configuration is absent or invalid.
2. Inspect Convex delivery state and Worker logs using safe delivery/request IDs only. Notification payload text is private and must not enter logs.
3. Resolve configuration or provider availability before retrying. Do not mark a delivery sent manually.
4. Re-run the dispatcher; the same logical channel/escalation record must be reused.
5. Resolving the Attention must cancel or no-op any still-pending escalation.

For APNs/FCM token failures, disable or rotate only the affected device subscription. For email failures, verify the configured sender/domain and provider response class without logging recipient content or credentials.
