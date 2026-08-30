import { env, exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import type { EmailDeliveryRequest } from "../src/contracts";
import { deliverEmail, renderAttentionEmail } from "../src/providers";

const deliveryPath = "/api/notifications/v1/deliver";
const dispatchSecret = "test-dispatch-secret-with-at-least-32-characters";

describe("notifications Worker", () => {
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
});

function pushPayload() {
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
    projectName: "Dongo <release>",
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
