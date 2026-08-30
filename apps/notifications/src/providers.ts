import type {
  DeliveryFailure,
  DeliveryResult,
  EmailDeliveryRequest,
  PushDeliveryRequest,
} from "./contracts";
import type { ApnsConfig, FcmConfig, ResendConfig } from "./config";
import { parseJson, readBoundedResponse, requestSignal } from "./http";
import { signEs256Jwt, signRs256Jwt } from "./jwt";

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const FIREBASE_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

function failure(
  code: string,
  retryable: boolean,
  disableDevice = false,
): DeliveryFailure {
  return {
    ok: false,
    error: {
      code,
      retryable,
      ...(disableDevice ? { disableDevice: true } : {}),
    },
  };
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderAttentionEmail(input: EmailDeliveryRequest): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = `Attention still needed for ${input.workIdentifier}`;
  const kind = input.attentionKind[0]!.toUpperCase() + input.attentionKind.slice(1);
  const plain = [
    "Dongo still needs your attention.",
    "",
    `Project: ${input.projectName}`,
    `Work: ${input.workIdentifier} — ${input.workTitle}`,
    `${kind}: ${input.attentionTitle}`,
    "",
    `Open in Dongo: ${input.deepLink}`,
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#08080a;color:#ececee;font-family:Arial,sans-serif"><div style="max-width:600px;margin:0 auto;padding:40px 24px"><p style="font-family:monospace;color:#93939c;letter-spacing:.12em;text-transform:uppercase">Dongo</p><h1 style="font-size:24px;font-weight:600">Attention still needed</h1><p style="color:#93939c;line-height:1.6">${escapeHtml(input.projectName)} · ${escapeHtml(input.workIdentifier)}</p><h2 style="font-size:18px">${escapeHtml(input.workTitle)}</h2><p style="line-height:1.6"><strong>${escapeHtml(kind)}:</strong> ${escapeHtml(input.attentionTitle)}</p><p style="margin-top:32px"><a href="${escapeHtml(input.deepLink)}" style="display:inline-block;background:#f0b429;color:#08080a;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">Open in Dongo</a></p></div></body></html>`;
  return { subject, text: plain, html };
}

export async function deliverEmail(input: {
  request: EmailDeliveryRequest;
  config: ResendConfig;
  fromEmail: string;
  fromName: string;
  fetcher?: Fetcher;
}): Promise<DeliveryResult> {
  const message = renderAttentionEmail(input.request);
  let response: Response;
  try {
    response = await (input.fetcher ?? fetch)("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.config.apiKey}`,
        "content-type": "application/json",
        "idempotency-key": input.request.idempotencyKey,
      },
      body: JSON.stringify({
        from: `${input.fromName} <${input.fromEmail}>`,
        to: [input.request.email],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      signal: requestSignal(),
    });
  } catch {
    return failure("resend_unavailable", true);
  }
  let payload: unknown;
  try {
    payload = parseJson(await readBoundedResponse(response));
  } catch {
    return failure("resend_invalid_response", response.status >= 500);
  }
  if (!response.ok) {
    return failure(
      response.status === 429 ? "resend_rate_limited" : "resend_rejected",
      response.status === 429 || response.status >= 500,
    );
  }
  const id =
    payload && typeof payload === "object" && "id" in payload
      ? text((payload as { id?: unknown }).id)
      : undefined;
  return id
    ? { ok: true, provider: "resend", messageId: id }
    : failure("resend_invalid_response", false);
}

export async function deliverApns(input: {
  request: PushDeliveryRequest;
  config: ApnsConfig;
  fetcher?: Fetcher;
  now?: number;
}): Promise<DeliveryResult> {
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1_000);
  let token: string;
  try {
    token = await signEs256Jwt({
      keyId: input.config.keyId,
      issuer: input.config.teamId,
      issuedAt: nowSeconds,
      privateKeyPkcs8: input.config.privateKeyPkcs8,
    });
  } catch {
    return failure("apns_configuration_invalid", false);
  }
  const host =
    input.config.environment === "production"
      ? "api.push.apple.com"
      : "api.sandbox.push.apple.com";
  let response: Response;
  try {
    response = await (input.fetcher ?? fetch)(
      `https://${host}/3/device/${encodeURIComponent(input.request.pushToken)}`,
      {
        method: "POST",
        headers: {
          authorization: `bearer ${token}`,
          "content-type": "application/json",
          "apns-topic": input.config.bundleId,
          "apns-push-type": "alert",
          "apns-priority": "10",
          "apns-expiration": "0",
          "apns-collapse-id": input.request.attentionRequestId.slice(0, 64),
        },
        body: JSON.stringify({
          aps: {
            alert: {
              title: "Dongo needs you",
              body: "Open Dongo to respond.",
            },
            sound: "default",
          },
          attentionRequestId: input.request.attentionRequestId,
          workItemId: input.request.workItemId,
          projectId: input.request.projectId,
        }),
        signal: requestSignal(),
      },
    );
  } catch {
    return failure("apns_unavailable", true);
  }
  let payload: unknown;
  try {
    payload = parseJson(await readBoundedResponse(response));
  } catch {
    return failure("apns_invalid_response", response.status >= 500);
  }
  if (response.ok) {
    return {
      ok: true,
      provider: "apns",
      messageId: response.headers.get("apns-id") ?? input.request.deliveryId,
    };
  }
  const reason =
    payload && typeof payload === "object" && "reason" in payload
      ? text((payload as { reason?: unknown }).reason)
      : undefined;
  const invalidDevice =
    response.status === 410 ||
    reason === "BadDeviceToken" ||
    reason === "DeviceTokenNotForTopic" ||
    reason === "Unregistered";
  return failure(
    invalidDevice ? "apns_device_invalid" : "apns_rejected",
    !invalidDevice && (response.status === 429 || response.status >= 500),
    invalidDevice,
  );
}

async function googleAccessToken(input: {
  config: FcmConfig;
  fetcher: Fetcher;
  now: number;
}): Promise<string | DeliveryFailure> {
  const nowSeconds = Math.floor(input.now / 1_000);
  let assertion: string;
  try {
    assertion = await signRs256Jwt({
      issuer: input.config.clientEmail,
      audience: GOOGLE_TOKEN_URL,
      scope: FIREBASE_SCOPE,
      issuedAt: nowSeconds,
      expiresAt: nowSeconds + 3_600,
      privateKeyPkcs8: input.config.privateKeyPkcs8,
    });
  } catch {
    return failure("fcm_configuration_invalid", false);
  }
  let response: Response;
  try {
    response = await input.fetcher(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
      signal: requestSignal(),
    });
  } catch {
    return failure("fcm_oauth_unavailable", true);
  }
  let payload: unknown;
  try {
    payload = parseJson(await readBoundedResponse(response));
  } catch {
    return failure("fcm_oauth_invalid_response", response.status >= 500);
  }
  const accessToken =
    payload && typeof payload === "object" && "access_token" in payload
      ? text((payload as { access_token?: unknown }).access_token)
      : undefined;
  if (!response.ok || !accessToken) {
    return failure(
      response.status === 429 ? "fcm_oauth_rate_limited" : "fcm_oauth_rejected",
      response.status === 429 || response.status >= 500,
    );
  }
  return accessToken;
}

export async function deliverFcm(input: {
  request: PushDeliveryRequest;
  config: FcmConfig;
  fetcher?: Fetcher;
  now?: number;
}): Promise<DeliveryResult> {
  const fetcher = input.fetcher ?? fetch;
  const accessToken = await googleAccessToken({
    config: input.config,
    fetcher,
    now: input.now ?? Date.now(),
  });
  if (typeof accessToken !== "string") return accessToken;
  let response: Response;
  try {
    response = await fetcher(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(input.config.projectId)}/messages:send`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          message: {
            token: input.request.pushToken,
            notification: {
              title: "Dongo needs you",
              body: "Open Dongo to respond.",
            },
            data: {
              attentionRequestId: input.request.attentionRequestId,
              workItemId: input.request.workItemId,
              projectId: input.request.projectId,
            },
            android: { collapseKey: input.request.attentionRequestId },
            apns: {
              headers: { "apns-collapse-id": input.request.attentionRequestId.slice(0, 64) },
            },
          },
        }),
        signal: requestSignal(),
      },
    );
  } catch {
    return failure("fcm_unavailable", true);
  }
  let payload: unknown;
  try {
    payload = parseJson(await readBoundedResponse(response));
  } catch {
    return failure("fcm_invalid_response", response.status >= 500);
  }
  const name =
    payload && typeof payload === "object" && "name" in payload
      ? text((payload as { name?: unknown }).name)
      : undefined;
  if (response.ok && name) {
    return { ok: true, provider: "fcm", messageId: name };
  }
  const serialized = JSON.stringify(payload ?? {});
  const invalidDevice =
    response.status === 404 ||
    serialized.includes("UNREGISTERED") ||
    serialized.includes("registration-token-not-registered");
  return failure(
    invalidDevice ? "fcm_device_invalid" : "fcm_rejected",
    !invalidDevice && (response.status === 429 || response.status >= 500),
    invalidDevice,
  );
}
