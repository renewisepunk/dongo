import { v } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "../../_generated/server";
import { requireSuperAdmin } from "../../lib/authz";
import { fail, requireString, stableStringify } from "../../lib/errors";
import {
  activeProjectLimit,
  MAX_ACTIVE_PROJECT_LIMIT_OVERRIDE,
  MAX_TOTAL_WORK_ITEM_LIMIT_OVERRIDE,
  projectCapacitySource,
  totalWorkItemLimit,
  workCapacitySource,
} from "../../lib/plans";
import { updateOrganizationAllowanceOverrides } from "../../lib/organizationAllowances";
import { initializeOrganizationWorkItemCount } from "../../lib/workUsage";

const MUTATION_REPLAY_MS = 24 * 60 * 60 * 1_000;
const MAX_ADMIN_ROWS = 25;

async function accountUsagePage(ctx: QueryCtx, cursor: string | null) {
  const profiles = await ctx.db.query("humanProfiles").order("desc").paginate({
    cursor,
    numItems: MAX_ADMIN_ROWS,
  });
  const rows = await Promise.all(profiles.page.map(async (profile) => {
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .take(MAX_ADMIN_ROWS + 1);
    return {
      profileId: profile._id,
      name: profile.name,
      email: profile.email,
      signedUpAt: profile.createdAt,
      lastActiveAt: profile.updatedAt,
      organizationCount: Math.min(memberships.length, MAX_ADMIN_ROWS),
      organizationsTruncated: memberships.length > MAX_ADMIN_ROWS,
      usage: {
        workItemsCreated: profile.createdWorkItemCount ?? 0,
        workItemsClosed: profile.closedWorkItemCount ?? 0,
        trackedFrom: profile.usageTrackingStartedAt,
      },
    };
  }));
  return {
    rows,
    cursor: profiles.isDone ? undefined : profiles.continueCursor,
  };
}

function finiteLimit(
  value: number | null,
  field: string,
  maximum: number,
): number | undefined {
  if (value === null) return undefined;
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    fail("validation", `${field} must be null or an integer from 1 to ${maximum}`);
  }
  return value;
}

async function organizationUsage(
  ctx: QueryCtx | MutationCtx,
  organization: Doc<"organizations">,
) {
  const [projects, activeProjects, memberships] = await Promise.all([
    ctx.db
      .query("projects")
      .withIndex("by_organization", (q) => q.eq("organizationId", organization._id))
      .take(101),
    ctx.db
      .query("projects")
      .withIndex("by_organization_archived", (q) =>
        q.eq("organizationId", organization._id).eq("archivedAt", undefined),
      )
      .take(101),
    ctx.db
      .query("memberships")
      .withIndex("by_organization", (q) => q.eq("organizationId", organization._id))
      .take(MAX_ADMIN_ROWS + 1),
  ]);
  const memberRows = await Promise.all(
    memberships.slice(0, MAX_ADMIN_ROWS).map(async (membership) => {
      const profile = await ctx.db.get(membership.profileId);
      if (profile === null) return undefined;
      return {
        profileId: profile._id,
        name: profile.name,
        email: profile.email,
        role: membership.role,
        joinedAt: membership.createdAt,
      };
    }),
  );
  const people = memberRows
    .filter((row): row is NonNullable<typeof row> => row !== undefined)
    .sort((left, right) => {
      if (left.role !== right.role) return left.role === "owner" ? -1 : 1;
      return left.joinedAt - right.joinedAt;
    });
  const activeProjectCount = Math.min(activeProjects.length, 100);
  const projectLimit = activeProjectLimit(
    organization.plan,
    organization.activeProjectLimitOverride,
  );
  const workLimit = totalWorkItemLimit(
    organization.plan,
    organization.totalWorkItemLimitOverride,
  );
  return {
    organizationId: organization._id,
    name: organization.name,
    slug: organization.slug,
    plan: organization.plan,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
    projectCapacityRevision: organization.projectCapacityRevision ?? 0,
    workCapacityRevision: organization.workCapacityRevision ?? 0,
    members: {
      count: Math.min(memberships.length, MAX_ADMIN_ROWS),
      truncated: memberships.length > MAX_ADMIN_ROWS,
      people,
    },
    projects: {
      active: activeProjectCount,
      activeTruncated: activeProjects.length > 100,
      total: Math.min(projects.length, 100),
      truncated: projects.length > 100,
      limit: projectLimit,
      source: projectCapacitySource(
        organization.plan,
        organization.activeProjectLimitOverride,
      ),
    },
    workItems: {
      total: organization.createdWorkItemCount,
      totalIsExact: organization.workItemCountState === "exact",
      closed: organization.closedWorkItemCount ?? 0,
      truncated: organization.workItemCountState === "at_least_limit",
      trackedFrom: organization.usageTrackingStartedAt,
      limit: workLimit,
      source: workCapacitySource(organization.totalWorkItemLimitOverride),
    },
    billing: {
      status: "not_configured" as const,
      provider: null,
    },
  };
}

async function organizationUsagePage(ctx: QueryCtx, cursor: string | null) {
  const organizations = await ctx.db.query("organizations").order("desc").paginate({
    cursor,
    numItems: MAX_ADMIN_ROWS,
  });
  return {
    rows: await Promise.all(
      organizations.page.map(async (organization) =>
        await organizationUsage(ctx, organization),
      ),
    ),
    cursor: organizations.isDone ? undefined : organizations.continueCursor,
  };
}

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireSuperAdmin(ctx);
    return {
      isSuperAdmin: true as const,
      name: profile.name,
      email: profile.email,
    };
  },
});

export const dashboard = query({
  args: {},
  handler: async (ctx) => {
    await requireSuperAdmin(ctx);
    return {
      generatedAt: Date.now(),
      privacy: "Aggregated product activity only. Work titles, comments, attachments, and raw billing data are not included.",
    };
  },
});

export const accountsPage = query({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    return await accountUsagePage(ctx, args.cursor);
  },
});

export const organizationsPage = query({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    return await organizationUsagePage(ctx, args.cursor);
  },
});

type AllowanceMutationResult = Awaited<ReturnType<typeof organizationUsage>> & {
  changed: boolean;
};

async function replayedMutation(
  ctx: MutationCtx,
  profileId: Id<"humanProfiles">,
  key: string,
  payload: unknown,
): Promise<AllowanceMutationResult | undefined> {
  const canonicalPayload = stableStringify(payload);
  const existing = await ctx.db
    .query("platformAdminMutationKeys")
    .withIndex("by_profile_operation_key", (q) =>
      q.eq("profileId", profileId).eq("operation", "organization.allowances.update").eq("key", key),
    )
    .unique();
  if (!existing) return undefined;
  if (existing.expiresAt <= Date.now()) {
    await ctx.db.delete(existing._id);
    return undefined;
  }
  if (existing.canonicalPayload !== canonicalPayload) {
    fail("idempotency_conflict", "This idempotency key was already used with different limits");
  }
  return JSON.parse(existing.resultJson) as AllowanceMutationResult;
}

export const updateOrganizationAllowances = mutation({
  args: {
    organizationId: v.id("organizations"),
    activeProjectLimit: v.union(v.number(), v.null()),
    totalWorkItemLimit: v.union(v.number(), v.null()),
    expectedProjectCapacityRevision: v.number(),
    expectedWorkCapacityRevision: v.number(),
    reason: v.string(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const profile = await requireSuperAdmin(ctx);
    const idempotencyKey = requireString(args.idempotencyKey, "idempotencyKey", 200);
    const payload = {
      organizationId: args.organizationId,
      activeProjectLimit: args.activeProjectLimit,
      totalWorkItemLimit: args.totalWorkItemLimit,
      expectedProjectCapacityRevision: args.expectedProjectCapacityRevision,
      expectedWorkCapacityRevision: args.expectedWorkCapacityRevision,
      reason: args.reason,
    };
    const replay = await replayedMutation(ctx, profile._id, idempotencyKey, payload);
    if (replay) return replay;
    if (
      !Number.isInteger(args.expectedProjectCapacityRevision) ||
      args.expectedProjectCapacityRevision < 0 ||
      !Number.isInteger(args.expectedWorkCapacityRevision) ||
      args.expectedWorkCapacityRevision < 0
    ) {
      fail("validation", "Allowance revisions must be non-negative integers");
    }
    const activeProjectLimitOverride = finiteLimit(
      args.activeProjectLimit,
      "activeProjectLimit",
      MAX_ACTIVE_PROJECT_LIMIT_OVERRIDE,
    );
    const totalWorkItemLimitOverride = finiteLimit(
      args.totalWorkItemLimit,
      "totalWorkItemLimit",
      MAX_TOTAL_WORK_ITEM_LIMIT_OVERRIDE,
    );
    const reason = requireString(args.reason, "reason", 500);
    const storedOrganization = await ctx.db.get(args.organizationId);
    if (!storedOrganization) fail("not_found", "Organization not found");
    if (storedOrganization.plan === "paid" && activeProjectLimitOverride !== undefined) {
      fail("invalid_transition", "Paid organizations have unlimited active projects");
    }
    const now = Date.now();
    const organization = await initializeOrganizationWorkItemCount(
      ctx,
      storedOrganization,
      now,
    );
    const { organization: updated, changed } = await updateOrganizationAllowanceOverrides(
      ctx,
      organization,
      {
        activeProjectLimitOverride,
        totalWorkItemLimitOverride,
        expectedProjectCapacityRevision: args.expectedProjectCapacityRevision,
        expectedWorkCapacityRevision: args.expectedWorkCapacityRevision,
        reason,
        requestId: idempotencyKey,
        operatorProfileId: profile._id,
        ...(organization.workItemCountState === "exact"
          ? { totalWorkItemCount: organization.createdWorkItemCount ?? 0 }
          : {}),
      },
    );
    const result = { changed, ...await organizationUsage(ctx, updated) };
    const expiredReplay = await ctx.db
      .query("platformAdminMutationKeys")
      .withIndex("by_profile_operation_key", (q) =>
        q.eq("profileId", profile._id).eq("operation", "organization.allowances.update").eq("key", idempotencyKey),
      )
      .unique();
    if (expiredReplay) await ctx.db.delete(expiredReplay._id);
    await ctx.db.insert("platformAdminMutationKeys", {
      profileId: profile._id,
      operation: "organization.allowances.update",
      key: idempotencyKey,
      canonicalPayload: stableStringify(payload),
      resultJson: stableStringify(result),
      createdAt: now,
      expiresAt: now + MUTATION_REPLAY_MS,
    });
    return result;
  },
});
