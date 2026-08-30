import assert from "node:assert/strict";
import test from "node:test";
import {
  OAuthError,
  OAuthErrorCode,
} from "@modelcontextprotocol/server";
import { BetterAuthIntrospectionTokenVerifier } from "../src/index.js";

const ISSUER = "https://auth.example/";
const RESOURCE = new URL("https://mcp.example/p/project_ref_123/mcp");
const NOW = 2_000_000_000;

const validIntrospection = {
  active: true,
  token_type: "Bearer",
  client_id: "codex-client",
  scope: "dongo:work:read offline_access",
  iss: ISSUER,
  aud: RESOURCE.href,
  exp: NOW + 300,
  nbf: NOW - 30,
  grantId: "oauth-binding-id",
  installationId: "installation-id",
  installationActorId: "installation-actor-id",
  organizationId: "organization-id",
  projectId: "project-id",
  projectRef: "project_ref_123",
};

function context() {
  return {
    expectedIssuer: ISSUER,
    expectedResource: RESOURCE,
    projectRef: "project_ref_123",
  };
}

function verifierWith(
  responseForCall: (call: number) => unknown,
  observed?: Request[],
) {
  let calls = 0;
  return {
    verifier: new BetterAuthIntrospectionTokenVerifier({
      introspectionUrl: new URL("https://auth.example/oauth2/introspect"),
      issuer: ISSUER,
      resourceClientId: "resource-server",
      resourceClientSecret: "resource-server-secret-32-bytes!!",
      nowSeconds: () => NOW,
      fetch: async function (this: void, input, init) {
        assert.equal(this, undefined);
        calls += 1;
        const request = new Request(input, init);
        observed?.push(request.clone());
        return Response.json(responseForCall(calls));
      },
    }),
    calls: () => calls,
  };
}

test("Better Auth introspection validates and projects only resource scopes", async () => {
  const observed: Request[] = [];
  const { verifier } = verifierWith(() => validIntrospection, observed);
  const auth = await verifier.verifyAccessToken("opaque-access-token", context());

  assert.equal(auth.clientId, "codex-client");
  assert.deepEqual(auth.scopes, ["dongo:work:read"]);
  assert.equal(auth.resource.href, RESOURCE.href);
  assert.equal(auth.extra.grantId, "oauth-binding-id");
  assert.equal(auth.extra.projectId, "project-id");

  assert.equal(observed.length, 1);
  const request = observed[0];
  assert.ok(request);
  assert.equal(request.method, "POST");
  assert.equal(request.url, "https://auth.example/oauth2/introspect");
  assert.match(request.headers.get("authorization") ?? "", /^Basic /u);
  assert.equal(request.headers.has("cookie"), false);
  const form = new URLSearchParams(await request.text());
  assert.equal(form.get("token"), "opaque-access-token");
  assert.equal(form.get("token_type_hint"), "access_token");
});

test("introspection has no positive cache and observes immediate revocation", async () => {
  const fixture = verifierWith((call) =>
    call === 1 ? validIntrospection : { active: false },
  );
  await fixture.verifier.verifyAccessToken("opaque-access-token", context());
  await assert.rejects(
    fixture.verifier.verifyAccessToken("opaque-access-token", context()),
    (error: unknown) =>
      error instanceof OAuthError && error.code === OAuthErrorCode.InvalidToken,
  );
  assert.equal(fixture.calls(), 2);
});

for (const [name, override] of [
  ["issuer", { iss: "https://other.example/" }],
  ["resource", { aud: "https://mcp.example/p/other_project/mcp" }],
  ["expiration", { exp: NOW - 30 }],
  ["not-before", { nbf: NOW + 30 }],
  ["scope", { scope: "unknown:scope" }],
  ["client", { client_id: "" }],
  ["grant binding", { grantId: "" }],
  ["project binding", { projectRef: "other_project" }],
] as const) {
  test(`introspection rejects invalid ${name}`, async () => {
    const { verifier } = verifierWith(() => ({
      ...validIntrospection,
      ...override,
    }));
    await assert.rejects(
      verifier.verifyAccessToken("opaque-access-token", context()),
      (error: unknown) =>
        error instanceof OAuthError && error.code === OAuthErrorCode.InvalidToken,
    );
  });
}

test("authorization-server failures remain server errors, not token challenges", async () => {
  const verifier = new BetterAuthIntrospectionTokenVerifier({
    introspectionUrl: new URL("https://auth.example/oauth2/introspect"),
    issuer: ISSUER,
    resourceClientId: "resource-server",
    resourceClientSecret: "resource-server-secret-32-bytes!!",
    fetch: async () => new Response("unavailable", { status: 503 }),
  });
  await assert.rejects(
    verifier.verifyAccessToken("opaque-access-token", context()),
    (error: unknown) =>
      error instanceof OAuthError && error.code === OAuthErrorCode.ServerError,
  );
});
