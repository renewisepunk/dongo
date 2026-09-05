import assert from "node:assert/strict";
import test from "node:test";
import {
  Client,
  StreamableHTTPClientTransport,
  type FetchLike,
} from "@modelcontextprotocol/client";
import {
  DONGO_MCP_INSTRUCTIONS,
  createDongoMcpGateway,
  createDongoToolCatalog,
} from "../src/index.js";
import {
  MCP_RESOURCE,
  PUBLIC_ORIGIN,
  fixtureContracts,
  gatewayFixture,
} from "./fixtures.js";

async function connectClient(
  era: "modern" | "legacy",
  input?: Parameters<typeof gatewayFixture>[0],
) {
  const fixture = gatewayFixture(input);
  const gateway = createDongoMcpGateway({
    ...fixture.options,
    catalog: createDongoToolCatalog(fixtureContracts()),
  });
  const inMemoryFetch: FetchLike = async (input, init) => {
    const original = new Request(input, init);
    const headers = new Headers(original.headers);
    headers.set("host", PUBLIC_ORIGIN.host);
    return gateway.fetch(new Request(original, { headers }));
  };
  const transport = new StreamableHTTPClientTransport(MCP_RESOURCE, {
    authProvider: { token: async () => "fixture-access-token" },
    fetch: inMemoryFetch,
  });
  const client = new Client(
    { name: `dongo-${era}-test`, version: "1" },
    era === "modern"
      ? { versionNegotiation: { mode: { pin: "2026-07-28" } } }
      : undefined,
  );
  await client.connect(transport);
  return { client, fixture };
}

for (const era of ["modern", "legacy"] as const) {
  test(`${era} client receives one additive next-call release notice`, async () => {
    const { client } = await connectClient(era, { releaseNoticeOnce: true });
    try {
      const first = await client.callTool({
        name: "dongo_session_start",
        arguments: { externalSessionId: `${era}-release-session` },
      });
      assert.deepEqual(first.structuredContent, {
        operation: "session_start",
        authorizationForwarded: false,
      });
      assert.equal(first.content.length, 2);
      assert.match(
        first.content[1]?.type === "text" ? first.content[1].text : "",
        /hosted dongo MCP service is already updated/u,
      );

      const second = await client.callTool({
        name: "dongo_get_overview",
        arguments: {},
      });
      assert.deepEqual(second.structuredContent, {
        operation: "get_overview",
        authorizationForwarded: false,
      });
      assert.equal(second.content.length, 1);
    } finally {
      await client.close();
    }
  });
}

for (const era of ["modern", "legacy"] as const) {
  test(`${era} official client lists and calls the shared tool factory`, async () => {
    const { client, fixture } = await connectClient(era);
    try {
      const listed = await client.listTools();
      assert.equal(listed.tools.length, 22);
      assert.ok(
        listed.tools.some((tool) => tool.name === "dongo_session_start"),
      );
      assert.ok(
        listed.tools.some((tool) => tool.name === "dongo_request_owner_attention"),
      );
      assert.ok(
        listed.tools.some((tool) => tool.name === "dongo_acquire_resource"),
      );
      assert.ok(
        listed.tools.some((tool) => tool.name === "dongo_release_resource"),
      );
      assert.match(client.getInstructions() ?? "", /dongo_session_start/);
      assert.doesNotMatch(
        client.getServerVersion()?.name ?? "",
        /\b(?:Dongo|DONGO)\b(?![-_.])/u,
      );

      const result = await client.callTool({
        name: "dongo_session_start",
        arguments: { externalSessionId: `${era}-session` },
      });
      assert.equal(result.isError, undefined);
      assert.deepEqual(result.structuredContent, {
        operation: "session_start",
        authorizationForwarded: false,
      });
      assert.equal(fixture.calls.length, 1);
      const call = fixture.calls[0];
      assert.equal(call?.operation, "session_start");
      assert.equal("token" in (call?.context ?? {}), false);
      assert.equal(call?.context.principal.projectRef, "project_ref_123");

      const updates = await client.callTool({
        name: "dongo_get_updates",
        arguments: { cursor: 4, waitSeconds: 20 },
      });
      assert.equal(updates.isError, undefined);
      assert.deepEqual(updates.structuredContent, {
        operation: "get_updates",
        authorizationForwarded: false,
      });
      assert.equal(fixture.calls[1]?.operation, "get_updates");
      assert.deepEqual(fixture.calls[1]?.input, {
        cursor: 4,
        waitSeconds: 20,
      });
    } finally {
      await client.close();
    }
  });
}

test("modern discovery and authenticated resource metadata are available", async () => {
  const { client } = await connectClient("modern");
  try {
    const discover = client.getDiscoverResult();
    assert.ok(discover);
    assert.equal(client.getInstructions(), DONGO_MCP_INSTRUCTIONS);
    const listed = await client.listResources();
    assert.ok(
      listed.resources.some(
        (resource) => resource.uri === "dongo://server/instructions",
      ),
    );
    assert.ok(
      listed.resources.some((resource) =>
        resource.uri.startsWith("dongo://project/project_ref_123/"),
      ),
    );
  } finally {
    await client.close();
  }
});
