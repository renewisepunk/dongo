import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { modules } from "../test.setup";

const ownerIdentity = {
  tokenIdentifier: "https://human.example.test|changelog-owner",
  subject: "changelog-owner",
  issuer: "https://human.example.test",
  email: "owner@example.test",
  name: "Changelog Owner",
};

const outsiderIdentity = {
  tokenIdentifier: "https://human.example.test|changelog-outsider",
  subject: "changelog-outsider",
  issuer: "https://human.example.test",
  email: "outsider@example.test",
  name: "Changelog Outsider",
};

async function setup() {
  const root = convexTest(schema, modules);
  const owner = root.withIdentity(ownerIdentity);
  const outsider = root.withIdentity(outsiderIdentity);
  const profile = await owner.mutation(
    api.domains.identity.index.bootstrapCurrentUser,
    {},
  );
  await outsider.mutation(api.domains.identity.index.bootstrapCurrentUser, {});
  const organization = await owner.mutation(
    api.domains.projects.index.createPersonalOrganization,
    { name: "Changelog Test", slug: `changelog-${crypto.randomUUID()}` },
  );
  const project = await owner.mutation(
    internal.domains.projects.index.createProject,
    {
      organizationId: organization.organizationId,
      name: "Changelog Test",
      slug: "changelog",
      identifierPrefix: "CHG",
      executionMode: "manual",
    },
  );

  const { publicRef, doneWorkItemId, openWorkItemId } = await root.run(async (ctx) => {
    const actor = await ctx.db
      .query("actors")
      .withIndex("by_organization_profile", (q) =>
        q
          .eq("organizationId", organization.organizationId)
          .eq("profileId", profile.profileId),
      )
      .unique();
    if (!actor) throw new Error("human actor fixture missing");
    const stored = await ctx.db.get(project.projectId);
    const base = {
      organizationId: organization.organizationId,
      projectId: project.projectId,
      kind: "task" as const,
      rank: 1,
      createdByActorId: actor._id,
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    const doneId = await ctx.db.insert("workItems", {
      ...base,
      number: 1,
      identifier: "CHG-1",
      title: "Private internal Work title",
      state: "done",
      completedAt: 10,
    });
    const openId = await ctx.db.insert("workItems", {
      ...base,
      number: 2,
      identifier: "CHG-2",
      title: "Still in progress",
      state: "ready",
      rank: 2,
    });
    return {
      publicRef: stored!.publicRef,
      doneWorkItemId: doneId,
      openWorkItemId: openId,
    };
  });

  return {
    root, owner, outsider, organization, project, publicRef,
    doneWorkItemId, openWorkItemId,
  };
}

describe("owner-curated changelog", () => {
  it("publishes nothing until an owner explicitly says so", async () => {
    const { root, owner, project, publicRef, doneWorkItemId } = await setup();

    const before = await root.query(
      api.domains.changelog.index.publishedEntries,
      { publicRef },
    );
    expect(before.entries).toEqual([]);

    const publishable = await owner.query(
      api.domains.changelog.index.publishableWork,
      { projectId: project.projectId },
    );
    expect(publishable.rows).toEqual([
      expect.objectContaining({ identifier: "CHG-1" }),
    ]);
    expect(publishable.rows[0].published).toBeUndefined();

    await owner.mutation(api.domains.changelog.index.publishEntry, {
      projectId: project.projectId,
      workItemId: doneWorkItemId,
      title: "Faster admin",
      summary: "Owner-authored wording, not the Work title.",
    });

    const after = await root.query(
      api.domains.changelog.index.publishedEntries,
      { publicRef },
    );
    expect(after.entries).toEqual([
      expect.objectContaining({
        title: "Faster admin",
        summary: "Owner-authored wording, not the Work title.",
      }),
    ]);
    // the internal Work title never reaches the public surface
    expect(JSON.stringify(after)).not.toContain("Private internal Work title");
    expect(JSON.stringify(after)).not.toContain("CHG-1");
  });

  it("refuses publication from outside the project and for unfinished Work", async () => {
    const { owner, outsider, project, doneWorkItemId, openWorkItemId } = await setup();

    await expect(outsider.query(
      api.domains.changelog.index.publishableWork,
      { projectId: project.projectId },
    )).rejects.toThrow();

    await expect(outsider.mutation(api.domains.changelog.index.publishEntry, {
      projectId: project.projectId,
      workItemId: doneWorkItemId,
      title: "Not mine",
      summary: "Should never publish.",
    })).rejects.toThrow();

    await expect(owner.mutation(api.domains.changelog.index.publishEntry, {
      projectId: project.projectId,
      workItemId: openWorkItemId,
      title: "Too early",
      summary: "Work is not finished.",
    })).rejects.toThrow();
  });

  it("takes an entry off the public page when it is unpublished", async () => {
    const { root, owner, project, publicRef, doneWorkItemId } = await setup();

    const published = await owner.mutation(
      api.domains.changelog.index.publishEntry,
      {
        projectId: project.projectId,
        workItemId: doneWorkItemId,
        title: "Shipped",
        summary: "Visible for now.",
      },
    );
    expect((await root.query(
      api.domains.changelog.index.publishedEntries,
      { publicRef },
    )).entries).toHaveLength(1);

    await owner.mutation(api.domains.changelog.index.unpublishEntry, {
      projectId: project.projectId,
      entryId: published.entryId,
    });

    expect((await root.query(
      api.domains.changelog.index.publishedEntries,
      { publicRef },
    )).entries).toEqual([]);
  });

  it("re-publishing the same Work edits the entry instead of duplicating it", async () => {
    const { root, owner, project, publicRef, doneWorkItemId } = await setup();
    const first = await owner.mutation(api.domains.changelog.index.publishEntry, {
      projectId: project.projectId,
      workItemId: doneWorkItemId,
      title: "First wording",
      summary: "Initial.",
    });
    const second = await owner.mutation(api.domains.changelog.index.publishEntry, {
      projectId: project.projectId,
      workItemId: doneWorkItemId,
      title: "Revised wording",
      summary: "Corrected.",
    });
    expect(second.entryId).toEqual(first.entryId);
    const { entries } = await root.query(
      api.domains.changelog.index.publishedEntries,
      { publicRef },
    );
    expect(entries).toEqual([
      expect.objectContaining({ title: "Revised wording", summary: "Corrected." }),
    ]);
  });
});
