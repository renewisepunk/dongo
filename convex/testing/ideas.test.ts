import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import type { Id } from "../_generated/dataModel";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { modules } from "../test.setup";

beforeEach(() => {
  process.env.DONGO_ENABLE_DEV_BOOTSTRAP = "true";
});

afterEach(() => {
  delete process.env.DONGO_ENABLE_DEV_BOOTSTRAP;
});

type AgentContext = {
  requestId: string;
  installationId: Id<"installations">;
  actorId: Id<"actors">;
  organizationId: Id<"organizations">;
  projectId: Id<"projects">;
  projectRef: string;
  resource: string;
  clientId: string;
  scopes: string[];
};

async function fixture() {
  const root = convexTest(schema, modules);
  const key = `ideas-${crypto.randomUUID()}`;
  const seeded = await root.mutation(
    internal.dev.bootstrap.createWalkingSkeleton,
    {
      key,
      organizationSlug: `ideas-org-${crypto.randomUUID()}`,
      projectSlug: `ideas-project-${crypto.randomUUID()}`,
    },
  );
  const context = await root.run(async (ctx): Promise<AgentContext> => {
    const installation = await ctx.db.get(seeded.installationId!);
    const project = await ctx.db.get(seeded.projectId!);
    if (!installation || !project) throw new Error("fixture missing");
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
  const human = root.withIdentity({
    tokenIdentifier: `development:${key}`,
    subject: key,
    issuer: "development",
    email: `${key}@development.invalid`,
    name: "Ideas Owner",
  });
  return { root, human, context };
}

async function availableAttachment(
  root: ReturnType<typeof convexTest>,
  human: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>,
  projectId: Id<"projects">,
  filename = "idea-notes.txt",
) {
  const reserved = await human.mutation(
    internal.domains.attachments.index.reserve,
    {
      projectId,
      filename,
      mimeType: "text/plain",
      byteSize: 12,
      idempotencyKey: crypto.randomUUID(),
    },
  );
  await root.mutation(internal.domains.attachments.index.finalize, {
    attachmentId: reserved.attachmentId,
    observedByteSize: 12,
    observedMimeType: "text/plain",
  });
  return reserved.attachmentId;
}

describe("human Ideas backlog", () => {
  it("captures, edits, orders, filters, archives, and restores with revision-safe attribution", async () => {
    const { root, human, context } = await fixture();
    const attachmentId = await availableAttachment(
      root,
      human,
      context.projectId,
    );
    const createKey = crypto.randomUUID();
    const createArgs = {
      projectId: context.projectId,
      title: "A private backlog thought",
      text: "Explore a dedicated workflow",
      context: "This is deliberately not Intake yet.",
      links: ["https://example.test/idea", "https://example.test/idea"],
      attachmentIds: [attachmentId],
      idempotencyKey: createKey,
    };
    const first = await human.mutation(api.domains.ideas.index.create, createArgs);
    expect(await human.mutation(api.domains.ideas.index.create, createArgs))
      .toEqual(first);
    const second = await human.mutation(api.domains.ideas.index.create, {
      projectId: context.projectId,
      title: "Second private thought",
      idempotencyKey: crypto.randomUUID(),
    });
    const detail = await human.query(api.domains.ideas.index.getForHuman, {
      ideaId: first.ideaId,
    });
    expect(detail.idea).toMatchObject({
      title: "A private backlog thought",
      text: "Explore a dedicated workflow",
      context: "This is deliberately not Intake yet.",
      links: ["https://example.test/idea"],
      state: "open",
      revision: 1,
      attachmentCount: 1,
      createdBy: { type: "human" },
      updatedBy: { type: "human" },
    });
    expect(detail.attachments).toEqual([{
      _id: attachmentId,
      filename: "idea-notes.txt",
      mimeType: "text/plain",
      byteSize: 12,
    }]);

    const updateKey = crypto.randomUUID();
    const updateArgs = {
      ideaId: first.ideaId,
      expectedRevision: 1,
      title: "A refined private thought",
      text: "Explore the dedicated workflow carefully",
      idempotencyKey: updateKey,
    };
    const updated = await human.mutation(api.domains.ideas.index.update, updateArgs);
    expect(await human.mutation(api.domains.ideas.index.update, updateArgs))
      .toEqual(updated);
    await expect(human.mutation(api.domains.ideas.index.update, {
      ideaId: first.ideaId,
      expectedRevision: 1,
      text: "stale",
      idempotencyKey: crypto.randomUUID(),
    })).rejects.toThrow("The Idea changed since it was read");

    const reordered = await human.mutation(api.domains.ideas.index.reorder, {
      projectId: context.projectId,
      orderedIdeaIds: [second.ideaId, first.ideaId],
      expectedRevisions: [
        { ideaId: first.ideaId, revision: 2 },
        { ideaId: second.ideaId, revision: 1 },
      ],
      idempotencyKey: crypto.randomUUID(),
    });
    expect(reordered.ideas.map((item) => item.ideaId)).toEqual([
      second.ideaId,
      first.ideaId,
    ]);
    const open = await human.query(api.domains.ideas.index.listForHuman, {
      projectId: context.projectId,
    });
    expect(open.map((idea) => idea._id)).toEqual([second.ideaId, first.ideaId]);

    const archived = await human.mutation(api.domains.ideas.index.archive, {
      ideaId: second.ideaId,
      expectedRevision: 2,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(archived.state).toBe("archived");
    expect(await human.query(api.domains.ideas.index.listForHuman, {
      projectId: context.projectId,
      state: "archived",
    })).toHaveLength(1);
    await expect(human.mutation(api.domains.ideas.index.update, {
      ideaId: second.ideaId,
      expectedRevision: archived.revision,
      text: "archived edits are blocked",
      idempotencyKey: crypto.randomUUID(),
    })).rejects.toThrow("Only open Ideas may be edited");
    const restored = await human.mutation(api.domains.ideas.index.restore, {
      ideaId: second.ideaId,
      expectedRevision: archived.revision,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(restored.state).toBe("open");

    const persisted = await root.run(async (ctx) => ({
      ideas: await ctx.db.query("ideas").collect(),
      events: await ctx.db
        .query("events")
        .withIndex("by_idea_created", (q) => q.eq("ideaId", first.ideaId))
        .collect(),
    }));
    expect(persisted.ideas).toHaveLength(2);
    expect(persisted.events.map((event) => event.type)).toEqual([
      "idea.created",
      "idea.updated",
    ]);

    const outsider = root.withIdentity({
      tokenIdentifier: "https://human.example.test|ideas-outsider",
      subject: "ideas-outsider",
      issuer: "https://human.example.test",
      email: "ideas-outsider@example.test",
      name: "Ideas Outsider",
    });
    await outsider.mutation(api.domains.identity.index.bootstrapCurrentUser, {});
    await expect(outsider.query(api.domains.ideas.index.listForHuman, {
      projectId: context.projectId,
    })).rejects.toThrow();
  });

  it("keeps Ideas and their media agent-invisible until one atomic promotion", async () => {
    const { root, human, context } = await fixture();
    const attachmentId = await availableAttachment(
      root,
      human,
      context.projectId,
      "private-idea.txt",
    );
    const idea = await human.mutation(api.domains.ideas.index.create, {
      projectId: context.projectId,
      title: "Invisible launch concept",
      text: "Secret backlog details",
      attachmentIds: [attachmentId],
      idempotencyKey: crypto.randomUUID(),
    });

    await expect(root.query(internal.domains.attachments.index.getForAgent, {
      authorization: context,
      attachmentId,
    })).rejects.toThrow("Attachment not found");
    const before = await Promise.all([
      root.query(internal.domains.overview.index.getForAgent, {
        authorization: context,
      }),
      root.query(internal.domains.search.index.intakesForAgent, {
        authorization: context,
        term: "Invisible launch concept",
        paginationOpts: { cursor: null, numItems: 10 },
      }),
      root.query(internal.domains.sync.index.snapshot, {
        authorization: context,
      }),
      root.query(internal.domains.agentUpdates.index.read, {
        authorization: context,
        cursor: 0,
      }),
    ]);
    expect(JSON.stringify(before)).not.toContain("Invisible launch concept");
    expect(JSON.stringify(before)).not.toContain("Secret backlog details");
    expect(JSON.stringify(before)).not.toContain(idea.ideaId);
    expect(before[1].page).toEqual([]);
    expect(before[3].updates).toEqual([]);

    const promoteKey = crypto.randomUUID();
    const promoted = await human.mutation(api.domains.ideas.index.promote, {
      ideaId: idea.ideaId,
      expectedRevision: 1,
      idempotencyKey: promoteKey,
    });
    expect(promoted).toMatchObject({
      ideaId: idea.ideaId,
      revision: 2,
      created: true,
    });
    expect(await human.mutation(api.domains.ideas.index.promote, {
      ideaId: idea.ideaId,
      expectedRevision: 1,
      idempotencyKey: promoteKey,
    })).toEqual(promoted);
    expect(await human.mutation(api.domains.ideas.index.promote, {
      ideaId: idea.ideaId,
      expectedRevision: 1,
      idempotencyKey: crypto.randomUUID(),
    })).toEqual({ ...promoted, created: false });

    const state = await root.run(async (ctx) => ({
      intakes: await ctx.db.query("intakes").collect(),
      idea: await ctx.db.get(idea.ideaId),
      attachment: await ctx.db.get(attachmentId),
    }));
    expect(state.intakes).toHaveLength(1);
    expect(state.intakes[0]).toMatchObject({
      _id: promoted.intakeId,
      sourceIdeaId: idea.ideaId,
      text: "Invisible launch concept\n\nSecret backlog details",
      status: "new",
    });
    expect(state.idea).toMatchObject({
      state: "promoted",
      promotedIntakeId: promoted.intakeId,
    });
    expect(state.attachment).toMatchObject({
      ideaId: idea.ideaId,
      intakeId: promoted.intakeId,
    });
    const intakeDetail = await human.query(
      api.domains.intake.index.getForHuman,
      { intakeId: promoted.intakeId },
    );
    expect(intakeDetail.intake.sourceIdeaId).toBe(idea.ideaId);
    const agentAttachment = await root.query(
      internal.domains.attachments.index.getForAgent,
      {
      authorization: context,
      attachmentId,
      },
    );
    expect(agentAttachment).toMatchObject({ intakeId: promoted.intakeId });
    expect(agentAttachment).not.toHaveProperty("ideaId");
    const postPromotionSync = await root.query(
      internal.domains.sync.index.snapshot,
      { authorization: context },
    );
    expect(JSON.stringify(postPromotionSync)).not.toContain(idea.ideaId);
    expect(JSON.stringify(postPromotionSync)).not.toContain("sourceIdeaId");
    const postPromotionSearch = await root.query(
      internal.domains.search.index.intakesForAgent,
      {
        authorization: context,
        term: "Invisible launch concept",
        paginationOpts: { cursor: null, numItems: 10 },
      },
    );
    expect(postPromotionSearch.page).toHaveLength(1);
    expect(postPromotionSearch.page[0]).not.toHaveProperty("sourceIdeaId");
    const promotedFilter = await human.query(
      api.domains.ideas.index.listForHuman,
      { projectId: context.projectId, state: "promoted" },
    );
    expect(promotedFilter).toHaveLength(1);
    expect(promotedFilter[0]).toMatchObject({
      promotedIntakeId: promoted.intakeId,
      state: "promoted",
    });
  });
});
