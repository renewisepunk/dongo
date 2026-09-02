import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { requireSystemActor } from "../lib/authz";
import { appendEvent } from "../lib/events";
import { fail, optionalString, requireString } from "../lib/errors";
import { updateOrganizationAllowanceOverrides } from "../lib/organizationAllowances";
import {
  activeProjectLimit,
  MAX_ACTIVE_PROJECT_LIMIT_OVERRIDE,
  projectCapacitySource,
} from "../lib/plans";

type OperatorContext = QueryCtx | MutationCtx;

function normalizeEmail(value: string): string {
  const email = requireString(value, "email", 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    fail("validation", "email must be a valid address");
  }
  return email;
}

function normalizeOrganizationSlug(value: string | undefined): string | undefined {
  const slug = optionalString(value, "organizationSlug", 80)?.toLowerCase();
  if (slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    fail("validation", "organizationSlug must contain lowercase letters, numbers, and hyphens");
  }
  return slug;
}

async function resolveOwnedOrganization(
  ctx: OperatorContext,
  emailInput: string,
  organizationSlugInput: string | undefined,
): Promise<{
  profile: Doc<"humanProfiles">;
  organization: Doc<"organizations">;
  activeProjectCount: number;
}> {
  const email = normalizeEmail(emailInput);
  const organizationSlug = normalizeOrganizationSlug(organizationSlugInput);
  const profiles = await ctx.db
    .query("humanProfiles")
    .withIndex("by_email", (query) => query.eq("email", email))
    .take(2);
  if (profiles.length !== 1) {
    fail("not_found", "No unique existing dongo account matches that email");
  }
  const profile = profiles[0]!;
  const memberships = await ctx.db
    .query("memberships")
    .withIndex("by_profile", (query) => query.eq("profileId", profile._id))
    .take(100);
  const owned = (await Promise.all(
    memberships
      .filter((membership) => membership.role === "owner")
      .map(async (membership) => await ctx.db.get(membership.organizationId)),
  )).filter((organization): organization is Doc<"organizations"> =>
    organization !== null
  );
  const matches = organizationSlug
    ? owned.filter((organization) => organization.slug === organizationSlug)
    : owned;
  if (matches.length === 0) {
    fail("not_found", "No owned organization matches that account and slug");
  }
  if (matches.length > 1) {
    fail("validation", "organizationSlug is required when the account owns more than one organization");
  }
  const organization = matches[0]!;
  const activeProjects = await ctx.db
    .query("projects")
    .withIndex("by_organization_archived", (query) =>
      query.eq("organizationId", organization._id).eq("archivedAt", undefined),
    )
    .take(MAX_ACTIVE_PROJECT_LIMIT_OVERRIDE + 1);
  return {
    profile,
    organization,
    activeProjectCount: activeProjects.length,
  };
}

function capacityResult(
  profile: Doc<"humanProfiles">,
  organization: Doc<"organizations">,
  activeProjectCount: number,
) {
  const limit = activeProjectLimit(
    organization.plan,
    organization.activeProjectLimitOverride,
  );
  return {
    profileId: profile._id,
    organizationId: organization._id,
    organizationSlug: organization.slug,
    plan: organization.plan,
    source: projectCapacitySource(
      organization.plan,
      organization.activeProjectLimitOverride,
    ),
    activeProjectCount,
    activeProjectLimit: limit,
    remaining: limit === undefined
      ? undefined
      : Math.max(0, limit - activeProjectCount),
    overLimit: limit !== undefined && activeProjectCount > limit,
    revision: organization.projectCapacityRevision ?? 0,
  };
}

export const inspect = internalQuery({
  args: {
    email: v.string(),
    organizationSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const resolved = await resolveOwnedOrganization(
      ctx,
      args.email,
      args.organizationSlug,
    );
    return capacityResult(
      resolved.profile,
      resolved.organization,
      resolved.activeProjectCount,
    );
  },
});

export const setOverride = internalMutation({
  args: {
    email: v.string(),
    organizationSlug: v.optional(v.string()),
    activeProjectLimit: v.union(v.number(), v.null()),
    expectedRevision: v.number(),
    reason: v.string(),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.expectedRevision) || args.expectedRevision < 0) {
      fail("validation", "expectedRevision must be a non-negative integer");
    }
    if (
      args.activeProjectLimit !== null
      && (!Number.isInteger(args.activeProjectLimit)
        || args.activeProjectLimit < 1
        || args.activeProjectLimit > MAX_ACTIVE_PROJECT_LIMIT_OVERRIDE)
    ) {
      fail(
        "validation",
        `activeProjectLimit must be null or an integer from 1 to ${MAX_ACTIVE_PROJECT_LIMIT_OVERRIDE}`,
      );
    }
    const reason = requireString(args.reason, "reason", 500);
    const requestId = requireString(args.requestId, "requestId", 128);
    const resolved = await resolveOwnedOrganization(
      ctx,
      args.email,
      args.organizationSlug,
    );
    const { profile, organization, activeProjectCount } = resolved;
    if (organization.plan !== "free") {
      fail("invalid_transition", "Paid organizations already have unlimited active projects");
    }
    const requestedOverride = args.activeProjectLimit ?? undefined;
    if (organization.activeProjectLimitOverride === requestedOverride) {
      return {
        changed: false as const,
        ...capacityResult(profile, organization, activeProjectCount),
      };
    }
    const currentRevision = organization.projectCapacityRevision ?? 0;
    if (args.expectedRevision !== currentRevision) {
      fail("revision_conflict", "Project capacity changed; inspect it before retrying", {
        expectedRevision: args.expectedRevision,
        currentRevision,
      });
    }
    const { organization: updated } = await updateOrganizationAllowanceOverrides(
      ctx,
      organization,
      {
        activeProjectLimitOverride: requestedOverride,
        expectedProjectCapacityRevision: currentRevision,
        reason,
        requestId,
        targetProfileId: profile._id,
        activeProjectCount,
      },
    );
    const now = Date.now();
    const systemActor = await requireSystemActor(ctx, organization._id);
    await appendEvent(ctx, {
      organizationId: organization._id,
      actorId: systemActor._id,
      type: "organization.project_capacity_changed",
      data: {
        profileId: profile._id,
        beforeLimit: activeProjectLimit(
          organization.plan,
          organization.activeProjectLimitOverride,
        ),
        afterLimit: activeProjectLimit(organization.plan, requestedOverride),
        activeProjectCount,
        reason,
      },
      requestId,
      createdAt: now,
    });
    return {
      changed: true as const,
      ...capacityResult(profile, updated, activeProjectCount),
    };
  },
});
