import { fail } from "../../lib/errors";

const TOKEN_DOMAIN = "dongo-runner-credential-v1\n";
const TOKEN_PATTERN = /^dng_run_([A-Za-z0-9_-]{11})_([A-Za-z0-9_-]{43})$/u;

function signingSecret(): string {
  const secret = process.env.DONGO_INTERNAL_GATEWAY_SECRET;
  if (!secret || new TextEncoder().encode(secret).byteLength < 32) {
    fail("internal", "Runner credential signing is not configured", {
      retryable: true,
    });
  }
  return secret;
}

function hex(bytes: Uint8Array): string {
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function hexBytes(value: string): Uint8Array | undefined {
  if (!/^[a-f0-9]{64}$/u.test(value)) return undefined;
  return Uint8Array.from(value.match(/.{2}/gu) ?? [], (pair) =>
    Number.parseInt(pair, 16));
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  return owned.buffer;
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

export function runnerCredentialTokenPrefix(token: string): string | undefined {
  return TOKEN_PATTERN.exec(token)?.[1];
}

export async function hashRunnerCredentialToken(token: string): Promise<string> {
  if (!runnerCredentialTokenPrefix(token)) {
    fail("validation", "Runner credential format is invalid");
  }
  const signature = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    await hmacKey(),
    new TextEncoder().encode(`${TOKEN_DOMAIN}${token}`),
  ));
  return hex(signature);
}

export async function verifyRunnerCredentialToken(
  token: string,
  tokenHash: string,
): Promise<boolean> {
  const expected = hexBytes(tokenHash);
  if (!runnerCredentialTokenPrefix(token) || !expected) return false;
  return await crypto.subtle.verify(
    "HMAC",
    await hmacKey(),
    ownedBuffer(expected),
    ownedBuffer(new TextEncoder().encode(`${TOKEN_DOMAIN}${token}`)),
  );
}
