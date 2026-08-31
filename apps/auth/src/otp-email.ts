import { z } from "zod";
import type { AuthWorkerEnv } from "./env";
import { verifyInternalRequest } from "./security";

const MAX_BODY_BYTES = 4 * 1024;
const requestSchema = z.object({
  email: z.email().max(320),
  otp: z.string().regex(/^\d{6}$/),
  type: z.enum(["sign-in", "email-verification"]),
});

function json(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export function renderOtpEmail(otp: string): { subject: string; text: string; html: string } {
  return {
    subject: `${otp} is your dongo sign-in code`,
    text: `Your dongo sign-in code is ${otp}. It expires in 10 minutes. If you did not request this code, you can ignore this email.`,
    html: `<!doctype html><html><body style="margin:0;background:#08080a;color:#ececee;font-family:Arial,sans-serif"><div style="max-width:560px;margin:0 auto;padding:40px 24px"><p style="font-family:monospace;color:#93939c;letter-spacing:.12em;text-transform:uppercase">dongo</p><h1 style="font-size:24px;font-weight:600">Your sign-in code</h1><p style="font-family:monospace;font-size:36px;letter-spacing:.2em;color:#f0b429">${otp}</p><p style="color:#93939c;line-height:1.6">It expires in 10 minutes. If you did not request this code, you can ignore this email.</p></div></body></html>`,
  };
}

export function authFromEmail(env: Pick<AuthWorkerEnv, "AUTH_FROM_EMAIL" | "PUBLIC_ORIGIN">): string {
  const email = z.email().max(320).parse(env.AUTH_FROM_EMAIL).toLowerCase();
  const origin = new URL(env.PUBLIC_ORIGIN);
  if (
    origin.protocol !== "https:" ||
    origin.username !== "" ||
    origin.password !== "" ||
    origin.port !== "" ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== "" ||
    email !== `auth@${origin.hostname.toLowerCase()}`
  ) {
    throw new Error("The dongo authentication sender must match PUBLIC_ORIGIN");
  }
  return email;
}

export async function sendOtpEmail(
  request: Request,
  env: AuthWorkerEnv,
): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return json({ error: "payload_too_large" }, 413);
  }
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > MAX_BODY_BYTES) return json({ error: "payload_too_large" }, 413);

  let signed: { timestamp: number; nonce: string };
  try {
    signed = await verifyInternalRequest({
      secret: env.DONGO_INTERNAL_GATEWAY_SECRET,
      keyId: request.headers.get("x-dongo-key-id"),
      timestamp: request.headers.get("x-dongo-timestamp"),
      nonce: request.headers.get("x-dongo-nonce"),
      signature: request.headers.get("x-dongo-signature"),
      method: request.method,
      pathname: new URL(request.url).pathname,
      body,
    });
  } catch {
    return json({ error: "unauthorized" }, 401);
  }
  const decoded = (() => {
    try {
      return JSON.parse(new TextDecoder().decode(body));
    } catch {
      return undefined;
    }
  })();
  const parsed = requestSchema.safeParse(decoded);
  if (!parsed.success) return json({ error: "invalid_request" }, 400);

  const now = Date.now();
  try {
    await env.AUTH_DB.prepare(
      `INSERT INTO dongoInternalNonce (nonce, timestamp, expiresAt)
       VALUES (?, ?, ?)`,
    )
      .bind(signed.nonce, signed.timestamp, now + 2 * 60_000)
      .run();
  } catch {
    return json({ error: "replayed_request" }, 409);
  }

  const message = renderOtpEmail(parsed.data.otp);
  await env.EMAIL.send({
    to: parsed.data.email,
    from: { email: authFromEmail(env), name: "dongo" },
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
  return json({ ok: true }, 200);
}
