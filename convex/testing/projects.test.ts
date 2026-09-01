import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { modules } from "../test.setup";

const gatewaySecret = "test-gateway-secret-with-at-least-32-characters";

beforeEach(() => {
  process.env.DONGO_AUTH_INTERNAL_URL =
    "https://dev.dongo.so/api/auth/internal/resources";
  process.env.DONGO_INTERNAL_GATEWAY_SECRET = gatewaySecret;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("project resource provisioning", () => {
  it("exposes the free-plan allowance and returns an actionable project limit", async () => {
    const t = convexTest(schema, modules).withIdentity({
      tokenIdentifier: "https://human.example.test|plan-owner",
      subject: "plan-owner",
      issuer: "https://human.example.test",
      email: "plan-owner@example.test",
      name: "Plan Owner",
    });
    await t.mutation(api.domains.identity.index.bootstrapCurrentUser, {});
    const organization = await t.mutation(
      api.domains.projects.index.createPersonalOrganization,
      { name: "Plan Test", slug: `plan-${crypto.randomUUID()}` },
    );

    const before = await t.query(api.domains.projects.index.listMine, {});
    expect(before[0]?.projectAllowance).toEqual({
      resource: "active_projects",
      plan: "free",
      activeProjectCount: 0,
      limit: 1,
      remaining: 1,
      canCreate: true,
      actions: ["use_existing", "archive_existing", "upgrade"],
    });

    await t.mutation(internal.domains.projects.index.createProject, {
      organizationId: organization.organizationId,
      name: "Existing Project",
      slug: "existing",
      identifierPrefix: "EXIST",
      executionMode: "manual",
      parallelExecution: {
        enabled: false,
        maxConcurrentRuns: 1,
        requiresIsolatedWorkspaces: true,
      },
    });
    const after = await t.query(api.domains.projects.index.listMine, {});
    expect(after[0]?.projectAllowance).toMatchObject({
      activeProjectCount: 1,
      remaining: 0,
      canCreate: false,
    });
    expect(after[0]?.projects[0]?.parallelExecution).toEqual({
      enabled: false,
      maxConcurrentRuns: 1,
      requiresIsolatedWorkspaces: true,
    });

    await expect(t.mutation(internal.domains.projects.index.createProject, {
      organizationId: organization.organizationId,
      name: "Second Project",
      slug: "second",
      identifierPrefix: "SEC",
      executionMode: "manual",
    })).rejects.toMatchObject({
      data: {
        code: "plan_limit",
        message: expect.stringMatching(/use the existing project, archive it, or upgrade/i),
        details: {
          resource: "active_projects",
          plan: "free",
          activeProjectCount: 1,
          limit: 1,
          remaining: 0,
          retryable: false,
          actions: ["use_existing", "archive_existing", "upgrade"],
        },
      },
    });
  });

  it("recovers an external provisioning failure without duplicating the project", async () => {
    const requests: Request[] = [];
    let attempts = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      requests.push(new Request(input, init));
      attempts += 1;
      return attempts === 1
        ? Response.json({ ok: false }, { status: 503 })
        : Response.json({ ok: true });
    });

    const t = convexTest(schema, modules).withIdentity({
      tokenIdentifier: "https://human.example.test|project-owner",
      subject: "project-owner",
      issuer: "https://human.example.test",
      email: "project-owner@example.test",
      name: "Project Owner",
    });
    await t.mutation(api.domains.identity.index.bootstrapCurrentUser, {});
    const organization = await t.mutation(
      api.domains.projects.index.createPersonalOrganization,
      { name: "Provision Test", slug: `provision-${crypto.randomUUID()}` },
    );
    const input = {
      organizationId: organization.organizationId,
      name: "Provisioned Project",
      slug: "provisioned",
      identifierPrefix: "PROV",
      repositoryUrl: "https://github.com/example/provisioned",
      executionMode: "manual" as const,
      parallelExecution: {
        enabled: true,
        maxConcurrentRuns: 3,
        requiresIsolatedWorkspaces: true as const,
      },
    };

    await expect(
      t.action(api.domains.projects.actions.createAndProvisionResource, input),
    ).rejects.toThrow("Auth resource provisioning failed");
    const afterFailure = await t.query(api.domains.projects.index.listMine, {});
    expect(afterFailure[0]?.projects).toHaveLength(1);

    const recovered = await t.action(
      api.domains.projects.actions.createAndProvisionResource,
      input,
    );
    expect(recovered).toMatchObject({
      projectId: afterFailure[0]?.projects[0]?._id,
      publicRef: afterFailure[0]?.projects[0]?.publicRef,
      created: false,
      resourceProvisioned: true,
    });
    const afterRecovery = await t.query(api.domains.projects.index.listMine, {});
    expect(afterRecovery[0]?.projects[0]?.parallelExecution).toEqual({
      enabled: true,
      maxConcurrentRuns: 3,
      requiresIsolatedWorkspaces: true,
    });
    expect(afterRecovery[0]?.projects).toHaveLength(1);
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.method).toBe("POST");
      expect(new URL(request.url).pathname).toBe(
        "/api/auth/internal/resources",
      );
      expect(request.headers.get("x-dongo-key-id")).toBe("v1");
      expect(request.headers.get("x-dongo-signature")).toMatch(
        /^[A-Za-z0-9_-]{43}$/u,
      );
      await expect(request.clone().json()).resolves.toEqual({
        projectRef: recovered.publicRef,
        projectName: input.name,
      });
    }
  });
});
