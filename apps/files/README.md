# dongo attachment edge

Private Cloudflare R2 edge for development attachments. The bucket has no
public listing or public R2 domain; objects are reachable only through the
`ATTACHMENTS` Worker binding and signed URLs under
`https://dev.dongo.so/api/files/*`.

## Routes

- `GET /api/files/healthz`
- `GET /api/files/readyz`
- `GET /api/files/download/{attachmentId}` verifies the exact Convex download
  signature and streams the R2 object as a safe attachment.
- `PUT /api/files/upload/{attachmentId}` verifies the method-, key-, expiry-,
  size-, MIME-, and optional SHA-256-bound Convex signature, streams directly
  to R2, and finalizes the reservation through the private Convex gateway.
- `POST /api/files/multipart/{attachmentId}` exchanges a signed create
  capability for one short-lived, upload-ID-bound multipart session.
- `PUT /api/files/multipart/{attachmentId}/parts/{partNumber}` accepts only
  the exact signed part geometry; `POST .../complete` validates the ordered
  part list and finalizes; `DELETE /api/files/multipart/{attachmentId}` aborts
  that exact R2 upload and removes any completed object.

There is deliberately no object listing route and no browser-callable finalize
route. Browser CORS is restricted to `https://dev.dongo.so`. Every valid
download, upload, delete, and multipart capability is rate-limited by action
and attachment before R2 access. Invalid signatures do not consume a valid
capability's allowance, and limiter failure returns `503` without touching R2.

## Required configuration

Wrangler config binds the development-only `dongo-dev-attachments` R2 bucket
and the `wandering-camel-662` Convex development HTTP Actions origin. The
`FILES_RATE_LIMITER` namespace allows 180 requests per attachment/action per
minute, enough for the bounded 64-part upload plus retries. Set both
dashboard-managed Worker secrets before deployment:

```sh
npx wrangler secret put DONGO_ATTACHMENT_URL_SIGNING_SECRET --config apps/files/wrangler.jsonc
npx wrangler secret put DONGO_INTERNAL_GATEWAY_SECRET --config apps/files/wrangler.jsonc
```

The first secret must match Convex's attachment URL signer. The second must
match Convex's internal replay-safe gateway. Never put either value in source
or `wrangler.jsonc`. Health reports `serving: false`, readiness returns `503`,
and uploads return `503` when either boundary is unavailable.

Convex development configuration must use:

```text
DONGO_ATTACHMENT_UPLOAD_BASE_URL=https://dev.dongo.so/api/files/upload
DONGO_ATTACHMENT_DOWNLOAD_BASE_URL=https://dev.dongo.so/api/files/download
```

## Signed URL contracts

Download query:

```text
expires={Unix milliseconds}
key={base64url(UTF-8 storageKey)}
signature={base64url(HMAC-SHA256(secret,
  attachmentId + "\n" + storageKey + "\n" + expires))}
```

Upload query:

```text
expires={Unix milliseconds}
key={base64url(UTF-8 storageKey)}
maxBytes={exact Content-Length}
mime={base64url(UTF-8 exact Content-Type)}
checksum={optional lowercase SHA-256 hex}
signature={base64url(HMAC-SHA256(secret,
  "PUT\n" + attachmentId + "\n" + storageKey + "\n" + expires + "\n" +
  maxBytes + "\n" + mimeType + "\n" + (checksum || "")))}
```

The upload rejects absent/chunked `Content-Length` and requires it to equal the
signed byte count. When a checksum is signed, the browser must send the exact
`x-dongo-content-sha256` value and R2 independently verifies the object bytes.

Files through 32 MiB use the single-upload contract. Larger files use 8 MiB
R2 multipart parts (the final part may be smaller), keeping every Worker
request below the normal account request-size limit while supporting retry of
an individual part. The signed create capability binds the storage key, exact
total bytes, MIME type, part size, part count, and one-hour expiry. The Worker
then issues a second HMAC capability additionally bound to R2's opaque upload
ID. Completion is retry-safe: if R2 already completed the upload, the Worker
accepts only an exact attachment-owned object with the signed byte size before
replaying the idempotent Convex finalizer.

An explicit client cancel aborts the R2 multipart upload before releasing its
Convex reservation. If the create response is lost before the client learns
the upload ID, Convex releases the quota reservation after one hour and R2
automatically aborts the empty/incomplete multipart upload under its lifecycle
policy. No session capability is persisted in the repository or application
logs.

After R2 accepts the stream, the Worker signs a one-time `POST` to
`/internal/attachments/v1/finalize` using `DONGO_INTERNAL_GATEWAY_SECRET` and
the common internal HMAC v1 headers. No bearer credential reaches this edge or
the internal gateway.

Downloads use `Content-Disposition: attachment`, `nosniff`, restrictive CSP,
same-origin resource policy, private/no-store caching, bounded object metadata,
and streamed bodies. The current signed upload contract does not carry the
original filename, so the edge uses a safe attachment-ID fallback unless R2
metadata already contains a trusted filename.

## Verification

```sh
npm --prefix apps/files test
npm --prefix apps/files run check
npx wrangler deploy --dry-run --config apps/files/wrangler.jsonc
```

No deployment command is part of the package.
