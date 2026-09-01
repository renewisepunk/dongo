import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import type { Id } from "../_generated/dataModel";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { modules } from "../test.setup";

const tenancyFields = [
  "_creationTime",
  "organizationId",
  "projectId",
] as const;

function expectNoFields(value: unknown, fields: readonly string[]) {
  for (const field of fields) expect(value).not.toHaveProperty(field);
}

describe("human query payloads", () => {
  it("exposes product summaries without storage, tenancy, or credential metadata", async () => {
    const identity = {
      tokenIdentifier: "https://human.example.test|payload-owner",
      subject: "payload-owner",
      issuer: "https://human.example.test",
      email: "payload@example.test",
      name: "Payload Owner",
    };
    const root = convexTest(schema, modules);
    const human = root.withIdentity(identity);
    const profile = await human.mutation(
      api.domains.identity.index.bootstrapCurrentUser,
      {},
    );
    const organization = await human.mutation(
      api.domains.projects.index.createPersonalOrganization,
      { name: "Payload Test", slug: `payload-${crypto.randomUUID()}` },
    );
    const project = await human.mutation(
      internal.domains.projects.index.createProject,
      {
        organizationId: organization.organizationId,
        name: "Payload Test",
        slug: "payload",
        identifierPrefix: "PAY",
        executionMode: "manual",
      },
    );
    const working = await human.mutation(api.domains.work.index.createForHuman, {
      projectId: project.projectId,
      title: "Working payload",
      description: "Only product fields should reach the browser.",
      kind: "task",
      idempotencyKey: crypto.randomUUID(),
    });
    const needs = await human.mutation(api.domains.work.index.createForHuman, {
      projectId: project.projectId,
      title: "Attention payload",
      kind: "task",
      idempotencyKey: crypto.randomUUID(),
    });
    const done = await human.mutation(api.domains.work.index.createForHuman, {
      projectId: project.projectId,
      title: "Completed payload",
      kind: "task",
      idempotencyKey: crypto.randomUUID(),
    });
    const intake = await human.mutation(api.domains.intake.index.create, {
      projectId: project.projectId,
      text: "Payload boundary intake",
      attachmentIds: [],
      idempotencyKey: crypto.randomUUID(),
    });
    const comment = await human.mutation(
      api.domains.comments.index.createForHuman,
      {
        workItemId: working.workItemId,
        body: "Payload boundary moonstone comment",
        idempotencyKey: crypto.randomUUID(),
      },
    );

    const seeded = await root.run(async (ctx) => {
      const humanActor = await ctx.db
        .query("actors")
        .withIndex("by_organization_profile", (query) =>
          query
            .eq("organizationId", organization.organizationId)
            .eq("profileId", profile.profileId),
        )
        .unique();
      if (!humanActor) throw new Error("human actor fixture missing");
      const now = Date.now();
      const agentActorId = await ctx.db.insert("actors", {
        organizationId: organization.organizationId,
        type: "agent",
        name: "Payload Agent",
        agentType: "test",
        createdAt: now,
      });
      const installationId = await ctx.db.insert("installations", {
        organizationId: organization.organizationId,
        projectId: project.projectId,
        actorId: agentActorId,
        kind: "development",
        status: "active",
        clientId: "payload-test-client",
        label: "Payload Test Client",
        resource: "https://private-resource.invalid",
        scopes: ["dongo:work:read", "dongo:work:write"],
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(agentActorId, { installationId });
      const workingRunId = await ctx.db.insert("runs", {
        organizationId: organization.organizationId,
        projectId: project.projectId,
        workItemId: working.workItemId,
        actorId: agentActorId,
        installationId,
        status: "running",
        summary: "Working safely",
        externalSessionId: "private-session-id",
        failureCode: "private-failure-code",
        startedAt: now,
        lastHeartbeatAt: now,
      });
      const needsRunId = await ctx.db.insert("runs", {
        organizationId: organization.organizationId,
        projectId: project.projectId,
        workItemId: needs.workItemId,
        actorId: agentActorId,
        installationId,
        status: "waiting",
        externalSessionId: "private-attention-session",
        startedAt: now,
        lastHeartbeatAt: now,
      });
      await ctx.db.patch(working.workItemId, {
        state: "working",
        claimedByActorId: agentActorId,
        claimedByInstallationId: installationId,
        claimedRunId: workingRunId,
        claimedAt: now,
        claimExpiresAt: now + 60_000,
      });
      await ctx.db.patch(needs.workItemId, {
        state: "ready",
        claimedByActorId: agentActorId,
        claimedByInstallationId: installationId,
        claimedRunId: needsRunId,
      });
      await ctx.db.patch(done.workItemId, {
        state: "done",
        completedAt: now,
        updatedAt: now,
      });
      const attentionRequestId = await ctx.db.insert("attentionRequests", {
        organizationId: organization.organizationId,
        projectId: project.projectId,
        workItemId: needs.workItemId,
        runId: needsRunId,
        requestedByActorId: agentActorId,
        requestedFromProfileId: profile.profileId,
        kind: "decision",
        title: "Choose safely",
        body: "Select an option.",
        options: ["One", "Two"],
        urgency: "important",
        status: "open",
        createdAt: now,
      });
      const artifactId = await ctx.db.insert("artifacts", {
        organizationId: organization.organizationId,
        projectId: project.projectId,
        workItemId: working.workItemId,
        runId: workingRunId,
        actorId: agentActorId,
        type: "report",
        title: "Payload report",
        metadata: { repositoryPath: "reports/result.md", private: "hidden" },
        createdAt: now,
      });
      await ctx.db.insert("intakeWorkLinks", {
        organizationId: organization.organizationId,
        projectId: project.projectId,
        intakeId: intake.intakeId,
        workItemId: working.workItemId,
        relation: "linked",
        createdAt: now,
      });
      const eventId = await ctx.db.insert("events", {
        organizationId: organization.organizationId,
        projectId: project.projectId,
        intakeId: intake.intakeId,
        workItemId: working.workItemId,
        runId: workingRunId,
        actorId: agentActorId,
        type: "payload.tested",
        data: { private: "must-not-be-returned" },
        requestId: "private-request-id",
        createdAt: now,
      });
      return {
        agentActorId,
        artifactId,
        attentionRequestId,
        eventId,
        workingRunId,
      };
    });

    const current = await human.query(api.domains.identity.index.current, {});
    expectNoFields(current.memberships[0], ["_creationTime", "profileId"]);

    const overview = await human.query(api.domains.overview.index.getForHuman, {
      projectId: project.projectId,
    });
    expect(overview.working[0]?.actor).toMatchObject({
      name: "Payload Agent",
      agentType: "test",
      transport: "development",
      transportLabel: "Payload Test Client",
    });
    expectNoFields(overview.project, ["_creationTime", "organizationId", "nextWorkNumber"]);
    expectNoFields(overview.working[0]?.work, [
      ...tenancyFields,
      "number",
      "createdByActorId",
      "claimedByInstallationId",
      "claimedRunId",
    ]);
    expectNoFields(overview.working[0]?.run, [
      ...tenancyFields,
      "workItemId",
      "installationId",
      "externalSessionId",
      "failureCode",
    ]);
    expectNoFields(overview.working[0]?.actor, [
      ...tenancyFields,
      "profileId",
      "installationId",
    ]);
    expectNoFields(overview.needsYou[0]?.request, [
      ...tenancyFields,
      "runId",
      "requestedFromProfileId",
      "resolvedByActorId",
    ]);
    expectNoFields(overview.inbox[0]?.intake, [
      ...tenancyFields,
      "createdByProfileId",
      "createdByActorId",
      "claimedByActorId",
      "claimedByInstallationId",
    ]);

    const detail = await human.query(api.domains.work.index.getDetailForHuman, {
      workItemId: working.workItemId,
    });
    expect(detail.actors.find((actor) => actor._id === seeded.agentActorId))
      .toMatchObject({
        name: "Payload Agent",
        agentType: "test",
        transport: "development",
        transportLabel: "Payload Test Client",
      });
    expect(detail.runs[0]?._id).toBe(seeded.workingRunId);
    expect(detail.comments[0]?._id).toBe(comment.commentId);
    expect(detail.artifacts[0]).toMatchObject({
      _id: seeded.artifactId,
      repositoryPath: "reports/result.md",
    });
    expect(detail).not.toHaveProperty("sources");
    expectNoFields(detail.comments[0], [...tenancyFields, "workItemId"]);
    expectNoFields(detail.artifacts[0], [
      ...tenancyFields,
      "workItemId",
      "runId",
      "metadata",
    ]);
    expectNoFields(detail.sourceIntakes[0]?.intake, [
      ...tenancyFields,
      "createdByProfileId",
      "createdByActorId",
    ]);

    const compactDetail = await human.query(api.domains.work.index.getForHuman, {
      workItemId: working.workItemId,
    });
    expect(compactDetail).not.toHaveProperty("sources");
    expectNoFields(compactDetail.work, [...tenancyFields, "createdByActorId"]);

    const intakeDetail = await human.query(api.domains.intake.index.getForHuman, {
      intakeId: intake.intakeId,
    });
    expectNoFields(intakeDetail.intake, [...tenancyFields, "createdByProfileId"]);
    expectNoFields(intakeDetail.links[0], ["_creationTime", "organizationId", "projectId", "intakeId"]);

    const attention = await human.query(api.domains.attention.index.listMine, {
      projectId: project.projectId,
    });
    expect(attention[0]?._id).toBe(seeded.attentionRequestId);
    expectNoFields(attention[0], [...tenancyFields, "runId", "requestedFromProfileId"]);

    const events = await human.query(api.domains.events.index.listForHuman, {
      projectId: project.projectId,
      paginationOpts: { cursor: null, numItems: 20 },
    });
    expect(events.page.some((event) => event._id === seeded.eventId)).toBe(true);
    const event = events.page.find((candidate) => candidate._id === seeded.eventId);
    expectNoFields(event, [...tenancyFields, "data", "requestId"]);

    const completed = await human.query(api.domains.work.index.listCompletedForHuman, {
      projectId: project.projectId,
      paginationOpts: { cursor: null, numItems: 20 },
    });
    expect(completed.page.some((item) => item._id === done.workItemId)).toBe(true);
    expectNoFields(completed.page[0], [...tenancyFields, "createdByActorId"]);

    const search = await human.query(api.domains.search.index.commentsForHuman, {
      projectId: project.projectId,
      term: "moonstone",
      paginationOpts: { cursor: null, numItems: 8 },
    });
    expect(search.page[0]).toMatchObject({
      comment: { _id: comment.commentId },
      work: { _id: working.workItemId },
    });
    expectNoFields(search.page[0]?.comment, [...tenancyFields, "workItemId"]);
    expectNoFields(search.page[0]?.work, [...tenancyFields, "createdByActorId"]);

    const workSearch = await human.query(api.domains.search.index.workForHuman, {
      projectId: project.projectId,
      term: "Working",
      paginationOpts: { cursor: null, numItems: 8 },
    });
    expectNoFields(workSearch.page[0], [...tenancyFields, "createdByActorId"]);
    const intakeSearch = await human.query(api.domains.search.index.intakesForHuman, {
      projectId: project.projectId,
      term: "boundary",
      paginationOpts: { cursor: null, numItems: 8 },
    });
    expectNoFields(intakeSearch.page[0], [
      ...tenancyFields,
      "createdByProfileId",
      "createdByActorId",
    ]);
  });
});
