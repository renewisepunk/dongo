import { ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { convexAccessToken } from "./auth-client";
import { convexDeploymentUrl } from "./auth-config";

export type PlatformAccountUsage = {
  profileId: string;
  name: string;
  email?: string;
  signedUpAt: number;
  lastActiveAt: number;
  organizationCount: number;
  organizationsTruncated: boolean;
  usage: {
    workItemsCreated: number;
    workItemsClosed: number;
    trackedFrom?: number;
  };
};

export type PlatformOrganizationMember = {
  profileId: string;
  name: string;
  email?: string;
  role: "owner" | "member";
  joinedAt: number;
};

export type PlatformOrganizationUsage = {
  organizationId: string;
  name: string;
  slug: string;
  plan: "free" | "paid";
  createdAt: number;
  updatedAt: number;
  projectCapacityRevision: number;
  workCapacityRevision: number;
  members: {
    count: number;
    truncated: boolean;
    people: PlatformOrganizationMember[];
  };
  projects: {
    active: number;
    activeTruncated: boolean;
    total: number;
    truncated: boolean;
    limit?: number;
    source: "plan" | "operator_override";
  };
  workItems: {
    total?: number;
    totalIsExact: boolean;
    closed: number;
    truncated: boolean;
    trackedFrom?: number;
    limit?: number;
    source: "plan" | "operator_override";
  };
  billing: { status: "not_configured"; provider: null };
};

export type PlatformDashboard = {
  generatedAt: number;
  accounts: PlatformAccountUsage[];
  organizations: PlatformOrganizationUsage[];
  accountCursor?: string;
  organizationCursor?: string;
  accountsTruncated: boolean;
  organizationsTruncated: boolean;
  privacy: string;
};

export type PlatformAdminConnection = {
  loadDashboard(): Promise<PlatformDashboard>;
  loadAccounts(cursor: string): Promise<{
    rows: PlatformAccountUsage[];
    cursor?: string;
  }>;
  loadOrganizations(cursor: string): Promise<{
    rows: PlatformOrganizationUsage[];
    cursor?: string;
  }>;
  updateOrganizationAllowances(input: {
    organizationId: string;
    activeProjectLimit: number | null;
    totalWorkItemLimit: number | null;
    expectedProjectCapacityRevision: number;
    expectedWorkCapacityRevision: number;
    reason: string;
  }): Promise<PlatformOrganizationUsage & { changed: boolean }>;
  close(): Promise<void>;
};

const viewerReference = makeFunctionReference<
  "query",
  Record<string, never>,
  { isSuperAdmin: true; name: string; email?: string }
>("domains/platformAdministration/index:viewer");

const dashboardReference = makeFunctionReference<
  "query",
  Record<string, never>,
  Pick<PlatformDashboard, "generatedAt" | "privacy">
>("domains/platformAdministration/index:dashboard");

const accountsPageReference = makeFunctionReference<
  "query",
  { cursor: string | null },
  { rows: PlatformAccountUsage[]; cursor?: string }
>("domains/platformAdministration/index:accountsPage");

const organizationsPageReference = makeFunctionReference<
  "query",
  { cursor: string | null },
  { rows: PlatformOrganizationUsage[]; cursor?: string }
>("domains/platformAdministration/index:organizationsPage");

const updateAllowancesReference = makeFunctionReference<
  "mutation",
  {
    organizationId: string;
    activeProjectLimit: number | null;
    totalWorkItemLimit: number | null;
    expectedProjectCapacityRevision: number;
    expectedWorkCapacityRevision: number;
    reason: string;
    idempotencyKey: string;
  },
  PlatformOrganizationUsage & { changed: boolean }
>("domains/platformAdministration/index:updateOrganizationAllowances");

export async function loadPlatformAdminAccess(): Promise<boolean> {
  const client = new ConvexClient(convexDeploymentUrl);
  client.setAuth(async () => await convexAccessToken());
  try {
    return (await client.query(viewerReference, {})).isSuperAdmin;
  } catch {
    return false;
  } finally {
    await client.close();
  }
}

export async function connectPlatformAdmin(): Promise<PlatformAdminConnection> {
  const client = new ConvexClient(convexDeploymentUrl);
  client.setAuth(async () => await convexAccessToken());
  try {
    await client.query(viewerReference, {});
  } catch (error) {
    await client.close();
    throw error;
  }
  return {
    async loadDashboard() {
      const [metadata, accounts, organizations] = await Promise.all([
        client.query(dashboardReference, {}),
        client.query(accountsPageReference, { cursor: null }),
        client.query(organizationsPageReference, { cursor: null }),
      ]);
      return {
        ...metadata,
        accounts: accounts.rows,
        organizations: organizations.rows,
        accountCursor: accounts.cursor,
        organizationCursor: organizations.cursor,
        accountsTruncated: accounts.cursor !== undefined,
        organizationsTruncated: organizations.cursor !== undefined,
      };
    },
    async loadAccounts(cursor) {
      return await client.query(accountsPageReference, { cursor });
    },
    async loadOrganizations(cursor) {
      return await client.query(organizationsPageReference, { cursor });
    },
    async updateOrganizationAllowances(input) {
      return await client.mutation(updateAllowancesReference, {
        ...input,
        idempotencyKey: crypto.randomUUID(),
      });
    },
    async close() {
      await client.close();
    },
  };
}
