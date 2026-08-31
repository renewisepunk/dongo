import { v } from "convex/values";
import type { Doc } from "../../_generated/dataModel";
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

function validateServiceScopes(scopes: string[]): string[] {
  const validated = validateScopes(scopes);
  if (validated.includes("offline_access")) {
    fail("validation", "Service credentials cannot request offline access");
  }
  return validated;
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
    const existingBindings = await ctx.db
      .query("oauthBindings")
      .withIndex("by_provider_grant", (q) =>
        q
          .eq("providerIssuer", providerIssuer)
          .eq("providerGrantId", providerGrantId),
      )
      .take(101);
    if (existingBindings.length > 100) {
      fail("internal", "OAuth grant history limit exceeded");
    }
    let activeExisting:
      | {
          binding: (typeof existingBindings)[number];
          installation: Doc<"installations">;
          actor: Doc<"actors">;
        }
      | undefined;
    for (const binding of existingBindings) {
      const installation = await ctx.db.get(binding.installationId);
      const actor = installation ? await ctx.db.get(installation.actorId) : null;
      if (
        !installation ||
        !actor ||
        binding.projectId !== project._id ||
        binding.organizationId !== project.organizationId ||
        binding.authorizedByProfileId !== profile._id ||
        binding.clientId !== clientId ||
        binding.subject !== subject ||
        binding.resource !== resource ||
        installation.projectId !== project._id ||
        installation.organizationId !== project.organizationId ||
        installation.authorizedByProfileId !== profile._id ||
        installation.clientId !== clientId ||
        installation.resource !== resource ||
        installation.kind !== args.kind ||
        actor.organizationId !== project.organizationId ||
        actor.type !== "agent" ||
        actor.installationId !== installation._id
      ) {
        fail("forbidden", "OAuth grant is already bound to another installation");
      }
      if ((binding.status === "active") !== (installation.status === "active")) {
        fail("internal", "OAuth grant state is inconsistent");
      }
      if (binding.status === "active") {
        if (activeExisting) {
          fail("internal", "OAuth grant has multiple active installations");
        }
        activeExisting = { binding, installation, actor };
      }
    }
    if (activeExisting) {
      const { binding, installation, actor } = activeExisting;
      await ctx.db.patch(binding._id, {
        subject,
        clientId,
        resource,
        scopes,
        authorizedByProfileId: profile._id,
        updatedAt: now,
        lastValidatedAt: now,
        expiresAt: args.expiresAt,
      });
      await ctx.db.patch(installation._id, {
        clientId,
        label,
        machineLabel: args.machineLabel,
        resource,
        scopes,
        authorizedByProfileId: profile._id,
        updatedAt: now,
      });
      await ctx.db.patch(actor._id, {
        name: label,
        lastSeenAt: now,
      });
      return {
        installationId: installation._id,
        oauthBindingId: binding._id,
        actorId: installation.actorId,
        organizationId: project.organizationId,
        projectId: project._id,
        projectRef: project.publicRef,
        created: false,
        reactivated: false,
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
    oauthBindingId: v.id("oauthBindings"),
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
    const binding = await ctx.db.get(args.oauthBindingId);
    const installation = binding ? await ctx.db.get(binding.installationId) : null;
    if (
      !binding ||
      !installation ||
      binding.status !== "active" ||
      installation.status !== "active" ||
      binding.providerIssuer !== providerIssuer ||
      binding.providerGrantId !== providerGrantId ||
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

export const persistServiceCredential = internalMutation({
  args: {
    projectId: v.id("projects"),
    label: v.string(),
    resource: v.string(),
    scopes: v.array(v.string()),
    tokenPrefix: v.string(),
    tokenHash: v.string(),
  },
  handler: async (ctx, args) => {
    const principal = await requireHumanProject(ctx, args.projectId, {
      owner: true,
    });
    const label = requireString(args.label, "label", 240);
    const resource = requireString(args.resource, "resource", 2_048);
    const scopes = validateServiceScopes(args.scopes);
    if (!/^[A-Za-z0-9_-]{11}$/u.test(args.tokenPrefix)) {
      fail("validation", "Service credential prefix is invalid");
    }
    if (!/^[a-f0-9]{64}$/u.test(args.tokenHash)) {
      fail("validation", "Service credential hash is invalid");
    }
    const prefixCollision = await ctx.db
      .query("serviceCredentials")
      .withIndex("by_token_prefix", (query) =>
        query.eq("tokenPrefix", args.tokenPrefix),
      )
      .first();
    if (prefixCollision) {
      fail("internal", "Service credential could not be created", {
        retryable: true,
      });
    }
    const now = Date.now();
    const clientId = `dongo-service-v1:${args.tokenPrefix}`;
    const actorId = await ctx.db.insert("actors", {
      organizationId: principal.project!.organizationId,
      type: "agent",
      name: label,
      agentType: "service",
      createdAt: now,
    });
    const installationId = await ctx.db.insert("installations", {
      organizationId: principal.project!.organizationId,
      projectId: principal.project!._id,
      actorId,
      kind: "service",
      status: "active",
      clientId,
      label,
      resource,
      scopes,
      authorizedByProfileId: principal.profile._id,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(actorId, { installationId });
    const serviceCredentialId = await ctx.db.insert("serviceCredentials", {
      organizationId: principal.project!.organizationId,
      projectId: principal.project!._id,
      installationId,
      tokenPrefix: args.tokenPrefix,
      tokenHash: args.tokenHash,
      scopes,
      createdAt: now,
    });
    await appendEvent(ctx, {
      organizationId: principal.project!.organizationId,
      projectId: principal.project!._id,
      actorId,
      type: "installation.authorized",
      data: { clientId, kind: "service", scopes },
      createdAt: now,
    });
    return { installationId, serviceCredentialId };
  },
});

export const serviceCredentialForVerification = internalQuery({
  args: { tokenPrefix: v.string() },
  handler: async (ctx, args) => {
    if (!/^[A-Za-z0-9_-]{11}$/u.test(args.tokenPrefix)) return null;
    const credentials = await ctx.db
      .query("serviceCredentials")
      .withIndex("by_token_prefix", (query) =>
        query.eq("tokenPrefix", args.tokenPrefix),
      )
      .take(2);
    if (credentials.length !== 1) return null;
    const credential = credentials[0]!;
    return {
      serviceCredentialId: credential._id,
      tokenHash: credential.tokenHash,
    };
  },
});

export const activateServiceCredential = internalMutation({
  args: { serviceCredentialId: v.id("serviceCredentials") },
  handler: async (ctx, args) => {
    const credential = await ctx.db.get(args.serviceCredentialId);
    const installation = credential
      ? await ctx.db.get(credential.installationId)
      : null;
    const project = credential ? await ctx.db.get(credential.projectId) : null;
    if (
      !credential ||
      credential.revokedAt !== undefined ||
      !installation ||
      installation.kind !== "service" ||
      installation.status !== "active" ||
      installation.projectId !== credential.projectId ||
      installation.organizationId !== credential.organizationId ||
      installation.resource.length === 0 ||
      !project ||
      project.organizationId !== credential.organizationId ||
      project.archivedAt !== undefined ||
      !installation.authorizedByProfileId
    ) return null;
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_organization_profile", (query) =>
        query
          .eq("organizationId", project.organizationId)
          .eq("profileId", installation.authorizedByProfileId!),
      )
      .unique();
    if (!membership || membership.role !== "owner") return null;
    const actor = await ctx.db.get(installation.actorId);
    if (
      !actor ||
      actor.type !== "agent" ||
      actor.organizationId !== project.organizationId
    ) return null;
    const now = Date.now();
    await ctx.db.patch(credential._id, { lastUsedAt: now });
    await ctx.db.patch(installation._id, { lastUsedAt: now, updatedAt: now });
    await ctx.db.patch(actor._id, { lastSeenAt: now });
    return {
      installationId: installation._id,
      serviceCredentialId: credential._id,
      actorId: actor._id,
      organizationId: project.organizationId,
      projectId: project._id,
      projectRef: project.publicRef,
      clientId: installation.clientId,
      resource: installation.resource,
      scopes: credential.scopes,
    };
  },
});

export const listForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireHumanProject(ctx, args.projectId, { owner: true, allowArchived: true });
    const installations = await ctx.db
      .query("installations")
      .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId))
      .take(100);
    return installations.map((installation) => ({
      _id: installation._id,
      kind: installation.kind,
      status: installation.status,
      clientId: installation.clientId,
      label: installation.label,
      machineLabel: installation.machineLabel,
      scopes: installation.scopes,
      createdAt: installation.createdAt,
      lastUsedAt: installation.lastUsedAt,
    }));
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
