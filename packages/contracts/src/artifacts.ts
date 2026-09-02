import { z } from "zod";

import { domainErrorCodes } from "./errors.ts";
import { operationRegistry, type OperationName } from "./operations.ts";
import {
  actorSummarySchema,
  artifactSchema,
  attachmentAccessSchema,
  attachmentSchema,
  attentionSchema,
  conversationEntrySchema,
  intakeSchema,
  overviewSchema,
  projectUpdateSchema,
  projectUpdatesSchema,
  projectSummarySchema,
  runnerJobSchema,
  runnerRegistrationSchema,
  runnerWaitSchema,
  runSchema,
  sessionStartSchema,
  syncSnapshotSchema,
  workRelationshipSchema,
  workItemSchema,
} from "./schemas.ts";

type JsonObject = Record<string, unknown>;

const JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema";
const domainSchemaEntries = [
  ["ActorSummary", actorSummarySchema],
  ["ProjectSummary", projectSummarySchema],
  ["Attachment", attachmentSchema],
  ["Intake", intakeSchema],
  ["Artifact", artifactSchema],
  ["ConversationEntry", conversationEntrySchema],
  ["Attention", attentionSchema],
  ["Run", runSchema],
  ["WorkRelationship", workRelationshipSchema],
  ["WorkItem", workItemSchema],
  ["Overview", overviewSchema],
  ["ProjectUpdate", projectUpdateSchema],
  ["ProjectUpdates", projectUpdatesSchema],
  ["SessionStart", sessionStartSchema],
  ["SyncSnapshot", syncSnapshotSchema],
  ["AttachmentAccess", attachmentAccessSchema],
  ["RunnerRegistration", runnerRegistrationSchema],
  ["RunnerJob", runnerJobSchema],
  ["RunnerWait", runnerWaitSchema],
] as const;
const domainComponentBySchema = new Map<z.ZodType, string>(
  domainSchemaEntries.map(([name, schema]) => [schema, name]),
);

function componentStem(operation: OperationName): string {
  return operation
    .split("_")
    .map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`)
    .join("");
}

function jsonSchema(schema: z.ZodType): JsonObject {
  const generated = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    unrepresentable: "any",
  }) as JsonObject;
  const { $schema: _dialect, ...portable } = generated;
  return portable;
}

function domainSchemas(referencePrefix: string): JsonObject {
  const registry = z.registry<{ id: string }>();
  for (const [name, schema] of domainSchemaEntries) {
    registry.add(schema, { id: name });
  }
  const generated = z.toJSONSchema(registry, {
    target: "draft-2020-12",
    unrepresentable: "any",
    reused: "inline",
    uri: (id) => `${referencePrefix}${id}`,
  }).schemas as JsonObject;
  return Object.fromEntries(
    Object.entries(generated).map(([name, value]) => {
      const { $schema: _dialect, $id: _id, ...portable } = value as JsonObject;
      return [name, portable];
    }),
  );
}

function outputComponent(schema: z.ZodType): string {
  const component = domainComponentBySchema.get(schema);
  if (!component) throw new Error("An operation output schema is not registered");
  return component;
}

function domainErrorSchema(): JsonObject {
  return {
    type: "object",
    additionalProperties: false,
    required: ["code", "message", "retryable"],
    properties: {
      code: { type: "string", enum: [...domainErrorCodes] },
      message: { type: "string" },
      retryable: { type: "boolean" },
      details: true,
    },
  };
}

function errorResponseSchema(errorReference: string): JsonObject {
  return {
    type: "object",
    additionalProperties: false,
    required: ["ok", "error", "requestId"],
    properties: {
      ok: { const: false },
      error: { $ref: errorReference },
      requestId: { type: "string", minLength: 1, maxLength: 128 },
    },
  };
}

function successResponseSchema(outputReference: string): JsonObject {
  return {
    type: "object",
    additionalProperties: false,
    required: ["ok", "data", "requestId", "apiVersion"],
    properties: {
      ok: { const: true },
      data: { $ref: outputReference },
      requestId: { type: "string", minLength: 1, maxLength: 128 },
      apiVersion: { const: "v1" },
    },
  };
}

function getParameters(input: JsonObject): JsonObject[] {
  const properties = input.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return [];
  const required = new Set(Array.isArray(input.required) ? input.required : []);
  return Object.entries(properties as JsonObject).map(([name, schema]) => ({
    name,
    in: "query",
    required: required.has(name),
    schema,
  }));
}

export function createAgentApiJsonSchema(): JsonObject {
  const definitions: JsonObject = {
    DomainError: domainErrorSchema(),
    ErrorResponse: errorResponseSchema("#/$defs/DomainError"),
    ...domainSchemas("#/$defs/"),
  };
  const operations: JsonObject = {};

  for (const [name, specification] of Object.entries(operationRegistry) as Array<
    [OperationName, (typeof operationRegistry)[OperationName]]
  >) {
    const stem = componentStem(name);
    const outputName = outputComponent(specification.outputSchema);
    definitions[`${stem}Input`] = jsonSchema(specification.inputSchema);
    definitions[`${stem}SuccessResponse`] = successResponseSchema(
      `#/$defs/${outputName}`,
    );
    operations[name] = {
      method: specification.method,
      path: specification.path,
      scopes: [...specification.scopes],
      readOnly: specification.readOnly,
      idempotent: specification.idempotent,
      destructive: specification.destructive,
      openWorld: specification.openWorld,
      mcpExposed: specification.mcpExposed,
      input: { $ref: `#/$defs/${stem}Input` },
      output: { $ref: `#/$defs/${outputName}` },
      successResponse: { $ref: `#/$defs/${stem}SuccessResponse` },
    };
  }

  return {
    $schema: JSON_SCHEMA_DIALECT,
    $id: "https://dongo.so/schemas/agent-api-v1.json",
    title: "dongo Agent API v1 schema catalog",
    description:
      "Transport-neutral input, output, envelope, and operation metadata generated from @dongo/contracts.",
    type: "object",
    additionalProperties: false,
    properties: {},
    $defs: definitions,
    "x-dongo-operations": operations,
  };
}

export function createAgentApiOpenApi(): JsonObject {
  const schemas: JsonObject = {
    DomainError: domainErrorSchema(),
    ErrorResponse: errorResponseSchema("#/components/schemas/DomainError"),
    ...domainSchemas("#/components/schemas/"),
  };
  const paths: JsonObject = {};

  for (const [name, specification] of Object.entries(operationRegistry) as Array<
    [OperationName, (typeof operationRegistry)[OperationName]]
  >) {
    const stem = componentStem(name);
    const inputName = `${stem}Input`;
    const outputName = outputComponent(specification.outputSchema);
    const successName = `${stem}SuccessResponse`;
    const input = jsonSchema(specification.inputSchema);
    schemas[inputName] = input;
    schemas[successName] = successResponseSchema(
      `#/components/schemas/${outputName}`,
    );

    const operation: JsonObject = {
      operationId: name,
      summary: `dongo ${name.replaceAll("_", " ")}`,
      security: [{ bearerAuth: [...specification.scopes] }],
      responses: {
        "200": {
          description: "Successful dongo operation",
          content: {
            "application/json": {
              schema: { $ref: `#/components/schemas/${successName}` },
            },
          },
        },
        default: {
          description: "dongo operation error",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
      "x-dongo-scopes": [...specification.scopes],
      "x-dongo-read-only": specification.readOnly,
      "x-dongo-idempotent": specification.idempotent,
      "x-dongo-destructive": specification.destructive,
      "x-dongo-open-world": specification.openWorld,
      "x-dongo-mcp-exposed": specification.mcpExposed,
    };
    if (specification.method === "GET") {
      operation.parameters = getParameters(input);
    } else {
      operation.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: `#/components/schemas/${inputName}` },
          },
        },
      };
    }
    paths[specification.path] = {
      [specification.method.toLowerCase()]: operation,
    };
  }

  return {
    openapi: "3.1.1",
    info: {
      title: "dongo Agent API",
      version: "1.0.0",
      description:
        "The versioned HTTPS operation contract shared by the dongo CLI and MCP gateway.",
    },
    servers: [
      {
        url: "https://{host}",
        variables: {
          host: {
            default: "dev.dongo.so",
            description: "Use the dongo environment host assigned to the installation.",
          },
        },
      },
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "oauth2",
          flows: {
            authorizationCode: {
              authorizationUrl: "/api/auth/oauth2/authorize",
              tokenUrl: "/api/auth/oauth2/token",
              scopes: {
                "dongo:work:read": "Read project work, Intake, and Attention state.",
                "dongo:work:write": "Claim, update, and complete project work.",
                "dongo:attachments:read": "Request short-lived attachment downloads.",
                offline_access: "Refresh an authorized installation session.",
              },
            },
          },
        },
      },
      schemas,
    },
  };
}
