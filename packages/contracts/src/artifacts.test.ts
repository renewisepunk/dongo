import { describe, expect, it } from "vitest";

import {
  createAgentApiJsonSchema,
  createAgentApiOpenApi,
} from "./artifacts.ts";
import { operationRegistry, type OperationName } from "./operations.ts";

type JsonObject = Record<string, any>;

function localReferences(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(localReferences);
  if (!value || typeof value !== "object") return [];
  const record = value as JsonObject;
  return [
    ...(typeof record.$ref === "string" ? [record.$ref] : []),
    ...Object.values(record).flatMap(localReferences),
  ];
}

function resolvesPointer(document: JsonObject, reference: string): boolean {
  if (!reference.startsWith("#/")) return false;
  const resolved = reference
    .slice(2)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce<unknown>((value, part) =>
      value && typeof value === "object"
        ? (value as JsonObject)[part]
        : undefined, document);
  return resolved !== undefined;
}

describe("generated agent API artifacts", () => {
  it("publishes every registry operation with exact transport metadata", () => {
    const openapi = createAgentApiOpenApi() as JsonObject;
    const catalog = createAgentApiJsonSchema() as JsonObject;

    expect(openapi.openapi).toBe("3.1.1");
    expect(Object.keys(openapi.paths)).toHaveLength(Object.keys(operationRegistry).length);
    expect(Object.keys(catalog["x-dongo-operations"])).toEqual(
      Object.keys(operationRegistry),
    );

    for (const [name, specification] of Object.entries(operationRegistry) as Array<
      [OperationName, (typeof operationRegistry)[OperationName]]
    >) {
      const operation = openapi.paths[specification.path][
        specification.method.toLowerCase()
      ];
      const catalogOperation = catalog["x-dongo-operations"][name];

      expect(operation.operationId).toBe(name);
      expect(operation["x-dongo-scopes"]).toEqual([...specification.scopes]);
      expect(operation["x-dongo-read-only"]).toBe(specification.readOnly);
      expect(operation["x-dongo-idempotent"]).toBe(specification.idempotent);
      expect(operation["x-dongo-open-world"]).toBe(specification.openWorld);
      expect(catalogOperation).toMatchObject({
        method: specification.method,
        path: specification.path,
        scopes: [...specification.scopes],
        readOnly: specification.readOnly,
        idempotent: specification.idempotent,
        destructive: specification.destructive,
        openWorld: specification.openWorld,
      });
    }
  });

  it("uses query parameters for GET and JSON bodies for POST", () => {
    const openapi = createAgentApiOpenApi() as JsonObject;

    for (const specification of Object.values(operationRegistry)) {
      const operation = openapi.paths[specification.path][
        specification.method.toLowerCase()
      ];
      if (specification.method === "GET") {
        expect(operation.parameters).toBeInstanceOf(Array);
        expect(operation.requestBody).toBeUndefined();
      } else {
        expect(operation.requestBody?.required).toBe(true);
        expect(operation.parameters).toBeUndefined();
      }
    }
  });

  it("contains no dangling local schema references", () => {
    for (const artifact of [createAgentApiOpenApi(), createAgentApiJsonSchema()]) {
      const references = localReferences(artifact);
      expect(references.length).toBeGreaterThan(0);
      expect(references.filter((reference) => !resolvesPointer(artifact, reference))).toEqual([]);
    }
  });
});
