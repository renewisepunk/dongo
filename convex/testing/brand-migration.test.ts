import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { modules } from "../test.setup";

describe("legacy brand migration", () => {
  it("updates only the exact historical CLI system label and is idempotent", async () => {
    const t = convexTest(schema, modules).withIdentity({
      tokenIdentifier: "https://human.example.test|brand-owner",
      subject: "brand-owner",
      issuer: "https://human.example.test",
      email: "brand@example.test",
      name: "Brand Owner",
    });
    const profile = await t.mutation(api.domains.identity.index.bootstrapCurrentUser, {});
    const organization = await t.mutation(
      api.domains.projects.index.createPersonalOrganization,
      { name: "Brand Test", slug: `brand-${crypto.randomUUID()}` },
    );
    const project = await t.mutation(internal.domains.projects.index.createProject, {
      organizationId: organization.organizationId,
      name: ["Don", "go"].join(""),
      slug: "dongo-user-project",
      identifierPrefix: "DNG",
      executionMode: "manual",
    });
    const seeded = await t.run(async (ctx) => {
      const actorId = await ctx.db.insert("actors", {
        organizationId: organization.organizationId,
        type: "agent",
        name: ["Don", "go CLI"].join(""),
        agentType: "cli",
        createdAt: 1,
      });
      const installationId = await ctx.db.insert("installations", {
        organizationId: organization.organizationId,
        projectId: project.projectId,
        actorId,
        kind: "cli",
        status: "active",
        clientId: "dongo-cli",
        label: ["Don", "go CLI"].join(""),
        resource: "https://dev.dongo.so/api/agent/v1",
        scopes: ["dongo:work:read"],
        authorizedByProfileId: profile.profileId,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.patch(actorId, { installationId });
      return { actorId, installationId };
    });

    await expect(t.mutation(internal.dev.brandMigration.lowercaseLegacyCliLabels, {}))
      .resolves.toMatchObject({ installationsUpdated: 1, actorsUpdated: 1, isDone: true });
    await expect(t.mutation(internal.dev.brandMigration.lowercaseLegacyCliLabels, {}))
      .resolves.toMatchObject({ installationsUpdated: 0, actorsUpdated: 0, isDone: true });

    const result = await t.run(async (ctx) => ({
      actor: await ctx.db.get(seeded.actorId),
      installation: await ctx.db.get(seeded.installationId),
      project: await ctx.db.get(project.projectId),
    }));
    expect(result.actor?.name).toBe("dongo CLI");
    expect(result.installation?.label).toBe("dongo CLI");
    expect(result.project?.name).toBe(["Don", "go"].join(""));
  });
});
