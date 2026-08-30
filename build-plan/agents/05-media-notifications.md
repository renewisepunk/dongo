# Agent 05 — Media and notifications

## Mission

Implement secure direct R2 media transfer, quota/retention lifecycle, attachment access, and reliable notification delivery without putting external side effects inside domain transactions.

## Exclusive ownership

- `convex/domains/media/**`
- `convex/domains/notifications/**`
- `convex/lib/mediaPolicy.ts`
- `infra/r2/**`
- `apps/web/src/features/uploads/**`
- `apps/web/src/features/attachments/**`
- `apps/web/src/features/notifications/**`
- media/notification fixtures and co-located tests

Agent 01 composes cron/HTTP/config files. Agent 03 provides the Attention outbox interface. Native device registration contracts are coordinated with Agents 08/09.

## Dependencies

- D-09 and the quota ownership decision.
- Agent 02’s authorization/entitlement interfaces.
- Agent 03’s Attention and Event interfaces.
- Contract v1 upload/download/delivery schemas.

## Tasks

### M-01 — Upload reservation and policy

- Generate opaque object keys and reserve declared bytes atomically.
- Enforce project/org ownership, entitlement, per-file limit, filename normalization, and allowed MIME policy before signing.
- Track pending/finalized/aborted/expired upload state.

Acceptance:

- Concurrent reservations cannot exceed quota.
- Client-selected keys cannot escape their tenant prefix.
- An unfinalized upload cannot be attached to Intake/Work.

### M-02 — Direct and multipart R2 transfer

- Use short-lived presigned PUT for small objects and multipart for large/video objects.
- Implement initiate, sign parts, complete, abort, resume/retry, and narrow CORS.
- Keep upload bytes out of Convex and the web Worker.

Acceptance:

- A 250 MB fixture uses multipart/direct transfer.
- Interrupted parts retry without duplicate Attachment records.
- Expired signatures and altered multipart completions fail safely.
- Tests prove real signing, HEAD, CORS, completion, and download against an isolated R2 prefix.

### M-03 — Finalization, quota, and cleanup

- HEAD the object and verify existence, actual size, metadata/type, and the selected checksum/ETag policy.
- Atomically convert reservation to actual usage and create finalized attachment metadata.
- Expire abandoned reservations/uploads, reconcile orphan records/objects, and implement retention/tombstone behavior.

Acceptance:

- Finalize cannot lie about size, ownership, or object existence.
- Abandoned work releases quota.
- Reconciliation is idempotent and never deletes an object without proven ownership.

### M-04 — Secure downloads and local-agent fetch

- Authorize temporary downloads for humans and project agents.
- Use safe content disposition and prevent active HTML/SVG from rendering inline.
- Return short-lived URL metadata; never persist or log the signed URL.

Acceptance:

- Cross-project callers cannot obtain a URL.
- A revoked/expired grant or CI/service credential, wrong audience, or missing attachment scope cannot obtain a signed download.
- CLI can validate declared size/checksum and choose a safe local path.

### N-01 — Delivery outbox and scheduling

- Create notification delivery records atomically with attention intent.
- Schedule delivery post-commit; external provider calls never occur in the state mutation.
- Implement pending/sending/sent/failed/retry state, provider IDs, deduplication, and terminal failure.

Acceptance:

- Provider failure never rolls back Attention.
- Retry after uncertain response produces one logical delivery.
- Delivery records contain no notification secret or unnecessary work content.

### N-02 — Email and push

- Implement Resend delivery and the important/unresolved T+60 escalation.
- Add device-token registration/disable/rotation contracts for APNs and FCM.
- Keep push payloads limited to IDs needed for deep links.

Acceptance:

- Resolved Attention cancels or no-ops pending escalation.
- Duplicate schedules cannot send duplicate escalation.
- Disabled/rotated device tokens stop receiving pushes.
- Notification payloads contain no private work text.

## Must not do

- Do not proxy large files through Convex or the app Worker.
- Do not trust browser MIME, size, object key, or completion claims.
- Do not store signed URLs in domain records or logs.
- Do not make provider success part of a Convex transaction.
