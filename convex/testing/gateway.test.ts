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
  it("claims each MCP release once per installation with monotonic rollback safety", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(
        internal.operators.agentReleaseNotice.activate,
        { releaseId: "release-10", releaseSequence: 10 },
      ),
    ).resolves.toMatchObject({ activated: true, releaseSequence: 10 });
    const key = `release-${crypto.randomUUID()}`;
    const seeded = await t.mutation(internal.dev.bootstrap.createWalkingSkeleton, {
      key,
      organizationSlug: `org-${crypto.randomUUID()}`,
      projectSlug: `project-${crypto.randomUUID()}`,
    });
    const project = await t.run(async (ctx) => await ctx.db.get(seeded.projectId!));
    if (!project) throw new Error("fixture missing");
    const providerIssuer = "https://auth.example.test";
    const resource = `https://dev.dongo.so/p/${project.publicRef}/mcp`;
    const createInstallation = async (suffix: string) =>
      await t.mutation(
        internal.domains.installations.index.registerOAuthGrant,
        {
          providerIssuer,
          providerGrantId: `release-grant-${suffix}`,
          subject: `oauth-user-${suffix}`,
          clientId: `codex-client-${suffix}`,
          resource,
          scopes: ["dongo:work:read", "dongo:work:write", "offline_access"],
          kind: "mcp",
          authSubject: `development:${key}`,
          projectRef: project.publicRef,
          label: "Codex",
        },
      );
    const firstInstallation = await createInstallation("one");
    const authorization = {
      requestId: "release-notice-request",
      installationId: firstInstallation.installationId,
      actorId: firstInstallation.actorId,
      organizationId: firstInstallation.organizationId,
      projectId: firstInstallation.projectId,
      projectRef: firstInstallation.projectRef,
      oauthBindingId: firstInstallation.oauthBindingId,
      issuer: providerIssuer,
      resource,
      clientId: "codex-client-one",
      scopes: ["dongo:work:read", "dongo:work:write"],
    };
    const claim = (releaseId: string, releaseSequence: number) =>
      t.mutation(
        internal.domains.installations.index.claimAgentReleaseNotice,
        { authorization, releaseId, releaseSequence },
      );

    await expect(claim("release-10", 10)).resolves.toMatchObject({
      deliver: true,
      releaseId: "release-10",
      releaseSequence: 10,
    });
    await expect(claim("release-10", 10)).resolves.toEqual({ deliver: false });
    await expect(claim("rollback-9", 9)).resolves.toEqual({ deliver: false });
    await expect(claim("changed-10", 10)).resolves.toEqual({ deliver: false });
    await expect(
      t.mutation(
        internal.operators.agentReleaseNotice.activate,
        { releaseId: "release-11", releaseSequence: 11 },
      ),
    ).resolves.toMatchObject({ activated: true, releaseSequence: 11 });
    await expect(claim("release-11", 11)).resolves.toMatchObject({
      deliver: true,
      releaseSequence: 11,
    });

    await t.mutation(
      internal.operators.agentReleaseNotice.activate,
      { releaseId: "release-12", releaseSequence: 12 },
    );
    const concurrent = await Promise.all([
      claim("release-12", 12),
      claim("release-12", 12),
    ]);
    expect(concurrent.filter((result) => result.deliver)).toHaveLength(1);

    const secondInstallation = await createInstallation("two");
    const secondAuthorization = {
      ...authorization,
      requestId: "release-notice-second-installation",
      installationId: secondInstallation.installationId,
      actorId: secondInstallation.actorId,
      oauthBindingId: secondInstallation.oauthBindingId,
      clientId: "codex-client-two",
    };
    await expect(
      t.mutation(
        internal.domains.installations.index.claimAgentReleaseNotice,
        {
          authorization: secondAuthorization,
          releaseId: "release-12",
          releaseSequence: 12,
        },
      ),
    ).resolves.toMatchObject({ deliver: true, releaseSequence: 12 });

    await expect(
      t.mutation(
        internal.operators.agentReleaseNotice.activate,
        { releaseId: "changed-12", releaseSequence: 12 },
      ),
    ).rejects.toThrow(/already activated/u);
    await expect(
      t.mutation(
        internal.operators.agentReleaseNotice.activate,
        { releaseId: "rollback-11", releaseSequence: 11 },
      ),
    ).rejects.toThrow(/cannot move backward/u);
    await expect(
      t.mutation(
        internal.operators.agentReleaseNotice.activate,
        { releaseId: "release-12", releaseSequence: 12 },
      ),
    ).resolves.toMatchObject({ activated: false, releaseSequence: 12 });

    await t.mutation(
      internal.operators.agentReleaseNotice.activate,
      { releaseId: "release-20", releaseSequence: 20 },
    );
    const failed = await callSigned(t, "/internal/agent/v1/execute", {
      version: 1,
      operation: "not_an_operation",
      input: {},
      releaseNotice: { id: "release-20", sequence: 20 },
      context: {
        ...secondAuthorization,
        requestId: "release-notice-failed-operation",
        grantId: secondAuthorization.oauthBindingId,
        oauthBindingId: undefined,
      },
    });
    expect(failed.response.status).toBe(404);

    const delivered = await callSigned(t, "/internal/agent/v1/execute", {
      version: 1,
      operation: "get_overview",
      input: {},
      releaseNotice: { id: "release-20", sequence: 20 },
      context: {
        ...secondAuthorization,
        requestId: "release-notice-successful-operation",
        grantId: secondAuthorization.oauthBindingId,
        oauthBindingId: undefined,
      },
    });
    expect(delivered.response.status).toBe(200);
    await expect(delivered.response.json()).resolves.toMatchObject({
      ok: true,
      releaseNoticeDelivery: { id: "release-20", sequence: 20 },
    });
  });

  it("does not deliver an inactive or globally rolled-back release", async () => {
    const t = convexTest(schema, modules);
    const key = `inactive-release-${crypto.randomUUID()}`;
    const seeded = await t.mutation(internal.dev.bootstrap.createWalkingSkeleton, {
      key,
      organizationSlug: `org-${crypto.randomUUID()}`,
      projectSlug: `project-${crypto.randomUUID()}`,
    });
    const project = await t.run(async (ctx) => await ctx.db.get(seeded.projectId!));
    if (!project) throw new Error("fixture missing");
    const providerIssuer = "https://auth.example.test";
    const resource = `https://dev.dongo.so/p/${project.publicRef}/mcp`;
    const installation = await t.mutation(
      internal.domains.installations.index.registerOAuthGrant,
      {
        providerIssuer,
        providerGrantId: "inactive-release-grant",
        subject: "inactive-release-user",
        clientId: "inactive-release-client",
        resource,
        scopes: ["dongo:work:read", "dongo:work:write", "offline_access"],
        kind: "mcp",
        authSubject: `development:${key}`,
        projectRef: project.publicRef,
        label: "Codex",
      },
    );
    const authorization = {
      requestId: "inactive-release-request",
      installationId: installation.installationId,
      actorId: installation.actorId,
      organizationId: installation.organizationId,
      projectId: installation.projectId,
      projectRef: installation.projectRef,
      oauthBindingId: installation.oauthBindingId,
      issuer: providerIssuer,
      clientId: "inactive-release-client",
      resource,
      scopes: ["dongo:work:read", "dongo:work:write"],
    };
    const claim = (releaseId: string, releaseSequence: number) =>
      t.mutation(internal.domains.installations.index.claimAgentReleaseNotice, {
        authorization,
        releaseId,
        releaseSequence,
      });

    await expect(claim("release-1", 1)).resolves.toEqual({ deliver: false });
    await t.mutation(internal.operators.agentReleaseNotice.activate, {
      releaseId: "release-2",
      releaseSequence: 2,
    });
    await expect(claim("release-1", 1)).resolves.toEqual({ deliver: false });
    await expect(claim("release-2", 2)).resolves.toMatchObject({
      deliver: true,
      releaseSequence: 2,
    });
  });

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

  it("reuses an active OAuth grant but creates a fresh identity after revocation", async () => {
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
      providerGrantId: "deterministic-codex-grant",
      subject: "oauth-user-1",
      clientId: "https://chatgpt.com/oauth/codex/client.json",
      resource: `https://dev.dongo.so/p/${project.publicRef}/mcp`,
      scopes: ["dongo:work:read", "dongo:work:write", "offline_access"],
      kind: "mcp",
      authSubject: `development:${key}`,
      projectRef: project.publicRef,
      label: "Codex",
    };
    const first = await callSigned(t, "/internal/oauth/v1/bind", {
      version: 1,
      requestId: "oauth-bind-1",
      input,
    });
    expect(first.response.status).toBe(200);
    const firstPayload = (await first.response.json()) as {
      ok: boolean;
      data: {
        installationId: string;
        oauthBindingId: string;
        actorId: string;
        created: boolean;
        reactivated: boolean;
      };
    };
    expect(firstPayload.ok).toBe(true);
    expect(firstPayload.data).toMatchObject({ created: true, reactivated: false });

    const activeReplay = await callSigned(t, "/internal/oauth/v1/bind", {
      version: 1,
      requestId: "oauth-bind-active-replay",
      input,
    });
    expect(activeReplay.response.status).toBe(200);
    await expect(activeReplay.response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        installationId: firstPayload.data.installationId,
        oauthBindingId: firstPayload.data.oauthBindingId,
        actorId: firstPayload.data.actorId,
        created: false,
        reactivated: false,
      },
    });

    const firstResolveInput = {
      oauthBindingId: firstPayload.data.oauthBindingId,
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
      input: firstResolveInput,
    });
    expect(activeResolution.response.status).toBe(200);
    await expect(activeResolution.response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        installationId: firstPayload.data.installationId,
        oauthBindingId: firstPayload.data.oauthBindingId,
        kind: "mcp",
        scopes: input.scopes,
      },
    });
    const mismatchedResolution = await callSigned(
      t,
      "/internal/oauth/v1/resolve",
      {
        version: 1,
        requestId: "oauth-resolve-mismatch",
        input: { ...firstResolveInput, resource: "https://other.example.test" },
      },
    );
    expect(mismatchedResolution.response.status).toBe(401);

    const owner = t.withIdentity({
      tokenIdentifier: `development:${key}`,
      subject: `development:${key}`,
      issuer: "https://human.example.test",
    });
    await owner.mutation(api.domains.installations.index.revoke, {
      installationId: firstPayload.data.installationId as never,
    });
    const revokedState = await t.run(async (ctx) => ({
      installation: await ctx.db.get(firstPayload.data.installationId as never),
      binding: await ctx.db.get(firstPayload.data.oauthBindingId as never),
      actor: await ctx.db.get(firstPayload.data.actorId as never),
    }));
    expect(revokedState.installation).toMatchObject({
      status: "revoked",
      actorId: firstPayload.data.actorId,
    });
    expect(revokedState.binding).toMatchObject({
      status: "revoked",
      installationId: firstPayload.data.installationId,
    });
    expect(revokedState.actor).toMatchObject({
      installationId: firstPayload.data.installationId,
      name: "Codex",
    });
    const revokedResolution = await callSigned(t, "/internal/oauth/v1/resolve", {
      version: 1,
      requestId: "oauth-resolve-revoked",
      input: firstResolveInput,
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
    const secondPayload = (await second.response.json()) as typeof firstPayload;
    expect(secondPayload).toMatchObject({
      ok: true,
      data: {
        created: true,
        reactivated: false,
      },
    });
    expect(secondPayload.data.installationId).not.toBe(firstPayload.data.installationId);
    expect(secondPayload.data.oauthBindingId).not.toBe(firstPayload.data.oauthBindingId);
    expect(secondPayload.data.actorId).not.toBe(firstPayload.data.actorId);

    const secondResolveInput = {
      ...firstResolveInput,
      oauthBindingId: secondPayload.data.oauthBindingId,
    };
    const newResolution = await callSigned(t, "/internal/oauth/v1/resolve", {
      version: 1,
      requestId: "oauth-resolve-new-installation",
      input: secondResolveInput,
    });
    expect(newResolution.response.status).toBe(200);
    await expect(newResolution.response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        installationId: secondPayload.data.installationId,
        oauthBindingId: secondPayload.data.oauthBindingId,
        actorId: secondPayload.data.actorId,
        kind: "mcp",
      },
    });

    const oldResolutionAfterReauthorization = await callSigned(
      t,
      "/internal/oauth/v1/resolve",
      {
        version: 1,
        requestId: "oauth-resolve-old-after-reauthorization",
        input: firstResolveInput,
      },
    );
    expect(oldResolutionAfterReauthorization.response.status).toBe(401);

    const finalState = await t.run(async (ctx) => ({
      oldInstallation: await ctx.db.get(firstPayload.data.installationId as never),
      oldBinding: await ctx.db.get(firstPayload.data.oauthBindingId as never),
      oldActor: await ctx.db.get(firstPayload.data.actorId as never),
      newInstallation: await ctx.db.get(secondPayload.data.installationId as never),
      newBinding: await ctx.db.get(secondPayload.data.oauthBindingId as never),
      newActor: await ctx.db.get(secondPayload.data.actorId as never),
      authorizedEvents: (await ctx.db.query("events").collect())
        .filter((event) => event.type === "installation.authorized"),
    }));
    expect(finalState.oldInstallation).toEqual(revokedState.installation);
    expect(finalState.oldBinding).toEqual(revokedState.binding);
    expect(finalState.oldActor).toEqual(revokedState.actor);
    expect(finalState.newInstallation).toMatchObject({
      status: "active",
      actorId: secondPayload.data.actorId,
    });
    expect(finalState.newBinding).toMatchObject({
      status: "active",
      installationId: secondPayload.data.installationId,
      providerGrantId: input.providerGrantId,
    });
    expect(finalState.newActor).toMatchObject({
      installationId: secondPayload.data.installationId,
      name: "Codex",
    });
    expect(finalState.authorizedEvents.map((event) => event.actorId)).toEqual([
      firstPayload.data.actorId,
      secondPayload.data.actorId,
    ]);

    const freshActiveReplay = await callSigned(t, "/internal/oauth/v1/bind", {
      version: 1,
      requestId: "oauth-bind-fresh-active-replay",
      input,
    });
    expect(freshActiveReplay.response.status).toBe(200);
    await expect(freshActiveReplay.response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        installationId: secondPayload.data.installationId,
        oauthBindingId: secondPayload.data.oauthBindingId,
        actorId: secondPayload.data.actorId,
        created: false,
        reactivated: false,
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
