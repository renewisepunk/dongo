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
      source: "plan",
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
        message: expect.stringMatching(/use an existing project, archive one, or review plan options/i),
        details: {
          resource: "active_projects",
          plan: "free",
          source: "plan",
          activeProjectCount: 1,
          limit: 1,
          remaining: 0,
          retryable: false,
          actions: ["use_existing", "archive_existing", "upgrade"],
        },
      },
    });
  });

  it("grants finite project capacity to an existing owner email without changing plan or storage", async () => {
    const email = "capacity-owner@example.test";
    const t = convexTest(schema, modules).withIdentity({
      tokenIdentifier: "https://human.example.test|capacity-owner",
      subject: "capacity-owner",
      issuer: "https://human.example.test",
      email,
      name: "Capacity Owner",
    });
    await t.mutation(api.domains.identity.index.bootstrapCurrentUser, {});
    const organization = await t.mutation(
      api.domains.projects.index.createPersonalOrganization,
      { name: "Capacity Test", slug: `capacity-${crypto.randomUUID()}` },
    );
    const create = async (name: string, slug: string, identifierPrefix: string) =>
      await t.mutation(internal.domains.projects.index.createProject, {
        organizationId: organization.organizationId,
        name,
        slug,
        identifierPrefix,
        executionMode: "manual" as const,
      });
    await create("First", "first", "FIRST");

    await expect(t.query(internal.operators.projectCapacity.inspect, {
      email: "missing@example.test",
    })).rejects.toMatchObject({ data: { code: "not_found" } });

    expect(await t.query(internal.operators.projectCapacity.inspect, {
      email: ` ${email.toUpperCase()} `,
    })).toMatchObject({
      plan: "free",
      source: "plan",
      activeProjectCount: 1,
      activeProjectLimit: 1,
      revision: 0,
    });

    const granted = await t.mutation(internal.operators.projectCapacity.setOverride, {
      email,
      activeProjectLimit: 3,
      expectedRevision: 0,
      reason: "Approved beta capacity",
      requestId: "capacity-grant-1",
    });
    expect(granted).toMatchObject({
      changed: true,
      plan: "free",
      source: "operator_override",
      activeProjectLimit: 3,
      revision: 1,
    });
    expect(await t.mutation(internal.operators.projectCapacity.setOverride, {
      email,
      activeProjectLimit: 3,
      expectedRevision: 0,
      reason: "Uncertain retry",
      requestId: "capacity-grant-retry",
    })).toMatchObject({ changed: false, revision: 1 });

    await create("Second", "second", "SECOND");
    await create("Third", "third", "THIRD");
    await expect(create("Fourth", "fourth", "FOURTH")).rejects.toMatchObject({
      data: {
        code: "plan_limit",
        details: {
          source: "operator_override",
          activeProjectCount: 3,
          limit: 3,
        },
      },
    });

    const lowered = await t.mutation(internal.operators.projectCapacity.setOverride, {
      email,
      activeProjectLimit: 2,
      expectedRevision: 1,
      reason: "Reduce unused future capacity",
      requestId: "capacity-lower-1",
    });
    expect(lowered).toMatchObject({
      changed: true,
      activeProjectCount: 3,
      activeProjectLimit: 2,
      overLimit: true,
      revision: 2,
    });
    const projects = await t.run(async (ctx) =>
      await ctx.db
        .query("projects")
        .withIndex("by_organization", (query) =>
          query.eq("organizationId", organization.organizationId),
        )
        .collect()
    );
    expect(projects.filter((project) => project.archivedAt === undefined)).toHaveLength(3);

    const events = await t.run(async (ctx) =>
      await ctx.db.query("events").collect()
    );
    const capacityEvents = events.filter(
      (event) => event.type === "organization.project_capacity_changed",
    );
    expect(capacityEvents).toHaveLength(2);
    expect(capacityEvents[0]).toMatchObject({
      organizationId: organization.organizationId,
      requestId: "capacity-grant-1",
      data: {
        beforeLimit: 1,
        afterLimit: 3,
        reason: "Approved beta capacity",
      },
    });
    expect(JSON.stringify(capacityEvents)).not.toContain(email);

    const cleared = await t.mutation(internal.operators.projectCapacity.setOverride, {
      email,
      activeProjectLimit: null,
      expectedRevision: 2,
      reason: "Return to the standard free allowance",
      requestId: "capacity-clear-1",
    });
    expect(cleared).toMatchObject({
      changed: true,
      source: "plan",
      activeProjectLimit: 1,
      overLimit: true,
      revision: 3,
    });
  });

  it("enforces the effective capacity when an archived project is restored", async () => {
    const email = "restore-capacity@example.test";
    const t = convexTest(schema, modules).withIdentity({
      tokenIdentifier: "https://human.example.test|restore-capacity",
      subject: "restore-capacity",
      issuer: "https://human.example.test",
      email,
      name: "Restore Capacity",
    });
    await t.mutation(api.domains.identity.index.bootstrapCurrentUser, {});
    const organization = await t.mutation(
      api.domains.projects.index.createPersonalOrganization,
      { name: "Restore Test", slug: `restore-${crypto.randomUUID()}` },
    );
    await t.mutation(internal.operators.projectCapacity.setOverride, {
      email,
      activeProjectLimit: 2,
      expectedRevision: 0,
      reason: "Allow a second active project",
      requestId: "restore-capacity-grant",
    });
    await t.mutation(internal.domains.projects.index.createProject, {
      organizationId: organization.organizationId,
      name: "First",
      slug: "first",
      identifierPrefix: "FIRST",
      executionMode: "manual",
    });
    const second = await t.mutation(internal.domains.projects.index.createProject, {
      organizationId: organization.organizationId,
      name: "Second",
      slug: "second",
      identifierPrefix: "SECOND",
      executionMode: "manual",
    });
    await t.mutation(api.domains.projects.index.archiveProject, {
      projectId: second.projectId,
    });
    await t.mutation(internal.operators.projectCapacity.setOverride, {
      email,
      activeProjectLimit: null,
      expectedRevision: 1,
      reason: "Return to the standard allowance",
      requestId: "restore-capacity-clear",
    });
    await expect(t.mutation(api.domains.projects.index.unarchiveProject, {
      projectId: second.projectId,
    })).rejects.toMatchObject({
      data: {
        code: "plan_limit",
        details: { source: "plan", limit: 1, activeProjectCount: 1 },
      },
    });
    await t.mutation(internal.operators.projectCapacity.setOverride, {
      email,
      activeProjectLimit: 2,
      expectedRevision: 2,
      reason: "Restore the second-project allowance",
      requestId: "restore-capacity-regrant",
    });
    await expect(t.mutation(api.domains.projects.index.unarchiveProject, {
      projectId: second.projectId,
    })).resolves.toEqual({ unarchived: true });
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
