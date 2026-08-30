import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { ConvexAttachmentFinalizer } from "../src/convex-finalizer.js";

const SECRET = "internal-gateway-test-secret-longer-than-thirty-two-bytes";
const NOW = 2_000_000_000_000;
const NONCE = "123e4567-e89b-42d3-a456-426614174000";

describe("ConvexAttachmentFinalizer", () => {
  it("uses the exact replay-safe HMAC v1 envelope", async () => {
    let observed: Request | undefined;
    const finalizer = new ConvexAttachmentFinalizer({
      convexSiteUrl: new URL("https://example.convex.site"),
      secret: SECRET,
      now: () => NOW,
      nonce: () => NONCE,
      fetch: async (input, init) => {
        observed = new Request(input, init);
        return Response.json({
          ok: true,
          data: { attachmentId: "attachment_123", status: "available" },
          requestId: "request-123",
          apiVersion: "v1",
        });
      },
    });

    await finalizer.finalize({
      requestId: "request-123",
      attachmentId: "attachment_123",
      observedByteSize: 5,
      observedMimeType: "text/plain",
      observedChecksumSha256:
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    });

    assert.ok(observed);
    assert.equal(observed.url, "https://example.convex.site/internal/attachments/v1/finalize");
    assert.equal(observed.method, "POST");
    const body = await observed.clone().text();
    assert.deepEqual(JSON.parse(body), {
      version: 1,
      requestId: "request-123",
      input: {
        attachmentId: "attachment_123",
        observedByteSize: 5,
        observedMimeType: "text/plain",
        observedChecksumSha256:
          "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      },
    });
    const hash = createHash("sha256").update(body).digest("hex");
    const canonical = `${NOW}\n${NONCE}\nPOST\n/internal/attachments/v1/finalize\n${hash}`;
    const expected = createHmac("sha256", SECRET)
      .update(canonical)
      .digest("base64url");
    assert.equal(observed.headers.get("x-dongo-key-id"), "v1");
    assert.equal(observed.headers.get("x-dongo-timestamp"), String(NOW));
    assert.equal(observed.headers.get("x-dongo-nonce"), NONCE);
    assert.equal(observed.headers.get("x-dongo-signature"), expected);
    assert.equal(observed.headers.has("authorization"), false);
  });

  it("rejects non-HTTPS origins, weak secrets, and invalid response envelopes", async () => {
    assert.throws(() => new ConvexAttachmentFinalizer({
      convexSiteUrl: new URL("http://example.convex.site"),
      secret: SECRET,
    }));
    assert.throws(() => new ConvexAttachmentFinalizer({
      convexSiteUrl: new URL("https://example.convex.site"),
      secret: "weak",
    }));
    const finalizer = new ConvexAttachmentFinalizer({
      convexSiteUrl: new URL("https://example.convex.site"),
      secret: SECRET,
      now: () => NOW,
      nonce: () => NONCE,
      fetch: async () => Response.json({
        ok: true,
        data: { attachmentId: "other", status: "available" },
        requestId: "request-123",
        apiVersion: "v1",
      }),
    });
    await assert.rejects(() => finalizer.finalize({
      requestId: "request-123",
      attachmentId: "attachment_123",
      observedByteSize: 5,
      observedMimeType: "text/plain",
    }));
  });
});
