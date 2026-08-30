import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { provisionAuthResource } from "../gateway/outbound";
import { fail } from "../lib/errors";
import type { Id } from "../_generated/dataModel";

type BootstrapResult = {
  profileId: Id<"humanProfiles">;
  organizationId?: Id<"organizations">;
  projectId?: Id<"projects">;
  installationId?: Id<"installations">;
  projectRef?: string;
  projectName?: string;
  created: boolean;
};

export const createWalkingSkeletonAndProvision = internalAction({
  args: {
    key: v.string(),
    organizationSlug: v.string(),
    projectSlug: v.string(),
  },
  handler: async (ctx, args): Promise<
    BootstrapResult & { resourceProvisioned: true }
  > => {
    const result: BootstrapResult = await ctx.runMutation(
      internal.dev.bootstrap.createWalkingSkeleton,
      args,
    );
    if (!result.projectRef || !result.projectName) {
      fail("internal", "Development project bootstrap is incomplete", {
        retryable: true,
      });
    }
    await provisionAuthResource({
      projectRef: result.projectRef,
      projectName: result.projectName,
    });
    return { ...result, resourceProvisioned: true };
  },
});
