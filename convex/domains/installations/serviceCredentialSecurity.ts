import { fail } from "../../lib/errors";

const TOKEN_DOMAIN = "dongo-service-credential-v1\n";
const TOKEN_PATTERN = /^dng_svc_([A-Za-z0-9_-]{11})_([A-Za-z0-9_-]{43})$/u;

function signingSecret(): string {
  const secret = process.env.DONGO_INTERNAL_GATEWAY_SECRET;
  if (!secret || new TextEncoder().encode(secret).byteLength < 32) {
    fail("internal", "Service credential signing is not configured", {
      retryable: true,
    });
  }
  return secret;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function hex(bytes: Uint8Array): string {
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function hexBytes(value: string): Uint8Array | undefined {
  if (!/^[a-f0-9]{64}$/u.test(value)) return undefined;
  return Uint8Array.from(
    value.match(/.{2}/gu) ?? [],
    (pair) => Number.parseInt(pair, 16),
  );
}

async function hmacKey(): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  return owned.buffer;
}

export function generateServiceCredentialToken(): {
  token: string;
  tokenPrefix: string;
} {
  const prefixBytes = crypto.getRandomValues(new Uint8Array(8));
  const secretBytes = crypto.getRandomValues(new Uint8Array(32));
  const tokenPrefix = base64Url(prefixBytes);
  const secret = base64Url(secretBytes);
  return { token: `dng_svc_${tokenPrefix}_${secret}`, tokenPrefix };
}

export function serviceCredentialTokenPrefix(
  token: string,
): string | undefined {
  return TOKEN_PATTERN.exec(token)?.[1];
}

export async function hashServiceCredentialToken(
  token: string,
): Promise<string> {
  if (!serviceCredentialTokenPrefix(token)) {
    fail("validation", "Service credential format is invalid");
  }
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      await hmacKey(),
      new TextEncoder().encode(`${TOKEN_DOMAIN}${token}`),
    ),
  );
  return hex(signature);
}

export async function verifyServiceCredentialToken(
  token: string,
  tokenHash: string,
): Promise<boolean> {
  const expected = hexBytes(tokenHash);
  if (!serviceCredentialTokenPrefix(token) || !expected) return false;
  return await crypto.subtle.verify(
    "HMAC",
    await hmacKey(),
    ownedBuffer(expected),
    ownedBuffer(new TextEncoder().encode(`${TOKEN_DOMAIN}${token}`)),
  );
}

