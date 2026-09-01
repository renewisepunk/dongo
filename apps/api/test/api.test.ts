import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ApiConvexOperationExecutor } from "../src/convex-executor.ts";
import {
  createDongoApiGateway,
  createUnavailableDongoApiWorker,
} from "../src/gateway.ts";
import { ApiIntrospectionTokenVerifier } from "../src/introspection.ts";
import {
  ApiRoutedTokenVerifier,
  ApiServiceCredentialTokenVerifier,
  isServiceCredentialBearer,
} from "../src/service-credentials.ts";
import { ApiBoundaryError } from "../src/types.ts";
import type {
  ApiOperationExecutor,
  ApiInstallationPrincipal,
  ApiRateLimiter,
  ApiTokenVerifier,
  DongoInstallationPrincipal,
} from "../src/types.ts";

const RESOURCE = new URL("https://dev.dongo.so/api/agent/v1");
const ISSUER = "https://dev.dongo.so/api/auth";
const NOW_SECONDS = 2_000_000_000;
const NOW_MS = NOW_SECONDS * 1_000;
const SECRET = "0123456789abcdef0123456789abcdef";
const NONCE = "00000000-0000-4000-8000-000000000001";
const SERVICE_REQUEST_ID = "00000000-0000-4000-8000-000000000002";
const SERVICE_PREFIX = "abcdefghijk";
const SERVICE_TOKEN = `dng_svc_${SERVICE_PREFIX}_${"s".repeat(43)}`;

function principal(
  scopes: readonly string[] = [
    "dongo:work:read",
    "dongo:work:write",
    "dongo:attachments:read",
  ],
): DongoInstallationPrincipal {
  return {
    clientId: "dongo-cli",
    grantId: "oauth-binding-id",
    installationId: "installation-id",
    installationActorId: "actor-id",
    organizationId: "organization-id",
    projectId: "project-id",
    projectRef: "project_ref_123",
    issuer: ISSUER,
    resource: RESOURCE.toString(),
    scopes,
  };
}

const validIntrospection = {
  active: true,
  token_type: "Bearer",
  client_id: "dongo-cli",
  scope: "dongo:work:read dongo:work:write offline_access",
  iss: ISSUER,
  aud: RESOURCE.toString(),
  sub: "human-user-1",
  exp: NOW_SECONDS + 300,
  nbf: NOW_SECONDS - 30,
  grantId: "oauth-binding-id",
  installationId: "installation-id",
  installationActorId: "actor-id",
  organizationId: "organization-id",
  projectId: "project-id",
  projectRef: "project_ref_123",
};

describe("generic API token introspection", () => {
  it("authenticates the confidential introspection request and projects pinned claims", async () => {
    const observed: Request[] = [];
    const verifier = new ApiIntrospectionTokenVerifier({
      introspectionUrl: new URL(`${ISSUER}/oauth2/introspect`),
      issuer: ISSUER,
      resource: RESOURCE,
      resourceClientId: "dongo-api-resource-dev",
      resourceClientSecret: SECRET,
      nowSeconds: () => NOW_SECONDS,
      fetch: async function (this: void, input, init) {
        expect(this).toBeUndefined();
        observed.push(new Request(input, init));
        return Response.json(validIntrospection);
      },
    });
    const result = await verifier.verifyAccessToken(
      "opaque-access-token",
      new AbortController().signal,
    );
    expect(result).toEqual({
      ...principal(["dongo:work:read", "dongo:work:write"]),
      clientId: "dongo-cli",
    });
    expect(observed).toHaveLength(1);
    const request = observed[0]!;
    expect(request.method).toBe("POST");
    expect(request.headers.get("authorization")).toMatch(/^Basic /u);
    expect(request.headers.has("cookie")).toBe(false);
    const form = new URLSearchParams(await request.text());
    expect(form.get("token")).toBe("opaque-access-token");
    expect(form.get("token_type_hint")).toBe("access_token");
  });

  it("introspects on every request and rejects revocation, audience drift, and invalid project claims", async () => {
    let calls = 0;
    const verifier = new ApiIntrospectionTokenVerifier({
      introspectionUrl: new URL(`${ISSUER}/oauth2/introspect`),
      issuer: ISSUER,
      resource: RESOURCE,
      resourceClientId: "dongo-api-resource-dev",
      resourceClientSecret: SECRET,
      nowSeconds: () => NOW_SECONDS,
      fetch: async () => {
        calls += 1;
        return Response.json(calls === 1 ? validIntrospection : { active: false });
      },
    });
    await verifier.verifyAccessToken("opaque", new AbortController().signal);
    await expect(
      verifier.verifyAccessToken("opaque", new AbortController().signal),
    ).rejects.toMatchObject({ code: "unauthorized", status: 401 });
    expect(calls).toBe(2);

    for (const override of [
      { aud: "https://dev.dongo.so/p/project_ref_123/mcp" },
      { projectRef: "invalid/project" },
      { grantId: "" },
    ]) {
      const strictVerifier = new ApiIntrospectionTokenVerifier({
        introspectionUrl: new URL(`${ISSUER}/oauth2/introspect`),
        issuer: ISSUER,
        resource: RESOURCE,
        resourceClientId: "dongo-api-resource-dev",
        resourceClientSecret: SECRET,
        nowSeconds: () => NOW_SECONDS,
        fetch: async () => Response.json({ ...validIntrospection, ...override }),
      });
      await expect(
        strictVerifier.verifyAccessToken("opaque", new AbortController().signal),
      ).rejects.toBeInstanceOf(ApiBoundaryError);
    }
  });
});

describe("service credential verification", () => {
  it("routes the CI bearer through the signed Convex boundary and returns a service principal", async () => {
    let observed: Request | undefined;
    const verifier = new ApiServiceCredentialTokenVerifier({
      convexSiteUrl: new URL("https://wandering-camel-662.convex.site/"),
      resource: RESOURCE,
      secret: SECRET,
      nowMs: () => NOW_MS,
      nonce: () => NONCE,
      requestId: () => SERVICE_REQUEST_ID,
      fetch: async function (this: void, input, init) {
        expect(this).toBeUndefined();
        observed = new Request(input, init);
        return Response.json({
          ok: true,
          apiVersion: "v1",
          requestId: SERVICE_REQUEST_ID,
          data: {
            active: true,
            installationId: "service-installation-id",
            serviceCredentialId: "service-credential-id",
            actorId: "service-actor-id",
            organizationId: "organization-id",
            projectId: "project-id",
            projectRef: "project_ref_123",
            clientId: `dongo-service-v1:${SERVICE_PREFIX}`,
            resource: RESOURCE.toString(),
            scopes: ["dongo:work:read", "dongo:work:write"],
          },
        });
      },
    });
    const result = await verifier.verifyAccessToken(
      SERVICE_TOKEN,
      new AbortController().signal,
    );
    expect(result).toEqual({
      clientId: `dongo-service-v1:${SERVICE_PREFIX}`,
      serviceCredentialId: "service-credential-id",
      installationId: "service-installation-id",
      installationActorId: "service-actor-id",
      organizationId: "organization-id",
      projectId: "project-id",
      projectRef: "project_ref_123",
      resource: RESOURCE.toString(),
      scopes: ["dongo:work:read", "dongo:work:write"],
    });
    expect(observed).toBeDefined();
    const request = observed!;
    expect(request.url).toBe(
      "https://wandering-camel-662.convex.site/internal/service-credentials/v1/resolve",
    );
    expect(request.headers.has("authorization")).toBe(false);
    expect(request.headers.has("cookie")).toBe(false);
    const body = await request.clone().text();
    expect(JSON.parse(body)).toEqual({
      version: 1,
      requestId: SERVICE_REQUEST_ID,
      input: { token: SERVICE_TOKEN },
    });
    const hash = createHash("sha256").update(body).digest("hex");
    const expected = createHmac("sha256", SECRET)
      .update(
        `${NOW_MS}\n${NONCE}\nPOST\n/internal/service-credentials/v1/resolve\n${hash}`,
      )
      .digest("base64url");
    expect(request.headers.get("x-dongo-signature")).toBe(expected);
  });

  it("rejects inactive or malformed CI credentials without falling back to OAuth", async () => {
    let serviceCalls = 0;
    const service = new ApiServiceCredentialTokenVerifier({
      convexSiteUrl: new URL("https://wandering-camel-662.convex.site/"),
      resource: RESOURCE,
      secret: SECRET,
      nowMs: () => NOW_MS,
      nonce: () => NONCE,
      requestId: () => SERVICE_REQUEST_ID,
      fetch: async () => {
        serviceCalls += 1;
        return Response.json({
          ok: true,
          apiVersion: "v1",
          requestId: SERVICE_REQUEST_ID,
          data: { active: false },
        });
      },
    });
    const oauth = new FakeVerifier(principal());
    const routed = new ApiRoutedTokenVerifier(oauth, service);
    await expect(
      routed.verifyAccessToken(SERVICE_TOKEN, new AbortController().signal),
    ).rejects.toMatchObject({ code: "unauthorized", status: 401 });
    await expect(
      routed.verifyAccessToken(
        "dng_svc_malformed",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "unauthorized", status: 401 });
    expect(serviceCalls).toBe(1);
    expect(oauth.calls).toEqual([]);
    expect(isServiceCredentialBearer("opaque-oauth-token")).toBe(false);
  });
});

describe("Convex signed executor", () => {
  it("signs the canonical gateway envelope for the generic resource without forwarding bearer data", async () => {
    let observed: Request | undefined;
    const executor = new ApiConvexOperationExecutor({
      convexSiteUrl: new URL("https://wandering-camel-662.convex.site/"),
      resource: RESOURCE,
      secret: SECRET,
      nowMs: () => NOW_MS,
      nonce: () => NONCE,
      fetch: async function (this: void, input, init) {
        expect(this).toBeUndefined();
        observed = new Request(input, init);
        return Response.json({
          ok: true,
          apiVersion: "v1",
          requestId: "request-1",
          data: {
            attachmentId: "attachment-id",
            filename: "report.pdf",
            contentType: "application/pdf",
            byteSize: 42,
            downloadUrl: "https://files.example/attachment-id?signature=signed",
            expiresAt: NOW_MS + 60_000,
          },
        });
      },
    });
    const result = await executor.execute(
      "get_attachment",
      { attachmentId: "attachment-id" },
      {
        principal: principal(),
        requestId: "request-1",
        signal: new AbortController().signal,
      },
    );
    expect(result.ok).toBe(true);
    expect(observed).toBeDefined();
    const request = observed!;
    expect(request.url).toBe(
      "https://wandering-camel-662.convex.site/internal/agent/v1/execute",
    );
    expect(request.redirect).toBe("manual");
    expect(request.headers.has("authorization")).toBe(false);
    const body = await request.clone().text();
    expect(body).not.toContain("opaque-access-token");
    expect(JSON.parse(body)).toMatchObject({
      version: 1,
      operation: "get_attachment",
      context: {
        requestId: "request-1",
        grantId: "oauth-binding-id",
        projectRef: "project_ref_123",
        resource: RESOURCE.toString(),
      },
    });
    const hash = createHash("sha256").update(body).digest("hex");
    const expected = createHmac("sha256", SECRET)
      .update(`${NOW_MS}\n${NONCE}\nPOST\n/internal/agent/v1/execute\n${hash}`)
      .digest("base64url");
    expect(request.headers.get("x-dongo-signature")).toBe(expected);
  });

  it("forwards only the service credential binding after bearer verification", async () => {
    let context: Record<string, unknown> | undefined;
    const executor = new ApiConvexOperationExecutor({
      convexSiteUrl: new URL("https://wandering-camel-662.convex.site/"),
      resource: RESOURCE,
      secret: SECRET,
      nowMs: () => NOW_MS,
      nonce: () => NONCE,
      fetch: async (input, init) => {
        const request = new Request(input, init);
        context = (JSON.parse(await request.text()) as { context: Record<string, unknown> }).context;
        return Response.json({
          ok: true,
          apiVersion: "v1",
          requestId: "service-operation-request",
          data: {
            project: {
              id: "project-id",
              publicRef: "project_ref_123",
              organizationId: "organization-id",
              organizationSlug: "organization",
              name: "Project",
              slug: "project",
              identifierPrefix: "DON",
              executionMode: "manual",
            },
            needsYou: [],
            working: [],
            ready: [],
            inbox: [],
            recentlyDone: [],
            serverTime: NOW_MS,
          },
        });
      },
    });
    const servicePrincipal: ApiInstallationPrincipal = {
      clientId: `dongo-service-v1:${SERVICE_PREFIX}`,
      serviceCredentialId: "service-credential-id",
      installationId: "service-installation-id",
      installationActorId: "service-actor-id",
      organizationId: "organization-id",
      projectId: "project-id",
      projectRef: "project_ref_123",
      resource: RESOURCE.toString(),
      scopes: ["dongo:work:read"],
    };
    const result = await executor.execute("get_overview", {}, {
      principal: servicePrincipal,
      requestId: "service-operation-request",
      signal: new AbortController().signal,
    });
    expect(result.ok).toBe(true);
    expect(context).toMatchObject({
      serviceCredentialId: "service-credential-id",
      installationId: "service-installation-id",
    });
    expect(context).not.toHaveProperty("grantId");
    expect(context).not.toHaveProperty("issuer");
  });

  it("rejects response contract drift and mismatched request IDs", async () => {
    for (const response of [
      {
        ok: true,
        apiVersion: "v1",
        requestId: "request-1",
        data: { attachmentId: "missing-fields" },
      },
      {
        ok: true,
        apiVersion: "v1",
        requestId: "different-request",
        data: {
          attachmentId: "attachment-id",
          filename: "file.txt",
          contentType: "text/plain",
          byteSize: 1,
          downloadUrl: "https://files.example/file",
          expiresAt: NOW_MS + 60_000,
        },
      },
    ]) {
      const executor = new ApiConvexOperationExecutor({
        convexSiteUrl: new URL("https://wandering-camel-662.convex.site/"),
        resource: RESOURCE,
        secret: SECRET,
        nowMs: () => NOW_MS,
        nonce: () => NONCE,
        fetch: async () => Response.json(response),
      });
      const result = await executor.execute(
        "get_attachment",
        { attachmentId: "attachment-id" },
        {
          principal: principal(),
          requestId: "request-1",
          signal: new AbortController().signal,
        },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(["internal", "temporarily_unavailable"]).toContain(
          result.error.code,
        );
      }
    }
  });
});

class FakeVerifier implements ApiTokenVerifier {
  calls: string[] = [];

  constructor(readonly value: ApiInstallationPrincipal) {}

  async verifyAccessToken(token: string): Promise<ApiInstallationPrincipal> {
    this.calls.push(token);
    return this.value;
  }
}

class FakeExecutor implements ApiOperationExecutor {
  calls: Array<{ operation: string; input: Record<string, unknown> }> = [];

  constructor(
    private readonly data: Record<string, unknown> = { accepted: true },
  ) {}

  async execute(
    operation: Parameters<ApiOperationExecutor["execute"]>[0],
    input: Parameters<ApiOperationExecutor["execute"]>[1],
  ) {
    this.calls.push({ operation, input });
    return {
      ok: true as const,
      data: this.data,
      requestId: "executor-request",
    };
  }
}

function allowedRateLimiter(): ApiRateLimiter {
  return { async check() { return { allowed: true }; } };
}

describe("CLI REST gateway", () => {
  it("parses GET query input and emits the packages/client result envelope", async () => {
    const verifier = new FakeVerifier(principal());
    const executor = new FakeExecutor();
    const worker = createDongoApiGateway({
      resource: RESOURCE,
      allowedHostnames: ["dev.dongo.so"],
      tokenVerifier: verifier,
      operationExecutor: executor,
      rateLimiter: allowedRateLimiter(),
    });
    const response = await worker.fetch(
      new Request(
        "https://dev.dongo.so/api/agent/v1/get_work?identifier=DON-42",
        {
          headers: {
            authorization: "Bearer opaque-access-token",
            "x-request-id": "cli-request-1",
          },
        },
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("cli-request-1");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { accepted: true },
      requestId: "cli-request-1",
      apiVersion: "v1",
    });
    expect(verifier.calls).toEqual(["opaque-access-token"]);
    expect(executor.calls).toEqual([
      { operation: "get_work", input: { identifier: "DON-42" } },
    ]);
  });

  it("preserves enriched Intake fields in the existing API response", async () => {
    const intake = {
      id: "intake-1",
      projectId: "project-1",
      text: "Investigate the failing import",
      context: "It began after the latest vendor export.",
      links: ["https://example.com/failure-report"],
      state: "waiting",
      revision: 2,
      createdBy: {
        id: "actor-1",
        kind: "human",
        displayName: "Project member",
      },
      attachmentIds: ["attachment-1"],
      linkedWorkItemIds: [],
      createdAt: 1,
      updatedAt: 2,
    };
    const executor = new FakeExecutor(intake);
    const worker = createDongoApiGateway({
      resource: RESOURCE,
      allowedHostnames: ["dev.dongo.so"],
      tokenVerifier: new FakeVerifier(principal()),
      operationExecutor: executor,
      rateLimiter: allowedRateLimiter(),
    });
    const response = await worker.fetch(new Request(
      "https://dev.dongo.so/api/agent/v1/get_intake?intakeId=intake-1",
      { headers: { authorization: "Bearer opaque-access-token" } },
    ));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: intake,
      apiVersion: "v1",
    });
    expect(executor.calls).toEqual([{
      operation: "get_intake",
      input: { intakeId: "intake-1" },
    }]);
  });

  it("requires exact POST JSON and Idempotency-Key consistency", async () => {
    const executor = new FakeExecutor();
    const worker = createDongoApiGateway({
      resource: RESOURCE,
      allowedHostnames: ["dev.dongo.so"],
      tokenVerifier: new FakeVerifier(principal()),
      operationExecutor: executor,
      rateLimiter: allowedRateLimiter(),
    });
    const body = {
      workItemId: "work-id",
      body: "A progress note",
      idempotencyKey: "idempotency-key-1",
    };
    const accepted = await worker.fetch(
      new Request("https://dev.dongo.so/api/agent/v1/add_comment", {
        method: "POST",
        headers: {
          authorization: "Bearer opaque",
          "content-type": "application/json; charset=utf-8",
          "idempotency-key": body.idempotencyKey,
        },
        body: JSON.stringify(body),
      }),
    );
    expect(accepted.status).toBe(200);
    expect(executor.calls).toHaveLength(1);

    const rejected = await worker.fetch(
      new Request("https://dev.dongo.so/api/agent/v1/add_comment", {
        method: "POST",
        headers: {
          authorization: "Bearer opaque",
          "content-type": "application/json",
          "idempotency-key": "different-key",
        },
        body: JSON.stringify(body),
      }),
    );
    expect(rejected.status).toBe(400);
    await expect(rejected.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "validation", retryable: false },
    });
    expect(executor.calls).toHaveLength(1);
  });

  it("forwards additive host capability and safe workspace metadata", async () => {
    const executor = new FakeExecutor();
    const worker = createDongoApiGateway({
      resource: RESOURCE,
      allowedHostnames: ["dev.dongo.so"],
      tokenVerifier: new FakeVerifier(principal()),
      operationExecutor: executor,
      rateLimiter: allowedRateLimiter(),
    });
    const sessionInput = {
      externalSessionId: "agent-session",
      hostCapabilities: {
        parallelExecution: "supported",
        worktreeIsolation: "supported",
      },
    };
    const session = await worker.fetch(new Request(
      "https://dev.dongo.so/api/agent/v1/session_start",
      {
        method: "POST",
        headers: {
          authorization: "Bearer opaque",
          "content-type": "application/json",
        },
        body: JSON.stringify(sessionInput),
      },
    ));
    expect(session.status).toBe(200);

    const workInput = {
      workItemId: "work-1",
      expectedRevision: 2,
      externalSessionId: "agent-session",
      workspace: {
        kind: "worktree",
        worktreeName: "agent-one",
        branch: "work/one",
      },
      idempotencyKey: "parallel-start-key",
    };
    const start = await worker.fetch(new Request(
      "https://dev.dongo.so/api/agent/v1/start_work",
      {
        method: "POST",
        headers: {
          authorization: "Bearer opaque",
          "content-type": "application/json",
          "idempotency-key": workInput.idempotencyKey,
        },
        body: JSON.stringify(workInput),
      },
    ));
    expect(start.status).toBe(200);
    expect(executor.calls).toEqual([
      { operation: "session_start", input: sessionInput },
      { operation: "start_work", input: workInput },
    ]);
  });

  it("enforces method, bearer, scope, and rate limit boundaries", async () => {
    const executor = new FakeExecutor();
    const verifier = new FakeVerifier(principal(["dongo:work:read"]));
    const worker = createDongoApiGateway({
      resource: RESOURCE,
      allowedHostnames: ["dev.dongo.so"],
      tokenVerifier: verifier,
      operationExecutor: executor,
      rateLimiter: {
        async check() {
          return { allowed: false, retryAfterSeconds: 17 };
        },
      },
    });
    const wrongMethod = await worker.fetch(
      new Request("https://dev.dongo.so/api/agent/v1/get_overview", {
        method: "POST",
      }),
    );
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("GET");
    expect(verifier.calls).toHaveLength(0);

    const noBearer = await worker.fetch(
      new Request("https://dev.dongo.so/api/agent/v1/get_overview"),
    );
    expect(noBearer.status).toBe(401);
    expect(noBearer.headers.get("www-authenticate")).toContain(
      RESOURCE.toString(),
    );

    const insufficient = await worker.fetch(
      new Request("https://dev.dongo.so/api/agent/v1/add_comment", {
        method: "POST",
        headers: {
          authorization: "Bearer opaque",
          "content-type": "application/json",
          "idempotency-key": "idempotency-key-1",
        },
        body: JSON.stringify({
          workItemId: "work-id",
          body: "comment",
          idempotencyKey: "idempotency-key-1",
        }),
      }),
    );
    expect(insufficient.status).toBe(403);

    const limited = await worker.fetch(
      new Request("https://dev.dongo.so/api/agent/v1/get_overview", {
        headers: { authorization: "Bearer opaque" },
      }),
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("17");
    expect(executor.calls).toHaveLength(0);
  });

  it("keeps liveness available while an unconfigured worker fails closed", async () => {
    const worker = createUnavailableDongoApiWorker(RESOURCE.toString());
    const health = await worker.fetch(
      new Request("https://dev.dongo.so/api/agent/v1/healthz"),
    );
    const ready = await worker.fetch(
      new Request("https://dev.dongo.so/api/agent/v1/readyz"),
    );
    const operation = await worker.fetch(
      new Request("https://dev.dongo.so/api/agent/v1/get_overview"),
    );
    expect(health.status).toBe(200);
    expect(ready.status).toBe(503);
    expect(operation.status).toBe(503);
  });

  it("rejects oversized bodies before introspection", async () => {
    const verifier = new FakeVerifier(principal());
    const worker = createDongoApiGateway({
      resource: RESOURCE,
      allowedHostnames: ["dev.dongo.so"],
      tokenVerifier: verifier,
      operationExecutor: new FakeExecutor(),
      rateLimiter: allowedRateLimiter(),
      maxBodyBytes: 64,
    });
    const response = await worker.fetch(
      new Request("https://dev.dongo.so/api/agent/v1/add_comment", {
        method: "POST",
        headers: {
          authorization: "Bearer opaque",
          "content-type": "application/json",
          "content-length": "1000",
        },
        body: "{}",
      }),
    );
    expect(response.status).toBe(413);
    expect(verifier.calls).toHaveLength(0);
  });
});
