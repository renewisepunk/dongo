import { fail } from "../lib/errors";

const MAX_AUTH_RESPONSE_BYTES = 64 * 1_024;

export async function provisionAuthResource(input: {
  projectRef: string;
  projectName?: string;
}): Promise<void> {
  const configuredUrl = process.env.DONGO_AUTH_INTERNAL_URL;
  const secret = process.env.DONGO_INTERNAL_GATEWAY_SECRET;
  if (!configuredUrl || !secret || secret.length < 32) {
    fail("internal", "Auth resource provisioning is not configured", {
      retryable: true,
    });
  }
  let url: URL;
  try {
    url = new URL(configuredUrl);
  } catch {
    fail("internal", "Auth resource provisioning URL is invalid", {
      retryable: true,
    });
  }
  if (
    url.protocol !== "https:" ||
    url.pathname !== "/api/auth/internal/resources"
  ) {
    fail("internal", "Auth resource provisioning URL is not trusted", {
      retryable: true,
    });
  }
  const body = JSON.stringify(input);
  const timestamp = String(Date.now());
  const nonce = crypto.randomUUID();
  const bodyHash = await sha256Hex(new TextEncoder().encode(body));
  const canonical = `${timestamp}\n${nonce}\nPOST\n${url.pathname}\n${bodyHash}`;
  const signature = await hmacBase64Url(secret, canonical);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-dongo-key-id": "v1",
        "x-dongo-timestamp": timestamp,
        "x-dongo-nonce": nonce,
        "x-dongo-signature": signature,
      },
      body,
    });
  } catch {
    fail("internal", "Auth resource provisioning is temporarily unavailable", {
      retryable: true,
    });
  }
  const responseBytes = new Uint8Array(await response.arrayBuffer());
  if (responseBytes.byteLength > MAX_AUTH_RESPONSE_BYTES) {
    fail("internal", "Auth resource provisioning response is too large", {
      retryable: true,
    });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(responseBytes));
  } catch {
    fail("internal", "Auth resource provisioning returned invalid JSON", {
      retryable: true,
      status: response.status,
    });
  }
  if (
    !response.ok ||
    !payload ||
    typeof payload !== "object" ||
    !("ok" in payload) ||
    (payload as { ok?: unknown }).ok !== true
  ) {
    fail("internal", "Auth resource provisioning failed", {
      retryable: response.status >= 500 || response.status === 429,
      status: response.status,
    });
  }
}

export async function sendOtpEmail(input: {
  email: string;
  otp: string;
  type: "sign-in" | "email-verification";
}): Promise<void> {
  const configuredUrl = process.env.DONGO_OTP_EMAIL_URL;
  const secret = process.env.DONGO_INTERNAL_GATEWAY_SECRET;
  if (!configuredUrl || !secret || secret.length < 32) {
    fail("internal", "OTP email delivery is not configured", { retryable: true });
  }
  let url: URL;
  try {
    url = new URL(configuredUrl);
  } catch {
    fail("internal", "OTP email delivery URL is invalid", { retryable: true });
  }
  if (
    url.protocol !== "https:" ||
    url.pathname !== "/api/auth/internal/email/otp"
  ) {
    fail("internal", "OTP email delivery URL is not trusted", { retryable: true });
  }
  const body = JSON.stringify(input);
  const timestamp = String(Date.now());
  const nonce = crypto.randomUUID();
  const bodyHash = await sha256Hex(new TextEncoder().encode(body));
  const canonical = `${timestamp}\n${nonce}\nPOST\n${url.pathname}\n${bodyHash}`;
  const signature = await hmacBase64Url(secret, canonical);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-dongo-key-id": "v1",
        "x-dongo-timestamp": timestamp,
        "x-dongo-nonce": nonce,
        "x-dongo-signature": signature,
      },
      body,
    });
  } catch {
    fail("internal", "OTP email delivery is temporarily unavailable", {
      retryable: true,
    });
  }
  const responseBytes = new Uint8Array(await response.arrayBuffer());
  if (responseBytes.byteLength > MAX_AUTH_RESPONSE_BYTES) {
    fail("internal", "OTP email delivery response is too large", { retryable: true });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(responseBytes));
  } catch {
    fail("internal", "OTP email delivery returned invalid JSON", {
      retryable: true,
      status: response.status,
    });
  }
  if (
    !response.ok ||
    !payload ||
    typeof payload !== "object" ||
    !("ok" in payload) ||
    (payload as { ok?: unknown }).ok !== true
  ) {
    fail("internal", "OTP email delivery failed", {
      retryable: response.status >= 500 || response.status === 429,
      status: response.status,
    });
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", owned.buffer),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacBase64Url(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
  );
  let binary = "";
  for (const byte of signature) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
