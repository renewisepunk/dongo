import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
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

describe("project administration", () => {
  it("serves member-safe data while enforcing owner mutations and quota truth", async () => {
    const root = convexTest(schema, modules);
    const owner = root.withIdentity(ownerIdentity);
    const member = root.withIdentity(memberIdentity);
    await owner.mutation(api.domains.identity.index.bootstrapCurrentUser, {});
    const organization = await owner.mutation(
      api.domains.projects.index.createPersonalOrganization,
      { name: "Admin Test", slug: `admin-${crypto.randomUUID()}` },
    );
    const project = await owner.mutation(api.domains.projects.index.createProject, {
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
    const project = await owner.mutation(api.domains.projects.index.createProject, {
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
