import { v } from "convex/values";
import { action } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { fail } from "../../lib/errors";
import {
  generateServiceCredentialToken,
  hashServiceCredentialToken,
} from "./serviceCredentialSecurity";

function serviceResource(): string {
  const value = process.env.SITE_URL;
  if (!value) fail("internal", "Service credential resource is not configured");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail("internal", "Service credential resource is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    fail("internal", "Service credential resource is invalid");
  }
  return new URL("/api/agent/v1", url).toString();
}

export const createServiceCredential = action({
  args: {
    projectId: v.id("projects"),
    label: v.string(),
    scopes: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<{
    installationId: Id<"installations">;
    serviceCredentialId: Id<"serviceCredentials">;
    tokenPrefix: string;
    token: string;
  }> => {
    if (!(await ctx.auth.getUserIdentity())) {
      fail("unauthorized", "Authentication is required");
    }
    const generated = generateServiceCredentialToken();
    const tokenHash = await hashServiceCredentialToken(generated.token);
    const result: {
      installationId: Id<"installations">;
      serviceCredentialId: Id<"serviceCredentials">;
    } = await ctx.runMutation(
      internal.domains.installations.index.persistServiceCredential,
      {
        projectId: args.projectId,
        label: args.label,
        scopes: args.scopes,
        resource: serviceResource(),
        tokenPrefix: generated.tokenPrefix,
        tokenHash,
      },
    );
    return { ...result, ...generated };
  },
});

