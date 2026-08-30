import { SignJWT } from "jose";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  allowedMetadataHostname,
  claudeLoopbackRedirectForFlow,
  claudeLoopbackRedirectForRequest,
  createMetadataFetcher,
  safeReturnTo,
  signInternalRequest,
  verifyInternalRequest,
  verifyHumanBridgeAssertion,
} from "../src/security";
import {
  ACCESS_TOKEN_PREFIX,
  consentReferenceIdForProject,
  decodePinnedAccessToken,
  decodePinnedRefreshToken,
  encodePinnedAccessToken,
  encodePinnedRefreshToken,
  pinnedRefreshTokenHandlers,
  REFRESH_TOKEN_PREFIX,
  projectRefForGrant,
  providerGrantId,
  type PinnedGrantContext,
} from "../src/grant-binding";
import { renderOtpEmail } from "../src/otp-email";
import { createAuthorizationServer, oauthClientLabel } from "../src/auth";
import type { AuthWorkerEnv } from "../src/env";

describe("authorization boundary security", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("constructs the OAuth server with encrypted clients and opaque tokens", async () => {
    const database = new Database(":memory:");
    const env = {
      AUTH_DB: database,
      EMAIL: {},
      PUBLIC_ORIGIN: "https://dev.dongo.so",
      AUTH_ISSUER: "https://dev.dongo.so/api/auth",
      HUMAN_ASSERTION_ISSUER: "https://convex.example",
      HUMAN_ASSERTION_SECRET: "h".repeat(48),
      BETTER_AUTH_SECRET: "b".repeat(48),
      CONVEX_INTERNAL_SITE_URL: "https://convex.example",
      DONGO_INTERNAL_GATEWAY_SECRET: "g".repeat(48),
      BETTER_AUTH_RESOURCE_CLIENT_ID: "mcp-resource",
      BETTER_AUTH_RESOURCE_CLIENT_SECRET: "m".repeat(48),
      DONGO_API_RESOURCE_CLIENT_ID: "api-resource",
      DONGO_API_RESOURCE_CLIENT_SECRET: "a".repeat(48),
      CIMD_ALLOWED_HOST_SUFFIXES: "openai.com,anthropic.com",
      ENVIRONMENT: "development",
    } as unknown as AuthWorkerEnv;

    const server = createAuthorizationServer(env);
    await expect(server.$context).resolves.toBeDefined();
    database.close();
  });

  it("labels OAuth installations from validated metadata or the client registry", async () => {
    const first = vi.fn(async () => ({ name: "Claude Code" }));
    const bind = vi.fn(() => ({ first }));
    const prepare = vi.fn(() => ({ bind }));
    const database = { prepare } as unknown as AuthWorkerEnv["AUTH_DB"];

    await expect(oauthClientLabel(database, "claude-client", {
      client_name: "Metadata Client",
    })).resolves.toBe("Metadata Client");
    expect(prepare).not.toHaveBeenCalled();

    await expect(oauthClientLabel(database, "claude-client"))
      .resolves.toBe("Claude Code");
    expect(bind).toHaveBeenCalledWith("claude-client");

    first.mockResolvedValueOnce({ name: "\u0000unsafe" });
    await expect(oauthClientLabel(database, "unknown-client"))
      .resolves.toBe("MCP host");
  });

  it("accepts only environment-local return targets", () => {
    expect(safeReturnTo("/device?user_code=ABCD", "https://dev.dongo.so"))
      .toBe("/device?user_code=ABCD");
    expect(safeReturnTo("https://attacker.example/x", "https://dev.dongo.so"))
      .toBe("/app");
  });

  it("allowlists metadata hosts without suffix confusion or IP literals", () => {
    expect(allowedMetadataHostname("clients.openai.com", ["openai.com"])).toBe(true);
    expect(allowedMetadataHostname("openai.com.attacker.test", ["openai.com"])).toBe(false);
    expect(allowedMetadataHostname("127.0.0.1", ["openai.com"])).toBe(false);
  });

  it("fetches an allowlisted CIMD document with bounded manual redirects", async () => {
    const upstream = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({
        client_id: String(input),
        client_name: "Claude Code",
        redirect_uris: ["http://localhost/callback"],
      }, {
        headers: {
          "cache-control": "public, max-age=300",
          "content-encoding": "br",
          "set-cookie": "private=never-forward",
        },
      }));
    vi.stubGlobal("fetch", upstream);
    const fetchMetadata = createMetadataFetcher(["claude.ai"]);
    const response = await fetchMetadata(
      "https://claude.ai/oauth/claude-code-client-metadata",
      { headers: { accept: "application/json" }, redirect: "error" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    await expect(response.json()).resolves.toMatchObject({
      client_name: "Claude Code",
    });
    expect(upstream).toHaveBeenCalledOnce();
    expect(upstream.mock.calls[0]?.[0]).toBe(
      "https://claude.ai/oauth/claude-code-client-metadata",
    );
    expect(upstream.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      redirect: "manual",
    });
    expect(new Headers(upstream.mock.calls[0]?.[1]?.headers).get("accept")).toBe(
      "application/json",
    );
  });

  it("rejects CIMD redirects instead of following them", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://claude.ai/elsewhere" },
      })));
    const fetchMetadata = createMetadataFetcher(["claude.ai"]);
    await expect(
      fetchMetadata("https://claude.ai/oauth/claude-code-client-metadata"),
    ).rejects.toThrow("redirects are not allowed");
  });

  it("admits only Claude Code's exact port-bearing localhost callback", () => {
    const authorize = (clientId: string, redirectUri: string) =>
      new Request(`https://dev.dongo.so/api/auth/oauth2/authorize?${new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
      })}`);
    expect(claudeLoopbackRedirectForRequest(authorize(
      "https://claude.ai/oauth/claude-code-client-metadata",
      "http://localhost:3118/callback",
    ))).toBe("http://localhost:3118/callback");
    for (const [clientId, redirectUri] of [
      ["https://attacker.example/client.json", "http://localhost:3118/callback"],
      ["https://claude.ai/oauth/claude-code-client-metadata", "http://localhost/callback"],
      ["https://claude.ai/oauth/claude-code-client-metadata", "http://localhost:3118/other"],
      ["https://claude.ai/oauth/claude-code-client-metadata", "http://localhost:3118/callback?x=1"],
      ["https://claude.ai/oauth/claude-code-client-metadata", "https://localhost:3118/callback"],
    ]) {
      expect(claudeLoopbackRedirectForRequest(authorize(clientId!, redirectUri!)))
        .toBeUndefined();
    }

    const duplicate = new URL(authorize(
      "https://claude.ai/oauth/claude-code-client-metadata",
      "http://localhost:3118/callback",
    ).url);
    duplicate.searchParams.append("redirect_uri", "http://localhost:3118/callback");
    expect(claudeLoopbackRedirectForRequest(new Request(duplicate))).toBeUndefined();
  });

  it("keeps Claude's validated loopback callback through consent and continuation", async () => {
    const oauthQuery = new URLSearchParams({
      client_id: "https://claude.ai/oauth/claude-code-client-metadata",
      redirect_uri: "http://localhost:3118/callback",
      response_type: "code",
    }).toString();
    const continuation = (path: string, query = oauthQuery) => new Request(
      `https://dev.dongo.so${path}`,
      {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ accept: true, oauth_query: query }),
      },
    );

    await expect(claudeLoopbackRedirectForFlow(
      continuation("/api/auth/oauth2/consent"),
    )).resolves.toBe("http://localhost:3118/callback");
    await expect(claudeLoopbackRedirectForFlow(
      continuation("/api/auth/oauth2/continue"),
    )).resolves.toBe("http://localhost:3118/callback");

    const duplicate = `${oauthQuery}&redirect_uri=${encodeURIComponent(
      "http://localhost:3118/callback",
    )}`;
    await expect(claudeLoopbackRedirectForFlow(
      continuation("/api/auth/oauth2/consent", duplicate),
    )).resolves.toBeUndefined();
    await expect(claudeLoopbackRedirectForFlow(new Request(
      "https://dev.dongo.so/api/auth/oauth2/consent",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    ))).resolves.toBeUndefined();
    await expect(claudeLoopbackRedirectForFlow(
      continuation("/api/auth/oauth2/consent", "x".repeat(16 * 1024 + 1)),
    )).resolves.toBeUndefined();
    await expect(claudeLoopbackRedirectForFlow(new Request(
      "https://dev.dongo.so/api/auth/oauth2/consent",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ oauth_query: oauthQuery, padding: "x".repeat(32 * 1024) }),
      },
    ))).resolves.toBeUndefined();
  });

  it("adds only the validated Claude callback to Claude's fetched metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      client_id: "https://claude.ai/oauth/claude-code-client-metadata",
      client_name: "Claude Code",
      redirect_uris: [
        "http://localhost/callback",
        "http://127.0.0.1/callback",
      ],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    })));
    const response = await createMetadataFetcher(
      ["claude.ai"],
      "http://localhost:3118/callback",
    )("https://claude.ai/oauth/claude-code-client-metadata");
    await expect(response.json()).resolves.toMatchObject({
      redirect_uris: [
        "http://localhost/callback",
        "http://127.0.0.1/callback",
        "http://localhost:3118/callback",
      ],
    });
  });

  it("verifies short-lived issuer and audience-bound human assertions", async () => {
    const secret = "s".repeat(48);
    const token = await new SignJWT({
      email: "rene@example.com",
      name: "Rene",
      profileId: "profile_1",
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer("https://convex.example")
      .setAudience("https://dev.dongo.so/api/auth/dongo/bridge")
      .setSubject("profile_1")
      .setJti("assertion_1")
      .setIssuedAt()
      .setExpirationTime("90s")
      .sign(new TextEncoder().encode(secret));
    const claims = await verifyHumanBridgeAssertion({
      token,
      secret,
      issuer: "https://convex.example",
      audience: "https://dev.dongo.so/api/auth/dongo/bridge",
    });
    expect(claims.profileId).toBe("profile_1");
  });

  it("signs the frozen internal HMAC canonical form deterministically", async () => {
    const body = new TextEncoder().encode('{"operation":"get_overview"}');
    const first = await signInternalRequest({
      secret: "g".repeat(48),
      timestamp: "1700000000000",
      nonce: "ad1f22bf-33c2-47d6-99f0-0d4f16ad9e1b",
      method: "POST",
      pathname: "/internal/agent/v1/execute",
      body,
    });
    const second = await signInternalRequest({
      secret: "g".repeat(48),
      timestamp: "1700000000000",
      nonce: "ad1f22bf-33c2-47d6-99f0-0d4f16ad9e1b",
      method: "POST",
      pathname: "/internal/agent/v1/execute",
      body,
    });
    expect(first).toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(verifyInternalRequest({
      secret: "g".repeat(48),
      keyId: "v1",
      timestamp: "1700000000000",
      nonce: "ad1f22bf-33c2-47d6-99f0-0d4f16ad9e1b",
      signature: first,
      method: "POST",
      pathname: "/internal/agent/v1/execute",
      body,
      now: 1700000000000,
    })).resolves.toEqual({
      timestamp: 1700000000000,
      nonce: "ad1f22bf-33c2-47d6-99f0-0d4f16ad9e1b",
    });
    await expect(verifyInternalRequest({
      secret: "g".repeat(48),
      keyId: "v1",
      timestamp: "1700000000000",
      nonce: "ad1f22bf-33c2-47d6-99f0-0d4f16ad9e1b",
      signature: first,
      method: "POST",
      pathname: "/internal/agent/v1/execute",
      body,
      now: 1700000060001,
    })).rejects.toThrow("outside the accepted window");
  });

  it("pins project selection to an exact MCP resource", async () => {
    const consentReference = consentReferenceIdForProject("project_123");
    expect(consentReferenceIdForProject("project_123")).toBe(consentReference);
    expect(consentReference).toBe("dongo-consent:project_123");
    const projectRef = projectRefForGrant({
      publicOrigin: "https://dev.dongo.so",
      resources: ["https://dev.dongo.so/p/project_123/mcp"],
      activeProjectRef: "project_123",
      referenceId: "dongo-grant:project_123:550e8400-e29b-41d4-a716-446655440000",
    });
    expect(projectRef).toBe("project_123");
    await expect(providerGrantId({
      issuer: "https://dev.dongo.so/api/auth",
      subject: "profile_1",
      clientId: "dongo-cli",
      projectRef,
      resource: "https://dev.dongo.so/api/agent/v1",
    })).resolves.toMatch(/^dongo-device:[0-9a-f]{64}$/);

    const firstClientGrant = await providerGrantId({
      issuer: "https://dev.dongo.so/api/auth",
      subject: "profile_1",
      clientId: "codex-client",
      projectRef,
      resource: "https://dev.dongo.so/p/project_123/mcp",
      referenceId: consentReference,
    });
    const secondClientGrant = await providerGrantId({
      issuer: "https://dev.dongo.so/api/auth",
      subject: "profile_1",
      clientId: "claude-client",
      projectRef,
      resource: "https://dev.dongo.so/p/project_123/mcp",
      referenceId: consentReference,
    });
    expect(firstClientGrant).toMatch(/^dongo-oauth:[0-9a-f]{64}$/);
    expect(secondClientGrant).toMatch(/^dongo-oauth:[0-9a-f]{64}$/);
    expect(firstClientGrant).not.toBe(secondClientGrant);
  });

  it("renders matching plain-text and HTML OTP messages", () => {
    const message = renderOtpEmail("482913");
    expect(message.subject).toContain("482913");
    expect(message.text).toContain("482913");
    expect(message.html).toContain("482913");
  });

  it("cryptographically pins opaque access and refresh tokens to one grant", async () => {
    const secret = "p".repeat(48);
    const grant: PinnedGrantContext = {
      providerIssuer: "https://dev.dongo.so/api/auth",
      providerGrantId: "dongo-device:abc123",
      subject: "oauth-user-1",
      clientId: "dongo-cli",
      label: "dongo CLI",
      resource: "https://dev.dongo.so/api/agent/v1",
      scopes: ["dongo:work:read", "offline_access"],
      kind: "cli",
      profileId: "profile-1",
      projectRef: "project-1",
      binding: {
        installationId: "installation-1",
        oauthBindingId: "binding-1",
        installationActorId: "actor-1",
        organizationId: "organization-1",
        projectId: "project-id-1",
        projectRef: "project-1",
      },
    };
    const access = await encodePinnedAccessToken(secret, grant);
    await expect(
      decodePinnedAccessToken(secret, `${ACCESS_TOKEN_PREFIX}${access}`),
    ).resolves.toEqual(grant);
    const tampered = `${access.slice(0, -1)}${access.endsWith("0") ? "1" : "0"}`;
    await expect(
      decodePinnedAccessToken(secret, `${ACCESS_TOKEN_PREFIX}${tampered}`),
    ).rejects.toThrow();

    const refresh = await encodePinnedRefreshToken({
      secret,
      token: "raw-refresh-token-value-123456789",
      sessionId: "session-1",
      grant,
    });
    await expect(decodePinnedRefreshToken(secret, refresh)).resolves.toEqual({
      token: "raw-refresh-token-value-123456789",
      sessionId: "session-1",
      grant,
    });

    let activeGrant: PinnedGrantContext | undefined = grant;
    const handlers = pinnedRefreshTokenHandlers(secret, {
      get: () => activeGrant,
      set: (value) => {
        activeGrant = value;
      },
    });
    const storedToken = await handlers.generate();
    const formattedToken = handlers.encrypt(storedToken);
    expect(formattedToken).toBe(storedToken);
    expect(formattedToken).not.toBeInstanceOf(Promise);
    expect(`${REFRESH_TOKEN_PREFIX}${formattedToken}`).not.toContain("[object Promise]");

    activeGrant = undefined;
    await expect(handlers.decrypt(formattedToken)).resolves.toEqual({
      token: storedToken,
      sessionId: undefined,
    });
    expect(activeGrant).toEqual(grant);

    activeGrant = grant;
    const malformed = await handlers.decrypt("[object Promise]");
    expect(malformed.token).not.toBe("[object Promise]");
    expect(activeGrant).toBeUndefined();
  });
});
