const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function encodedJson(value: Record<string, unknown>): string {
  return base64Url(encoder.encode(JSON.stringify(value)));
}

function pemBytes(pem: string): Uint8Array {
  const normalized = pem.replace(/\\n/g, "\n");
  const body = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/=]+$/.test(body)) {
    throw new Error("invalid_private_key");
  }
  const decoded = atob(body);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export async function signEs256Jwt(input: {
  keyId: string;
  issuer: string;
  issuedAt: number;
  privateKeyPkcs8: string;
}): Promise<string> {
  const header = encodedJson({ alg: "ES256", kid: input.keyId });
  const payload = encodedJson({ iss: input.issuer, iat: input.issuedAt });
  const unsigned = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    ownedArrayBuffer(pemBytes(input.privateKeyPkcs8)),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      encoder.encode(unsigned),
    ),
  );
  if (signature.byteLength !== 64) throw new Error("invalid_es256_signature");
  return `${unsigned}.${base64Url(signature)}`;
}

export async function signRs256Jwt(input: {
  issuer: string;
  audience: string;
  scope: string;
  issuedAt: number;
  expiresAt: number;
  privateKeyPkcs8: string;
}): Promise<string> {
  const header = encodedJson({ alg: "RS256", typ: "JWT" });
  const payload = encodedJson({
    iss: input.issuer,
    scope: input.scope,
    aud: input.audience,
    iat: input.issuedAt,
    exp: input.expiresAt,
  });
  const unsigned = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    ownedArrayBuffer(pemBytes(input.privateKeyPkcs8)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key,
      encoder.encode(unsigned),
    ),
  );
  return `${unsigned}.${base64Url(signature)}`;
}
