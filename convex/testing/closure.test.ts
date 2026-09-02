import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { modules } from "../test.setup";

async function setup() {
  const root = convexTest(schema, modules);
  const owner = root.withIdentity({
    tokenIdentifier: "https://human.example.test|closure-owner",
    subject: "closure-owner",
    issuer: "https://human.example.test",
    email: "closure-owner@example.test",
    name: "Closure Owner",
  });
  await owner.mutation(api.domains.identity.index.bootstrapCurrentUser, {});
  const organization = await owner.mutation(api.domains.projects.index.createPersonalOrganization, {
    name: "Closure Test",
    slug: `closure-${crypto.randomUUID()}`,
  });
  const project = await owner.mutation(internal.domains.projects.index.createProject, {
    organizationId: organization.organizationId,
    name: "Closure Test",
    slug: "closure-test",
    identifierPrefix: "CLS",
    executionMode: "manual",
  });
  return { root, owner, project };
}

describe("human issue closure", () => {
  it("dismisses Intake revision-safely and preserves its reason and audit event", async () => {
    const { root, owner, project } = await setup();
    const created = await owner.mutation(api.domains.intake.index.create, {
      projectId: project.projectId,
      text: "Mistaken request",
      attachmentIds: [],
      idempotencyKey: "closure-intake-create",
    });
    const input = {
      intakeId: created.intakeId,
      expectedRevision: 1,
      reason: "incorrect" as const,
      note: "This was filed against the wrong project.",
      idempotencyKey: "closure-intake-dismiss",
    };
    const closed = await owner.mutation(api.domains.intake.index.dismissForHuman, input);
    expect(await owner.mutation(api.domains.intake.index.dismissForHuman, input)).toEqual(closed);
    const stored = await root.run(async (ctx) => ({
      intake: await ctx.db.get(created.intakeId),
      events: await ctx.db.query("events").withIndex("by_intake_created", (q) => q.eq("intakeId", created.intakeId)).collect(),
    }));
    expect(stored.intake).toMatchObject({ status: "dismissed", closureReason: "incorrect", closureNote: input.note, revision: 2 });
    expect(stored.events.at(-1)).toMatchObject({ type: "intake.dismissed", data: { reason: "incorrect", note: input.note } });
    await expect(owner.mutation(api.domains.intake.index.dismissForHuman, {
      ...input,
      expectedRevision: 2,
      idempotencyKey: "closure-intake-again",
    })).rejects.toThrow("Intake is already closed");
  });

  it("distinguishes completed and cancelled Work and includes both in closed history", async () => {
    const { owner, project } = await setup();
    const completed = await owner.mutation(api.domains.work.index.createForHuman, {
      projectId: project.projectId, title: "Actually finished", kind: "task", idempotencyKey: "closure-work-done-create",
    });
    const cancelled = await owner.mutation(api.domains.work.index.createForHuman, {
      projectId: project.projectId, title: "No longer needed", kind: "task", idempotencyKey: "closure-work-cancel-create",
    });
    await owner.mutation(api.domains.work.index.closeForHuman, {
      workItemId: completed.workItemId, expectedRevision: 1, outcome: "completed", reason: "completed", idempotencyKey: "closure-work-done",
    });
    await owner.mutation(api.domains.work.index.closeForHuman, {
      workItemId: cancelled.workItemId, expectedRevision: 1, outcome: "cancelled", reason: "no_longer_relevant", note: "The requirement changed.", idempotencyKey: "closure-work-cancel",
    });
    const page = await owner.query(api.domains.work.index.listCompletedForHuman, {
      projectId: project.projectId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(page.page.map((work) => work.state).sort()).toEqual(["cancelled", "done"]);
    expect(page.page.find((work) => work.state === "cancelled")).toMatchObject({
      closureReason: "no_longer_relevant",
      closureNote: "The requirement changed.",
    });
  });
});
