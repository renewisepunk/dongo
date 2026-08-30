import type {
  AttachmentFinalizeInput,
  AttachmentFinalizer,
} from "./service.js";

const encoder = new TextEncoder();
const METHOD = "POST";
const PATHNAME = "/internal/attachments/v1/finalize";
const MAX_RESPONSE_BYTES = 64 * 1_024;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface ConvexAttachmentFinalizerOptions {
  readonly convexSiteUrl: URL;
  readonly secret: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly nonce?: () => string;
  readonly timeoutMs?: number;
}

function validateOrigin(value: URL): URL {
  if (
    value.protocol !== "https:" ||
    value.username !== "" ||
    value.password !== "" ||
    value.pathname !== "/" ||
    value.search !== "" ||
    value.hash !== ""
  ) throw new Error("Convex site URL must be an HTTPS origin");
  return new URL(value);
}

function base64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function boundedText(response: Response): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel("Finalize response exceeded its limit");
      throw new Error("Attachment finalize response is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function validSuccess(value: unknown, requestId: string, attachmentId: string): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const envelope = value as Record<string, unknown>;
  if (
    envelope.ok !== true ||
    envelope.apiVersion !== "v1" ||
    envelope.requestId !== requestId ||
    envelope.data === null ||
    typeof envelope.data !== "object" ||
    Array.isArray(envelope.data)
  ) return false;
  const data = envelope.data as Record<string, unknown>;
  return data.attachmentId === attachmentId && data.status === "available";
}

/**
 * Signs a one-time internal finalize request. This secret is never exposed to
 * browsers and is intentionally separate from the attachment URL secret.
 */
export class ConvexAttachmentFinalizer implements AttachmentFinalizer {
  readonly #endpoint: URL;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #nonce: () => string;
  readonly #timeoutMs: number;
  readonly #hmacKey: Promise<CryptoKey>;

  constructor(options: ConvexAttachmentFinalizerOptions) {
    this.#endpoint = new URL(PATHNAME, validateOrigin(options.convexSiteUrl));
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? Date.now;
    this.#nonce = options.nonce ?? (() => crypto.randomUUID());
    this.#timeoutMs = options.timeoutMs ?? 20_000;
    if (Number.isSafeInteger(this.#timeoutMs) === false || this.#timeoutMs <= 0) {
      throw new Error("Finalize timeout must be a positive integer");
    }
    const secretBytes = encoder.encode(options.secret);
    if (
      options.secret.length < 32 ||
      secretBytes.byteLength < 32 ||
      secretBytes.byteLength > 4_096
    ) throw new Error("Internal gateway secret is invalid");
    this.#hmacKey = crypto.subtle.importKey(
      "raw",
      secretBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
  }

  async finalize(input: AttachmentFinalizeInput): Promise<void> {
    const timestamp = String(this.#now());
    const nonce = this.#nonce();
    if (/^\d{13}$/u.test(timestamp) === false || UUID.test(nonce) === false) {
      throw new Error("Internal gateway clock or nonce is invalid");
    }
    const body = JSON.stringify({
      version: 1,
      requestId: input.requestId,
      input: {
        attachmentId: input.attachmentId,
        observedByteSize: input.observedByteSize,
        observedMimeType: input.observedMimeType,
        ...(input.observedChecksumSha256 === undefined
          ? {}
          : { observedChecksumSha256: input.observedChecksumSha256 }),
      },
    });
    const bodyBytes = encoder.encode(body);
    const bodyHash = hex(await crypto.subtle.digest("SHA-256", bodyBytes));
    const canonical = `${timestamp}\n${nonce}\n${METHOD}\n${PATHNAME}\n${bodyHash}`;
    const signature = base64Url(
      await crypto.subtle.sign(
        "HMAC",
        await this.#hmacKey,
        encoder.encode(canonical),
      ),
    );
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error("Attachment finalize timed out")),
      this.#timeoutMs,
    );
    try {
      const response = await this.#fetch(this.#endpoint, {
        method: METHOD,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-dongo-key-id": "v1",
          "x-dongo-timestamp": timestamp,
          "x-dongo-nonce": nonce,
          "x-dongo-signature": signature,
        },
        body: bodyBytes,
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      const text = await boundedText(response);
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        throw new Error("Attachment finalize response is invalid");
      }
      if (
        response.ok === false ||
        validSuccess(value, input.requestId, input.attachmentId) === false
      ) throw new Error("Attachment finalize was rejected");
    } finally {
      clearTimeout(timer);
    }
  }
}
