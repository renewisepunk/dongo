import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";
import { modules } from "../test.setup";

describe("project search", () => {
  it("returns an authorized comment match with its durable Work target", async () => {
    const t = convexTest(schema, modules).withIdentity({
      tokenIdentifier: "https://human.example.test|search-owner",
      subject: "search-owner",
      issuer: "https://human.example.test",
      email: "search@example.test",
      name: "Search Owner",
    });
    await t.mutation(api.domains.identity.index.bootstrapCurrentUser, {});
    const organization = await t.mutation(
      api.domains.projects.index.createPersonalOrganization,
      { name: "Search Test", slug: `search-${crypto.randomUUID()}` },
    );
    const project = await t.mutation(api.domains.projects.index.createProject, {
      organizationId: organization.organizationId,
      name: "Search Test",
      slug: "search",
      identifierPrefix: "SRC",
      executionMode: "manual",
    });
    const work = await t.mutation(api.domains.work.index.createForHuman, {
      projectId: project.projectId,
      title: "Repair the callback",
      description: "Authentication return path",
      kind: "bug",
      idempotencyKey: crypto.randomUUID(),
    });
    const comment = await t.mutation(api.domains.comments.index.createForHuman, {
      workItemId: work.workItemId,
      body: "The moonstone callback only fails after refresh.",
      idempotencyKey: crypto.randomUUID(),
    });

    const result = await t.query(api.domains.search.index.commentsForHuman, {
      projectId: project.projectId,
      term: "moonstone",
      paginationOpts: { cursor: null, numItems: 8 },
    });

    expect(result.page).toHaveLength(1);
    expect(result.page[0]).toMatchObject({
      comment: { _id: comment.commentId, workItemId: work.workItemId },
      work: { _id: work.workItemId, title: "Repair the callback" },
    });
  });
});
