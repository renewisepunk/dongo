import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { modules } from "../test.setup";

describe("completed Work history", () => {
  it("paginates every completed item in newest-first order for a project member", async () => {
    const t = convexTest(schema, modules).withIdentity({
      tokenIdentifier: "https://human.example.test|history-owner",
      subject: "history-owner",
      issuer: "https://human.example.test",
      email: "history@example.test",
      name: "History Owner",
    });
    const profile = await t.mutation(
      api.domains.identity.index.bootstrapCurrentUser,
      {},
    );
    const organization = await t.mutation(
      api.domains.projects.index.createPersonalOrganization,
      { name: "History Test", slug: `history-${crypto.randomUUID()}` },
    );
    const project = await t.mutation(internal.domains.projects.index.createProject, {
      organizationId: organization.organizationId,
      name: "History Test",
      slug: "history",
      identifierPrefix: "HST",
      executionMode: "manual",
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
      for (let index = 1; index <= 30; index += 1) {
        await ctx.db.insert("workItems", {
          organizationId: organization.organizationId,
          projectId: project.projectId,
          number: index,
          identifier: `HST-${index}`,
          title: `Completed item ${index}`,
          kind: "task",
          state: "done",
          rank: index,
          createdByActorId: actor._id,
          revision: 1,
          createdAt: index,
          updatedAt: index,
          completedAt: index,
        });
      }
    });

    const first = await t.query(
      api.domains.work.index.listCompletedForHuman,
      {
        projectId: project.projectId,
        paginationOpts: { cursor: null, numItems: 20 },
      },
    );
    const second = await t.query(
      api.domains.work.index.listCompletedForHuman,
      {
        projectId: project.projectId,
        paginationOpts: { cursor: first.continueCursor, numItems: 20 },
      },
    );

    expect(first.page.map((item) => item.identifier)).toEqual(
      Array.from({ length: 20 }, (_, index) => `HST-${30 - index}`),
    );
    expect(first.isDone).toBe(false);
    expect(second.page.map((item) => item.identifier)).toEqual(
      Array.from({ length: 10 }, (_, index) => `HST-${10 - index}`),
    );
    expect(second.isDone).toBe(true);
  });
});
