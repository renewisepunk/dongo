import { beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { modules } from "../test.setup";

const gatewaySecret = "test-gateway-secret-with-at-least-32-characters";
const ownerIdentity = {
  tokenIdentifier: "https://human.example.test|service-owner",
  subject: "service-owner",
  issuer: "https://human.example.test",
  email: "service-owner@example.test",
  name: "Service Owner",
};
const memberIdentity = {
  tokenIdentifier: "https://human.example.test|service-member",
  subject: "service-member",
  issuer: "https://human.example.test",
  email: "service-member@example.test",
  name: "Service Member",
};

beforeEach(() => {
  process.env.DONGO_INTERNAL_GATEWAY_SECRET = gatewaySecret;
  process.env.SITE_URL = "https://dev.dongo.so";
});

describe("service credentials", () => {
  it("issues a one-time project credential, stores only its keyed hash, and revokes immediately", async () => {
    const root = convexTest(schema, modules);
    const owner = root.withIdentity(ownerIdentity);
    await owner.mutation(api.domains.identity.index.bootstrapCurrentUser, {});
    const organization = await owner.mutation(
      api.domains.projects.index.createPersonalOrganization,
      { name: "Service Test", slug: `service-${crypto.randomUUID()}` },
    );
    const project = await owner.mutation(
      internal.domains.projects.index.createProject,
      {
        organizationId: organization.organizationId,
        name: "Service Test",
        slug: "service",
        identifierPrefix: "SVC",
        executionMode: "manual",
      },
    );
    const created = await owner.action(
      api.domains.installations.actions.createServiceCredential,
      {
        projectId: project.projectId,
        label: "Repository CI",
        scopes: [
          "dongo:work:read",
          "dongo:work:write",
          "dongo:attachments:read",
        ],
      },
    );
    expect(created.token).toMatch(
      /^dng_svc_[A-Za-z0-9_-]{11}_[A-Za-z0-9_-]{43}$/u,
    );
    expect(created.tokenPrefix).toHaveLength(11);

    const stored = await root.run(async (ctx) => ({
      credential: await ctx.db.get(created.serviceCredentialId),
      installation: await ctx.db.get(created.installationId),
      serialized: JSON.stringify(await ctx.db.get(created.serviceCredentialId)),
    }));
    expect(stored.credential?.tokenHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(stored.credential?.tokenPrefix).toBe(created.tokenPrefix);
    expect(stored.serialized).not.toContain(created.token);
    expect(stored.installation).toMatchObject({
      kind: "service",
      clientId: "dongo-service-v1",
      resource: "https://dev.dongo.so/api/agent/v1",
      status: "active",
    });

    const invalidToken = `${created.token.slice(0, -1)}${created.token.endsWith("a") ? "b" : "a"}`;
    const invalid = await callSigned(
      root,
      "/internal/service-credentials/v1/resolve",
      {
        version: 1,
        requestId: "service-resolve-invalid",
        input: { token: invalidToken },
      },
    );
    expect(invalid.status).toBe(401);

    const resolved = await callSigned(
      root,
      "/internal/service-credentials/v1/resolve",
      {
        version: 1,
        requestId: "service-resolve-active",
        input: { token: created.token },
      },
    );
    expect(resolved.status).toBe(200);
    const resolution = (await resolved.json()) as {
      data: {
        installationId: string;
        serviceCredentialId: string;
        actorId: string;
        organizationId: string;
        projectId: string;
        projectRef: string;
        clientId: string;
        resource: string;
        scopes: string[];
      };
    };
    expect(resolution.data).toMatchObject({
      installationId: created.installationId,
      serviceCredentialId: created.serviceCredentialId,
      projectId: project.projectId,
      clientId: "dongo-service-v1",
    });
    const agent = await callSigned(root, "/internal/agent/v1/execute", {
      version: 1,
      operation: "get_overview",
      input: {},
      context: {
        requestId: "service-agent-active",
        installationId: resolution.data.installationId,
        serviceCredentialId: resolution.data.serviceCredentialId,
        actorId: resolution.data.actorId,
        organizationId: resolution.data.organizationId,
        projectId: resolution.data.projectId,
        projectRef: resolution.data.projectRef,
        clientId: resolution.data.clientId,
        resource: resolution.data.resource,
        scopes: resolution.data.scopes,
      },
    });
    expect(agent.status).toBe(200);

    await owner.mutation(api.domains.installations.index.revoke, {
      installationId: created.installationId,
    });
    const revoked = await callSigned(
      root,
      "/internal/service-credentials/v1/resolve",
      {
        version: 1,
        requestId: "service-resolve-revoked",
        input: { token: created.token },
      },
    );
    expect(revoked.status).toBe(401);
    const revokedAgent = await callSigned(root, "/internal/agent/v1/execute", {
      version: 1,
      operation: "get_overview",
      input: {},
      context: {
        requestId: "service-agent-revoked",
        installationId: resolution.data.installationId,
        serviceCredentialId: resolution.data.serviceCredentialId,
        actorId: resolution.data.actorId,
        organizationId: resolution.data.organizationId,
        projectId: resolution.data.projectId,
        projectRef: resolution.data.projectRef,
        clientId: resolution.data.clientId,
        resource: resolution.data.resource,
        scopes: resolution.data.scopes,
      },
    });
    expect(revokedAgent.status).toBe(401);
  });

  it("restricts creation and continued use to an active organization owner", async () => {
    const root = convexTest(schema, modules);
    const owner = root.withIdentity(ownerIdentity);
    const member = root.withIdentity(memberIdentity);
    await owner.mutation(api.domains.identity.index.bootstrapCurrentUser, {});
    await member.mutation(api.domains.identity.index.bootstrapCurrentUser, {});
    const organization = await owner.mutation(
      api.domains.projects.index.createPersonalOrganization,
      { name: "Role Test", slug: `role-${crypto.randomUUID()}` },
    );
    const project = await owner.mutation(
      internal.domains.projects.index.createProject,
      {
        organizationId: organization.organizationId,
        name: "Role Test",
        slug: "role",
        identifierPrefix: "ROL",
        executionMode: "manual",
      },
    );
    await owner.mutation(api.domains.projects.index.addMember, {
      projectId: project.projectId,
      email: memberIdentity.email,
    });
    await expect(
      member.action(api.domains.installations.actions.createServiceCredential, {
        projectId: project.projectId,
        label: "Unauthorized CI",
        scopes: ["dongo:work:read"],
      }),
    ).rejects.toThrow();
    await expect(
      owner.action(api.domains.installations.actions.createServiceCredential, {
        projectId: project.projectId,
        label: "Invalid offline CI",
        scopes: ["dongo:work:read", "offline_access"],
      }),
    ).rejects.toThrow();

    const created = await owner.action(
      api.domains.installations.actions.createServiceCredential,
      {
        projectId: project.projectId,
        label: "Owner CI",
        scopes: ["dongo:work:read"],
      },
    );
    await root.run(async (ctx) => {
      const installation = await ctx.db.get(created.installationId);
      if (!installation?.authorizedByProfileId) throw new Error("fixture missing");
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_organization_profile", (query) =>
          query
            .eq("organizationId", organization.organizationId)
            .eq("profileId", installation.authorizedByProfileId!),
        )
        .unique();
      if (!membership) throw new Error("fixture missing");
      await ctx.db.patch(membership._id, { role: "member" });
    });
    const demoted = await callSigned(
      root,
      "/internal/service-credentials/v1/resolve",
      {
        version: 1,
        requestId: "service-resolve-demoted",
        input: { token: created.token },
      },
    );
    expect(demoted.status).toBe(401);
  });
});

async function callSigned(
  t: ReturnType<typeof convexTest>,
  path: string,
  payload: unknown,
): Promise<Response> {
  const body = JSON.stringify(payload);
  const timestamp = Date.now();
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
  return await t.fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-dongo-key-id": "v1",
      "x-dongo-timestamp": String(timestamp),
      "x-dongo-nonce": nonce,
      "x-dongo-signature": signature,
    },
    body,
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", owned));
  return [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

