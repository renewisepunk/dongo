import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "../../_generated/server";
import {
  requireHumanProject,
  requireMembership,
  requireOwner,
} from "../../lib/authz";
import { appendEvent } from "../../lib/events";
import { fail, requireString } from "../../lib/errors";

const allowedScopes = new Set([
  "dongo:work:read",
  "dongo:work:write",
  "dongo:attachments:read",
  "offline_access",
]);

function validateScopes(scopes: string[]): string[] {
  const unique = [...new Set(scopes)];
  if (unique.length === 0 || unique.some((scope) => !allowedScopes.has(scope))) {
    fail("validation", "Installation contains an unsupported scope");
  }
  return unique.sort();
}

export const registerOAuthGrant = internalMutation({
  args: {
    projectId: v.optional(v.id("projects")),
    projectRef: v.optional(v.string()),
    authorizedByProfileId: v.optional(v.id("humanProfiles")),
    authSubject: v.optional(v.string()),
    kind: v.union(v.literal("cli"), v.literal("mcp")),
    clientId: v.string(),
    label: v.string(),
    machineLabel: v.optional(v.string()),
    resource: v.string(),
    scopes: v.array(v.string()),
    providerIssuer: v.string(),
    providerGrantId: v.string(),
    subject: v.string(),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if ((!args.projectId && !args.projectRef) || (args.projectId && args.projectRef)) {
      fail("validation", "Exactly one projectId or projectRef is required");
    }
    const project = args.projectId
      ? await ctx.db.get(args.projectId)
      : await ctx.db
          .query("projects")
          .withIndex("by_public_ref", (q) =>
            q.eq("publicRef", requireString(args.projectRef!, "projectRef", 128)),
          )
          .unique();
    if (!project || project.archivedAt !== undefined) {
      fail("not_found", "Project not found");
    }
    if (
      (!args.authorizedByProfileId && !args.authSubject) ||
      (args.authorizedByProfileId && args.authSubject)
    ) {
      fail(
        "validation",
        "Exactly one authorizedByProfileId or authSubject is required",
      );
    }
    const profile = args.authorizedByProfileId
      ? await ctx.db.get(args.authorizedByProfileId)
      : await ctx.db
          .query("humanProfiles")
          .withIndex("by_auth_subject", (q) =>
            q.eq(
              "authSubject",
              requireString(args.authSubject!, "authSubject", 1_000),
            ),
          )
          .unique();
    if (!profile) fail("not_found", "Authorizing profile not found");
    const membership = await requireMembership(
      ctx,
      project.organizationId,
      profile._id,
    );
    requireOwner(membership);
    const now = Date.now();
    const scopes = validateScopes(args.scopes);
    const clientId = requireString(args.clientId, "clientId", 500);
    const label = requireString(args.label, "label", 240);
    const resource = requireString(args.resource, "resource", 2_048);
    const providerIssuer = requireString(
      args.providerIssuer,
      "providerIssuer",
      2_048,
    );
    const providerGrantId = requireString(
      args.providerGrantId,
      "providerGrantId",
      1_000,
    );
    const subject = requireString(args.subject, "subject", 1_000);
    const existing = await ctx.db
      .query("oauthBindings")
      .withIndex("by_provider_grant", (q) =>
        q
          .eq("providerIssuer", providerIssuer)
          .eq("providerGrantId", providerGrantId),
      )
      .unique();
    if (existing) {
      const installation = await ctx.db.get(existing.installationId);
      if (
        !installation ||
        existing.projectId !== project._id ||
        existing.organizationId !== project.organizationId ||
        existing.authorizedByProfileId !== profile._id ||
        existing.clientId !== clientId ||
        existing.subject !== subject ||
        existing.resource !== resource ||
        installation.resource !== resource ||
        installation.kind !== args.kind
      ) {
        fail("forbidden", "OAuth grant is already bound to another installation");
      }
      const reactivated =
        existing.status === "revoked" || installation.status !== "active";
      await ctx.db.patch(existing._id, {
        subject,
        clientId,
        resource,
        scopes,
        status: "active",
        authorizedByProfileId: profile._id,
        updatedAt: now,
        lastValidatedAt: now,
        expiresAt: args.expiresAt,
        revokedAt: undefined,
      });
      await ctx.db.patch(installation._id, {
        status: "active",
        clientId,
        label,
        machineLabel: args.machineLabel,
        resource,
        scopes,
        authorizedByProfileId: profile._id,
        updatedAt: now,
        revokedAt: undefined,
      });
      await ctx.db.patch(installation.actorId, {
        name: label,
        lastSeenAt: now,
      });
      if (reactivated) {
        await appendEvent(ctx, {
          organizationId: project.organizationId,
          projectId: project._id,
          actorId: installation.actorId,
          type: "installation.reauthorized",
          data: { clientId, kind: args.kind, scopes },
          createdAt: now,
        });
      }
      return {
        installationId: existing.installationId,
        oauthBindingId: existing._id,
        actorId: installation.actorId,
        organizationId: project.organizationId,
        projectId: project._id,
        projectRef: project.publicRef,
        created: false,
        reactivated,
      };
    }
    const actorId = await ctx.db.insert("actors", {
      organizationId: project.organizationId,
      type: "agent",
      name: label,
      agentType: args.kind,
      createdAt: now,
      lastSeenAt: now,
    });
    const installationId = await ctx.db.insert("installations", {
      organizationId: project.organizationId,
      projectId: project._id,
      actorId,
      kind: args.kind,
      status: "active",
      clientId,
      label,
      machineLabel: args.machineLabel,
      resource,
      scopes,
      authorizedByProfileId: profile._id,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(actorId, { installationId });
    const oauthBindingId = await ctx.db.insert("oauthBindings", {
      organizationId: project.organizationId,
      projectId: project._id,
      installationId,
      providerIssuer,
      providerGrantId,
      subject,
      clientId,
      resource,
      scopes,
      status: "active",
      authorizedByProfileId: profile._id,
      createdAt: now,
      updatedAt: now,
      lastValidatedAt: now,
      expiresAt: args.expiresAt,
    });
    await appendEvent(ctx, {
      organizationId: project.organizationId,
      projectId: project._id,
      actorId,
      type: "installation.authorized",
      data: { clientId, kind: args.kind, scopes },
      createdAt: now,
    });
    return {
      installationId,
      oauthBindingId,
      actorId,
      organizationId: project.organizationId,
      projectId: project._id,
      projectRef: project.publicRef,
      created: true,
      reactivated: false,
    };
  },
});

export const resolveOAuthGrant = internalQuery({
  args: {
    providerIssuer: v.string(),
    providerGrantId: v.string(),
    subject: v.string(),
    clientId: v.string(),
    resource: v.string(),
    projectRef: v.string(),
    authorizedByProfileId: v.optional(v.id("humanProfiles")),
    authSubject: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (
      (!args.authorizedByProfileId && !args.authSubject) ||
      (args.authorizedByProfileId && args.authSubject)
    ) {
      fail("validation", "Exactly one profileId or authSubject is required");
    }
    const project = await ctx.db
      .query("projects")
      .withIndex("by_public_ref", (q) =>
        q.eq("publicRef", requireString(args.projectRef, "projectRef", 128)),
      )
      .unique();
    if (!project || project.archivedAt !== undefined) {
      fail("unauthorized", "OAuth grant is not active");
    }
    const profile = args.authorizedByProfileId
      ? await ctx.db.get(args.authorizedByProfileId)
      : await ctx.db
          .query("humanProfiles")
          .withIndex("by_auth_subject", (q) =>
            q.eq(
              "authSubject",
              requireString(args.authSubject!, "authSubject", 1_000),
            ),
          )
          .unique();
    if (!profile) fail("unauthorized", "OAuth grant is not active");
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_organization_profile", (q) =>
        q
          .eq("organizationId", project.organizationId)
          .eq("profileId", profile._id),
      )
      .unique();
    if (!membership || membership.role !== "owner") {
      fail("unauthorized", "OAuth grant is not active");
    }
    const providerIssuer = requireString(
      args.providerIssuer,
      "providerIssuer",
      2_048,
    );
    const providerGrantId = requireString(
      args.providerGrantId,
      "providerGrantId",
      1_000,
    );
    const binding = await ctx.db
      .query("oauthBindings")
      .withIndex("by_provider_grant", (q) =>
        q
          .eq("providerIssuer", providerIssuer)
          .eq("providerGrantId", providerGrantId),
      )
      .unique();
    const installation = binding
      ? await ctx.db.get(binding.installationId)
      : null;
    if (
      !binding ||
      !installation ||
      binding.status !== "active" ||
      installation.status !== "active" ||
      (installation.kind !== "cli" && installation.kind !== "mcp") ||
      binding.projectId !== project._id ||
      binding.organizationId !== project.organizationId ||
      binding.authorizedByProfileId !== profile._id ||
      binding.subject !== requireString(args.subject, "subject", 1_000) ||
      binding.clientId !== requireString(args.clientId, "clientId", 500) ||
      binding.resource !== requireString(args.resource, "resource", 2_048) ||
      installation.clientId !== binding.clientId ||
      installation.resource !== binding.resource ||
      (binding.expiresAt !== undefined && binding.expiresAt <= Date.now())
    ) {
      fail("unauthorized", "OAuth grant is not active");
    }
    return {
      installationId: installation._id,
      oauthBindingId: binding._id,
      actorId: installation.actorId,
      organizationId: project.organizationId,
      projectId: project._id,
      projectRef: project.publicRef,
      scopes: binding.scopes,
      kind: installation.kind,
      expiresAt: binding.expiresAt,
    };
  },
});

export const listForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireHumanProject(ctx, args.projectId, { owner: true, allowArchived: true });
    return await ctx.db
      .query("installations")
      .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId))
      .take(100);
  },
});

export const revoke = mutation({
  args: { installationId: v.id("installations") },
  handler: async (ctx, args) => {
    const installation = await ctx.db.get(args.installationId);
    if (!installation) fail("not_found", "Installation not found");
    const principal = await requireHumanProject(ctx, installation.projectId, {
      owner: true,
      allowArchived: true,
    });
    const now = Date.now();
    if (installation.status !== "revoked") {
      await ctx.db.patch(installation._id, {
        status: "revoked",
        revokedAt: now,
        updatedAt: now,
      });
      const bindings = await ctx.db
        .query("oauthBindings")
        .withIndex("by_installation", (q) =>
          q.eq("installationId", installation._id),
        )
        .collect();
      for (const binding of bindings) {
        if (binding.status === "active") {
          await ctx.db.patch(binding._id, {
            status: "revoked",
            revokedAt: now,
            updatedAt: now,
          });
        }
      }
      const credentials = await ctx.db
        .query("serviceCredentials")
        .withIndex("by_installation", (q) =>
          q.eq("installationId", installation._id),
        )
        .collect();
      for (const credential of credentials) {
        if (credential.revokedAt === undefined) {
          await ctx.db.patch(credential._id, { revokedAt: now });
        }
      }
      await appendEvent(ctx, {
        organizationId: installation.organizationId,
        projectId: installation.projectId,
        actorId: principal.actor._id,
        type: "installation.revoked",
        data: { installationId: installation._id },
        createdAt: now,
      });
    }
    return { revoked: true };
  },
});
