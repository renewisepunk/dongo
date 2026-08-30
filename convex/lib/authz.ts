import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { fail, optionalString, requireString } from "./errors";

type ReadCtx = Pick<QueryCtx, "auth" | "db"> | Pick<MutationCtx, "auth" | "db">;
type DbCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;

export type HumanPrincipal = {
  kind: "human";
  profile: Doc<"humanProfiles">;
  actor: Doc<"actors">;
  membership: Doc<"memberships">;
  project?: Doc<"projects">;
  principalKey: string;
};

export type AgentPrincipal = {
  kind: "agent";
  installation: Doc<"installations">;
  actor: Doc<"actors">;
  project: Doc<"projects">;
  scopes: readonly string[];
  authorizedByProfileId?: Id<"humanProfiles">;
  principalKey: string;
  requestId: string;
  externalSessionId?: string;
};

export type AgentContext = {
  requestId: string;
  installationId: Id<"installations">;
  actorId: Id<"actors">;
  organizationId: Id<"organizations">;
  projectId: Id<"projects">;
  projectRef: string;
  oauthBindingId?: Id<"oauthBindings">;
  serviceCredentialId?: Id<"serviceCredentials">;
  issuer?: string;
  resource: string;
  clientId: string;
  scopes: string[];
  externalSessionId?: string;
};

export function authSubject(identity: {
  tokenIdentifier: string;
  subject: string;
}): string {
  return identity.tokenIdentifier || identity.subject;
}

export async function requireCurrentProfile(
  ctx: ReadCtx,
): Promise<Doc<"humanProfiles">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) fail("unauthorized", "Authentication is required");
  const profile = await ctx.db
    .query("humanProfiles")
    .withIndex("by_auth_subject", (query) =>
      query.eq("authSubject", authSubject(identity)),
    )
    .unique();
  if (!profile) {
    fail("unauthorized", "Complete account bootstrap before using dongo");
  }
  return profile;
}

export async function requireMembership(
  ctx: DbCtx,
  organizationId: Id<"organizations">,
  profileId: Id<"humanProfiles">,
): Promise<Doc<"memberships">> {
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_organization_profile", (query) =>
      query.eq("organizationId", organizationId).eq("profileId", profileId),
    )
    .unique();
  if (!membership) fail("not_found", "Organization or project not found");
  return membership;
}

export function requireOwner(membership: Doc<"memberships">): void {
  if (membership.role !== "owner") {
    fail("forbidden", "Organization owner access is required");
  }
}

export async function requireHumanActor(
  ctx: DbCtx,
  organizationId: Id<"organizations">,
  profileId: Id<"humanProfiles">,
): Promise<Doc<"actors">> {
  const actor = await ctx.db
    .query("actors")
    .withIndex("by_organization_profile", (query) =>
      query.eq("organizationId", organizationId).eq("profileId", profileId),
    )
    .unique();
  if (!actor || actor.type !== "human") {
    fail("unauthorized", "Human actor mapping is missing");
  }
  return actor;
}

export async function requireHumanProject(
  ctx: ReadCtx,
  projectId: Id<"projects">,
  options?: { owner?: boolean; allowArchived?: boolean },
): Promise<HumanPrincipal> {
  const profile = await requireCurrentProfile(ctx);
  const project = await ctx.db.get(projectId);
  if (!project) fail("not_found", "Project not found");
  const membership = await requireMembership(
    ctx,
    project.organizationId,
    profile._id,
  );
  if (options?.owner) requireOwner(membership);
  if (project.archivedAt !== undefined && !options?.allowArchived) {
    fail("project_archived", "The project is archived");
  }
  const actor = await requireHumanActor(ctx, project.organizationId, profile._id);
  return {
    kind: "human",
    profile,
    actor,
    membership,
    project,
    principalKey: `human:${profile._id}`,
  };
}

export async function resolveAgentPrincipal(
  ctx: DbCtx,
  authorization: AgentContext,
  requiredScope: string | readonly string[],
): Promise<AgentPrincipal> {
  const requestId = requireString(authorization.requestId, "requestId", 200);
  const externalSessionId = optionalString(
    authorization.externalSessionId,
    "externalSessionId",
    300,
  );
  const installation = await ctx.db.get(authorization.installationId);
  if (!installation || installation.status !== "active") {
    fail("unauthorized", "Agent installation is not active");
  }
  if (
    authorization.resource !== installation.resource ||
    authorization.clientId !== installation.clientId ||
    authorization.organizationId !== installation.organizationId ||
    authorization.projectId !== installation.projectId ||
    authorization.actorId !== installation.actorId
  ) {
    fail("unauthorized", "Agent request audience or client is invalid");
  }
  const project = await ctx.db.get(installation.projectId);
  if (!project || project.organizationId !== installation.organizationId) {
    fail("unauthorized", "Agent installation is invalid");
  }
  if (authorization.projectRef !== project.publicRef) {
    fail("unauthorized", "Agent project reference is invalid");
  }
  if (project.archivedAt !== undefined) {
    fail("project_archived", "The project is archived");
  }
  const actor = await ctx.db.get(installation.actorId);
  if (
    !actor ||
    actor.organizationId !== installation.organizationId ||
    actor.type !== "agent"
  ) {
    fail("unauthorized", "Agent actor mapping is invalid");
  }

  let scopes: readonly string[];
  let authorizedByProfileId: Id<"humanProfiles"> | undefined;
  if (installation.kind === "cli" || installation.kind === "mcp") {
    if (!authorization.oauthBindingId) {
      fail("unauthorized", "OAuth grant context is required");
    }
    const binding = await ctx.db.get(authorization.oauthBindingId);
    if (
      !binding ||
      binding.installationId !== installation._id ||
      binding.organizationId !== installation.organizationId ||
      binding.projectId !== project._id ||
      binding.status !== "active" ||
      binding.providerIssuer !== authorization.issuer ||
      binding.clientId !== authorization.clientId ||
      binding.resource !== installation.resource ||
      (binding.expiresAt !== undefined && binding.expiresAt <= Date.now())
    ) {
      fail("unauthorized", "OAuth grant is not active");
    }
    await requireMembership(
      ctx,
      project.organizationId,
      binding.authorizedByProfileId,
    );
    scopes = binding.scopes;
    authorizedByProfileId = binding.authorizedByProfileId;
  } else if (installation.kind === "service") {
    if (!authorization.serviceCredentialId) {
      fail("unauthorized", "Service credential context is required");
    }
    const credential = await ctx.db.get(authorization.serviceCredentialId);
    if (
      !credential ||
      credential.installationId !== installation._id ||
      credential.projectId !== project._id ||
      credential.organizationId !== installation.organizationId ||
      credential.revokedAt !== undefined
    ) {
      fail("unauthorized", "Service credential is not active");
    }
    scopes = credential.scopes;
    authorizedByProfileId = installation.authorizedByProfileId;
    if (!authorizedByProfileId) {
      fail("unauthorized", "Service credential authorizer is missing");
    }
    const membership = await requireMembership(
      ctx,
      project.organizationId,
      authorizedByProfileId,
    );
    if (membership.role !== "owner") {
      fail("unauthorized", "Service credential is not active");
    }
  } else {
    if (process.env.DONGO_ENABLE_DEV_BOOTSTRAP !== "true") {
      fail("development_bootstrap_disabled", "Development bootstrap is disabled");
    }
    scopes = installation.scopes;
    authorizedByProfileId = installation.authorizedByProfileId;
  }

  const presentedScopes = [...new Set(authorization.scopes)];
  if (
    presentedScopes.length === 0 ||
    presentedScopes.some((scope) => !scopes.includes(scope))
  ) {
    fail("unauthorized", "Agent request contains invalid delegated scopes");
  }
  const requiredScopes =
    typeof requiredScope === "string" ? [requiredScope] : requiredScope;
  const missingScopes = requiredScopes.filter(
    (scope) => !presentedScopes.includes(scope),
  );
  if (missingScopes.length > 0) {
    fail(
      "insufficient_scope",
      `The ${missingScopes.join(", ")} scope${missingScopes.length === 1 ? " is" : "s are"} required`,
    );
  }
  return {
    kind: "agent",
    installation,
    actor,
    project,
    scopes: presentedScopes,
    authorizedByProfileId,
    principalKey: `installation:${installation._id}`,
    requestId,
    externalSessionId,
  };
}

export async function requireSystemActor(
  ctx: DbCtx,
  organizationId: Id<"organizations">,
): Promise<Doc<"actors">> {
  const actor = await ctx.db
    .query("actors")
    .withIndex("by_organization_type", (query) =>
      query.eq("organizationId", organizationId).eq("type", "system"),
    )
    .unique();
  if (!actor) fail("unauthorized", "System actor mapping is missing");
  return actor;
}

export function assertSameProject(
  entity: { organizationId: Id<"organizations">; projectId: Id<"projects"> },
  project: Doc<"projects">,
): void {
  if (
    entity.projectId !== project._id ||
    entity.organizationId !== project.organizationId
  ) {
    fail("not_found", "Resource not found");
  }
}
