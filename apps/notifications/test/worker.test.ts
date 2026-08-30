import { env, exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import type { EmailDeliveryRequest, PushDeliveryRequest } from "../src/contracts";
import {
  deliverApns,
  deliverEmail,
  deliverFcm,
  renderAttentionEmail,
} from "../src/providers";
import { requiredNotificationProviders } from "../src/config";

const deliveryPath = "/api/notifications/v1/deliver";
const dispatchSecret = "test-dispatch-secret-with-at-least-32-characters";

describe("notifications Worker", () => {
  it("fails closed to every provider for an empty or unknown readiness policy", () => {
    expect(requiredNotificationProviders("resend")).toEqual(["resend"]);
    expect(requiredNotificationProviders("resend,apns,fcm")).toEqual([
      "resend",
      "apns",
      "fcm",
    ]);
    expect(requiredNotificationProviders("")).toEqual(["resend", "apns", "fcm"]);
    expect(requiredNotificationProviders("resend,unknown")).toEqual([
      "resend",
      "apns",
      "fcm",
    ]);
  });

  it("reports liveness separately from provider readiness", async () => {
    const health = await exports.default.fetch(
      "https://dev.dongo.so/api/notifications/healthz",
    );
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toMatchObject({
      ok: true,
      service: "notifications",
    });
    const readiness = await exports.default.fetch(
      "https://dev.dongo.so/api/notifications/readyz",
    );
    expect(readiness.status).toBe(503);
    await expect(readiness.json()).resolves.toMatchObject({
      ok: false,
      providers: { dispatch: true, resend: false, apns: false, fcm: false },
      required: ["dispatch", "resend"],
    });
  });

  it("rejects unsigned dispatch and fails closed when a provider is absent", async () => {
    const payload = pushPayload();
    const unsigned = await exports.default.fetch(
      `https://dev.dongo.so${deliveryPath}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    expect(unsigned.status).toBe(401);

    const body = JSON.stringify(payload);
    const timestamp = String(Date.now());
    const nonce = crypto.randomUUID();
    const signature = await signRequest(body, timestamp, nonce);
    const signed = await exports.default.fetch(
      `https://dev.dongo.so${deliveryPath}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dongo-key-id": "v1",
          "x-dongo-timestamp": timestamp,
          "x-dongo-nonce": nonce,
          "x-dongo-signature": signature,
        },
        body,
      },
    );
    expect(signed.status).toBe(503);
    const responseText = await signed.text();
    expect(responseText).toContain("apns_not_configured");
    expect(responseText).not.toContain(payload.pushToken);
  });

  it("escapes email content and sends with a stable Resend idempotency key", async () => {
    const request = emailPayload();
    const rendered = renderAttentionEmail(request);
    expect(rendered.html).toContain("&lt;release&gt;");
    expect(rendered.html).not.toContain("<release>");
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        authorization: "Bearer re_test_key_long_enough",
        "idempotency-key": request.idempotencyKey,
      });
      expect(String(init?.body)).toContain("&lt;release&gt;");
      return Response.json({ id: "email-message-1" }, { status: 200 });
    });
    await expect(
      deliverEmail({
        request,
        config: { apiKey: "re_test_key_long_enough" },
        fromEmail: env.RESEND_FROM_EMAIL,
        fromName: env.RESEND_FROM_NAME,
        fetcher,
      }),
    ).resolves.toEqual({
      ok: true,
      provider: "resend",
      messageId: "email-message-1",
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("signs APNs requests and sends only neutral deep-link identifiers", async () => {
    const privateKeyPkcs8 = await es256PrivateKey();
    const request = pushPayload();
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        `https://api.sandbox.push.apple.com/3/device/${request.pushToken}`,
      );
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toMatch(/^bearer [^.]+\.[^.]+\.[^.]+$/u);
      expect(headers.get("apns-topic")).toBe("so.dongo.dev");
      expect(headers.get("apns-collapse-id")).toBe(request.attentionRequestId);
      expect(JSON.parse(String(init?.body))).toEqual({
        aps: {
          alert: { title: "dongo needs you", body: "Open dongo to respond." },
          sound: "default",
        },
        attentionRequestId: request.attentionRequestId,
        workItemId: request.workItemId,
        projectId: request.projectId,
      });
      return new Response(null, {
        status: 200,
        headers: { "apns-id": "apns-message-1" },
      });
    });
    await expect(deliverApns({
      request,
      config: {
        teamId: "TEAMID1234",
        keyId: "KEYID12345",
        bundleId: "so.dongo.dev",
        environment: "sandbox",
        privateKeyPkcs8,
      },
      fetcher,
      now: 1_787_000_000_000,
    })).resolves.toEqual({
      ok: true,
      provider: "apns",
      messageId: "apns-message-1",
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("exchanges a signed service assertion and sends a neutral FCM payload", async () => {
    const privateKeyPkcs8 = await rs256PrivateKey();
    const request = { ...pushPayload(), platform: "android" as const };
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        const form = new URLSearchParams(String(init?.body));
        expect(form.get("grant_type")).toBe(
          "urn:ietf:params:oauth:grant-type:jwt-bearer",
        );
        expect(form.get("assertion")).toMatch(/^[^.]+\.[^.]+\.[^.]+$/u);
        return Response.json({ access_token: "short-lived-fcm-access" });
      }
      expect(url).toBe(
        "https://fcm.googleapis.com/v1/projects/dongo-dev/messages:send",
      );
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer short-lived-fcm-access",
      );
      expect(JSON.parse(String(init?.body))).toEqual({
        message: {
          token: request.pushToken,
          notification: {
            title: "dongo needs you",
            body: "Open dongo to respond.",
          },
          data: {
            attentionRequestId: request.attentionRequestId,
            workItemId: request.workItemId,
            projectId: request.projectId,
          },
          android: { collapseKey: request.attentionRequestId },
          apns: {
            headers: { "apns-collapse-id": request.attentionRequestId },
          },
        },
      });
      return Response.json({ name: "projects/dongo-dev/messages/fcm-message-1" });
    });
    await expect(deliverFcm({
      request,
      config: {
        projectId: "dongo-dev",
        clientEmail: "notifications@dongo-dev.iam.gserviceaccount.com",
        privateKeyPkcs8,
      },
      fetcher,
      now: 1_787_000_000_000,
    })).resolves.toEqual({
      ok: true,
      provider: "fcm",
      messageId: "projects/dongo-dev/messages/fcm-message-1",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

function pushPayload(): PushDeliveryRequest {
  return {
    version: 1,
    deliveryId: "delivery-1",
    idempotencyKey: "attention:1:push:1",
    channel: "push" as const,
    platform: "ios" as const,
    pushToken: "private-device-token",
    attentionRequestId: "attention-1",
    workItemId: "work-1",
    projectId: "project-1",
    deepLink: "https://dev.dongo.so/app/org/project?work=work-1",
  };
}

async function es256PrivateKey(): Promise<string> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  return privateKeyPem(
    await crypto.subtle.exportKey("pkcs8", pair.privateKey) as ArrayBuffer,
  );
}

async function rs256PrivateKey(): Promise<string> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2_048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  return privateKeyPem(
    await crypto.subtle.exportKey("pkcs8", pair.privateKey) as ArrayBuffer,
  );
}

function privateKeyPem(buffer: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  const lines = btoa(binary).match(/.{1,64}/gu) ?? [];
  const begin = ["-----BEGIN ", "PRIVATE KEY-----"].join("");
  const end = ["-----END ", "PRIVATE KEY-----"].join("");
  return `${begin}\n${lines.join("\n")}\n${end}`;
}

function emailPayload(): EmailDeliveryRequest {
  return {
    version: 1,
    deliveryId: "delivery-2",
    idempotencyKey: "attention:1:email",
    channel: "email",
    email: "owner@example.test",
    attentionRequestId: "attention-1",
    workItemId: "work-1",
    projectId: "project-1",
    deepLink: "https://dev.dongo.so/app/org/project?work=work-1",
    projectName: "dongo <release>",
    workIdentifier: "DON-1",
    workTitle: "Ship safely",
    attentionKind: "decision",
    attentionTitle: "Choose the release path",
  };
}

async function signRequest(
  body: string,
  timestamp: string,
  nonce: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(body);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const bodyHash = [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const canonical = `${timestamp}\n${nonce}\nPOST\n${deliveryPath}\n${bodyHash}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(dispatchSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonical)),
  );
  let binary = "";
  for (const byte of signature) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
