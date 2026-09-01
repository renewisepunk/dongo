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

  it("lets a project member enrich claimed Intake while preserving the claim", async () => {
    const root = convexTest(schema, modules);
    const owner = root.withIdentity({
      tokenIdentifier: "https://human.example.test|intake-edit-owner",
      subject: "intake-edit-owner",
      issuer: "https://human.example.test",
      email: "intake-edit-owner@example.test",
      name: "Intake Edit Owner",
    });
    const member = root.withIdentity({
      tokenIdentifier: "https://human.example.test|intake-edit-member",
      subject: "intake-edit-member",
      issuer: "https://human.example.test",
      email: "intake-edit-member@example.test",
      name: "Intake Edit Member",
    });
    await owner.mutation(api.domains.identity.index.bootstrapCurrentUser, {});
    const memberProfile = await member.mutation(
      api.domains.identity.index.bootstrapCurrentUser,
      {},
    );
    const organization = await owner.mutation(
      api.domains.projects.index.createPersonalOrganization,
      { name: "Intake Editing", slug: `intake-edit-${crypto.randomUUID()}` },
    );
    const project = await owner.mutation(
      internal.domains.projects.index.createProject,
      {
        organizationId: organization.organizationId,
        name: "Intake Editing",
        slug: "intake-editing",
        identifierPrefix: "IED",
        executionMode: "manual",
      },
    );
    await owner.mutation(api.domains.projects.index.addMember, {
      projectId: project.projectId,
      email: "intake-edit-member@example.test",
    });
    const created = await owner.mutation(api.domains.intake.index.create, {
      projectId: project.projectId,
      text: "Original request",
      context: "Original context",
      links: ["https://example.test/original"],
      attachmentIds: [],
      idempotencyKey: crypto.randomUUID(),
    });
    const reserved = await member.mutation(
      internal.domains.attachments.index.reserve,
      {
        projectId: project.projectId,
        filename: "extra-context.txt",
        mimeType: "text/plain",
        byteSize: 5,
        idempotencyKey: crypto.randomUUID(),
      },
    );
    await root.mutation(internal.domains.attachments.index.finalize, {
      attachmentId: reserved.attachmentId,
      observedByteSize: 5,
      observedMimeType: "text/plain",
    });
    const ownerReserved = await owner.mutation(
      internal.domains.attachments.index.reserve,
      {
        projectId: project.projectId,
        filename: "owner-only.txt",
        mimeType: "text/plain",
        byteSize: 4,
        idempotencyKey: crypto.randomUUID(),
      },
    );
    await root.mutation(internal.domains.attachments.index.finalize, {
      attachmentId: ownerReserved.attachmentId,
      observedByteSize: 4,
      observedMimeType: "text/plain",
    });
    const claim = await root.run(async (ctx) => {
      const now = Date.now();
      const actorId = await ctx.db.insert("actors", {
        organizationId: organization.organizationId,
        type: "agent",
        name: "Claude Code",
        createdAt: now,
      });
      const installationId = await ctx.db.insert("installations", {
        organizationId: organization.organizationId,
        projectId: project.projectId,
        actorId,
        kind: "mcp",
        status: "active",
        clientId: "intake-edit-test",
        label: "Claude Code",
        resource: "https://dongo.so/api/agent/v1",
        scopes: ["dongo:work:read", "dongo:work:write"],
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(actorId, { installationId });
      await ctx.db.patch(created.intakeId, {
        status: "claimed",
        claimedByActorId: actorId,
        claimedByInstallationId: installationId,
        claimedAt: now,
        claimExpiresAt: now + 60_000,
        revision: 2,
        updatedAt: now,
      });
      return { actorId, installationId };
    });
    await expect(member.mutation(api.domains.intake.index.updateForHuman, {
      intakeId: created.intakeId,
      expectedRevision: 2,
      addAttachmentIds: [ownerReserved.attachmentId],
      idempotencyKey: crypto.randomUUID(),
    })).rejects.toThrow("Attachment is not available for this Intake");
    const idempotencyKey = crypto.randomUUID();
    const updateArgs = {
      intakeId: created.intakeId,
      expectedRevision: 2,
      text: "Updated request",
      context: "The member supplied more detail.",
      links: ["https://example.test/design", "https://example.test/design"],
      addAttachmentIds: [reserved.attachmentId],
      idempotencyKey,
    };
    const updated = await member.mutation(
      api.domains.intake.index.updateForHuman,
      updateArgs,
    );
    const replay = await member.mutation(
      api.domains.intake.index.updateForHuman,
      updateArgs,
    );
    expect(replay).toEqual(updated);
    expect(updated).toMatchObject({
      intakeId: created.intakeId,
      revision: 3,
      addedAttachmentIds: [reserved.attachmentId],
    });
    const detail = await member.query(api.domains.intake.index.getForHuman, {
      intakeId: created.intakeId,
    });
    expect(detail.intake).toMatchObject({
      text: "Updated request",
      context: "The member supplied more detail.",
      links: ["https://example.test/design"],
      status: "claimed",
      revision: 3,
    });
    expect(detail.attachments).toEqual([{
      _id: reserved.attachmentId,
      filename: "extra-context.txt",
      mimeType: "text/plain",
      byteSize: 5,
    }]);
    const search = await member.query(
      api.domains.search.index.intakesForHuman,
      {
        projectId: project.projectId,
        term: "Updated",
        paginationOpts: { cursor: null, numItems: 10 },
      },
    );
    expect(search.page[0]).toMatchObject({
      _id: created.intakeId,
      displayLabel: "Updated request",
    });
    const persisted = await root.run(async (ctx) => {
      const events = await ctx.db
        .query("events")
        .withIndex("by_intake_created", (q) =>
          q.eq("intakeId", created.intakeId),
        )
        .collect();
      const actor = await ctx.db
        .query("actors")
        .withIndex("by_organization_profile", (q) =>
          q.eq("organizationId", organization.organizationId)
            .eq("profileId", memberProfile.profileId),
        )
        .unique();
      const intake = await ctx.db.get(created.intakeId);
      return { events, actor, intake };
    });
    expect(persisted.intake).toMatchObject({
      claimedByActorId: claim.actorId,
      claimedByInstallationId: claim.installationId,
    });
    expect(persisted.events.at(-1)).toMatchObject({
      type: "intake.updated",
      actorId: persisted.actor?._id,
      data: {
        changedFields: ["text", "context", "links", "attachments"],
        addedAttachmentCount: 1,
      },
    });

    await expect(member.mutation(api.domains.intake.index.updateForHuman, {
      intakeId: created.intakeId,
      expectedRevision: 2,
      text: "Stale edit",
      idempotencyKey: crypto.randomUUID(),
    })).rejects.toMatchObject({
      data: {
        code: "revision_conflict",
        message: "The Intake changed since it was read",
        details: { expectedRevision: 2, currentRevision: 3 },
      },
    });
  });

  it("enforces editable states, safe links, attachment ownership, and content", async () => {
    const root = convexTest(schema, modules);
    const owner = root.withIdentity({
      tokenIdentifier: "https://human.example.test|intake-guard-owner",
      subject: "intake-guard-owner",
      issuer: "https://human.example.test",
      email: "intake-guard-owner@example.test",
      name: "Intake Guard Owner",
    });
    await owner.mutation(api.domains.identity.index.bootstrapCurrentUser, {});
    const organization = await owner.mutation(
      api.domains.projects.index.createPersonalOrganization,
      { name: "Intake Guards", slug: `intake-guards-${crypto.randomUUID()}` },
    );
    const project = await owner.mutation(
      internal.domains.projects.index.createProject,
      {
        organizationId: organization.organizationId,
        name: "Intake Guards",
        slug: "intake-guards",
        identifierPrefix: "ING",
        executionMode: "manual",
      },
    );
    const created = await owner.mutation(api.domains.intake.index.create, {
      projectId: project.projectId,
      text: "Keep some content",
      attachmentIds: [],
      idempotencyKey: crypto.randomUUID(),
    });
    await expect(owner.mutation(api.domains.intake.index.updateForHuman, {
      intakeId: created.intakeId,
      expectedRevision: 1,
      text: " ",
      idempotencyKey: crypto.randomUUID(),
    })).rejects.toThrow("Intake requires text or an attachment");
    await expect(owner.mutation(api.domains.intake.index.updateForHuman, {
      intakeId: created.intakeId,
      expectedRevision: 1,
      links: ["javascript:alert(1)"],
      idempotencyKey: crypto.randomUUID(),
    })).rejects.toThrow("must use HTTP or HTTPS");
    const outsider = root.withIdentity({
      tokenIdentifier: "https://human.example.test|intake-outsider",
      subject: "intake-outsider",
      issuer: "https://human.example.test",
      email: "intake-outsider@example.test",
      name: "Intake Outsider",
    });
    await outsider.mutation(api.domains.identity.index.bootstrapCurrentUser, {});
    await expect(outsider.mutation(api.domains.intake.index.updateForHuman, {
      intakeId: created.intakeId,
      expectedRevision: 1,
      context: "Unauthorized edit",
      idempotencyKey: crypto.randomUUID(),
    })).rejects.toThrow("Organization or project not found");

    const pending = await owner.mutation(
      internal.domains.attachments.index.reserve,
      {
        projectId: project.projectId,
        filename: "still-uploading.txt",
        mimeType: "text/plain",
        byteSize: 5,
        idempotencyKey: crypto.randomUUID(),
      },
    );
    await expect(owner.mutation(api.domains.intake.index.updateForHuman, {
      intakeId: created.intakeId,
      expectedRevision: 1,
      addAttachmentIds: [pending.attachmentId],
      idempotencyKey: crypto.randomUUID(),
    })).rejects.toThrow("Attachment is not available for this Intake");

    await root.run((ctx) => ctx.db.patch(created.intakeId, {
      status: "processed",
    }));
    await expect(owner.mutation(api.domains.intake.index.updateForHuman, {
      intakeId: created.intakeId,
      expectedRevision: 1,
      context: "Too late",
      idempotencyKey: crypto.randomUUID(),
    })).rejects.toThrow("Processed Intake cannot be edited");
  });

  it("enforces attachment scope and limits and keeps dismissed Intake read-only", async () => {
    const root = convexTest(schema, modules);
    const owner = root.withIdentity({
      tokenIdentifier: "https://human.example.test|intake-limit-owner",
      subject: "intake-limit-owner",
      issuer: "https://human.example.test",
      email: "intake-limit-owner@example.test",
      name: "Intake Limit Owner",
    });
    const profile = await owner.mutation(
      api.domains.identity.index.bootstrapCurrentUser,
      {},
    );
    const organization = await owner.mutation(
      api.domains.projects.index.createPersonalOrganization,
      { name: "Intake Limits", slug: `intake-limits-${crypto.randomUUID()}` },
    );
    const project = await owner.mutation(
      internal.domains.projects.index.createProject,
      {
        organizationId: organization.organizationId,
        name: "Intake Limits",
        slug: "intake-limits",
        identifierPrefix: "INL",
        executionMode: "manual",
      },
    );
    const created = await owner.mutation(api.domains.intake.index.create, {
      projectId: project.projectId,
      text: "Attachment boundary",
      attachmentIds: [],
      idempotencyKey: crypto.randomUUID(),
    });
    const fixtures = await root.run(async (ctx) => {
      const now = Date.now();
      const otherProjectId = await ctx.db.insert("projects", {
        organizationId: organization.organizationId,
        name: "Other Project",
        slug: "other-project",
        publicRef: `project_${crypto.randomUUID().replaceAll("-", "")}`,
        identifierPrefix: "OTH",
        nextWorkNumber: 1,
        executionMode: "manual",
        createdAt: now,
        updatedAt: now,
      });
      const otherIntakeId = await ctx.db.insert("intakes", {
        organizationId: organization.organizationId,
        projectId: project.projectId,
        createdByProfileId: profile.profileId,
        createdByActorId: (await ctx.db
          .query("actors")
          .withIndex("by_organization_profile", (q) =>
            q.eq("organizationId", organization.organizationId)
              .eq("profileId", profile.profileId),
          )
          .unique())!._id,
        text: "Already attached",
        status: "new",
        revision: 1,
        createdAt: now,
        updatedAt: now,
      });
      const insertAttachment = async (
        projectId: typeof project.projectId,
        filename: string,
        intakeId?: typeof created.intakeId,
      ) => await ctx.db.insert("attachments", {
        organizationId: organization.organizationId,
        projectId,
        createdByProfileId: profile.profileId,
        filename,
        mimeType: "text/plain",
        byteSize: 1,
        storageKey: `test/${filename}`,
        status: "available",
        intakeId,
        createdAt: now,
        finalizedAt: now,
      });
      const available = [];
      for (let index = 0; index < 21; index += 1) {
        available.push(await insertAttachment(
          project.projectId,
          `available-${index + 1}.txt`,
        ));
      }
      return {
        available,
        crossProject: await insertAttachment(
          otherProjectId,
          "cross-project.txt",
        ),
        alreadyUsed: await insertAttachment(
          project.projectId,
          "already-used.txt",
          otherIntakeId,
        ),
      };
    });
    for (const unsafeAttachmentId of [
      fixtures.crossProject,
      fixtures.alreadyUsed,
    ]) {
      await expect(owner.mutation(api.domains.intake.index.updateForHuman, {
        intakeId: created.intakeId,
        expectedRevision: 1,
        addAttachmentIds: [unsafeAttachmentId],
        idempotencyKey: crypto.randomUUID(),
      })).rejects.toThrow("Attachment is not available for this Intake");
    }
    const filled = await owner.mutation(api.domains.intake.index.updateForHuman, {
      intakeId: created.intakeId,
      expectedRevision: 1,
      text: " ",
      addAttachmentIds: fixtures.available.slice(0, 20),
      idempotencyKey: crypto.randomUUID(),
    });
    expect(filled).toMatchObject({ revision: 2 });
    expect(filled.addedAttachmentIds).toHaveLength(20);
    const attachmentOnly = await owner.query(
      api.domains.intake.index.getForHuman,
      { intakeId: created.intakeId },
    );
    expect(attachmentOnly.intake.displayLabel).toBe("available-1.txt");
    await expect(owner.mutation(api.domains.intake.index.updateForHuman, {
      intakeId: created.intakeId,
      expectedRevision: 2,
      addAttachmentIds: [fixtures.available[20]!],
      idempotencyKey: crypto.randomUUID(),
    })).rejects.toThrow("An Intake may include at most 20 attachments");

    await root.run((ctx) => ctx.db.patch(created.intakeId, {
      status: "dismissed",
    }));
    await expect(owner.mutation(api.domains.intake.index.updateForHuman, {
      intakeId: created.intakeId,
      expectedRevision: 2,
      context: "Too late",
      idempotencyKey: crypto.randomUUID(),
    })).rejects.toThrow("Processed Intake cannot be edited");
  });
});
