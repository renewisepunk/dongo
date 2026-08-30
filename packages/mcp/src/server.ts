import {
  McpServer,
  createMcpHandler,
  type CallToolResult,
  type McpHttpHandler,
  type McpServerFactory,
  type ServerContext,
} from "@modelcontextprotocol/server";
import { agentScopes } from "@dongo/contracts";
import { getDongoRequestContext, hasRequiredScopes } from "./auth.js";
import { assertNoCallerSelectedIdentity } from "./catalog.js";
import { DONGO_MCP_INSTRUCTIONS } from "./instructions.js";
import { operationResultToToolResult } from "./results.js";
import type {
  DongoLogger,
  DongoMcpLimits,
  DongoOperationName,
  DongoToolDescriptor,
  JsonRecord,
  OperationExecutor,
  OperationExecutionResult,
} from "./types.js";

export const DEFAULT_DONGO_MCP_LIMITS: DongoMcpLimits = Object.freeze({
  maxRequestBytes: 256 * 1024,
  maxResultBytes: 512 * 1024,
  maxTextBytes: 8 * 1024,
  maxErrorDetailsBytes: 16 * 1024,
  operationTimeoutMs: 25_000,
});

export interface DongoMcpServerOptions {
  readonly catalog: readonly DongoToolDescriptor[];
  readonly operationExecutor: OperationExecutor;
  readonly limits: DongoMcpLimits;
  readonly logger?: DongoLogger;
  readonly serverName: string;
  readonly serverVersion: string;
}

function domainFailure(
  code: string,
  message: string,
  retryable = false,
): OperationExecutionResult {
  return {
    ok: false,
    error: { code, message, retryable },
  };
}

async function executeWithTimeout(
  operation: DongoOperationName,
  input: JsonRecord,
  context: ServerContext,
  options: DongoMcpServerOptions,
): Promise<CallToolResult> {
  let requestContext: ReturnType<typeof getDongoRequestContext>;
  try {
    requestContext = getDongoRequestContext(context.http?.authInfo);
  } catch {
    return operationResultToToolResult(
      operation,
      domainFailure(
        "unauthorized",
        "Validated authorization context is required",
      ),
      "unavailable",
      options.limits,
    );
  }

  const descriptor = options.catalog.find(
    (candidate) => candidate.operation === operation,
  );
  if (descriptor === undefined) {
    return operationResultToToolResult(
      operation,
      domainFailure("internal", "Tool policy is unavailable", true),
      requestContext.requestId,
      options.limits,
    );
  }
  if (
    hasRequiredScopes(
      requestContext.principal.scopes,
      descriptor.requiredScopes,
    ) === false
  ) {
    return operationResultToToolResult(
      operation,
      domainFailure(
        "insufficient_scope",
        `This operation requires ${descriptor.requiredScopes.join(" ")}`,
      ),
      requestContext.requestId,
      options.limits,
    );
  }

  try {
    assertNoCallerSelectedIdentity(operation, input);
  } catch {
    return operationResultToToolResult(
      operation,
      domainFailure(
        "validation",
        "Tool arguments cannot select trusted dongo identity fields",
      ),
      requestContext.requestId,
      options.limits,
    );
  }

  if (context.mcpReq.signal.aborted) {
    return operationResultToToolResult(
      operation,
      domainFailure("request_cancelled", "The MCP request was cancelled"),
      requestContext.requestId,
      options.limits,
    );
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  let timedOut = false;
  let resolveCancellation:
    | ((result: OperationExecutionResult) => void)
    | undefined;
  const cancellation = new Promise<OperationExecutionResult>((resolve) => {
    resolveCancellation = resolve;
  });
  const relayAbort = (): void => {
    controller.abort(context.mcpReq.signal.reason);
    resolveCancellation?.(
      domainFailure("request_cancelled", "The MCP request was cancelled"),
    );
  };
  context.mcpReq.signal.addEventListener("abort", relayAbort, { once: true });

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<OperationExecutionResult>((resolve) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("dongo operation timed out"));
      resolve(
        domainFailure(
          "temporarily_unavailable",
          "The dongo operation timed out; retry only when safe for the operation",
          true,
        ),
      );
    }, options.limits.operationTimeoutMs);
  });

  try {
    const result = await Promise.race([
      options.operationExecutor.execute(operation, input, {
        principal: requestContext.principal,
        projectRef: requestContext.principal.projectRef,
        requestId: requestContext.requestId,
        signal: controller.signal,
      }),
      timeout,
      cancellation,
    ]);
    options.logger?.info({
      event: "mcp_tool_call",
      operation,
      requestId: requestContext.requestId,
      projectId: requestContext.principal.projectId,
      ok: result.ok,
      timedOut,
      durationMs: Date.now() - startedAt,
    });
    return operationResultToToolResult(
      operation,
      result,
      requestContext.requestId,
      options.limits,
    );
  } catch (error) {
    const cancelled = context.mcpReq.signal.aborted;
    options.logger?.error({
      event: "mcp_tool_failure",
      operation,
      requestId: requestContext.requestId,
      projectId: requestContext.principal.projectId,
      cancelled,
      errorName: error instanceof Error ? error.name : "UnknownError",
      durationMs: Date.now() - startedAt,
    });
    return operationResultToToolResult(
      operation,
      domainFailure(
        cancelled ? "request_cancelled" : "internal",
        cancelled
          ? "The MCP request was cancelled"
          : "The dongo operation failed unexpectedly",
        cancelled === false,
      ),
      requestContext.requestId,
      options.limits,
    );
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    context.mcpReq.signal.removeEventListener("abort", relayAbort);
  }
}

export function createDongoMcpServerFactory(
  options: DongoMcpServerOptions,
): McpServerFactory {
  return (requestContext) => {
    const server = new McpServer(
      {
        name: options.serverName,
        version: options.serverVersion,
      },
      {
        instructions: DONGO_MCP_INSTRUCTIONS,
        cacheHints: {
          "server/discover": { ttlMs: 300_000, cacheScope: "private" },
          "tools/list": { ttlMs: 300_000, cacheScope: "private" },
          "resources/list": { ttlMs: 300_000, cacheScope: "private" },
          "resources/read": { ttlMs: 60_000, cacheScope: "private" },
        },
      },
    );

    for (const descriptor of options.catalog) {
      server.registerTool(
        descriptor.toolName,
        {
          title: descriptor.title,
          description: descriptor.description,
          inputSchema: descriptor.inputSchema,
          outputSchema: descriptor.outputSchema,
          annotations: descriptor.annotations,
          _meta: {
            "dongo/operation": descriptor.operation,
            "dongo/requiredScopes": [...descriptor.requiredScopes],
          },
        },
        (input, context) =>
          executeWithTimeout(
            descriptor.operation,
            input,
            context,
            options,
          ),
      );
    }

    server.registerResource(
      "dongo-server-instructions",
      "dongo://server/instructions",
      {
        title: "dongo server instructions",
        description:
          "Canonical workflow and safety instructions shared by dongo MCP hosts.",
        mimeType: "text/plain",
        cacheHint: { ttlMs: 300_000, cacheScope: "private" },
      },
      (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: DONGO_MCP_INSTRUCTIONS,
          },
        ],
      }),
    );

    const projectRef = requestContext.authInfo?.extra?.projectRef;
    if (typeof projectRef === "string" && projectRef.length > 0) {
      const uri = `dongo://project/${encodeURIComponent(projectRef)}/capabilities`;
      server.registerResource(
        "dongo-project-capabilities",
        uri,
        {
          title: "dongo project MCP capabilities",
          description:
            "Non-secret project binding and scope names for this authenticated dongo endpoint.",
          mimeType: "application/json",
          cacheHint: { ttlMs: 60_000, cacheScope: "private" },
        },
        () => ({
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify({
                projectRef,
                scopes: agentScopes.filter(
                  (scope) => scope !== "offline_access",
                ),
                remoteRepositoryWrites: false,
              }),
            },
          ],
        }),
      );
    }

    return server;
  };
}

export function createDongoMcpHandler(
  options: DongoMcpServerOptions,
): McpHttpHandler {
  return createMcpHandler(createDongoMcpServerFactory(options), {
    legacy: "stateless",
    responseMode: "auto",
    onerror: (error) => {
      options.logger?.error({
        event: "mcp_protocol_error",
        errorName: error.name,
      });
    },
  });
}
