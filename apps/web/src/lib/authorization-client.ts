import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

import { authWorkerUrl, convexDeploymentUrl } from "./auth-config";
import { convexAccessToken } from "./auth-client";
import { personalOrganizationSlug, projectIdentifierPrefix, signedOAuthQuery } from "./auth-flow";

type BridgeAssertion = {
  assertion: string;
  expiresAt: number;
  profileId: string;
  projectRef?: string;
};

export type AuthorizableProject = {
  publicRef: string;
  name: string;
  slug: string;
  organizationName: string;
  organizationSlug: string;
  repositoryUrl?: string;
};

export type DeviceRequest = {
  userCode: string;
  status: string;
  clientId: string;
  scopes: string[];
  resources: string[];
};

export type OAuthClientSummary = {
  clientId: string;
  name: string;
  uri?: string;
};

type OAuthResult = { redirect?: boolean; url?: string };

type ProjectGroup = {
  membership: { organizationId: string; role: "owner" | "member" };
  organization: { name: string; slug: string } | null;
  projects: Array<{ _id?: string; publicRef: string; name: string; slug: string; repositoryUrl?: string; archivedAt?: number }>;
};

export type BootstrapResult = { profileId: string; created: boolean };

export type FirstProjectResult = {
  projectId: string;
  publicRef: string;
  created: boolean;
  resourceProvisioned: true;
  organizationId: string;
  organizationSlug: string;
};

const bootstrapReference = makeFunctionReference<"mutation", Record<string, never>, BootstrapResult>(
  "domains/identity/index:bootstrapCurrentUser",
);

const mintAssertionReference = makeFunctionReference<
  "action",
  { projectRef?: string; returnTo?: string },
  BridgeAssertion
>("domains/identity/assertions:mintHumanBridgeAssertion");

const listProjectsReference = makeFunctionReference<"query", Record<string, never>, ProjectGroup[]>(
  "domains/projects/index:listMine",
);

const createPersonalOrganizationReference = makeFunctionReference<
  "mutation",
  { name: string; slug: string },
  { organizationId: string; created: boolean }
>("domains/projects/index:createPersonalOrganization");

const createAndProvisionProjectReference = makeFunctionReference<
  "action",
  {
    organizationId: string;
    name: string;
    slug: string;
    identifierPrefix: string;
    repositoryUrl?: string;
    executionMode: "manual" | "autonomous";
  },
  { projectId: string; publicRef: string; created: boolean; resourceProvisioned: true }
>("domains/projects/actions:createAndProvisionResource");

export class AuthorizationFlowError extends Error {
  constructor(
    readonly code: "authentication_required" | "expired" | "invalid" | "conflict" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "AuthorizationFlowError";
  }
}

async function convexClient(): Promise<ConvexHttpClient> {
  const client = new ConvexHttpClient(convexDeploymentUrl);
  client.setAuth(await convexAccessToken());
  return client;
}

export async function bootstrapHumanIdentity(): Promise<BootstrapResult> {
  try {
    return await (await convexClient()).mutation(bootstrapReference, {});
  } catch {
    throw new AuthorizationFlowError("authentication_required", "Sign in again to finish setting up your dongo profile.");
  }
}

async function bootstrappedConvexClient(): Promise<ConvexHttpClient> {
  const client = await convexClient();
  await client.mutation(bootstrapReference, {});
  return client;
}

async function mintAssertion(input: { projectRef?: string; returnTo?: string }): Promise<BridgeAssertion> {
  try {
    return await (await bootstrappedConvexClient()).action(mintAssertionReference, input);
  } catch {
    throw new AuthorizationFlowError("authentication_required", "Sign in again to continue this authorization request.");
  }
}

async function workerRequest<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(authWorkerUrl(pathname), {
      ...init,
      // Authorization endpoints return a JSON continuation. Never let fetch
      // follow that continuation: a loopback OAuth callback must be reached
      // only as the explicit top-level navigation in followOAuthResult.
      redirect: "manual",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new AuthorizationFlowError("unavailable", "The authorization service is unavailable. Try again shortly.");
  }
  const body = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || body === null) {
    const code = body?.error;
    if (response.status === 401 || code === "unauthorized") {
      throw new AuthorizationFlowError("authentication_required", "Sign in again to continue this authorization request.");
    }
    if (code === "expired_token") {
      throw new AuthorizationFlowError("expired", "This authorization request has expired. Start again from your terminal or MCP host.");
    }
    if (code === "device_code_already_processed" || code === "access_denied") {
      throw new AuthorizationFlowError("conflict", "This authorization request has already been completed.");
    }
    throw new AuthorizationFlowError("invalid", "This authorization request is invalid or no longer available.");
  }
  return body;
}

async function authorizationWorkerProfileId(): Promise<string | undefined> {
  try {
    const response = await fetch(authWorkerUrl("/get-session"), {
      method: "GET",
      redirect: "manual",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (response.status === 401) return undefined;
    if (!response.ok) throw new Error("session check failed");
    const body = await response.json().catch(() => null) as {
      user?: { id?: unknown; convexProfileId?: unknown };
    } | null;
    const profileId = body?.user?.convexProfileId ?? body?.user?.id;
    return typeof profileId === "string" ? profileId : undefined;
  } catch {
    throw new AuthorizationFlowError("unavailable", "The authorization service is unavailable. Try again shortly.");
  }
}

export async function bridgeAuthorizationSession(returnTo: string): Promise<string> {
  const minted = await mintAssertion({ returnTo });
  // The Convex human session and the authorization-worker session are separate
  // cookies. A valid worker cookie may belong to an account that was used
  // earlier in the same browser. Only reuse it when it is bound to the exact
  // current Convex profile; otherwise replace it through the signed bridge.
  if (await authorizationWorkerProfileId() === minted.profileId) return returnTo;
  const bridged = await workerRequest<{ ok: boolean; redirectTo: string }>("/dongo/bridge", {
    method: "POST",
    body: JSON.stringify({ assertion: minted.assertion }),
  });
  return bridged.redirectTo;
}

export async function listAuthorizableProjects(): Promise<AuthorizableProject[]> {
  try {
    const groups = await (await bootstrappedConvexClient()).query(listProjectsReference, {});
    return groups.flatMap((group) => group.organization
      ? group.projects
          .filter((project) => project.archivedAt === undefined)
          .map((project) => ({
            publicRef: project.publicRef,
            name: project.name,
            slug: project.slug,
            organizationName: group.organization!.name,
            organizationSlug: group.organization!.slug,
            repositoryUrl: project.repositoryUrl,
          }))
      : []);
  } catch {
    throw new AuthorizationFlowError("unavailable", "Could not load the projects you can authorize.");
  }
}

export async function createFirstProject(input: {
  user: { id: string; name?: string; email?: string };
  name: string;
  slug: string;
  repositoryUrl?: string;
  executionMode: "manual" | "autonomous";
}): Promise<FirstProjectResult> {
  try {
    const client = await bootstrappedConvexClient();
    let groups = await client.query(listProjectsReference, {});
    let ownerGroup = groups.find((group) => group.membership.role === "owner" && group.organization !== null);
    let organizationId = ownerGroup?.membership.organizationId;
    if (!organizationId && groups.length === 0) {
      const organization = await client.mutation(createPersonalOrganizationReference, {
        name: input.user.name?.trim() || "Personal workspace",
        slug: personalOrganizationSlug({ ...input.user, userId: input.user.id }),
      });
      organizationId = organization.organizationId;
      groups = await client.query(listProjectsReference, {});
      ownerGroup = groups.find((group) => group.membership.organizationId === organizationId && group.membership.role === "owner");
    }
    if (!organizationId || !ownerGroup) {
      throw new AuthorizationFlowError("invalid", "An organization owner must create the first project.");
    }
    const project = await client.action(createAndProvisionProjectReference, {
      organizationId,
      name: input.name,
      slug: input.slug,
      identifierPrefix: projectIdentifierPrefix(input.name),
      repositoryUrl: input.repositoryUrl,
      executionMode: input.executionMode,
    });
    const organizationSlug = ownerGroup.organization?.slug;
    if (!organizationSlug) {
      throw new AuthorizationFlowError("invalid", "The project organization could not be resolved.");
    }
    return { ...project, organizationId, organizationSlug };
  } catch (cause) {
    if (cause instanceof AuthorizationFlowError) throw cause;
    const message = cause instanceof Error ? cause.message : "";
    if (message.includes("free plan")) {
      throw new AuthorizationFlowError("conflict", "The free plan already has an active project.");
    }
    if (message.includes("slug is already") || message.includes("slug is already in use")) {
      throw new AuthorizationFlowError("conflict", "That project slug is already in use. Change the project name and try again.");
    }
    if (message.includes("identifierPrefix")) {
      throw new AuthorizationFlowError("conflict", "That project identifier is already in use. Change the project name and try again.");
    }
    throw new AuthorizationFlowError("unavailable", "The project could not be created or provisioned. Your entries are still here; try again.");
  }
}

export async function selectAuthorizationProject(projectRef: string, returnTo: string): Promise<void> {
  const minted = await mintAssertion({ projectRef, returnTo });
  await workerRequest<{ ok: boolean; projectRef: string }>("/dongo/select-project", {
    method: "POST",
    body: JSON.stringify({ assertion: minted.assertion }),
  });
}

export async function getDeviceRequest(userCode: string): Promise<DeviceRequest> {
  const result = await workerRequest<{
    user_code: string;
    status: string;
    client_id?: string;
    scope?: string;
    resource?: string | string[];
  }>(`/device?${new URLSearchParams({ user_code: userCode })}`);
  return {
    userCode: result.user_code,
    status: result.status,
    clientId: result.client_id || "dongo-cli",
    scopes: result.scope?.split(/\s+/).filter(Boolean) ?? [],
    resources: Array.isArray(result.resource) ? result.resource : result.resource ? [result.resource] : [],
  };
}

export async function decideDeviceRequest(userCode: string, accept: boolean): Promise<void> {
  await workerRequest<{ success: boolean }>(accept ? "/device/approve" : "/device/deny", {
    method: "POST",
    body: JSON.stringify({ userCode }),
  });
}

export async function getOAuthClientSummary(clientId: string): Promise<OAuthClientSummary> {
  const client = await workerRequest<{ clientId: string; name?: string; uri?: string }>(
    `/oauth2/public-client?${new URLSearchParams({ client_id: clientId })}`,
  );
  return { clientId: client.clientId, name: client.name || "MCP host", uri: client.uri };
}

export async function continueOAuthAfterProject(search: string): Promise<OAuthResult> {
  return workerRequest<OAuthResult>("/oauth2/continue", {
    method: "POST",
    body: JSON.stringify({ postLogin: true, oauth_query: signedOAuthQuery(search) }),
  });
}

export async function decideOAuthConsent(search: string, accept: boolean): Promise<OAuthResult> {
  return workerRequest<OAuthResult>("/oauth2/consent", {
    method: "POST",
    body: JSON.stringify({ accept, oauth_query: signedOAuthQuery(search) }),
  });
}

export function followOAuthResult(result: OAuthResult): void {
  if (!result.redirect || !result.url) {
    throw new AuthorizationFlowError("invalid", "The authorization server did not provide a safe continuation.");
  }
  window.location.assign(result.url);
}
