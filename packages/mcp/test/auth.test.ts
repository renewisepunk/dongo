import assert from "node:assert/strict";
import test from "node:test";
import { createDongoMcpGateway, createDongoToolCatalog } from "../src/index.js";
import {
  MCP_RESOURCE,
  PROJECT_REF,
  authenticatedRequest,
  fixtureContracts,
  gatewayFixture,
  unauthenticatedRequest,
} from "./fixtures.js";

function gatewayFor(
  fixture: ReturnType<typeof gatewayFixture>,
) {
  return createDongoMcpGateway({
    ...fixture.options,
    catalog: createDongoToolCatalog(fixtureContracts()),
  });
}

test("missing bearer receives an RFC 9728 discovery challenge", async () => {
  const gateway = gatewayFor(gatewayFixture());
  const response = await gateway.fetch(
    unauthenticatedRequest(MCP_RESOURCE.pathname, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
  );
  assert.equal(response.status, 401);
  const challenge = response.headers.get("www-authenticate") ?? "";
  assert.match(challenge, /^Bearer /);
  assert.match(challenge, /resource_metadata=/);
  assert.match(
    decodeURIComponent(challenge),
    new RegExp(
      `/\\.well-known/oauth-protected-resource/p/${PROJECT_REF}/mcp`,
    ),
  );
});

for (const [name, overrides] of [
  ["resource", { tokenResource: new URL("https://dongo.example/p/other/mcp") }],
  ["issuer", { tokenIssuer: "https://wrong-issuer.example/" }],
  ["project", { tokenProjectRef: "other_project" }],
] as const) {
  test(`wrong token ${name} fails closed`, async () => {
    const gateway = gatewayFor(gatewayFixture(overrides));
    const response = await gateway.fetch(
      authenticatedRequest(MCP_RESOURCE.pathname, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    assert.equal(response.status, 401);
    assert.match(response.headers.get("www-authenticate") ?? "", /invalid_token/);
  });
}

for (const [name, overrides] of [
  ["expired", { expired: true }],
  ["revoked", { revoked: true }],
] as const) {
  test(`${name} authorization receives a 401 challenge`, async () => {
    const gateway = gatewayFor(gatewayFixture(overrides));
    const response = await gateway.fetch(
      authenticatedRequest(MCP_RESOURCE.pathname, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    assert.equal(response.status, 401);
    assert.match(response.headers.get("www-authenticate") ?? "", /invalid_token/);
  });
}

test("modern write preflight returns an insufficient_scope challenge", async () => {
  const gateway = gatewayFor(
    gatewayFixture({ tokenScopes: ["dongo:work:read"] }),
  );
  const response = await gateway.fetch(
    authenticatedRequest(MCP_RESOURCE.pathname, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "tools/call",
        "mcp-name": "dongo_create_work",
      },
      body: "{}",
    }),
  );
  assert.equal(response.status, 403);
  const challenge = response.headers.get("www-authenticate") ?? "";
  assert.match(challenge, /insufficient_scope/);
  assert.match(challenge, /dongo:work:write/);
});

test("attachment access requires both read and attachment scopes", async () => {
  const gateway = gatewayFor(
    gatewayFixture({ tokenScopes: ["dongo:work:read"] }),
  );
  const response = await gateway.fetch(
    authenticatedRequest(MCP_RESOURCE.pathname, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "tools/call",
        "mcp-name": "dongo_get_attachment",
      },
      body: "{}",
    }),
  );
  assert.equal(response.status, 403);
  assert.match(
    response.headers.get("www-authenticate") ?? "",
    /dongo:attachments:read/,
  );
});

test("rate limits are bounded before protocol dispatch", async () => {
  const gateway = gatewayFor(gatewayFixture({ rateLimited: true }));
  const response = await gateway.fetch(
    authenticatedRequest(MCP_RESOURCE.pathname, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
  );
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "17");
});
