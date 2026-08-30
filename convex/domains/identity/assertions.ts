import { v } from "convex/values";
import { action, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { authSubject, requireMembership } from "../../lib/authz";
import { fail, optionalString } from "../../lib/errors";

const ASSERTION_TTL_SECONDS = 90;

type AssertionClaims = {
  profileId: Id<"humanProfiles">;
  email: string;
  name: string;
  projectRef?: string;
};

export const claimsForCurrentHuman = internalQuery({
  args: {
    authSubject: v.string(),
    projectRef: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<AssertionClaims> => {
    const profile = await ctx.db
      .query("humanProfiles")
      .withIndex("by_auth_subject", (q) =>
        q.eq("authSubject", args.authSubject),
      )
      .unique();
    if (!profile) fail("unauthorized", "Authentication is required");
    if (!profile.email) {
      fail("validation", "A verified email is required for authorization");
    }
    let projectRef: string | undefined;
    if (args.projectRef !== undefined) {
      projectRef = optionalString(args.projectRef, "projectRef", 128);
      if (!projectRef) fail("validation", "projectRef is required");
      const project = await ctx.db
        .query("projects")
        .withIndex("by_public_ref", (q) => q.eq("publicRef", projectRef!))
        .unique();
      if (!project || project.archivedAt !== undefined) {
        fail("not_found", "Project not found");
      }
      await requireMembership(ctx, project.organizationId, profile._id);
    }
    return {
      profileId: profile._id,
      email: profile.email,
      name: profile.name,
      projectRef,
    };
  },
});

export const mintHumanBridgeAssertion = action({
  args: {
    projectRef: v.optional(v.string()),
    returnTo: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    assertion: string;
    expiresAt: number;
    profileId: Id<"humanProfiles">;
    projectRef?: string;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) fail("unauthorized", "Authentication is required");
    const claims: AssertionClaims = await ctx.runQuery(
      internal.domains.identity.assertions.claimsForCurrentHuman,
      {
        authSubject: authSubject(identity),
        projectRef: args.projectRef,
      },
    );
    const secret = process.env.DONGO_HUMAN_ASSERTION_SECRET;
    const issuer = requiredUrlEnv(
      "DONGO_HUMAN_ASSERTION_ISSUER",
      process.env.DONGO_HUMAN_ASSERTION_ISSUER,
    );
    const authIssuer = requiredUrlEnv(
      "DONGO_AUTH_ISSUER",
      process.env.DONGO_AUTH_ISSUER,
    ).replace(/\/$/, "");
    if (!secret || secret.length < 32) {
      fail("internal", "Human assertion signing is not configured");
    }
    const returnTo = optionalString(args.returnTo, "returnTo", 2_048);
    const issuedAt = Math.floor(Date.now() / 1_000);
    const expiresAtSeconds = issuedAt + ASSERTION_TTL_SECONDS;
    const payload = {
      iss: issuer,
      aud: `${authIssuer}/dongo/bridge`,
      sub: claims.profileId,
      jti: crypto.randomUUID(),
      iat: issuedAt,
      exp: expiresAtSeconds,
      email: claims.email,
      name: claims.name,
      profileId: claims.profileId,
      projectRef: claims.projectRef,
      returnTo,
    };
    const header = base64UrlJson({ alg: "HS256", typ: "JWT" });
    const body = base64UrlJson(payload);
    const signingInput = `${header}.${body}`;
    const signature = await signHs256(secret, signingInput);
    return {
      assertion: `${signingInput}.${signature}`,
      expiresAt: expiresAtSeconds * 1_000,
      profileId: claims.profileId,
      projectRef: claims.projectRef,
    };
  },
});

function requiredUrlEnv(name: string, value: string | undefined): string {
  if (!value) fail("internal", `${name} is not configured`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail("internal", `${name} is invalid`);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    fail("internal", `${name} must be an HTTPS URL`);
  }
  return url.toString().replace(/\/$/, "");
}

function base64UrlJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function signHs256(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64Url(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
    ),
  );
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
