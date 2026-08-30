import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { modules } from "../test.setup";

const ownerIdentity = {
  tokenIdentifier: "https://human.example.test|admin-owner",
  subject: "admin-owner",
  issuer: "https://human.example.test",
  email: "owner@example.test",
  name: "Admin Owner",
};

const memberIdentity = {
  tokenIdentifier: "https://human.example.test|admin-member",
  subject: "admin-member",
  issuer: "https://human.example.test",
  email: "member@example.test",
  name: "Project Member",
};

const invitedIdentity = {
  tokenIdentifier: "https://human.example.test|admin-invited",
  subject: "admin-invited",
  issuer: "https://human.example.test",
  email: "invited@example.test",
  name: "Invited Member",
};

describe("project administration", () => {
  it("adds an existing account once and revokes its installations on removal", async () => {
    const root = convexTest(schema, modules);
    const owner = root.withIdentity(ownerIdentity);
    const invited = root.withIdentity({
      ...invitedIdentity,
      email: "INVITED@EXAMPLE.TEST",
    });
    const ownerProfile = await owner.mutation(
      api.domains.identity.index.bootstrapCurrentUser,
      {},
    );
    const invitedProfile = await invited.mutation(
      api.domains.identity.index.bootstrapCurrentUser,
      {},
    );
    const organization = await owner.mutation(
      api.domains.projects.index.createPersonalOrganization,
      { name: "Membership Test", slug: `membership-${crypto.randomUUID()}` },
    );
    const project = await owner.mutation(
      internal.domains.projects.index.createProject,
      {
        organizationId: organization.organizationId,
        name: "Membership Test",
        slug: "membership",
        identifierPrefix: "MEM",
        executionMode: "manual",
      },
    );

    await expect(owner.mutation(api.domains.projects.index.addMember, {
      projectId: project.projectId,
      email: "missing@example.test",
    })).rejects.toThrow();
    const added = await owner.mutation(api.domains.projects.index.addMember, {
      projectId: project.projectId,
      email: "INVITED@EXAMPLE.TEST",
    });
    expect(added).toMatchObject({ created: true, role: "member" });
    const replay = await owner.mutation(api.domains.projects.index.addMember, {
      projectId: project.projectId,
      email: invitedIdentity.email,
    });
    expect(replay).toEqual({
      membershipId: added.membershipId,
      created: false,
      role: "member",
    });
    await expect(invited.query(api.domains.projects.index.administration, {
      projectId: project.projectId,
    })).resolves.toMatchObject({ membershipRole: "member" });
    await expect(invited.mutation(api.domains.projects.index.addMember, {
      projectId: project.projectId,
      email: ownerIdentity.email,
    })).rejects.toThrow();

    const grant = await root.run(async (ctx) => {
      const now = Date.now();
      const actorId = await ctx.db.insert("actors", {
        organizationId: organization.organizationId,
        type: "agent",
        name: "Invited CLI",
        agentType: "cli",
        createdAt: now,
      });
      const installationId = await ctx.db.insert("installations", {
        organizationId: organization.organizationId,
        projectId: project.projectId,
        actorId,
        kind: "cli",
        status: "active",
        clientId: "invited-cli",
        label: "Invited CLI",
        resource: "https://dev.dongo.so/api/agent/v1",
        scopes: ["dongo:work:read"],
        authorizedByProfileId: invitedProfile.profileId,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(actorId, { installationId });
      const bindingId = await ctx.db.insert("oauthBindings", {
        organizationId: organization.organizationId,
        projectId: project.projectId,
        installationId,
        providerIssuer: "https://dev.dongo.so/api/auth",
        providerGrantId: "invited-grant",
        subject: invitedIdentity.subject,
        clientId: "invited-cli",
        resource: "https://dev.dongo.so/api/agent/v1",
        scopes: ["dongo:work:read"],
        status: "active",
        authorizedByProfileId: invitedProfile.profileId,
        createdAt: now,
        updatedAt: now,
      });
      return { bindingId, installationId };
    });

    const removed = await owner.mutation(api.domains.projects.index.removeMember, {
      projectId: project.projectId,
      membershipId: added.membershipId,
    });
    expect(removed).toEqual({ removed: true, revokedInstallationCount: 1 });
    const state = await root.run(async (ctx) => ({
      binding: await ctx.db.get(grant.bindingId),
      installation: await ctx.db.get(grant.installationId),
      membership: await ctx.db
        .query("memberships")
        .withIndex("by_organization_profile", (query) =>
          query
            .eq("organizationId", organization.organizationId)
            .eq("profileId", invitedProfile.profileId),
        )
        .unique(),
      invitedActor: await ctx.db
        .query("actors")
        .withIndex("by_organization_profile", (query) =>
          query
            .eq("organizationId", organization.organizationId)
            .eq("profileId", invitedProfile.profileId),
        )
        .unique(),
      ownerActor: await ctx.db
        .query("actors")
        .withIndex("by_organization_profile", (query) =>
          query
            .eq("organizationId", organization.organizationId)
            .eq("profileId", ownerProfile.profileId),
        )
        .unique(),
    }));
    expect(state.membership).toBeNull();
    expect(state.installation?.status).toBe("revoked");
    expect(state.binding?.status).toBe("revoked");
    expect(state.invitedActor?.type).toBe("human");
    expect(state.ownerActor?.type).toBe("human");
    await expect(invited.query(api.domains.projects.index.administration, {
      projectId: project.projectId,
    })).rejects.toThrow();
  });

  it("serves member-safe data while enforcing owner mutations and quota truth", async () => {
    const root = convexTest(schema, modules);
    const owner = root.withIdentity(ownerIdentity);
    const member = root.withIdentity(memberIdentity);
    await owner.mutation(api.domains.identity.index.bootstrapCurrentUser, {});
    const organization = await owner.mutation(
      api.domains.projects.index.createPersonalOrganization,
      { name: "Admin Test", slug: `admin-${crypto.randomUUID()}` },
    );
    const project = await owner.mutation(internal.domains.projects.index.createProject, {
      organizationId: organization.organizationId,
      name: "Admin Test",
      slug: "admin",
      identifierPrefix: "ADM",
      executionMode: "manual",
    });
    const membershipId = await owner.run(async (ctx) => {
      const now = Date.now();
      const profileId = await ctx.db.insert("humanProfiles", {
        authSubject: memberIdentity.tokenIdentifier,
        email: memberIdentity.email,
        name: memberIdentity.name,
        createdAt: now,
        updatedAt: now,
      });
      const inserted = await ctx.db.insert("memberships", {
        organizationId: organization.organizationId,
        profileId,
        role: "member",
        createdAt: now,
      });
      await ctx.db.insert("actors", {
        organizationId: organization.organizationId,
        type: "human",
        name: memberIdentity.name,
        profileId,
        createdAt: now,
      });
      return inserted;
    });

    const snapshot = await member.query(
      api.domains.projects.index.administration,
      { projectId: project.projectId },
    );
    expect(snapshot).toMatchObject({
      membershipRole: "member",
      activeProjectCount: 1,
      storage: {
        activeBytes: 0,
        reservedBytes: 0,
        limitBytes: 1_073_741_824,
        maximumAttachmentBytes: 262_144_000,
      },
    });
    expect(snapshot.members.map(({ email, role }) => ({ email, role }))).toEqual([
      { email: ownerIdentity.email, role: "owner" },
      { email: memberIdentity.email, role: "member" },
    ]);
    expect(snapshot.project).not.toHaveProperty("nextWorkNumber");
    expect(snapshot.project).not.toHaveProperty("organizationId");
    expect(snapshot.organization).not.toHaveProperty("createdByProfileId");
    const mine = await owner.query(api.domains.projects.index.listMine, {});
    expect(mine).toHaveLength(1);
    expect(mine[0]?.membership).toEqual({
      organizationId: organization.organizationId,
      role: "owner",
    });
    expect(mine[0]?.organization).not.toHaveProperty("createdByProfileId");
    expect(mine[0]?.projects[0]).not.toHaveProperty("nextWorkNumber");

    const installationId = await owner.run(async (ctx) => {
      const profile = await ctx.db
        .query("humanProfiles")
        .withIndex("by_auth_subject", (query) =>
          query.eq("authSubject", ownerIdentity.tokenIdentifier),
        )
        .unique();
      if (!profile) throw new Error("Expected owner profile");
      const now = Date.now();
      const actorId = await ctx.db.insert("actors", {
        organizationId: organization.organizationId,
        type: "agent",
        name: "Test CLI",
        agentType: "cli",
        createdAt: now,
      });
      return await ctx.db.insert("installations", {
        organizationId: organization.organizationId,
        projectId: project.projectId,
        actorId,
        kind: "cli",
        status: "active",
        clientId: "test-cli",
        label: "Test CLI",
        machineLabel: "Test Mac",
        resource: "https://dev.dongo.so/api/agent/v1",
        scopes: ["dongo:work:read"],
        authorizedByProfileId: profile._id,
        createdAt: now,
        updatedAt: now,
        lastUsedAt: now,
      });
    });
    const installations = await owner.query(
      api.domains.installations.index.listForProject,
      { projectId: project.projectId },
    );
    expect(installations).toEqual([
      expect.objectContaining({
        _id: installationId,
        kind: "cli",
        status: "active",
        clientId: "test-cli",
        label: "Test CLI",
        machineLabel: "Test Mac",
        scopes: ["dongo:work:read"],
      }),
    ]);
    expect(installations[0]).not.toHaveProperty("resource");
    expect(installations[0]).not.toHaveProperty("authorizedByProfileId");
    await expect(member.mutation(api.domains.projects.index.updateProject, {
      projectId: project.projectId,
      name: "Forbidden rename",
      executionMode: "manual",
    })).rejects.toThrow();

    await owner.mutation(api.domains.projects.index.updateProject, {
      projectId: project.projectId,
      name: "Renamed project",
      repositoryUrl: "https://github.com/example/dongo",
      executionMode: "autonomous",
    });
    await owner.mutation(api.domains.projects.index.updateOrganization, {
      projectId: project.projectId,
      name: "Renamed organization",
    });
    const updated = await owner.query(api.domains.projects.index.administration, {
      projectId: project.projectId,
    });
    expect(updated.project).toMatchObject({
      name: "Renamed project",
      repositoryUrl: "https://github.com/example/dongo",
      executionMode: "autonomous",
    });
    expect(updated.organization.name).toBe("Renamed organization");
    await expect(owner.mutation(api.domains.projects.index.updateProject, {
      projectId: project.projectId,
      name: "Unsafe repository",
      repositoryUrl: "https://secret@example.com/repository",
      executionMode: "manual",
    })).rejects.toThrow();

    await owner.mutation(api.domains.projects.index.removeMember, {
      projectId: project.projectId,
      membershipId,
    });
    await expect(member.query(api.domains.projects.index.administration, {
      projectId: project.projectId,
    })).rejects.toThrow();
  });

  it("keeps archived data owner-readable and restores within free-plan limits", async () => {
    const owner = convexTest(schema, modules).withIdentity(ownerIdentity);
    await owner.mutation(api.domains.identity.index.bootstrapCurrentUser, {});
    const organization = await owner.mutation(
      api.domains.projects.index.createPersonalOrganization,
      { name: "Archive Test", slug: `archive-${crypto.randomUUID()}` },
    );
    const project = await owner.mutation(internal.domains.projects.index.createProject, {
      organizationId: organization.organizationId,
      name: "Archive Test",
      slug: "archive",
      identifierPrefix: "ARC",
      executionMode: "manual",
    });

    await owner.mutation(api.domains.projects.index.archiveProject, {
      projectId: project.projectId,
    });
    const archived = await owner.query(api.domains.projects.index.administration, {
      projectId: project.projectId,
    });
    expect(archived.project.archivedAt).toBeTypeOf("number");
    await owner.mutation(api.domains.projects.index.unarchiveProject, {
      projectId: project.projectId,
    });
    const restored = await owner.query(api.domains.projects.index.administration, {
      projectId: project.projectId,
    });
    expect(restored.project.archivedAt).toBeUndefined();
  });
});
