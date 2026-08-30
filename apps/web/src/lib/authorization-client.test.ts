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
        projects: [{ publicRef: "project_1", name: "dongo", slug: "dongo" }],
      }];
    }

    async action(_reference: unknown, input: unknown) {
      convexCalls.push(`mintAssertion:${JSON.stringify(input)}`);
      return {
        assertion: "signed-human-bridge-assertion-with-safe-length",
        expiresAt: Date.now() + 60_000,
        profileId: "profile_1",
      };
    }
  },
}));

import {
  bootstrapHumanIdentity,
  bridgeAuthorizationSession,
  decideDeviceRequest,
  decideOAuthConsent,
  getDeviceRequest,
  getOAuthClientSummary,
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
      name: "dongo",
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

  it("maps the OAuth public-client response without losing the host identity", async () => {
    const clientId = "https://claude.ai/oauth/claude-code-client-metadata";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      client_id: clientId,
      client_name: "Claude Code",
      client_uri: "https://claude.ai",
    })));

    await expect(getOAuthClientSummary(clientId)).resolves.toEqual({
      clientId,
      name: "Claude Code",
      uri: "https://claude.ai",
    });
  });

  it("rejects a public-client identity mismatch", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      client_id: "different-client",
      client_name: "Different client",
    })));

    await expect(getOAuthClientSummary("expected-client"))
      .rejects.toMatchObject({ code: "invalid" });
  });

  it("replaces a valid authorization-worker session that belongs to another human profile", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://dev.dongo.so/api/auth/get-session") {
        return Response.json({
          session: { id: "old-session" },
          user: { id: "profile_old", convexProfileId: "profile_old" },
        });
      }
      expect(url).toBe("https://dev.dongo.so/api/auth/dongo/bridge");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        assertion: "signed-human-bridge-assertion-with-safe-length",
      });
      return Response.json({ ok: true, redirectTo: "/device?user_code=DV9KPQLH" });
    });
    vi.stubGlobal("fetch", fetch);

    await expect(bridgeAuthorizationSession("/device?user_code=DV9KPQLH"))
      .resolves.toBe("/device?user_code=DV9KPQLH");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reuses an authorization-worker session only for the exact current human profile", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://dev.dongo.so/api/auth/get-session");
      return Response.json({
        session: { id: "current-session" },
        user: { id: "profile_1", convexProfileId: "profile_1" },
      });
    });
    vi.stubGlobal("fetch", fetch);

    await expect(bridgeAuthorizationSession("/oauth/consent?client_id=test"))
      .resolves.toBe("/oauth/consent?client_id=test");
    expect(fetch).toHaveBeenCalledTimes(1);
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
      expect(init?.redirect).toBe("manual");
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

  it("never lets an authorization fetch follow the host loopback callback", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe("manual");
      return new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1:8765/callback?code=secret" },
      });
    });
    vi.stubGlobal("fetch", fetch);

    await expect(decideOAuthConsent("?client_id=codex&sig=s&ba_param=client_id", true))
      .rejects.toMatchObject({ code: "invalid" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
