import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";

import { api, internal } from "../_generated/api";
import schema from "../schema";
import { modules } from "../test.setup";

function humanIdentity(subject: string) {
  return {
    tokenIdentifier: `https://human.example.test|${subject}`,
    subject,
    issuer: "https://human.example.test",
    email: `${subject}@example.test`,
    name: "Overview Owner",
  };
}

describe("cross-project overview", () => {
  it("groups only accessible active projects and applies project priority order", async () => {
    const t = convexTest(schema, modules).withIdentity(humanIdentity("cross-project-owner"));
    const profile = await t.mutation(api.domains.identity.index.bootstrapCurrentUser, {});
    const organization = await t.mutation(
      api.domains.projects.index.createPersonalOrganization,
      { name: "Paid Studio", slug: `paid-${crypto.randomUUID()}` },
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(organization.organizationId, { plan: "paid" });
    });
    const first = await t.mutation(internal.domains.projects.index.createProject, {
      organizationId: organization.organizationId,
      name: "Alpha",
      slug: "alpha",
      identifierPrefix: "ALPHA",
      executionMode: "manual",
    });
    const second = await t.mutation(internal.domains.projects.index.createProject, {
      organizationId: organization.organizationId,
      name: "Beta",
      slug: "beta",
      identifierPrefix: "BETA",
      executionMode: "manual",
    });
    const attentionWork = await t.mutation(api.domains.work.index.createForHuman, {
      projectId: first.projectId,
      title: "Review the launch decision",
      kind: "task",
      idempotencyKey: "cross-project-attention-work",
    });
    await t.mutation(api.domains.work.index.createForHuman, {
      projectId: second.projectId,
      title: "Prepare the beta release",
      kind: "task",
      idempotencyKey: "cross-project-ready-work",
    });

    await t.run(async (ctx) => {
      const actor = await ctx.db
        .query("actors")
        .withIndex("by_organization_profile", (q) =>
          q
            .eq("organizationId", organization.organizationId)
            .eq("profileId", profile.profileId),
        )
        .unique();
      if (!actor) throw new Error("human actor fixture missing");
      await ctx.db.insert("attentionRequests", {
        organizationId: organization.organizationId,
        projectId: first.projectId,
        workItemId: attentionWork.workItemId,
        requestedByActorId: actor._id,
        requestedFromProfileId: profile.profileId,
        kind: "decision",
        title: "Choose the launch window",
        urgency: "important",
        status: "open",
        createdAt: Date.now(),
      });

      const privateOrganizationId = await ctx.db.insert("organizations", {
        name: "Private Studio",
        slug: "private-studio",
        createdByProfileId: profile.profileId,
        plan: "paid",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("projects", {
        organizationId: privateOrganizationId,
        name: "Secret",
        slug: "secret",
        publicRef: "private-secret",
        identifierPrefix: "SECRET",
        nextWorkNumber: 1,
        executionMode: "manual",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const result = await t.query(api.domains.overview.index.getAcrossProjectsForHuman, {});

    expect(result.truncated).toBe(false);
    expect(result.organizations).toHaveLength(1);
    expect(result.organizations[0]).toMatchObject({
      organization: { name: "Paid Studio", plan: "paid" },
      crossProjectOverview: { enabled: true, source: "plan" },
    });
    expect(result.organizations[0]?.projects.map((entry) => entry.project.name)).toEqual([
      "Alpha",
      "Beta",
    ]);
    expect(result.organizations[0]?.projects[0]?.priority).toMatchObject({
      kind: "needs_you",
      title: "Choose the launch window",
      target: { kind: "work", identifier: "alph001" },
    });
    expect(result.organizations[0]?.projects[1]?.priority).toMatchObject({
      kind: "ready",
      title: "Prepare the beta release",
      target: { kind: "work", identifier: "beta001" },
    });
    expect(JSON.stringify(result)).not.toContain("Private Studio");
    expect(JSON.stringify(result)).not.toContain("Secret");
  });

  it("keeps operator-expanded Free organizations locked and excludes archived projects", async () => {
    const t = convexTest(schema, modules).withIdentity(humanIdentity("cross-project-free"));
    await t.mutation(api.domains.identity.index.bootstrapCurrentUser, {});
    const organization = await t.mutation(
      api.domains.projects.index.createPersonalOrganization,
      { name: "Free Studio", slug: `free-${crypto.randomUUID()}` },
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(organization.organizationId, { activeProjectLimitOverride: 3 });
    });
    const active = await t.mutation(internal.domains.projects.index.createProject, {
      organizationId: organization.organizationId,
      name: "Active",
      slug: "active",
      identifierPrefix: "ACTIVE",
      executionMode: "manual",
    });
    const archived = await t.mutation(internal.domains.projects.index.createProject, {
      organizationId: organization.organizationId,
      name: "Archived",
      slug: "archived",
      identifierPrefix: "ARCH",
      executionMode: "manual",
    });
    await t.mutation(api.domains.work.index.createForHuman, {
      projectId: active.projectId,
      title: "Must stay behind the plan boundary",
      kind: "task",
      idempotencyKey: "cross-project-free-work",
    });
    await t.mutation(api.domains.projects.index.archiveProject, {
      projectId: archived.projectId,
    });

    const result = await t.query(api.domains.overview.index.getAcrossProjectsForHuman, {});

    expect(result.organizations[0]).toMatchObject({
      organization: { name: "Free Studio", plan: "free" },
      crossProjectOverview: { enabled: false, source: "plan" },
      projects: [{
        project: { name: "Active" },
        priority: null,
      }],
    });
    expect(JSON.stringify(result)).not.toContain("Must stay behind the plan boundary");
    expect(JSON.stringify(result)).not.toContain("Archived");
  });
});
