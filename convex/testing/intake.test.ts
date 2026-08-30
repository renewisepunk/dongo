import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { modules } from "../test.setup";

describe("human Intake creation", () => {
  it("correlates the durable row and returns it exactly once on retry", async () => {
    const t = convexTest(schema, modules).withIdentity({
      tokenIdentifier: "https://human.example.test|intake-owner",
      subject: "intake-owner",
      issuer: "https://human.example.test",
      email: "intake@example.test",
      name: "Intake Owner",
    });
    await t.mutation(api.domains.identity.index.bootstrapCurrentUser, {});
    const organization = await t.mutation(
      api.domains.projects.index.createPersonalOrganization,
      { name: "Intake Test", slug: `intake-${crypto.randomUUID()}` },
    );
    const project = await t.mutation(internal.domains.projects.index.createProject, {
      organizationId: organization.organizationId,
      name: "Intake Test",
      slug: "intake",
      identifierPrefix: "INQ",
      executionMode: "manual",
    });
    const idempotencyKey = crypto.randomUUID();
    const args = {
      projectId: project.projectId,
      text: "Render this immediately",
      attachmentIds: [],
      idempotencyKey,
    };

    const first = await t.mutation(api.domains.intake.index.create, args);
    const retry = await t.mutation(api.domains.intake.index.create, args);
    const state = await t.run(async (ctx) => ({
      intake: await ctx.db.get(first.intakeId),
      count: (await ctx.db.query("intakes").collect()).length,
    }));

    expect(retry).toEqual(first);
    expect(state.count).toBe(1);
    expect(state.intake?.clientRequestId).toBe(idempotencyKey);
  });
});
