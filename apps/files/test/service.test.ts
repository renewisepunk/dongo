import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import {
  createFilesWorker,
  verifyDeleteLink,
  verifyDownloadLink,
  verifyMultipartCreateLink,
  verifyMultipartSessionLink,
  verifyUploadLink,
  type AttachmentFinalizeInput,
  type AttachmentFinalizer,
  type AttachmentObjectStore,
  type FilesRateLimiter,
  type MultipartUploadedPart,
  type StoreUploadOptions,
  type StoredAttachment,
  type StoredUpload,
} from "../src/service.js";

const NOW = 2_000_000_000_000;
const SECRET = "attachment-test-secret-that-is-longer-than-thirty-two-bytes";
const ATTACHMENT_ID = "attachment_123";
const STORAGE_KEY =
  `organizations/org_123/projects/project_123/attachments/${ATTACHMENT_ID}`;
const CHECKSUM =
  "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
const MULTIPART_SIZE = 10 * 1_024 * 1_024 + 3;
const MULTIPART_PART_SIZE = 5 * 1_024 * 1_024;
const MULTIPART_PART_COUNT = 3;
const MULTIPART_UPLOAD_ID = "multipart_upload_123";

function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function sign(value: string): string {
  return createHmac("sha256", SECRET).update(value).digest("base64url");
}

function downloadUrl(overrides?: Readonly<Record<string, string>>): URL {
  const expires = overrides?.expires ?? String(NOW + 5 * 60_000);
  const key = overrides?.key ?? base64Url(STORAGE_KEY);
  const signature = overrides?.signature ??
    sign(`${ATTACHMENT_ID}\n${STORAGE_KEY}\n${expires}`);
  const url = new URL(
    `https://dev.dongo.so/api/files/download/${ATTACHMENT_ID}`,
  );
  url.searchParams.set("expires", expires);
  url.searchParams.set("key", key);
  url.searchParams.set("signature", signature);
  return url;
}

function uploadUrl(
  overrides?: Readonly<Record<string, string | undefined>>,
): URL {
  const expires = overrides?.expires ?? String(NOW + 15 * 60_000);
  const key = overrides?.key ?? base64Url(STORAGE_KEY);
  const maxBytes = overrides?.maxBytes ?? "5";
  const mimeType = overrides?.mimeType ?? "text/plain";
  const mime = overrides?.mime ?? base64Url(mimeType);
  const checksum = overrides !== undefined && "checksum" in overrides
    ? overrides.checksum
    : CHECKSUM;
  const signature = overrides?.signature ?? sign([
    "PUT",
    ATTACHMENT_ID,
    STORAGE_KEY,
    expires,
    maxBytes,
    mimeType,
    checksum ?? "",
  ].join("\n"));
  const url = new URL(
    `https://dev.dongo.so/api/files/upload/${ATTACHMENT_ID}`,
  );
  url.searchParams.set("expires", expires);
  url.searchParams.set("key", key);
  url.searchParams.set("maxBytes", maxBytes);
  url.searchParams.set("mime", mime);
  if (checksum !== undefined) url.searchParams.set("checksum", checksum);
  url.searchParams.set("signature", signature);
  return url;
}

function deleteUrl(
  overrides?: Readonly<Record<string, string>>,
): URL {
  const expires = overrides?.expires ?? String(NOW + 60_000);
  const key = overrides?.key ?? base64Url(STORAGE_KEY);
  const signature = overrides?.signature ?? sign([
    "DELETE",
    ATTACHMENT_ID,
    STORAGE_KEY,
    expires,
  ].join("\n"));
  const url = new URL(
    `https://dev.dongo.so/api/files/upload/${ATTACHMENT_ID}`,
  );
  url.searchParams.set("expires", expires);
  url.searchParams.set("key", key);
  url.searchParams.set("signature", signature);
  return url;
}

function multipartCreateUrl(
  overrides?: Readonly<Record<string, string>>,
): URL {
  const expires = overrides?.expires ?? String(NOW + 60 * 60_000);
  const key = overrides?.key ?? base64Url(STORAGE_KEY);
  const maxBytes = overrides?.maxBytes ?? String(MULTIPART_SIZE);
  const mimeType = overrides?.mimeType ?? "video/quicktime";
  const mime = overrides?.mime ?? base64Url(mimeType);
  const partSize = overrides?.partSize ?? String(MULTIPART_PART_SIZE);
  const partCount = overrides?.partCount ?? String(MULTIPART_PART_COUNT);
  const signature = overrides?.signature ?? sign([
    "MULTIPART_CREATE",
    ATTACHMENT_ID,
    STORAGE_KEY,
    expires,
    maxBytes,
    mimeType,
    partSize,
    partCount,
  ].join("\n"));
  const url = new URL(
    `https://dev.dongo.so/api/files/multipart/${ATTACHMENT_ID}`,
  );
  url.searchParams.set("expires", expires);
  url.searchParams.set("key", key);
  url.searchParams.set("maxBytes", maxBytes);
  url.searchParams.set("mime", mime);
  url.searchParams.set("partSize", partSize);
  url.searchParams.set("partCount", partCount);
  url.searchParams.set("signature", signature);
  return url;
}

function multipartSessionUrl(
  overrides?: Readonly<Record<string, string>>,
): URL {
  const expires = overrides?.expires ?? String(NOW + 60 * 60_000);
  const key = overrides?.key ?? base64Url(STORAGE_KEY);
  const uploadId = overrides?.uploadId ?? MULTIPART_UPLOAD_ID;
  const maxBytes = overrides?.maxBytes ?? String(MULTIPART_SIZE);
  const mimeType = overrides?.mimeType ?? "video/quicktime";
  const mime = overrides?.mime ?? base64Url(mimeType);
  const partSize = overrides?.partSize ?? String(MULTIPART_PART_SIZE);
  const partCount = overrides?.partCount ?? String(MULTIPART_PART_COUNT);
  const signature = overrides?.signature ?? sign([
    "MULTIPART_SESSION",
    ATTACHMENT_ID,
    STORAGE_KEY,
    uploadId,
    expires,
    maxBytes,
    mimeType,
    partSize,
    partCount,
  ].join("\n"));
  const url = new URL(
    `https://dev.dongo.so/api/files/multipart/${ATTACHMENT_ID}`,
  );
  url.searchParams.set("expires", expires);
  url.searchParams.set("key", key);
  url.searchParams.set("uploadId", uploadId);
  url.searchParams.set("maxBytes", maxBytes);
  url.searchParams.set("mime", mime);
  url.searchParams.set("partSize", partSize);
  url.searchParams.set("partCount", partCount);
  url.searchParams.set("signature", signature);
  return url;
}

class FakeStore implements AttachmentObjectStore {
  readonly gets: string[] = [];
  readonly puts: Array<{
    key: string;
    body: string;
    options: StoreUploadOptions;
  }> = [];
  readonly deletes: string[] = [];
  readonly multipartCreates: Array<{ key: string; options: StoreUploadOptions }> = [];
  readonly multipartParts: Array<{
    key: string;
    uploadId: string;
    partNumber: number;
    size: number;
  }> = [];
  readonly multipartCompletes: Array<{
    key: string;
    uploadId: string;
    parts: readonly MultipartUploadedPart[];
  }> = [];
  readonly multipartAborts: Array<{ key: string; uploadId: string }> = [];
  completedObject: StoredUpload | null = null;
  failCompletedMultipartReplay = false;
  readyCalls = 0;
  object: StoredAttachment | null = {
    body: new Response("hello").body!,
    size: 5,
    httpEtag: '"etag-1"',
    contentType: "text/plain; charset=utf-8",
    filename: "résumé\r\nInjected.txt",
  };

  async get(key: string): Promise<StoredAttachment | null> {
    this.gets.push(key);
    return this.object;
  }

  async head(key: string, attachmentId: string): Promise<StoredUpload | null> {
    return key === STORAGE_KEY && attachmentId === ATTACHMENT_ID
      ? this.completedObject
      : null;
  }

  async put(
    key: string,
    body: ReadableStream<Uint8Array>,
    options: StoreUploadOptions,
  ): Promise<StoredUpload> {
    this.puts.push({ key, body: await new Response(body).text(), options });
    return {
      size: options.size,
      httpEtag: '"uploaded-etag"',
      ...(options.checksumSha256 === undefined
        ? {}
        : { checksumSha256: options.checksumSha256 }),
    };
  }

  async createMultipart(
    key: string,
    options: StoreUploadOptions,
  ): Promise<{ uploadId: string }> {
    this.multipartCreates.push({ key, options });
    return { uploadId: MULTIPART_UPLOAD_ID };
  }

  async uploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    body: ReadableStream<Uint8Array>,
  ): Promise<MultipartUploadedPart> {
    const size = (await new Response(body).arrayBuffer()).byteLength;
    this.multipartParts.push({ key, uploadId, partNumber, size });
    return { partNumber, etag: `etag-${partNumber}` };
  }

  async completeMultipart(
    key: string,
    uploadId: string,
    parts: readonly MultipartUploadedPart[],
  ): Promise<StoredUpload> {
    this.multipartCompletes.push({ key, uploadId, parts });
    if (this.completedObject !== null && this.failCompletedMultipartReplay) {
      throw new Error("Multipart upload no longer exists");
    }
    this.completedObject = {
      size: MULTIPART_SIZE,
      httpEtag: '"multipart-etag"',
    };
    return this.completedObject;
  }

  async abortMultipart(key: string, uploadId: string): Promise<void> {
    this.multipartAborts.push({ key, uploadId });
  }

  async delete(key: string): Promise<void> {
    this.deletes.push(key);
  }

  async ready(): Promise<void> {
    this.readyCalls += 1;
  }
}

class FakeFinalizer implements AttachmentFinalizer {
  readonly calls: AttachmentFinalizeInput[] = [];

  async finalize(input: AttachmentFinalizeInput): Promise<void> {
    this.calls.push(input);
  }
}

class FakeRateLimiter implements FilesRateLimiter {
  readonly keys: string[] = [];

  constructor(
    private readonly outcome: "allow" | "deny" | "fail" = "allow",
  ) {}

  async check(key: string): Promise<{ readonly allowed: boolean }> {
    this.keys.push(key);
    if (this.outcome === "fail") throw new Error("rate limiter unavailable");
    return { allowed: this.outcome === "allow" };
  }
}

function fixture(options?: {
  secret?: string;
  finalizer?: AttachmentFinalizer;
  rateLimiter?: FilesRateLimiter;
}) {
  const store = new FakeStore();
  const finalizer = options !== undefined && "finalizer" in options
    ? options.finalizer
    : new FakeFinalizer();
  const worker = createFilesWorker({
    publicOrigin: new URL("https://dev.dongo.so"),
    allowedBrowserOrigin: "https://dev.dongo.so",
    attachmentSigningSecret: options !== undefined && "secret" in options
      ? options.secret
      : SECRET,
    store,
    finalizer,
    rateLimiter: options?.rateLimiter ?? new FakeRateLimiter(),
    now: () => NOW,
  });
  return { worker, store, finalizer };
}

describe("signed attachment link parity", () => {
  it("verifies the exact Convex download signature", async () => {
    assert.deepEqual(
      await verifyDownloadLink(downloadUrl(), ATTACHMENT_ID, SECRET, NOW),
      {
        attachmentId: ATTACHMENT_ID,
        storageKey: STORAGE_KEY,
        expiresAt: NOW + 5 * 60_000,
      },
    );
  });

  it("verifies the method, size, type, and checksum-bound upload signature", async () => {
    assert.deepEqual(
      await verifyUploadLink(uploadUrl(), ATTACHMENT_ID, SECRET, NOW),
      {
        attachmentId: ATTACHMENT_ID,
        storageKey: STORAGE_KEY,
        expiresAt: NOW + 15 * 60_000,
        maximumBytes: 5,
        mimeType: "text/plain",
        checksumSha256: CHECKSUM,
      },
    );
  });

  it("verifies a short-lived method-bound delete signature", async () => {
    assert.deepEqual(
      await verifyDeleteLink(deleteUrl(), ATTACHMENT_ID, SECRET, NOW),
      {
        attachmentId: ATTACHMENT_ID,
        storageKey: STORAGE_KEY,
        expiresAt: NOW + 60_000,
      },
    );
    const tampered = deleteUrl();
    tampered.searchParams.set("expires", String(NOW + 61_000));
    assert.equal(
      await verifyDeleteLink(tampered, ATTACHMENT_ID, SECRET, NOW),
      undefined,
    );
  });

  it("verifies create and session capabilities for the exact multipart shape", async () => {
    assert.deepEqual(
      await verifyMultipartCreateLink(
        multipartCreateUrl(),
        ATTACHMENT_ID,
        SECRET,
        NOW,
      ),
      {
        attachmentId: ATTACHMENT_ID,
        storageKey: STORAGE_KEY,
        expiresAt: NOW + 60 * 60_000,
        maximumBytes: MULTIPART_SIZE,
        mimeType: "video/quicktime",
        partSize: MULTIPART_PART_SIZE,
        partCount: MULTIPART_PART_COUNT,
      },
    );
    assert.deepEqual(
      await verifyMultipartSessionLink(
        multipartSessionUrl(),
        ATTACHMENT_ID,
        SECRET,
        NOW,
      ),
      {
        attachmentId: ATTACHMENT_ID,
        storageKey: STORAGE_KEY,
        uploadId: MULTIPART_UPLOAD_ID,
        expiresAt: NOW + 60 * 60_000,
        maximumBytes: MULTIPART_SIZE,
        mimeType: "video/quicktime",
        partSize: MULTIPART_PART_SIZE,
        partCount: MULTIPART_PART_COUNT,
      },
    );

    const tampered = multipartSessionUrl();
    tampered.searchParams.set("partCount", "4");
    assert.equal(
      await verifyMultipartSessionLink(tampered, ATTACHMENT_ID, SECRET, NOW),
      undefined,
    );
  });

  it("rejects tampering, extra query fields, mismatched keys, and stale links", async () => {
    const tampered = uploadUrl();
    tampered.searchParams.set("maxBytes", "6");
    assert.equal(
      await verifyUploadLink(tampered, ATTACHMENT_ID, SECRET, NOW),
      undefined,
    );

    const extra = downloadUrl();
    extra.searchParams.set("debug", "1");
    assert.equal(
      await verifyDownloadLink(extra, ATTACHMENT_ID, SECRET, NOW),
      undefined,
    );

    const otherKey = STORAGE_KEY.replace(ATTACHMENT_ID, "other_attachment");
    const wrongKey = downloadUrl({
      key: base64Url(otherKey),
      signature: sign(`${ATTACHMENT_ID}\n${otherKey}\n${NOW + 5 * 60_000}`),
    });
    assert.equal(
      await verifyDownloadLink(wrongKey, ATTACHMENT_ID, SECRET, NOW),
      undefined,
    );

    const expired = downloadUrl({ expires: String(NOW) });
    assert.equal(
      await verifyDownloadLink(expired, ATTACHMENT_ID, SECRET, NOW),
      undefined,
    );
  });
});

describe("attachment edge routes", () => {
  it("streams a signed download with safe response headers", async () => {
    const { worker, store } = fixture();
    const response = await worker.fetch(new Request(downloadUrl(), {
      headers: { origin: "https://dev.dongo.so" },
    }));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "hello");
    assert.deepEqual(store.gets, [STORAGE_KEY]);
    assert.equal(response.headers.get("content-type"), "text/plain");
    assert.equal(response.headers.get("content-length"), "5");
    assert.equal(response.headers.get("etag"), '"etag-1"');
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("access-control-allow-origin"), "https://dev.dongo.so");
    const disposition = response.headers.get("content-disposition") ?? "";
    assert.match(disposition, /^attachment;/u);
    assert.equal(disposition.includes("\r"), false);
    assert.equal(disposition.includes("\n"), false);
  });

  it("streams a valid upload to R2 and finalizes it server-to-server", async () => {
    const { worker, store, finalizer } = fixture();
    const response = await worker.fetch(new Request(uploadUrl(), {
      method: "PUT",
      headers: {
        "content-length": "5",
        "content-type": "text/plain",
        origin: "https://dev.dongo.so",
        "x-dongo-content-sha256": CHECKSUM,
      },
      body: new TextEncoder().encode("hello"),
    }));
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
      ok: true,
      attachmentId: ATTACHMENT_ID,
      byteSize: 5,
      etag: '"uploaded-etag"',
    });
    assert.deepEqual(store.puts, [{
      key: STORAGE_KEY,
      body: "hello",
      options: {
        attachmentId: ATTACHMENT_ID,
        size: 5,
        contentType: "text/plain",
        checksumSha256: CHECKSUM,
      },
    }]);
    assert.equal(finalizer instanceof FakeFinalizer, true);
    assert.deepEqual((finalizer as FakeFinalizer).calls, [{
      requestId: response.headers.get("x-request-id"),
      attachmentId: ATTACHMENT_ID,
      observedByteSize: 5,
      observedMimeType: "text/plain",
      observedChecksumSha256: CHECKSUM,
    }]);
  });

  it("supports a signed upload without a checksum", async () => {
    const { worker, store, finalizer } = fixture();
    const response = await worker.fetch(new Request(uploadUrl({ checksum: undefined }), {
      method: "PUT",
      headers: {
        "content-length": "5",
        "content-type": "text/plain",
      },
      body: new TextEncoder().encode("hello"),
    }));
    assert.equal(response.status, 201);
    assert.deepEqual(store.puts[0]?.options, {
      attachmentId: ATTACHMENT_ID,
      size: 5,
      contentType: "text/plain",
    });
    assert.equal((finalizer as FakeFinalizer).calls[0]?.observedChecksumSha256, undefined);
  });

  it("creates, uploads, and completes a bounded multipart object", async () => {
    const { worker, store, finalizer } = fixture();
    const created = await worker.fetch(new Request(multipartCreateUrl(), {
      method: "POST",
      headers: { origin: "https://dev.dongo.so" },
    }));
    assert.equal(created.status, 201);
    const creation = await created.json() as {
      sessionUrl: string;
      partSize: number;
      partCount: number;
    };
    assert.equal(creation.partSize, MULTIPART_PART_SIZE);
    assert.equal(creation.partCount, MULTIPART_PART_COUNT);
    assert.deepEqual(store.multipartCreates, [{
      key: STORAGE_KEY,
      options: {
        attachmentId: ATTACHMENT_ID,
        size: MULTIPART_SIZE,
        contentType: "video/quicktime",
      },
    }]);
    assert.deepEqual(
      await verifyMultipartSessionLink(
        new URL(creation.sessionUrl),
        ATTACHMENT_ID,
        SECRET,
        NOW,
      ),
      {
        attachmentId: ATTACHMENT_ID,
        storageKey: STORAGE_KEY,
        uploadId: MULTIPART_UPLOAD_ID,
        expiresAt: NOW + 60 * 60_000,
        maximumBytes: MULTIPART_SIZE,
        mimeType: "video/quicktime",
        partSize: MULTIPART_PART_SIZE,
        partCount: MULTIPART_PART_COUNT,
      },
    );

    const parts: MultipartUploadedPart[] = [];
    for (let partNumber = 1; partNumber <= MULTIPART_PART_COUNT; partNumber += 1) {
      const size = partNumber < MULTIPART_PART_COUNT ? MULTIPART_PART_SIZE : 3;
      const partUrl = new URL(creation.sessionUrl);
      partUrl.pathname += `/parts/${partNumber}`;
      const response = await worker.fetch(new Request(partUrl, {
        method: "PUT",
        headers: {
          "content-length": String(size),
          "content-type": "application/octet-stream",
          origin: "https://dev.dongo.so",
        },
        body: new Uint8Array(size),
      }));
      assert.equal(response.status, 200);
      const uploaded = await response.json() as MultipartUploadedPart;
      parts.push({
        partNumber: uploaded.partNumber,
        etag: uploaded.etag,
      });
    }
    assert.deepEqual(store.multipartParts.map(({ partNumber, size }) => ({
      partNumber,
      size,
    })), [
      { partNumber: 1, size: MULTIPART_PART_SIZE },
      { partNumber: 2, size: MULTIPART_PART_SIZE },
      { partNumber: 3, size: 3 },
    ]);

    const completeUrl = new URL(creation.sessionUrl);
    completeUrl.pathname += "/complete";
    const completed = await worker.fetch(new Request(completeUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://dev.dongo.so",
      },
      body: JSON.stringify({ parts }),
    }));
    assert.equal(completed.status, 201);
    assert.deepEqual(await completed.json(), {
      ok: true,
      attachmentId: ATTACHMENT_ID,
      byteSize: MULTIPART_SIZE,
      etag: '"multipart-etag"',
    });
    assert.equal(store.multipartCompletes.length, 1);
    assert.equal(finalizer instanceof FakeFinalizer, true);
    assert.deepEqual((finalizer as FakeFinalizer).calls[0], {
      requestId: completed.headers.get("x-request-id"),
      attachmentId: ATTACHMENT_ID,
      observedByteSize: MULTIPART_SIZE,
      observedMimeType: "video/quicktime",
    });

    store.failCompletedMultipartReplay = true;
    const replay = await worker.fetch(new Request(completeUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parts }),
    }));
    assert.equal(replay.status, 201);
    assert.equal(store.multipartCompletes.length, 2);
    assert.equal((finalizer as FakeFinalizer).calls.length, 2);
  });

  it("aborts only the signed multipart upload and rejects malformed completion", async () => {
    const { worker, store } = fixture();
    const session = multipartSessionUrl();
    const malformedComplete = new URL(session);
    malformedComplete.pathname += "/complete";
    const malformed = await worker.fetch(new Request(malformedComplete, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parts: [{ partNumber: 2, etag: "wrong-order" }] }),
    }));
    assert.equal(malformed.status, 400);
    assert.equal(store.multipartCompletes.length, 0);

    const aborted = await worker.fetch(new Request(session, {
      method: "DELETE",
    }));
    assert.equal(aborted.status, 200);
    assert.deepEqual(store.multipartAborts, [{
      key: STORAGE_KEY,
      uploadId: MULTIPART_UPLOAD_ID,
    }]);
    assert.deepEqual(store.deletes, [STORAGE_KEY]);
  });

  it("deletes only the exact object selected by a signed discard", async () => {
    const { worker, store } = fixture();
    const response = await worker.fetch(new Request(deleteUrl(), {
      method: "DELETE",
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      attachmentId: ATTACHMENT_ID,
      deleted: true,
    });
    assert.deepEqual(store.deletes, [STORAGE_KEY]);

    const tampered = deleteUrl();
    tampered.searchParams.set("key", base64Url(
      STORAGE_KEY.replace(ATTACHMENT_ID, "other_attachment"),
    ));
    assert.equal(
      (await worker.fetch(new Request(tampered, { method: "DELETE" }))).status,
      403,
    );
    assert.deepEqual(store.deletes, [STORAGE_KEY]);
  });

  it("deletes the exact R2 object when post-upload finalization fails", async () => {
    const privateFailure =
      "finalization unavailable for owner@example.test with token short-secret";
    const finalizer: AttachmentFinalizer = {
      async finalize() {
        throw new Error(privateFailure);
      },
    };
    const { worker, store } = fixture({ finalizer });
    const logs: string[] = [];
    const originalConsoleError = console.error;
    console.error = (...values: unknown[]) => {
      logs.push(values.map(String).join(" "));
    };
    let response: Response;
    try {
      response = await worker.fetch(new Request(uploadUrl(), {
        method: "PUT",
        headers: {
          "content-length": "5",
          "content-type": "text/plain",
          "x-dongo-content-sha256": CHECKSUM,
        },
        body: new TextEncoder().encode("hello"),
      }));
    } finally {
      console.error = originalConsoleError;
    }

    assert.equal(response.status, 500);
    assert.equal(store.puts.length, 1);
    assert.deepEqual(store.deletes, [STORAGE_KEY]);
    assert.equal(logs.some((line) => line.includes(privateFailure)), false);
    assert.ok(logs.some((line) => line.includes("attachment_upload_finalize_failed")));
  });

  it("does not touch R2 when upload headers or the URL signature mismatch", async () => {
    const { worker, store, finalizer } = fixture();
    const wrongHeaders = await worker.fetch(new Request(uploadUrl(), {
      method: "PUT",
      headers: {
        "content-length": "4",
        "content-type": "text/plain",
        "x-dongo-content-sha256": CHECKSUM,
      },
      body: new TextEncoder().encode("oops"),
    }));
    assert.equal(wrongHeaders.status, 400);

    const tamperedUrl = uploadUrl();
    tamperedUrl.searchParams.set("mime", base64Url("image/png"));
    const tampered = await worker.fetch(new Request(tamperedUrl, {
      method: "PUT",
      headers: {
        "content-length": "5",
        "content-type": "image/png",
        "x-dongo-content-sha256": CHECKSUM,
      },
      body: new TextEncoder().encode("hello"),
    }));
    assert.equal(tampered.status, 403);
    assert.equal(store.puts.length, 0);
    assert.equal((finalizer as FakeFinalizer).calls.length, 0);
  });

  it("rate-limits valid capabilities before R2 access and fails closed", async () => {
    const deniedLimiter = new FakeRateLimiter("deny");
    const deniedFixture = fixture({ rateLimiter: deniedLimiter });
    const invalid = downloadUrl({ signature: "invalid" });
    const invalidResponse = await deniedFixture.worker.fetch(new Request(invalid));
    assert.equal(invalidResponse.status, 403);
    assert.deepEqual(deniedLimiter.keys, []);

    const denied = await deniedFixture.worker.fetch(new Request(uploadUrl(), {
      method: "PUT",
      headers: {
        "content-length": "5",
        "content-type": "text/plain",
        "x-dongo-content-sha256": CHECKSUM,
      },
      body: new TextEncoder().encode("hello"),
    }));
    assert.equal(denied.status, 429);
    assert.equal(denied.headers.get("retry-after"), "60");
    assert.deepEqual(await denied.json(), {
      error: "rate_limited",
      retryable: true,
    });
    assert.deepEqual(deniedLimiter.keys, [`upload:${ATTACHMENT_ID}`]);
    assert.equal(deniedFixture.store.puts.length, 0);
    assert.equal((deniedFixture.finalizer as FakeFinalizer).calls.length, 0);

    const failedLimiter = new FakeRateLimiter("fail");
    const failedFixture = fixture({ rateLimiter: failedLimiter });
    const unavailable = await failedFixture.worker.fetch(new Request(downloadUrl()));
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.headers.get("retry-after"), "30");
    assert.deepEqual(await unavailable.json(), {
      error: "rate_limit_unavailable",
      retryable: true,
    });
    assert.deepEqual(failedLimiter.keys, [`download:${ATTACHMENT_ID}`]);
    assert.deepEqual(failedFixture.store.gets, []);
  });

  it("fails closed when secrets or the finalizer are absent", async () => {
    const { worker, store } = fixture({ secret: undefined, finalizer: undefined });
    const readiness = await worker.fetch(
      new Request("https://dev.dongo.so/api/files/readyz"),
    );
    assert.equal(readiness.status, 503);
    const upload = await worker.fetch(new Request(uploadUrl(), {
      method: "PUT",
      headers: {
        "content-length": "5",
        "content-type": "text/plain",
        "x-dongo-content-sha256": CHECKSUM,
      },
      body: new TextEncoder().encode("hello"),
    }));
    assert.equal(upload.status, 503);
    assert.equal(store.puts.length, 0);
  });

  it("reports readiness only after checking the private R2 binding", async () => {
    const { worker, store } = fixture();
    const health = await worker.fetch(
      new Request("https://dev.dongo.so/api/files/healthz"),
    );
    assert.deepEqual(await health.json(), { status: "ok", serving: true });
    const readiness = await worker.fetch(
      new Request("https://dev.dongo.so/api/files/readyz"),
    );
    assert.equal(readiness.status, 200);
    assert.deepEqual(await readiness.json(), { status: "ready" });
    assert.equal(store.readyCalls, 1);
  });

  it("permits only the development browser origin and bounded CORS headers", async () => {
    const { worker } = fixture();
    const allowed = await worker.fetch(new Request(uploadUrl(), {
      method: "OPTIONS",
      headers: {
        origin: "https://dev.dongo.so",
        "access-control-request-method": "PUT",
        "access-control-request-headers": "content-type, x-dongo-content-sha256",
      },
    }));
    assert.equal(allowed.status, 204);
    assert.equal(
      allowed.headers.get("access-control-allow-origin"),
      "https://dev.dongo.so",
    );

    const forbidden = await worker.fetch(new Request(uploadUrl(), {
      method: "OPTIONS",
      headers: {
        origin: "https://evil.example",
        "access-control-request-method": "PUT",
      },
    }));
    assert.equal(forbidden.status, 403);

    const forbiddenHeader = await worker.fetch(new Request(uploadUrl(), {
      method: "OPTIONS",
      headers: {
        origin: "https://dev.dongo.so",
        "access-control-request-method": "PUT",
        "access-control-request-headers": "authorization",
      },
    }));
    assert.equal(forbiddenHeader.status, 403);
  });

  it("has no listing route and rejects wrong hosts and methods", async () => {
    const { worker } = fixture();
    assert.equal(
      (await worker.fetch(new Request("https://dev.dongo.so/api/files/"))).status,
      404,
    );
    assert.equal(
      (await worker.fetch(new Request(downloadUrl(), { method: "DELETE" }))).status,
      405,
    );
    assert.equal(
      (await worker.fetch(new Request(
        downloadUrl().toString().replace("dev.dongo.so", "other.example"),
      ))).status,
      400,
    );
  });
});
