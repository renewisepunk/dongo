import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { modules } from "../test.setup";

const superAdminIdentity = {
  tokenIdentifier: "https://human.example.test|platform-admin",
  subject: "platform-admin",
  issuer: "https://human.example.test",
  email: "rene@wisepunk.com",
  name: "Platform Admin",
};

const ordinaryIdentity = {
  tokenIdentifier: "https://human.example.test|ordinary",
  subject: "ordinary",
  issuer: "https://human.example.test",
  email: "ordinary@example.test",
  name: "Ordinary User",
};

beforeEach(() => {
  process.env.DONGO_ENABLE_DEV_BOOTSTRAP = "true";
});

afterEach(() => {
  delete process.env.DONGO_ENABLE_DEV_BOOTSTRAP;
});

function objectContainsKey(value: unknown, forbidden: Set<string>): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => objectContainsKey(item, forbidden));
  }
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) =>
    forbidden.has(key) || objectContainsKey(child, forbidden));
}

async function setupOrganization() {
  const root = convexTest(schema, modules);
  const admin = root.withIdentity(superAdminIdentity);
  const ordinary = root.withIdentity(ordinaryIdentity);
  const bootstrap = await admin.mutation(
    api.domains.identity.index.bootstrapCurrentUser,
    {},
  );
  expect(bootstrap).toMatchObject({ isSuperAdmin: true });
  await ordinary.mutation(api.domains.identity.index.bootstrapCurrentUser, {});
  const organization = await admin.mutation(
    api.domains.projects.index.createPersonalOrganization,
    { name: "Platform Test", slug: `platform-${crypto.randomUUID()}` },
  );
  const project = await admin.mutation(
    internal.domains.projects.index.createProject,
    {
      organizationId: organization.organizationId,
      name: "Platform Test",
      slug: "platform",
      identifierPrefix: "PLT",
      executionMode: "manual",
    },
  );
  return { root, admin, ordinary, organization, project };
}

async function loadDashboard(
  admin: Awaited<ReturnType<typeof setupOrganization>>["admin"],
) {
  const [metadata, accounts, organizations] = await Promise.all([
    admin.query(api.domains.platformAdministration.index.dashboard, {}),
    admin.query(api.domains.platformAdministration.index.accountsPage, {
      cursor: null,
    }),
    admin.query(api.domains.platformAdministration.index.organizationsPage, {
      cursor: null,
    }),
  ]);
  return {
    ...metadata,
    accounts: accounts.rows,
    organizations: organizations.rows,
    accountCursor: accounts.cursor,
    organizationCursor: organizations.cursor,
  };
}

describe("platform administration", () => {
  it("derives super-admin access and exposes only bounded aggregate usage", async () => {
    const { admin, ordinary, organization } = await setupOrganization();
    await expect(ordinary.query(
      api.domains.platformAdministration.index.dashboard,
      {},
    )).rejects.toThrow();
    await expect(ordinary.mutation(
      api.domains.platformAdministration.index.updateOrganizationAllowances,
      {
        organizationId: organization.organizationId,
        activeProjectLimit: 2,
        totalWorkItemLimit: 300,
        expectedProjectCapacityRevision: 0,
        expectedWorkCapacityRevision: 0,
        reason: "Unauthorized",
        idempotencyKey: "ordinary-user-denied",
      },
    )).rejects.toThrow();

    const dashboard = await loadDashboard(admin);
    expect(dashboard.accounts.length).toBeLessThanOrEqual(25);
    expect(dashboard.organizations.length).toBeLessThanOrEqual(25);
    expect(dashboard.accounts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        email: superAdminIdentity.email,
        usage: expect.objectContaining({ workItemsCreated: 0, workItemsClosed: 0 }),
      }),
    ]));
    expect(dashboard.organizations[0]).toMatchObject({
      plan: "free",
      projectCapacityRevision: 0,
      workCapacityRevision: 0,
      projects: { active: 1, limit: 1 },
      workItems: { total: 0, totalIsExact: true, limit: 250 },
      billing: { status: "not_configured", provider: null },
    });
    expect(objectContainsKey(
      dashboard,
      new Set(["title", "description", "body", "attachments", "attachmentIds"]),
    )).toBe(false);
  });

  it("maps each organization to the people who own it", async () => {
    const { admin } = await setupOrganization();
    const dashboard = await loadDashboard(admin);
    const organization = dashboard.organizations[0];
    expect(organization.members).toMatchObject({ count: 1, truncated: false });
    expect(organization.members.people).toEqual([
      expect.objectContaining({
        name: superAdminIdentity.name,
        email: superAdminIdentity.email,
        role: "owner",
      }),
    ]);
    expect(objectContainsKey(
      dashboard,
      new Set(["title", "description", "body", "attachments", "attachmentIds"]),
    )).toBe(false);
  });

  it("keeps later owners visible before truncating a large membership list", async () => {
    const { root, admin, organization } = await setupOrganization();
    await root.run(async (ctx) => {
      for (let index = 0; index < 27; index++) {
        const profileId = await ctx.db.insert("humanProfiles", {
          authSubject: `late-owner-${index}`, name: index === 26 ? "Later Owner" : `Member ${index}`,
          email: `member-${index}@example.test`, createdAt: index, updatedAt: index,
        });
        await ctx.db.insert("memberships", { organizationId: organization.organizationId,
          profileId, role: index === 26 ? "owner" : "member", createdAt: index });
      }
    });
    const dashboard = await loadDashboard(admin);
    const members = dashboard.organizations[0].members;
    expect(members.count).toBe(25);
    expect(members.truncated).toBe(true);
    expect(members.people).toHaveLength(25);
    expect(members.people.some((person) => person.name === "Later Owner" && person.role === "owner")).toBe(true);
    expect(members.people.slice(0, 2).map((person) => person.role)).toEqual(["owner", "owner"]);
  });

  it("keeps account and organization row 26 reachable through bounded cursors", async () => {
    const { admin, organization } = await setupOrganization();
    const adminProfile = await admin.query(api.domains.identity.index.current, {});
    await admin.run(async (ctx) => {
      const now = Date.now();
      for (let index = 0; index < 25; index += 1) {
        await ctx.db.insert("humanProfiles", {
          authSubject: `pagination-${index}`,
          email: `pagination-${index}@example.test`,
          name: `Pagination ${index}`,
          createdAt: now + index,
          updatedAt: now + index,
        });
        await ctx.db.insert("organizations", {
          name: `Pagination ${index}`,
          slug: `pagination-${index}`,
          createdByProfileId: adminProfile.profile._id,
          plan: "free",
          createdWorkItemCount: 0,
          workItemCountState: "exact",
          closedWorkItemCount: 0,
          usageTrackingStartedAt: now,
          createdAt: now + index,
          updatedAt: now + index,
        });
      }
    });
    const dashboard = await loadDashboard(admin);
    expect(dashboard.accounts).toHaveLength(25);
    expect(dashboard.organizations).toHaveLength(25);
    expect(dashboard.accountCursor).toEqual(expect.any(String));
    expect(dashboard.organizationCursor).toEqual(expect.any(String));

    const accountPage = await admin.query(
      api.domains.platformAdministration.index.accountsPage,
      { cursor: dashboard.accountCursor! },
    );
    expect(accountPage.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ email: superAdminIdentity.email }),
    ]));
    const organizationPage = await admin.query(
      api.domains.platformAdministration.index.organizationsPage,
      { cursor: dashboard.organizationCursor! },
    );
    expect(organizationPage.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ organizationId: organization.organizationId }),
    ]));
  });

  it("marks bounded active-project usage as a lower bound", async () => {
    const { admin, organization } = await setupOrganization();
    await admin.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.patch(organization.organizationId, { plan: "paid" });
      for (let index = 1; index <= 100; index += 1) {
        await ctx.db.insert("projects", {
          organizationId: organization.organizationId,
          name: `Additional ${index}`,
          slug: `additional-${index}`,
          publicRef: `additional-${index}`,
          identifierPrefix: `A${String(index).padStart(2, "0")}`,
          nextWorkNumber: 1,
          executionMode: "manual",
          createdAt: now,
          updatedAt: now,
        });
      }
    });
    const dashboard = await loadDashboard(admin);
    expect(dashboard.organizations[0].projects).toMatchObject({
      active: 100,
      activeTruncated: true,
    });
  });

  it("shares project-capacity revisions with the deployment operator and audits both paths", async () => {
    const { admin, root, organization } = await setupOrganization();
    const updated = await admin.mutation(
      api.domains.platformAdministration.index.updateOrganizationAllowances,
      {
        organizationId: organization.organizationId,
        activeProjectLimit: 4,
        totalWorkItemLimit: 400,
        expectedProjectCapacityRevision: 0,
        expectedWorkCapacityRevision: 0,
        reason: "Approved pilot",
        idempotencyKey: "platform-allowance-1",
      },
    );
    expect(updated).toMatchObject({
      changed: true,
      projectCapacityRevision: 1,
      workCapacityRevision: 1,
      projects: { limit: 4, source: "operator_override" },
      workItems: { limit: 400, source: "operator_override" },
    });
    expect(await admin.mutation(
      api.domains.platformAdministration.index.updateOrganizationAllowances,
      {
        organizationId: organization.organizationId,
        activeProjectLimit: 4,
        totalWorkItemLimit: 400,
        expectedProjectCapacityRevision: 0,
        expectedWorkCapacityRevision: 0,
        reason: "Approved pilot",
        idempotencyKey: "platform-allowance-1",
      },
    )).toEqual(updated);
    await expect(admin.mutation(
      api.domains.platformAdministration.index.updateOrganizationAllowances,
      {
        organizationId: organization.organizationId,
        activeProjectLimit: 5,
        totalWorkItemLimit: 400,
        expectedProjectCapacityRevision: 1,
        expectedWorkCapacityRevision: 1,
        reason: "Different payload",
        idempotencyKey: "platform-allowance-1",
      },
    )).rejects.toThrow();

    await expect(root.mutation(internal.operators.projectCapacity.setOverride, {
      email: superAdminIdentity.email,
      organizationSlug: updated.slug,
      activeProjectLimit: 5,
      expectedRevision: 0,
      reason: "stale deployment update",
      requestId: "stale-project-capacity",
    })).rejects.toThrow();

    const events = await root.run(async (ctx) => await ctx.db
      .query("events")
      .withIndex("by_organization_created", (q) =>
        q.eq("organizationId", organization.organizationId),
      )
      .collect());
    const allowanceEvent = events.find((event) =>
      event.type === "organization.allowances_changed",
    );
    expect(allowanceEvent?.data).toMatchObject({
      operator: "super_admin",
      reason: "Approved pilot",
      before: { activeProjectLimit: 1, totalWorkItemLimit: 250 },
      after: { activeProjectLimit: 4, totalWorkItemLimit: 400 },
    });
    expect(JSON.stringify(allowanceEvent)).not.toContain(superAdminIdentity.email);
  });

  it("enforces the Free 250-Work allowance centrally and honors an audited override", async () => {
    const { admin, organization, project } = await setupOrganization();
    await admin.run(async (ctx) => {
      const actor = await ctx.db
        .query("actors")
        .withIndex("by_organization_profile", (q) =>
          q.eq("organizationId", organization.organizationId),
        )
        .first();
      if (!actor) throw new Error("Expected human actor");
      const now = Date.now();
      for (let number = 1; number <= 250; number += 1) {
        await ctx.db.insert("workItems", {
          organizationId: organization.organizationId,
          projectId: project.projectId,
          number,
          identifier: `dong${String(number).padStart(3, "0")}`,
          title: `Work ${number}`,
          kind: "task",
          state: "ready",
          rank: number * 1_024,
          createdByActorId: actor._id,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        });
      }
      await ctx.db.patch(project.projectId, { nextWorkNumber: 251 });
      await ctx.db.patch(organization.organizationId, {
        createdWorkItemCount: 250,
        workItemCountState: "exact",
      });
    });

    await expect(admin.mutation(api.domains.work.index.createForHuman, {
      projectId: project.projectId,
      title: "Blocked Work",
      kind: "task",
      idempotencyKey: "blocked-at-250",
    })).rejects.toThrow();

    await admin.mutation(
      api.domains.platformAdministration.index.updateOrganizationAllowances,
      {
        organizationId: organization.organizationId,
        activeProjectLimit: null,
        totalWorkItemLimit: 251,
        expectedProjectCapacityRevision: 0,
        expectedWorkCapacityRevision: 0,
        reason: "One-item migration allowance",
        idempotencyKey: "work-capacity-251",
      },
    );
    await expect(admin.mutation(api.domains.work.index.createForHuman, {
      projectId: project.projectId,
      title: "Allowed Work",
      kind: "task",
      idempotencyKey: "allowed-at-251",
    })).resolves.toMatchObject({ workItemId: expect.any(String) });
  });

  it("keeps expired platform replay cleanup within the requested total bound", async () => {
    const { root, admin } = await setupOrganization();
    const profileId = (await admin.query(api.domains.identity.index.current, {})).profile._id;
    await root.run(async (ctx) => {
      const now = Date.now() - 1;
      for (let index = 0; index < 3; index += 1) {
        await ctx.db.insert("platformAdminMutationKeys", {
          profileId,
          operation: "organization.allowances.update",
          key: `expired-${index}`,
          canonicalPayload: "{}",
          resultJson: "{}",
          createdAt: now - 1_000,
          expiresAt: now,
        });
      }
    });
    expect(await root.mutation(
      internal.maintenance.removeExpiredIdempotencyKeys,
      { limit: 2 },
    )).toEqual({ removed: 2 });
  });

  it("persists a saturating legacy count so repeated at-cap checks are constant-read", async () => {
    const { admin, root, organization, project } = await setupOrganization();
    await admin.run(async (ctx) => {
      const actor = await ctx.db
        .query("actors")
        .withIndex("by_organization_profile", (q) =>
          q.eq("organizationId", organization.organizationId),
        )
        .first();
      if (!actor) throw new Error("Expected human actor");
      const now = Date.now();
      for (let number = 1; number <= 250; number += 1) {
        await ctx.db.insert("workItems", {
          organizationId: organization.organizationId,
          projectId: project.projectId,
          number,
          identifier: `legacy${String(number).padStart(3, "0")}`,
          title: `Legacy ${number}`,
          kind: "task",
          state: "ready",
          rank: number,
          createdByActorId: actor._id,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        });
      }
      await ctx.db.patch(organization.organizationId, {
        createdWorkItemCount: undefined,
        workItemCountState: undefined,
      });
    });

    expect(await root.mutation(
      internal.maintenance.backfillNextOrganizationWorkItemCount,
      {},
    )).toMatchObject({ complete: false, count: 250, state: "exact" });
    for (const key of ["legacy-cap-a", "legacy-cap-b"]) {
      await expect(admin.mutation(api.domains.work.index.createForHuman, {
        projectId: project.projectId,
        title: "Still blocked",
        kind: "task",
        idempotencyKey: key,
      })).rejects.toThrow();
    }
    const stored = await admin.run(async (ctx) =>
      await ctx.db.get(organization.organizationId));
    expect(stored).toMatchObject({
      createdWorkItemCount: 250,
      workItemCountState: "exact",
    });
  });

  it("stores a safe lower bound for legacy organizations above every finite limit", async () => {
    const { admin, root, organization, project } = await setupOrganization();
    await admin.run(async (ctx) => {
      const actor = await ctx.db
        .query("actors")
        .withIndex("by_organization_profile", (q) =>
          q.eq("organizationId", organization.organizationId),
        )
        .first();
      if (!actor) throw new Error("Expected human actor");
      const now = Date.now();
      for (let number = 1; number <= 1_001; number += 1) {
        await ctx.db.insert("workItems", {
          organizationId: organization.organizationId,
          projectId: project.projectId,
          number,
          identifier: `historic-${number}`,
          title: "Historical Work",
          kind: "task",
          state: "done",
          rank: number,
          createdByActorId: actor._id,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        });
      }
      await ctx.db.patch(organization.organizationId, {
        createdWorkItemCount: undefined,
        workItemCountState: undefined,
      });
    });
    expect(await root.mutation(
      internal.maintenance.backfillNextOrganizationWorkItemCount,
      {},
    )).toMatchObject({
      complete: false,
      count: 1_000,
      state: "at_least_limit",
    });
    const dashboard = await loadDashboard(admin);
    expect(dashboard.organizations[0].workItems).toMatchObject({
      total: 1_000,
      totalIsExact: false,
    });
  });

  it("enforces one shared Work allowance for agent and human creation", async () => {
    const root = convexTest(schema, modules);
    const key = `shared-cap-${crypto.randomUUID()}`;
    const seeded = await root.mutation(
      internal.dev.bootstrap.createWalkingSkeleton,
      {
        key,
        organizationSlug: `shared-cap-${crypto.randomUUID()}`,
        projectSlug: `shared-cap-${crypto.randomUUID()}`,
      },
    );
    await root.run(async (ctx) => await ctx.db.patch(seeded.organizationId!, {
      totalWorkItemLimitOverride: 1,
    }));
    const installation = await root.run(async (ctx) =>
      await ctx.db.get(seeded.installationId!));
    const project = await root.run(async (ctx) => await ctx.db.get(seeded.projectId!));
    if (!installation || !project) throw new Error("Expected development fixture");
    const authorization = {
      requestId: "shared-cap-agent",
      installationId: installation._id,
      actorId: installation.actorId,
      organizationId: installation.organizationId,
      projectId: project._id,
      projectRef: project.publicRef,
      resource: installation.resource,
      clientId: installation.clientId,
      scopes: installation.scopes,
    };
    await root.mutation(internal.domains.work.index.createForAgent, {
      authorization,
      title: "Agent-created Work",
      kind: "task",
      idempotencyKey: "shared-cap-agent-create",
    });
    const human = root.withIdentity({
      tokenIdentifier: `development:${key}`,
      subject: key,
      issuer: "development",
      email: `${key}@development.invalid`,
      name: "dongo developer",
    });
    await expect(human.mutation(api.domains.work.index.createForHuman, {
      projectId: project._id,
      title: "Human blocked by shared cap",
      kind: "task",
      idempotencyKey: "shared-cap-human-create",
    })).rejects.toThrow();
  });

  it("counts a terminal transition once across idempotent replay", async () => {
    const { admin, organization, project } = await setupOrganization();
    const created = await admin.mutation(api.domains.work.index.createForHuman, {
      projectId: project.projectId,
      title: "Close once",
      kind: "task",
      idempotencyKey: "close-once-create",
    });
    const input = {
      workItemId: created.workItemId,
      expectedRevision: 1,
      idempotencyKey: "close-once-cancel",
    };
    const first = await admin.mutation(api.domains.work.index.cancelForHuman, input);
    expect(await admin.mutation(api.domains.work.index.cancelForHuman, input)).toEqual(first);
    const stored = await admin.run(async (ctx) =>
      await ctx.db.get(organization.organizationId));
    expect(stored?.closedWorkItemCount).toBe(1);
  });
});
