import assert from "node:assert/strict";
import test from "node:test";
import { mcpToolNames, operationRegistry } from "@dongo/contracts";
import { z } from "zod";
import {
  DONGO_OPERATION_NAMES,
  createCanonicalDongoToolCatalog,
  createDongoToolCatalog,
  type ContractOperationRegistry,
  type ContractSchema,
} from "../src/index.js";
import { fixtureContracts } from "./fixtures.js";

test("catalog has exact parity with the canonical operation registry", () => {
  const catalog = createDongoToolCatalog(fixtureContracts());
  assert.deepEqual(
    catalog.map((tool) => tool.operation),
    Object.keys(operationRegistry),
  );
  assert.deepEqual(
    catalog.map((tool) => tool.toolName),
    mcpToolNames,
  );
  for (const descriptor of catalog) {
    const canonical = operationRegistry[descriptor.operation];
    assert.deepEqual(descriptor.requiredScopes, canonical.scopes);
    assert.equal(descriptor.annotations.readOnlyHint, canonical.readOnly);
    assert.equal(descriptor.annotations.destructiveHint, canonical.destructive);
    assert.equal(descriptor.annotations.idempotentHint, canonical.idempotent);
    assert.equal(descriptor.annotations.openWorldHint, canonical.openWorld);
    assert.match(descriptor.toolName, /^dongo_/u);
    assert.doesNotMatch(
      `${descriptor.title}\n${descriptor.description}`,
      /\b(?:Dongo|DONGO)\b(?![-_.])/u,
    );
  }
});

test("production catalog consumes the runtime canonical schemas directly", () => {
  const catalog = createCanonicalDongoToolCatalog();
  for (const descriptor of catalog) {
    assert.equal(
      descriptor.inputSchema,
      operationRegistry[descriptor.operation].inputSchema,
    );
    assert.equal(
      descriptor.outputSchema,
      operationRegistry[descriptor.operation].outputSchema,
    );
  }
});

test("catalog preserves the exact injected contract schema instances", () => {
  const contracts = fixtureContracts();
  const catalog = createDongoToolCatalog(contracts);
  for (const descriptor of catalog) {
    assert.equal(
      descriptor.inputSchema,
      contracts[descriptor.operation].inputSchema,
    );
    assert.equal(
      descriptor.outputSchema,
      contracts[descriptor.operation].outputSchema,
    );
  }
});

test("catalog rejects trusted identity arguments", () => {
  const contracts = fixtureContracts();
  const unsafe = {
    ...contracts,
    get_overview: {
      ...contracts.get_overview,
      inputSchema: z
        .object({ projectId: z.string() })
        .strict() as unknown as ContractSchema,
    },
  } as ContractOperationRegistry;
  assert.throws(
    () => createDongoToolCatalog(unsafe),
    /trusted identity field/,
  );
});

test("catalog rejects a mutation schema without required idempotencyKey", () => {
  const contracts = fixtureContracts();
  const unsafe = {
    ...contracts,
    create_work: {
      ...contracts.create_work,
      inputSchema: z.object({}).strict() as unknown as ContractSchema,
    },
  } as ContractOperationRegistry;
  assert.throws(() => createDongoToolCatalog(unsafe), /idempotencyKey/);
});

test("operation list is derived rather than maintained independently", () => {
  assert.deepEqual(DONGO_OPERATION_NAMES, Object.keys(operationRegistry));
});

test("parallel capability and worktree fields flow through canonical MCP schemas", () => {
  const catalog = createCanonicalDongoToolCatalog();
  const session = catalog.find((tool) => tool.operation === "session_start");
  const start = catalog.find((tool) => tool.operation === "start_work");
  assert.ok(session);
  assert.ok(start);
  const sessionJson = session.inputSchema["~standard"].jsonSchema!.input({
    target: "draft-2020-12",
  }) as { properties?: Record<string, unknown> };
  const startJson = start.inputSchema["~standard"].jsonSchema!.input({
    target: "draft-2020-12",
  }) as { properties?: Record<string, unknown> };
  assert.ok(sessionJson.properties?.hostCapabilities);
  assert.ok(startJson.properties?.workspace);
});
