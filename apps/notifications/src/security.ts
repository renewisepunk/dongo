const INTERNAL_REQUEST_WINDOW_MS = 60_000;
const encoder = new TextEncoder();

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new Error("invalid_signature_encoding");
  }
  const standard = value.replace(/-/g, "+").replace(/_/g, "/");
  const decoded = atob(standard.padEnd(44, "="));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", ownedArrayBuffer(bytes)),
  );
  return [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyInternalRequest(input: {
  secret: string;
  keyId: string | null;
  timestamp: string | null;
  nonce: string | null;
  signature: string | null;
  method: string;
  pathname: string;
  body: Uint8Array;
  now?: number;
}): Promise<void> {
  if (
    new TextEncoder().encode(input.secret).byteLength < 32 ||
    input.keyId !== "v1"
  ) {
    throw new Error("internal_credentials_unavailable");
  }
  if (
    input.timestamp === null ||
    !/^\d{13}$/.test(input.timestamp) ||
    input.nonce === null ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.nonce,
    ) ||
    input.signature === null
  ) {
    throw new Error("invalid_internal_headers");
  }
  const timestamp = Number(input.timestamp);
  if (Math.abs((input.now ?? Date.now()) - timestamp) > INTERNAL_REQUEST_WINDOW_MS) {
    throw new Error("expired_internal_request");
  }
  const bodyHash = await sha256Hex(input.body);
  const canonical = [
    input.timestamp,
    input.nonce,
    input.method.toUpperCase(),
    input.pathname,
    bodyHash,
  ].join("\n");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(input.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    ownedArrayBuffer(decodeBase64Url(input.signature)),
    encoder.encode(canonical),
  );
  if (!valid) throw new Error("invalid_internal_signature");
}
