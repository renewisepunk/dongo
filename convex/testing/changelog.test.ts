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
      expect.objectContaining({ identifier: "chan001" }),
    ]);
    expect(publishable.rows[0].published).toBeUndefined();

    await owner.mutation(api.domains.changelog.index.publishEntry, {
      projectId: project.projectId,
      workItemId: doneWorkItemId,
      title: "Faster admin",
      expectedRevision: 0, idempotencyKey: crypto.randomUUID(),
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
    expect(JSON.stringify(after)).not.toContain("chan001");
  });

  it("shows canonical identifiers for legacy Work without rewriting stored aliases", async () => {
    const { root, owner, project, doneWorkItemId } = await setup();
    await root.run(async (ctx) => {
      await ctx.db.patch(project.projectId, { compactIdentifierPrefix: "ship" });
      await ctx.db.patch(doneWorkItemId, { number: 999, identifier: "CHG-999" });
    });

    const page = await owner.query(api.domains.changelog.index.publishableWork, {
      projectId: project.projectId,
    });
    expect(page.rows[0].identifier).toBe("ship999");
    const stored = await root.run(async (ctx) => await ctx.db.get(doneWorkItemId));
    expect(stored?.identifier).toBe("CHG-999");
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
      expectedRevision: 0, idempotencyKey: crypto.randomUUID(),
      summary: "Should never publish.",
    })).rejects.toThrow();

    await expect(owner.mutation(api.domains.changelog.index.publishEntry, {
      projectId: project.projectId,
      workItemId: openWorkItemId,
      title: "Too early",
      expectedRevision: 0, idempotencyKey: crypto.randomUUID(),
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
        expectedRevision: 0, idempotencyKey: crypto.randomUUID(),
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
      expectedRevision: published.revision, idempotencyKey: crypto.randomUUID(),
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
      expectedRevision: 0, idempotencyKey: crypto.randomUUID(),
      summary: "Initial.",
    });
    const second = await owner.mutation(api.domains.changelog.index.publishEntry, {
      projectId: project.projectId,
      workItemId: doneWorkItemId,
      title: "Revised wording",
      expectedRevision: first.revision, idempotencyKey: crypto.randomUUID(),
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

describe("changelog concurrency and bounded reads", () => {
  it("replays lost responses, rejects stale edits and unpublishes, and prevents stale resurrection", async () => {
    const { root, owner, project, publicRef, doneWorkItemId } = await setup();
    const input = { projectId: project.projectId, workItemId: doneWorkItemId,
      title: "Reviewed", summary: "Safe wording.", expectedRevision: 0, idempotencyKey: crypto.randomUUID() };
    const first = await owner.mutation(api.domains.changelog.index.publishEntry, input);
    expect(await owner.mutation(api.domains.changelog.index.publishEntry, input)).toEqual(first);
    await expect(owner.mutation(api.domains.changelog.index.publishEntry, { ...input, title: "Different" })).rejects.toThrow(/idempotency/);
    await expect(owner.mutation(api.domains.changelog.index.publishEntry, { ...input, idempotencyKey: crypto.randomUUID() })).rejects.toThrow(/changed/);
    const update = await owner.mutation(api.domains.changelog.index.publishEntry, { ...input,
      expectedRevision: first.revision, idempotencyKey: crypto.randomUUID(), title: "Revised" });
    await expect(owner.mutation(api.domains.changelog.index.unpublishEntry, {
      projectId: project.projectId, entryId: first.entryId,
      expectedRevision: first.revision, idempotencyKey: crypto.randomUUID(),
    })).rejects.toThrow(/changed/);
    const remove = { projectId: project.projectId, entryId: first.entryId,
      expectedRevision: update.revision, idempotencyKey: crypto.randomUUID() };
    const removed = await owner.mutation(api.domains.changelog.index.unpublishEntry, remove);
    expect(await owner.mutation(api.domains.changelog.index.unpublishEntry, remove)).toEqual(removed);
    await expect(owner.mutation(api.domains.changelog.index.publishEntry, { ...input, idempotencyKey: crypto.randomUUID() })).rejects.toThrow(/changed/);
    expect((await root.query(api.domains.changelog.index.publishedEntries, { publicRef })).entries).toEqual([]);
    const events = await root.run(async (ctx) => await ctx.db.query("events").collect());
    expect(events.filter((event) => event.type.startsWith("changelog."))).toHaveLength(3);
  });

  it("finds publication for recent Work beyond 100 older publications", async () => {
    const { root, owner, project, doneWorkItemId } = await setup();
    await root.run(async (ctx) => {
      const work = (await ctx.db.get(doneWorkItemId))!;
      const profile = (await ctx.db.query("humanProfiles").collect())[0]!;
      for (let index = 0; index < 101; index++) {
        const { _id, _creationTime, ...data } = work;
        const id = await ctx.db.insert("workItems", { ...data, number: index + 10,
          identifier: `old${index}`, updatedAt: 0, completedAt: 0 });
        await ctx.db.insert("changelogEntries", { projectId: project.projectId, workItemId: id,
          title: "Old public entry", summary: "Reviewed", publishedAt: index,
          publishedByProfileId: profile._id, createdAt: index, updatedAt: index });
      }
    });
    await owner.mutation(api.domains.changelog.index.publishEntry, {
      projectId: project.projectId, workItemId: doneWorkItemId, title: "Most recent", summary: "Reviewed",
      expectedRevision: 0, idempotencyKey: crypto.randomUUID(),
    });
    const page = await owner.query(api.domains.changelog.index.publishableWork, { projectId: project.projectId });
    expect(page.rows).toHaveLength(50);
    expect(page.truncated).toBe(true);
    expect(page.rows.find((row) => row.workItemId === doneWorkItemId)?.published?.title).toBe("Most recent");
    const older = await owner.query(api.domains.changelog.index.publishableWork, { projectId: project.projectId, cursor: page.cursor });
    expect(older.rows).toHaveLength(50);
    const olderPublished = older.rows.find((row) => row.published)!;
    await owner.mutation(api.domains.changelog.index.unpublishEntry, {
      projectId: project.projectId, entryId: olderPublished.published!.entryId,
      expectedRevision: olderPublished.revision, idempotencyKey: crypto.randomUUID(),
    });
    const refreshed = await owner.query(api.domains.changelog.index.publishableWork, { projectId: project.projectId, cursor: page.cursor });
    expect(refreshed.rows.find((row) => row.workItemId === olderPublished.workItemId)?.published).toBeUndefined();
  });
});
