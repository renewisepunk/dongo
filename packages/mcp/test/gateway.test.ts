import assert from "node:assert/strict";
import test from "node:test";
import {
  createDongoMcpGateway,
  createDongoToolCatalog,
  createUnavailableDongoMcpWorker,
} from "../src/index.js";
import {
  MCP_RESOURCE,
  OAUTH_METADATA,
  PROJECT_REF,
  PUBLIC_ORIGIN,
  fixtureContracts,
  gatewayFixture,
  unauthenticatedRequest,
} from "./fixtures.js";

function gatewayFor(fixture: ReturnType<typeof gatewayFixture>) {
  return createDongoMcpGateway({
    ...fixture.options,
    catalog: createDongoToolCatalog(fixtureContracts()),
  });
}

test("health and readiness are distinct", async () => {
  const gateway = gatewayFor(gatewayFixture({ ready: false }));
  const health = await gateway.fetch(unauthenticatedRequest("/api/mcp/healthz"));
  const ready = await gateway.fetch(unauthenticatedRequest("/api/mcp/readyz"));
  assert.equal(health.status, 200);
  assert.equal(ready.status, 503);
});

test("resource metadata binds the exact project endpoint", async () => {
  const gateway = gatewayFor(gatewayFixture());
  const response = await gateway.fetch(
    unauthenticatedRequest(
      `/.well-known/oauth-protected-resource/p/${PROJECT_REF}/mcp`,
    ),
  );
  assert.equal(response.status, 200);
  const metadata = (await response.json()) as {
    resource: string;
    authorization_servers: string[];
    scopes_supported: string[];
  };
  assert.equal(metadata.resource, MCP_RESOURCE.href);
  assert.deepEqual(metadata.authorization_servers, ["https://auth.example/"]);
  assert.deepEqual(metadata.scopes_supported, [
    "dongo:work:read",
    "dongo:work:write",
    "dongo:attachments:read",
  ]);
});

test("host and browser origin allowlists fail closed", async () => {
  const gateway = gatewayFor(gatewayFixture());
  const badHost = await gateway.fetch(
    new Request(MCP_RESOURCE, { headers: { host: "attacker.example" } }),
  );
  assert.notEqual(badHost.status, 200);
  const badOrigin = await gateway.fetch(
    new Request(MCP_RESOURCE, {
      headers: {
        host: PUBLIC_ORIGIN.host,
        origin: "https://attacker.example",
      },
    }),
  );
  assert.equal(badOrigin.status, 403);
});

test("request bodies are bounded even without a Content-Length header", async () => {
  const fixture = gatewayFixture();
  const gateway = createDongoMcpGateway({
    ...fixture.options,
    catalog: createDongoToolCatalog(fixtureContracts()),
    limits: { ...fixture.options.limits, maxRequestBytes: 64 },
  });
  const response = await gateway.fetch(
    unauthenticatedRequest(MCP_RESOURCE.pathname, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: "x".repeat(100) }),
    }),
  );
  assert.equal(response.status, 413);
});

test("default worker is live but cannot serve protected MCP", async () => {
  const worker = createUnavailableDongoMcpWorker({
    publicOrigin: PUBLIC_ORIGIN,
    authorizationServerMetadata: OAUTH_METADATA,
    allowedHostnames: [PUBLIC_ORIGIN.hostname],
    allowedOrigins: [PUBLIC_ORIGIN.hostname],
  });
  assert.equal(
    (await worker.fetch(unauthenticatedRequest("/api/mcp/healthz"))).status,
    200,
  );
  assert.equal(
    (await worker.fetch(unauthenticatedRequest("/api/mcp/readyz"))).status,
    503,
  );
  assert.equal(
    (await worker.fetch(unauthenticatedRequest(MCP_RESOURCE.pathname))).status,
    503,
  );
});
