import { v } from "convex/values";
import { action } from "../../_generated/server";
import { api } from "../../_generated/api";
import { provisionAuthResource } from "../../gateway/outbound";
import type { Id } from "../../_generated/dataModel";

const projectArgs = {
  organizationId: v.id("organizations"),
  name: v.string(),
  slug: v.string(),
  identifierPrefix: v.string(),
  repositoryUrl: v.optional(v.string()),
  executionMode: v.union(v.literal("manual"), v.literal("autonomous")),
};

export const createAndProvisionResource = action({
  args: projectArgs,
  handler: async (ctx, args): Promise<{
    projectId: Id<"projects">;
    publicRef: string;
    created: boolean;
    resourceProvisioned: true;
  }> => {
    const project: {
      projectId: Id<"projects">;
      publicRef: string;
      created: boolean;
    } = await ctx.runMutation(
      api.domains.projects.index.createProject,
      args,
    );
    await provisionAuthResource({
      projectRef: project.publicRef,
      projectName: args.name,
    });
    return { ...project, resourceProvisioned: true };
  },
});

export const provisionExistingResource = action({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args): Promise<{ resourceProvisioned: true }> => {
    const project = await ctx.runQuery(
      api.domains.projects.index.provisioningInfo,
      args,
    );
    await provisionAuthResource(project);
    return { resourceProvisioned: true };
  },
});
