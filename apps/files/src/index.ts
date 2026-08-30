import {
  createFilesWorker,
  type AttachmentObjectStore,
  type StoreUploadOptions,
  type StoredAttachment,
  type StoredUpload,
} from "./service.js";
import { ConvexAttachmentFinalizer } from "./convex-finalizer.js";

type RuntimeEnv = Env & {
  /** Dashboard-managed Worker secret; never place this value in wrangler.jsonc. */
  readonly DONGO_ATTACHMENT_URL_SIGNING_SECRET?: string;
  /** Dashboard-managed secret shared only with the internal Convex gateway. */
  readonly DONGO_INTERNAL_GATEWAY_SECRET?: string;
};

function hex(value: ArrayBuffer | undefined): string | undefined {
  return value === undefined
    ? undefined
    : [...new Uint8Array(value)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

function validRuntimeSecret(value: string | undefined): value is string {
  if (value === undefined || value.length < 32) return false;
  const byteLength = new TextEncoder().encode(value).byteLength;
  return byteLength >= 32 && byteLength <= 4_096;
}

class R2AttachmentObjectStore implements AttachmentObjectStore {
  constructor(private readonly bucket: R2Bucket) {}

  async get(storageKey: string): Promise<StoredAttachment | null> {
    const object = await this.bucket.get(storageKey);
    if (object === null) {
      return null;
    }
    return {
      body: object.body,
      size: object.size,
      httpEtag: object.httpEtag,
      contentType: object.httpMetadata?.contentType,
      filename: object.customMetadata?.filename,
    };
  }

  async put(
    storageKey: string,
    body: ReadableStream<Uint8Array>,
    options: StoreUploadOptions,
  ): Promise<StoredUpload> {
    const object = await this.bucket.put(storageKey, body, {
      httpMetadata: {
        contentType: options.contentType,
        cacheControl: "private, no-store, max-age=0",
      },
      customMetadata: {
        attachmentId: options.attachmentId,
        ...(options.checksumSha256 === undefined
          ? {}
          : { checksumSha256: options.checksumSha256 }),
      },
      ...(options.checksumSha256 === undefined
        ? {}
        : { sha256: options.checksumSha256 }),
    });
    const checksumSha256 = hex(object.checksums.sha256);
    return {
      size: object.size,
      httpEtag: object.httpEtag,
      ...(checksumSha256 === undefined ? {} : { checksumSha256 }),
    };
  }

  async delete(storageKey: string): Promise<void> {
    await this.bucket.delete(storageKey);
  }

  async ready(): Promise<void> {
    await this.bucket.head("__dongo_files_readiness__");
  }
}

export default {
  async fetch(request: Request, env: RuntimeEnv): Promise<Response> {
    const internalSecret = env.DONGO_INTERNAL_GATEWAY_SECRET;
    const finalizer = validRuntimeSecret(internalSecret)
      ? new ConvexAttachmentFinalizer({
          convexSiteUrl: new URL(env.CONVEX_SITE_URL),
          secret: internalSecret,
        })
      : undefined;
    const worker = createFilesWorker({
      publicOrigin: new URL(env.PUBLIC_ORIGIN),
      allowedBrowserOrigin: env.ALLOWED_BROWSER_ORIGIN,
      attachmentSigningSecret: env.DONGO_ATTACHMENT_URL_SIGNING_SECRET,
      store: new R2AttachmentObjectStore(env.ATTACHMENTS),
      finalizer,
    });
    return worker.fetch(request);
  },
} satisfies ExportedHandler<RuntimeEnv>;

export {
  createFilesWorker,
  verifyDownloadLink,
  verifyUploadLink,
} from "./service.js";
export { ConvexAttachmentFinalizer } from "./convex-finalizer.js";
