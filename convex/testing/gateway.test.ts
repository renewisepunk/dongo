import { beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { jwtVerify } from "jose";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { modules } from "../test.setup";

const gatewaySecret = "test-gateway-secret-with-at-least-32-characters";

beforeEach(() => {
  process.env.DONGO_ENABLE_DEV_BOOTSTRAP = "true";
  process.env.DONGO_INTERNAL_GATEWAY_SECRET = gatewaySecret;
  process.env.DONGO_HUMAN_ASSERTION_SECRET = gatewaySecret;
  process.env.DONGO_HUMAN_ASSERTION_ISSUER =
    "https://wandering-camel-662.convex.site";
  process.env.DONGO_AUTH_ISSUER = "https://dev.dongo.so/api/auth";
});

describe("human authorization bridge", () => {
  it("mints a short-lived issuer and audience-bound assertion from Convex auth", async () => {
    const t = convexTest(schema, modules).withIdentity({
      tokenIdentifier: "https://human.example.test|user-1",
      subject: "user-1",
      issuer: "https://human.example.test",
      email: "owner@example.test",
      name: "dongo Owner",
    });
    const profile = await t.mutation(
      api.domains.identity.index.bootstrapCurrentUser,
      {},
    );
    const minted = await t.action(
      api.domains.identity.assertions.mintHumanBridgeAssertion,
      { returnTo: "/device/approve?user_code=ABCD" },
    );
    const verified = await jwtVerify(
      minted.assertion,
      new TextEncoder().encode(gatewaySecret),
      {
        issuer: "https://wandering-camel-662.convex.site",
        audience: "https://dev.dongo.so/api/auth/dongo/bridge",
        algorithms: ["HS256"],
      },
    );
    expect(minted.profileId).toBe(profile.profileId);
    expect(minted.expiresAt).toBeGreaterThan(Date.now());
    expect(verified.payload).toMatchObject({
      sub: profile.profileId,
      profileId: profile.profileId,
      email: "owner@example.test",
      name: "dongo Owner",
      returnTo: "/device/approve?user_code=ABCD",
    });
  });
});

describe("internal signed gateway", () => {
  it("returns canonical DTOs and rejects replay, stale, and tampered calls", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.mutation(internal.dev.bootstrap.createWalkingSkeleton, {
      key: `gateway-${crypto.randomUUID()}`,
      organizationSlug: `org-${crypto.randomUUID()}`,
      projectSlug: `project-${crypto.randomUUID()}`,
    });
    const context = await t.run(async (ctx) => {
      const installation = await ctx.db.get(seeded.installationId!);
      const project = await ctx.db.get(seeded.projectId!);
      if (!installation || !project) throw new Error("fixture missing");
      return {
        requestId: "request-overview-1",
        installationId: installation._id,
        actorId: installation.actorId,
        organizationId: installation.organizationId,
        projectId: project._id,
        projectRef: project.publicRef,
        clientId: installation.clientId,
        resource: installation.resource,
        scopes: installation.scopes,
      };
    });
    const body = JSON.stringify({
      version: 1,
      operation: "get_overview",
      input: {},
      context,
    });
    const signed = await signedRequest(
      "/internal/agent/v1/execute",
      body,
    );
    const response = await t.fetch("/internal/agent/v1/execute", signed);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      apiVersion: "v1",
      requestId: context.requestId,
      data: {
        project: { id: context.projectId, publicRef: context.projectRef },
        needsYou: [],
        working: [],
        ready: [],
        inbox: [],
        recentlyDone: [],
      },
    });

    const replay = await t.fetch("/internal/agent/v1/execute", signed);
    expect(replay.status).toBe(401);
    await expect(replay.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "unauthorized" },
    });

    const tamperedBody = body.replace("get_overview", "sync_snapshot");
    const tampered = await t.fetch("/internal/agent/v1/execute", {
      ...signed,
      body: tamperedBody,
    });
    expect(tampered.status).toBe(401);

    const stale = await signedRequest(
      "/internal/agent/v1/execute",
      body,
      Date.now() - 61_000,
    );
    const staleResponse = await t.fetch(
      "/internal/agent/v1/execute",
      stale,
    );
    expect(staleResponse.status).toBe(401);
  });

  it("reactivates a deterministic revoked OAuth grant through the same boundary", async () => {
    const t = convexTest(schema, modules);
    const key = `oauth-${crypto.randomUUID()}`;
    const seeded = await t.mutation(internal.dev.bootstrap.createWalkingSkeleton, {
      key,
      organizationSlug: `org-${crypto.randomUUID()}`,
      projectSlug: `project-${crypto.randomUUID()}`,
    });
    const project = await t.run(async (ctx) => await ctx.db.get(seeded.projectId!));
    if (!project) throw new Error("fixture missing");
    const input = {
      providerIssuer: "https://auth.example.test",
      providerGrantId: "deterministic-device-grant",
      subject: "oauth-user-1",
      clientId: "dongo-cli",
      resource: "https://dev.dongo.so/api/agent",
      scopes: ["dongo:work:read", "dongo:work:write"],
      kind: "cli",
      authSubject: `development:${key}`,
      projectRef: project.publicRef,
      label: "Test CLI",
      machineLabel: "test-machine",
    };
    const first = await callSigned(t, "/internal/oauth/v1/bind", {
      version: 1,
      requestId: "oauth-bind-1",
      input,
    });
    expect(first.response.status).toBe(200);
    const firstPayload = (await first.response.json()) as {
      ok: boolean;
      data: { installationId: string; oauthBindingId: string };
    };
    expect(firstPayload.ok).toBe(true);

    const resolveInput = {
      providerIssuer: input.providerIssuer,
      providerGrantId: input.providerGrantId,
      subject: input.subject,
      clientId: input.clientId,
      resource: input.resource,
      authSubject: input.authSubject,
      projectRef: input.projectRef,
    };
    const activeResolution = await callSigned(t, "/internal/oauth/v1/resolve", {
      version: 1,
      requestId: "oauth-resolve-active",
      input: resolveInput,
    });
    expect(activeResolution.response.status).toBe(200);
    await expect(activeResolution.response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        installationId: firstPayload.data.installationId,
        oauthBindingId: firstPayload.data.oauthBindingId,
        kind: "cli",
        scopes: input.scopes,
      },
    });
    const mismatchedResolution = await callSigned(
      t,
      "/internal/oauth/v1/resolve",
      {
        version: 1,
        requestId: "oauth-resolve-mismatch",
        input: { ...resolveInput, resource: "https://other.example.test" },
      },
    );
    expect(mismatchedResolution.response.status).toBe(401);

    await t.run(async (ctx) => {
      await ctx.db.patch(
        firstPayload.data.installationId as never,
        { status: "revoked", revokedAt: Date.now() } as never,
      );
      await ctx.db.patch(
        firstPayload.data.oauthBindingId as never,
        { status: "revoked", revokedAt: Date.now() } as never,
      );
    });
    const revokedResolution = await callSigned(t, "/internal/oauth/v1/resolve", {
      version: 1,
      requestId: "oauth-resolve-revoked",
      input: resolveInput,
    });
    expect(revokedResolution.response.status).toBe(401);
    await expect(revokedResolution.response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "unauthorized" },
    });

    const second = await callSigned(t, "/internal/oauth/v1/bind", {
      version: 1,
      requestId: "oauth-bind-2",
      input,
    });
    expect(second.response.status).toBe(200);
    await expect(second.response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        installationId: firstPayload.data.installationId,
        oauthBindingId: firstPayload.data.oauthBindingId,
        created: false,
        reactivated: true,
      },
    });
  });
});

async function callSigned(
  t: ReturnType<typeof convexTest>,
  path: string,
  payload: unknown,
) {
  const body = JSON.stringify(payload);
  return {
    response: await t.fetch(path, await signedRequest(path, body)),
    body,
  };
}

async function signedRequest(
  path: string,
  body: string,
  timestamp = Date.now(),
): Promise<RequestInit> {
  const nonce = crypto.randomUUID();
  const bodyHash = await sha256Hex(new TextEncoder().encode(body));
  const canonical = `${timestamp}\n${nonce}\nPOST\n${path}\n${bodyHash}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(gatewaySecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = base64Url(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonical)),
    ),
  );
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-dongo-key-id": "v1",
      "x-dongo-timestamp": String(timestamp),
      "x-dongo-nonce": nonce,
      "x-dongo-signature": signature,
    },
    body,
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", owned.buffer),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}
