import { beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import type { Id } from "../_generated/dataModel";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { modules } from "../test.setup";

beforeEach(() => {
  process.env.DONGO_ENABLE_DEV_BOOTSTRAP = "true";
});

async function identifierFixture() {
  const root = convexTest(schema, modules);
  const key = `identifiers-${crypto.randomUUID()}`;
  const seeded = await root.mutation(
    internal.dev.bootstrap.createWalkingSkeleton,
    {
      key,
      organizationSlug: `identifier-org-${crypto.randomUUID()}`,
      projectSlug: "dongo-identifiers",
    },
  );
  const human = root.withIdentity({
    tokenIdentifier: `development:${key}`,
    subject: key,
    issuer: "development",
    name: "dongo developer",
  });
  const authorization = await root.run(async (ctx) => {
    const project = await ctx.db.get(seeded.projectId!);
    const installation = await ctx.db.get(seeded.installationId!);
    if (!project || !installation) throw new Error("identifier fixture missing");
    return {
      requestId: crypto.randomUUID(),
      installationId: installation._id,
      actorId: installation.actorId,
      organizationId: installation.organizationId,
      projectId: project._id,
      projectRef: project.publicRef,
      resource: installation.resource,
      clientId: installation.clientId,
      scopes: installation.scopes,
    };
  });
  return {
    root,
    human,
    authorization,
    projectId: seeded.projectId!,
    organizationId: seeded.organizationId!,
  };
}

describe("compact work identifiers", () => {
  it("creates canonical identifiers while resolving retained legacy aliases", async () => {
    const fixture = await identifierFixture();
    const created = await fixture.human.mutation(
      api.domains.work.index.createForHuman,
      {
        projectId: fixture.projectId,
        title: "Keep old issue links working",
        kind: "task",
        idempotencyKey: crypto.randomUUID(),
      },
    );
    const stored = await fixture.root.run(async (ctx) => ({
      work: await ctx.db.get(created.workItemId),
      project: await ctx.db.get(fixture.projectId),
      event: await ctx.db
        .query("events")
        .withIndex("by_work_created", (q) => q.eq("workItemId", created.workItemId))
        .filter((q) => q.eq(q.field("type"), "work.created"))
        .unique(),
    }));
    expect(stored.work?.identifier).toBe("dong001");
    expect(stored.project).toMatchObject({
      compactIdentifierPrefix: "dong",
      nextWorkNumber: 2,
    });
    expect(stored.event?.data).toMatchObject({
      identifier: "dong001",
      legacyIdentifiers: ["DON-1"],
    });

    await fixture.root.run((ctx) =>
      ctx.db.patch(created.workItemId, { identifier: "DON-1" })
    );
    for (const identifier of ["dong001", "DON-1"]) {
      const humanDetail = await fixture.human.query(
        api.domains.work.index.getByIdentifierForHuman,
        { projectId: fixture.projectId, identifier },
      );
      expect(humanDetail.work).toMatchObject({
        _id: created.workItemId,
        identifier: "dong001",
        legacyIdentifiers: ["DON-1"],
      });
      const agentDetail = await fixture.root.query(
        internal.gateway.readModels.getWorkByIdentifier,
        { authorization: fixture.authorization, identifier },
      );
      expect(agentDetail).toMatchObject({
        id: created.workItemId,
        identifier: "dong001",
        legacyIdentifiers: ["DON-1"],
      });
      const agentSearch = await fixture.root.query(
        internal.domains.search.index.workForAgent,
        {
          authorization: fixture.authorization,
          term: identifier,
          paginationOpts: { cursor: null, numItems: 10 },
        },
      );
      expect(agentSearch.page[0]).toMatchObject({
        _id: created.workItemId,
        identifier: "dong001",
        legacyIdentifiers: ["DON-1"],
      });
    }
    await fixture.root.run((ctx) =>
      ctx.db.patch(fixture.projectId, { nextWorkNumber: 1 })
    );
    let collision: unknown;
    try {
      await fixture.human.mutation(api.domains.work.index.createForHuman, {
        projectId: fixture.projectId,
        title: "Do not skip a collided sequence",
        kind: "task",
        idempotencyKey: "create-collided-compact-issue",
      });
    } catch (caught) {
      collision = caught;
    }
    expect(collision).toMatchObject({
      data: {
        code: "identifier_conflict",
        message: "The next work identifier is already in use",
        details: { identifier: "dong001", sequence: 1 },
      },
    });
  });

  it("keeps compact collisions unambiguous across project boundaries", async () => {
    const fixture = await identifierFixture();
    const otherProjectId = await fixture.root.run(async (ctx) => {
      const now = Date.now();
      const actor = await ctx.db
        .query("actors")
        .withIndex("by_organization_type", (q) =>
          q.eq("organizationId", fixture.organizationId).eq("type", "system")
        )
        .unique();
      if (!actor) throw new Error("system actor missing");
      const projectId = await ctx.db.insert("projects", {
        organizationId: fixture.organizationId,
        name: "dongo other",
        slug: "dongo-other",
        publicRef: `other-${crypto.randomUUID()}`,
        identifierPrefix: "ALT",
        compactIdentifierPrefix: "dong",
        nextWorkNumber: 2,
        executionMode: "manual",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("workItems", {
        organizationId: fixture.organizationId,
        projectId,
        number: 1,
        identifier: "ALT-1",
        title: "Other project issue",
        kind: "task",
        state: "ready",
        rank: 1_024,
        createdByActorId: actor._id,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      });
      return projectId;
    });
    const original = await fixture.human.mutation(
      api.domains.work.index.createForHuman,
      {
        projectId: fixture.projectId,
        title: "Original project issue",
        kind: "task",
        idempotencyKey: crypto.randomUUID(),
      },
    );
    const originalDetail = await fixture.human.query(
      api.domains.work.index.getByIdentifierForHuman,
      { projectId: fixture.projectId, identifier: "dong001" },
    );
    const otherDetail = await fixture.human.query(
      api.domains.work.index.getByIdentifierForHuman,
      { projectId: otherProjectId, identifier: "dong001" },
    );
    expect(originalDetail.work._id).toBe(original.workItemId);
    expect(otherDetail.work.title).toBe("Other project issue");
    expect(otherDetail.work._id).not.toBe(original.workItemId);
  });

  it("replays creation of sequence 999 before rejecting sequence 1000", async () => {
    const fixture = await identifierFixture();
    await fixture.root.run((ctx) =>
      ctx.db.patch(fixture.projectId, { nextWorkNumber: 999 })
    );
    const input = {
      projectId: fixture.projectId,
      title: "Last compact issue",
      kind: "task" as const,
      idempotencyKey: "create-last-compact-issue",
    };
    const created = await fixture.human.mutation(
      api.domains.work.index.createForHuman,
      input,
    );
    await expect(fixture.human.mutation(
      api.domains.work.index.createForHuman,
      input,
    )).resolves.toEqual(created);
    const detail = await fixture.human.query(
      api.domains.work.index.getDetailForHuman,
      { workItemId: created.workItemId },
    );
    expect(detail.work.identifier).toBe("dong999");

    let error: unknown;
    try {
      await fixture.human.mutation(api.domains.work.index.createForHuman, {
        ...input,
        title: "One issue too many",
        idempotencyKey: "create-exhausted-compact-issue",
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      data: {
        code: "identifier_exhausted",
        message: "This project has used all 999 work identifiers",
        details: {
          maxSequence: 999,
          nextSequence: 1000,
          action: "use_another_project",
        },
      },
    });
    const storedCount = await fixture.root.run(async (ctx) =>
      (await ctx.db
        .query("workItems")
        .withIndex("by_project_state_rank", (q) =>
          q.eq("projectId", fixture.projectId).eq("state", "ready"),
        )
        .collect()).length
    );
    expect(storedCount).toBe(1);
  });
});
