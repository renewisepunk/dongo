import { afterEach, describe, expect, it, vi } from "vitest";

const convexCalls = vi.hoisted(() => [] as string[]);

vi.mock("./auth-client", () => ({
  convexAccessToken: async () => "convex-access-token",
}));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    setAuth(token: string) {
      convexCalls.push(`auth:${token}`);
    }

    async mutation(_reference: unknown, _input: unknown) {
      convexCalls.push("bootstrap");
      return { profileId: "profile_1", created: false };
    }

    async query(_reference: unknown, _input: unknown) {
      convexCalls.push("listMine");
      return [{
        membership: { organizationId: "org_1", role: "owner" },
        organization: { name: "Studio", slug: "studio" },
        projects: [{ publicRef: "project_1", name: "Dongo", slug: "dongo" }],
      }];
    }
  },
}));

import {
  bootstrapHumanIdentity,
  decideDeviceRequest,
  decideOAuthConsent,
  getDeviceRequest,
  listAuthorizableProjects,
} from "./authorization-client";

afterEach(() => {
  convexCalls.length = 0;
  vi.unstubAllGlobals();
});

describe("isolated authorization worker client", () => {
  it("bootstraps the current profile before listMine", async () => {
    await expect(bootstrapHumanIdentity()).resolves.toEqual({ profileId: "profile_1", created: false });
    convexCalls.length = 0;
    await expect(listAuthorizableProjects()).resolves.toEqual([{
      publicRef: "project_1",
      name: "Dongo",
      slug: "dongo",
      organizationName: "Studio",
      organizationSlug: "studio",
    }]);
    expect(convexCalls).toEqual(["auth:convex-access-token", "bootstrap", "listMine"]);
  });

  it("reads a device request without persisting or inventing authorization data", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://dev.dongo.so/api/auth/device?user_code=DV9KPQLH");
      return Response.json({
        user_code: "DV9KPQLH",
        status: "pending",
        client_id: "dongo-cli",
        scope: "dongo:work:read dongo:work:write offline_access",
        resource: "https://dev.dongo.so/api/agent/v1",
      });
    });
    vi.stubGlobal("fetch", fetch);

    await expect(getDeviceRequest("DV9KPQLH")).resolves.toEqual({
      userCode: "DV9KPQLH",
      status: "pending",
      clientId: "dongo-cli",
      scopes: ["dongo:work:read", "dongo:work:write", "offline_access"],
      resources: ["https://dev.dongo.so/api/agent/v1"],
    });
  });

  it("posts only the comparison code to the maintained approve endpoint", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://dev.dongo.so/api/auth/device/approve");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ userCode: "DV9KPQLH" });
      return Response.json({ success: true });
    });
    vi.stubGlobal("fetch", fetch);
    await decideDeviceRequest("DV9KPQLH", true);
  });

  it("sends consent through the provider and strips unsigned query injection", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://dev.dongo.so/api/auth/oauth2/consent");
      const body = JSON.parse(String(init?.body)) as { accept: boolean; oauth_query: string };
      expect(body.accept).toBe(true);
      const query = new URLSearchParams(body.oauth_query);
      expect(query.get("client_id")).toBe("codex");
      expect(query.has("injected")).toBe(false);
      return Response.json({ redirect: true, url: "http://127.0.0.1:8765/callback" });
    });
    vi.stubGlobal("fetch", fetch);
    await decideOAuthConsent("?client_id=codex&injected=drop&sig=s&ba_param=client_id", true);
  });
});
