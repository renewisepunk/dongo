import { describe, expect, it } from "vitest";
import { mcpToolNames, operationRegistry } from "./operations.ts";

describe("operation registry", () => {
  it("uses one project-safe v1 path and one MCP name per operation", () => {
    const operations = Object.values(operationRegistry);
    expect(new Set(operations.map((operation) => operation.path)).size).toBe(operations.length);
    expect(mcpToolNames).toHaveLength(operations.length);
    expect(operations.every((operation) => operation.path.startsWith("/api/agent/v1/"))).toBe(true);
  });

  it("never treats annotations as authorization", () => {
    for (const operation of Object.values(operationRegistry)) {
      expect(operation.scopes.length).toBeGreaterThan(0);
      expect(operation.destructive).toBe(false);
      if (!operation.readOnly) expect(operation.scopes).toContain("dongo:work:write");
    }
  });

  it("keeps session start observational", () => {
    expect(operationRegistry.session_start.method).toBe("POST");
    expect(operationRegistry.session_start.readOnly).toBe(true);
    expect(operationRegistry.session_start.scopes).toEqual(["dongo:work:read"]);
  });

  it("rejects unsupported artifact kinds at the public contract boundary", () => {
    const base = {
      workItemId: "work-1",
      expectedRevision: 1,
      idempotencyKey: "idempotency-key",
    };
    expect(operationRegistry.update_work.inputSchema.safeParse({
      ...base,
      artifact: {
        kind: "file",
        label: "Build plan",
        repositoryPath: "build-plan/README.md",
      },
    }).success).toBe(true);
    expect(operationRegistry.update_work.inputSchema.safeParse({
      ...base,
      artifact: {
        kind: "repository",
        label: "Unsupported",
        repositoryPath: "build-plan/README.md",
      },
    }).success).toBe(false);
  });
});
