import { DONGO_TOOL_POLICIES } from "./policies.js";
import { operationRegistry } from "@dongo/contracts";
import {
  DONGO_OPERATION_NAMES,
  type ContractOperationRegistry,
  type DongoToolDescriptor,
  type JsonRecord,
} from "./types.js";

const FORBIDDEN_IDENTITY_FIELDS = new Set([
  "actorid",
  "credentialid",
  "grantid",
  "installationactorid",
  "installationid",
  "organizationid",
  "projectid",
  "token",
]);

function inputJsonSchema(descriptor: DongoToolDescriptor): JsonRecord {
  const standard = descriptor.inputSchema["~standard"];
  if (standard.jsonSchema === undefined) {
    throw new Error(
      `${descriptor.operation} input schema must implement Standard JSON Schema`,
    );
  }

  return standard.jsonSchema.input({
    target: "draft-2020-12",
  }) as JsonRecord;
}

function assertSafeSchemaNode(
  operation: string,
  value: unknown,
  path = "$",
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertSafeSchemaNode(operation, item, `${path}[${index}]`),
    );
    return;
  }

  if (value === null || typeof value !== "object") {
    return;
  }

  const record = value as JsonRecord;
  const properties = record.properties;
  if (properties !== null && typeof properties === "object") {
    for (const propertyName of Object.keys(properties as JsonRecord)) {
      if (FORBIDDEN_IDENTITY_FIELDS.has(propertyName.toLowerCase())) {
        throw new Error(
          `${operation} input schema exposes trusted identity field ${path}.properties.${propertyName}`,
        );
      }
    }
  }

  for (const [key, child] of Object.entries(record)) {
    assertSafeSchemaNode(operation, child, `${path}.${key}`);
  }
}

function assertDescriptorContract(descriptor: DongoToolDescriptor): void {
  const schema = inputJsonSchema(descriptor);
  if (schema.type !== "object") {
    throw new Error(`${descriptor.operation} input schema must be object-shaped`);
  }

  assertSafeSchemaNode(descriptor.operation, schema);

  if (descriptor.effect === "write") {
    const required = schema.required;
    if (
      Array.isArray(required) === false ||
      required.includes("idempotencyKey") === false
    ) {
      throw new Error(
        `${descriptor.operation} write input schema must require idempotencyKey`,
      );
    }
  }
}

/**
 * Creates the MCP catalog from the canonical contract registry. Policies add
 * only transport presentation and authorization metadata; schemas remain
 * owned by `@dongo/contracts`.
 */
export function createDongoToolCatalog(
  contracts: ContractOperationRegistry,
): readonly DongoToolDescriptor[] {
  const catalog = DONGO_OPERATION_NAMES.map((operation) => {
    const contract = contracts[operation];
    if (contract === undefined) {
      throw new Error(`Missing canonical operation contract: ${operation}`);
    }

    const descriptor = Object.freeze({
      ...DONGO_TOOL_POLICIES[operation],
      inputSchema: contract.inputSchema,
      outputSchema: contract.outputSchema,
    });
    assertDescriptorContract(descriptor);
    return descriptor;
  });

  return Object.freeze(catalog);
}

/** Creates the production catalog directly from the runtime canonical registry. */
export function createCanonicalDongoToolCatalog(): readonly DongoToolDescriptor[] {
  return createDongoToolCatalog(
    operationRegistry as unknown as ContractOperationRegistry,
  );
}

/**
 * Defense in depth for hand-built clients. The contract schemas reject these
 * keys too, but this scan prevents an accidental permissive schema from
 * allowing callers to choose a trusted tenant, actor, grant, or credential.
 */
export function assertNoCallerSelectedIdentity(
  operation: string,
  input: JsonRecord,
): void {
  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, `${path}[${index}]`));
      return;
    }
    if (value === null || typeof value !== "object") {
      return;
    }

    for (const [key, child] of Object.entries(value as JsonRecord)) {
      if (FORBIDDEN_IDENTITY_FIELDS.has(key.toLowerCase())) {
        throw new Error(
          `${operation} arguments contain caller-selected identity field ${path}.${key}`,
        );
      }
      visit(child, `${path}.${key}`);
    }
  };

  visit(input, "$arguments");
}
