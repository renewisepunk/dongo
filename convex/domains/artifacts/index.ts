import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import {
  agentContextValidator,
  artifactTypeValidator,
  MAX_TITLE_LENGTH,
} from "../../lib/validators";
import { assertSameProject, resolveAgentPrincipal } from "../../lib/authz";
import { appendEvent } from "../../lib/events";
import {
  assertJsonSize,
  fail,
  optionalString,
  requireString,
} from "../../lib/errors";
import { runIdempotent } from "../../lib/idempotency";

export const create = internalMutation({
  args: {
    authorization: agentContextValidator,
    workItemId: v.id("workItems"),
    runId: v.optional(v.id("runs")),
    type: artifactTypeValidator,
    title: v.string(),
    url: v.optional(v.string()),
    metadata: v.optional(v.any()),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await resolveAgentPrincipal(
      ctx,
      args.authorization,
      "dongo:work:write",
    );
    const work = await ctx.db.get(args.workItemId);
    if (!work) fail("not_found", "Work item not found");
    assertSameProject(work, principal.project);
    if (args.runId) {
      const run = await ctx.db.get(args.runId);
      if (
        !run ||
        run.workItemId !== work._id ||
        run.installationId !== principal.installation._id
      ) {
        fail("not_found", "Run not found");
      }
    }
    const title = requireString(args.title, "title", MAX_TITLE_LENGTH);
    const url = optionalString(args.url, "url", 2_048);
    if (
      ["commit", "pull_request", "deployment", "preview", "url"].includes(
        args.type,
      ) && !url
    ) {
      fail("validation", `${args.type} artifacts require a URL`);
    }
    if (args.metadata !== undefined) assertJsonSize(args.metadata, 8_192);
    const now = Date.now();
    return await runIdempotent(
      ctx,
      {
        organizationId: work.organizationId,
        projectId: work.projectId,
        principalKey: principal.principalKey,
        operation: "artifact.create",
        key: args.idempotencyKey,
        payload: {
          workItemId: work._id,
          runId: args.runId,
          type: args.type,
          title,
          url,
          metadata: args.metadata,
        },
        now,
      },
      async () => {
        const artifactId = await ctx.db.insert("artifacts", {
          organizationId: work.organizationId,
          projectId: work.projectId,
          workItemId: work._id,
          runId: args.runId,
          actorId: principal.actor._id,
          type: args.type,
          title,
          url,
          metadata: args.metadata,
          createdAt: now,
        });
        await appendEvent(ctx, {
          organizationId: work.organizationId,
          projectId: work.projectId,
          workItemId: work._id,
          runId: args.runId,
          actorId: principal.actor._id,
          type: "artifact.created",
          data: { artifactId, artifactType: args.type },
          requestId: principal.requestId,
          createdAt: now,
        });
        return { artifactId };
      },
    );
  },
});
