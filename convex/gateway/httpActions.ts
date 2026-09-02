import { z } from "zod";
import {
  domainErrorCodes,
  operationRegistry,
  type DomainErrorCode,
  type OperationName,
} from "@dongo/contracts";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  serviceCredentialTokenPrefix,
  verifyServiceCredentialToken,
} from "../domains/installations/serviceCredentialSecurity";

const AGENT_PATH = "/internal/agent/v1/execute";
const OAUTH_BIND_PATH = "/internal/oauth/v1/bind";
const OAUTH_RESOLVE_PATH = "/internal/oauth/v1/resolve";
const SERVICE_CREDENTIAL_RESOLVE_PATH =
  "/internal/service-credentials/v1/resolve";
const ATTACHMENT_FINALIZE_PATH = "/internal/attachments/v1/finalize";
const MAX_BODY_BYTES = 256 * 1_024;
const MAX_RESPONSE_BYTES = 1 * 1_024 * 1_024;
const MAX_MCP_RESULT_BYTES = 512 * 1_024;
const ALLOWED_CLOCK_SKEW_MS = 60_000;
const DOWNLOAD_TTL_MS = 5 * 60 * 1_000;
const GATEWAY_KEY_ID = "v1";

const identifier = z.string().min(1).max(256);
const contextSchema = z
  .object({
    requestId: z.string().min(1).max(200),
    installationId: identifier,
    actorId: identifier,
    organizationId: identifier,
    projectId: identifier,
    projectRef: z.string().min(3).max(128),
    clientId: z.string().min(1).max(500),
    grantId: identifier.optional(),
    serviceCredentialId: identifier.optional(),
    issuer: z.string().min(1).max(2_048).optional(),
    resource: z.string().min(1).max(2_048),
    scopes: z
      .array(
        z.enum([
          "dongo:work:read",
          "dongo:work:write",
          "dongo:attachments:read",
          "offline_access",
        ]),
      )
      .min(1)
      .max(4),
    externalSessionId: z.string().min(1).max(500).optional(),
  })
  .strict();

const agentEnvelopeSchema = z
  .object({
    version: z.literal(1),
    operation: z.string().min(1).max(64),
    input: z.unknown(),
    context: contextSchema,
    releaseNotice: z
      .object({
        id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/u),
        sequence: z.number().int().positive(),
      })
      .strict()
      .optional(),
  })
  .strict();

const oauthBindEnvelopeSchema = z
  .object({
    version: z.literal(1),
    requestId: z.string().min(1).max(200),
    input: z
      .object({
        providerIssuer: z.string().min(1).max(2_048),
        providerGrantId: z.string().min(1).max(1_000),
        subject: z.string().min(1).max(1_000),
        clientId: z.string().min(1).max(500),
        resource: z.string().min(1).max(2_048),
        scopes: z
          .array(
            z.enum([
              "dongo:work:read",
              "dongo:work:write",
              "dongo:attachments:read",
              "offline_access",
            ]),
          )
          .min(1)
          .max(4),
        kind: z.enum(["cli", "mcp"]),
        profileId: identifier.optional(),
        authSubject: z.string().min(1).max(1_000).optional(),
        projectRef: z.string().min(3).max(128),
        label: z.string().min(1).max(240),
        machineLabel: z.string().min(1).max(240).optional(),
        expiresAt: z.number().int().positive().optional(),
      })
      .strict()
      .refine(
        (input) =>
          Boolean(input.profileId) !== Boolean(input.authSubject),
        "Exactly one profileId or authSubject is required",
      ),
  })
  .strict();
const oauthBindOutputSchema = z
  .object({
    installationId: identifier,
    oauthBindingId: identifier,
    actorId: identifier,
    organizationId: identifier,
    projectId: identifier,
    projectRef: z.string().min(3).max(128),
    created: z.boolean(),
    reactivated: z.boolean(),
  })
  .strict();
const oauthResolveEnvelopeSchema = z
  .object({
    version: z.literal(1),
    requestId: z.string().min(1).max(200),
    input: z
      .object({
        oauthBindingId: identifier,
        providerIssuer: z.string().min(1).max(2_048),
        providerGrantId: z.string().min(1).max(1_000),
        subject: z.string().min(1).max(1_000),
        clientId: z.string().min(1).max(500),
        resource: z.string().min(1).max(2_048),
        projectRef: z.string().min(3).max(128),
        profileId: identifier.optional(),
        authSubject: z.string().min(1).max(1_000).optional(),
      })
      .strict()
      .refine(
        (input) => Boolean(input.profileId) !== Boolean(input.authSubject),
        "Exactly one profileId or authSubject is required",
      ),
  })
  .strict();
const oauthResolveOutputSchema = z
  .object({
    installationId: identifier,
    oauthBindingId: identifier,
    actorId: identifier,
    organizationId: identifier,
    projectId: identifier,
    projectRef: z.string().min(3).max(128),
    scopes: z.array(z.string()).min(1).max(4),
    kind: z.enum(["cli", "mcp"]),
    expiresAt: z.number().int().positive().optional(),
  })
  .strict();
const serviceCredentialResolveEnvelopeSchema = z
  .object({
    version: z.literal(1),
    requestId: z.string().min(1).max(200),
    input: z.object({ token: z.string().min(1).max(256) }).strict(),
  })
  .strict();
const serviceCredentialResolveOutputSchema = z.discriminatedUnion("active", [
  z.object({ active: z.literal(false) }).strict(),
  z
    .object({
      active: z.literal(true),
      installationId: identifier,
      serviceCredentialId: identifier,
      actorId: identifier,
      organizationId: identifier,
      projectId: identifier,
      projectRef: z.string().min(3).max(128),
      clientId: z.string().min(1).max(500),
      resource: z.string().min(1).max(2_048),
      scopes: z.array(z.string()).min(1).max(3),
    })
    .strict(),
]);

const attachmentFinalizeEnvelopeSchema = z
  .object({
    version: z.literal(1),
    requestId: z.string().min(1).max(200),
    input: z
      .object({
        attachmentId: identifier,
        observedByteSize: z.number().int().positive(),
        observedMimeType: z.string().trim().min(1).max(200),
        observedChecksumSha256: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      })
      .strict(),
  })
  .strict();

type AgentWireContext = z.infer<typeof contextSchema>;
type AgentAuthorization = {
  requestId: string;
  installationId: Id<"installations">;
  actorId: Id<"actors">;
  organizationId: Id<"organizations">;
  projectId: Id<"projects">;
  projectRef: string;
  oauthBindingId?: Id<"oauthBindings">;
  serviceCredentialId?: Id<"serviceCredentials">;
  issuer?: string;
  resource: string;
  clientId: string;
  scopes: string[];
  externalSessionId?: string;
};

class GatewayError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly status: number,
    readonly details?: unknown,
    readonly retryable = false,
  ) {
    super(message);
  }
}

function authorization(
  context: AgentWireContext,
  externalSessionId?: string,
): AgentAuthorization {
  return {
    requestId: context.requestId,
    installationId: context.installationId as Id<"installations">,
    actorId: context.actorId as Id<"actors">,
    organizationId: context.organizationId as Id<"organizations">,
    projectId: context.projectId as Id<"projects">,
    projectRef: context.projectRef,
    oauthBindingId: context.grantId as Id<"oauthBindings"> | undefined,
    serviceCredentialId: context.serviceCredentialId as
      | Id<"serviceCredentials">
      | undefined,
    issuer: context.issuer,
    resource: context.resource,
    clientId: context.clientId,
    scopes: [...new Set(context.scopes)],
    externalSessionId: externalSessionId ?? context.externalSessionId,
  };
}

function record(input: unknown): Record<string, unknown> {
  return input as Record<string, unknown>;
}

function stringField(
  input: Record<string, unknown>,
  field: string,
): string {
  return input[field] as string;
}

function optionalStringField(
  input: Record<string, unknown>,
  field: string,
): string | undefined {
  return input[field] as string | undefined;
}

function numberField(
  input: Record<string, unknown>,
  field: string,
): number {
  return input[field] as number;
}

const artifactKinds = new Set([
  "commit",
  "pull_request",
  "deployment",
  "preview",
  "url",
  "image",
  "file",
  "report",
]);

function artifactInput(value: unknown) {
  const artifact = record(value);
  const type = stringField(artifact, "kind");
  if (!artifactKinds.has(type)) {
    throw new GatewayError("validation", "Unsupported artifact kind", 400);
  }
  return {
    type: type as
      | "commit"
      | "pull_request"
      | "deployment"
      | "preview"
      | "url"
      | "image"
      | "file"
      | "report",
    title: stringField(artifact, "label"),
    url: optionalStringField(artifact, "url"),
    repositoryPath: optionalStringField(artifact, "repositoryPath"),
  };
}

async function mutationRunId(
  ctx: ActionCtx,
  auth: AgentAuthorization,
  workItemId: Id<"workItems">,
  operation:
    | "work.update"
    | "work.renew_claim"
    | "work.finish"
    | "attention.request",
  idempotencyKey: string,
): Promise<Id<"runs">> {
  const active = await ctx.runQuery(internal.gateway.readModels.mutationRun, {
    authorization: auth,
    workItemId,
    operation,
    idempotencyKey,
  });
  return active.runId;
}

async function workResult(
  ctx: ActionCtx,
  auth: AgentAuthorization,
  workItemId: Id<"workItems">,
) {
  return await ctx.runQuery(internal.gateway.readModels.getWork, {
    authorization: auth,
    workItemId,
  });
}

async function intakeResult(
  ctx: ActionCtx,
  auth: AgentAuthorization,
  intakeId: Id<"intakes">,
) {
  return await ctx.runQuery(internal.gateway.readModels.getIntake, {
    authorization: auth,
    intakeId,
  });
}

async function attentionResult(
  ctx: ActionCtx,
  auth: AgentAuthorization,
  attentionRequestId: Id<"attentionRequests">,
) {
  return await ctx.runQuery(internal.gateway.readModels.getAttention, {
    authorization: auth,
    attentionRequestId,
  });
}

async function dispatchAgentOperation(
  ctx: ActionCtx,
  operation: OperationName,
  parsedInput: unknown,
  wireContext: AgentWireContext,
): Promise<unknown> {
  const input = record(parsedInput);
  const baseAuthorization = authorization(wireContext);
  switch (operation) {
    case "session_start": {
      const auth = authorization(
        wireContext,
        stringField(input, "externalSessionId"),
      );
      return await ctx.runMutation(internal.gateway.readModels.sessionStart, {
        authorization: auth,
        hostCapabilities: input.hostCapabilities as
          | {
              parallelExecution: "supported" | "unsupported";
              worktreeIsolation: "supported" | "unsupported";
            }
          | undefined,
      });
    }
    case "get_overview":
      return await ctx.runQuery(internal.gateway.readModels.getOverview, {
        authorization: baseAuthorization,
      });
    case "get_updates": {
      const waitSeconds = (input.waitSeconds as number | undefined) ?? 0;
      const started = await ctx.runMutation(
        internal.domains.agentUpdates.index.beginPull,
        { authorization: baseAuthorization, waitSeconds },
      );
      let cursor = input.cursor as number | undefined;
      let intervalMilliseconds = 1_000;
      let result:
        | {
            cursor: number;
            updates: unknown[];
            hasMore: boolean;
            serverTime: number;
          }
        | undefined;
      try {
        while (true) {
          result = await ctx.runQuery(internal.domains.agentUpdates.index.read, {
            authorization: baseAuthorization,
            cursor,
          });
          cursor = result.cursor;
          if (result.updates.length > 0 || result.hasMore || waitSeconds === 0) {
            break;
          }
          const elapsed = Date.now() - started.startedAt;
          const remaining = waitSeconds * 1_000 - elapsed;
          if (remaining <= 0) break;
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(intervalMilliseconds, remaining)),
          );
          intervalMilliseconds = Math.min(intervalMilliseconds * 2, 5_000);
        }
      } finally {
        await ctx.runMutation(internal.domains.agentUpdates.index.finishPull, {
          authorization: baseAuthorization,
        });
      }
      if (!result) throw new Error("Project updates were unavailable");
      const elapsedMilliseconds = Math.max(0, Date.now() - started.startedAt);
      return {
        ...result,
        wait: {
          status: result.updates.length > 0 || result.hasMore
            ? "updates_available"
            : waitSeconds > 0
              ? "timed_out"
              : "not_requested",
          requestedSeconds: waitSeconds,
          elapsedMilliseconds,
        },
        delivery: {
          mechanism: "bounded_pull",
          stoppedAgentsRestarted: false,
        },
        serverTime: Date.now(),
      };
    }
    case "get_intake":
      return await intakeResult(
        ctx,
        baseAuthorization,
        stringField(input, "intakeId") as Id<"intakes">,
      );
    case "claim_intake": {
      const intakeId = stringField(input, "intakeId") as Id<"intakes">;
      await ctx.runMutation(internal.domains.intake.index.claim, {
        authorization: baseAuthorization,
        intakeId,
        expectedRevision: numberField(input, "expectedRevision"),
        leaseSeconds: input.leaseSeconds as number | undefined,
        idempotencyKey: stringField(input, "idempotencyKey"),
      });
      return await intakeResult(ctx, baseAuthorization, intakeId);
    }
    case "renew_intake_claim": {
      const intakeId = stringField(input, "intakeId") as Id<"intakes">;
      await ctx.runMutation(internal.domains.intake.index.renewClaim, {
        authorization: baseAuthorization,
        intakeId,
        expectedRevision: numberField(input, "expectedRevision"),
        leaseSeconds: input.leaseSeconds as number | undefined,
        idempotencyKey: stringField(input, "idempotencyKey"),
      });
      return await intakeResult(ctx, baseAuthorization, intakeId);
    }
    case "complete_triage": {
      const intakeId = stringField(input, "intakeId") as Id<"intakes">;
      await ctx.runMutation(internal.domains.intake.index.completeTriage, {
        authorization: baseAuthorization,
        intakeId,
        expectedRevision: numberField(input, "expectedRevision"),
        create: [],
        link: ((input.linkedWorkItemIds as string[] | undefined) ?? []).map(
          (value) => value as Id<"workItems">,
        ),
        dismiss: input.state === "dismissed",
        explanation: optionalStringField(input, "explanation"),
        idempotencyKey: stringField(input, "idempotencyKey"),
      });
      return await intakeResult(ctx, baseAuthorization, intakeId);
    }
    case "create_work": {
      const created = await ctx.runMutation(
        internal.domains.work.index.createForAgent,
        {
          authorization: baseAuthorization,
          title: stringField(input, "title"),
          description: stringField(input, "goal"),
          context: optionalStringField(input, "context"),
          links: input.links as string[] | undefined,
          initialComment: optionalStringField(input, "initialComment"),
          kind: "task",
          parentId: optionalStringField(input, "parentWorkItemId") as
            | Id<"workItems">
            | undefined,
          sourceIntakeIds: (input.sourceIntakeIds as string[] | undefined)?.map(
            (value) => value as Id<"intakes">,
          ),
          idempotencyKey: stringField(input, "idempotencyKey"),
        },
      );
      return await workResult(ctx, baseAuthorization, created.workItemId);
    }
    case "get_work": {
      const workItemId = optionalStringField(input, "workItemId");
      const identifierValue = optionalStringField(input, "identifier");
      if (Boolean(workItemId) === Boolean(identifierValue)) {
        throw new GatewayError(
          "validation",
          "Exactly one workItemId or identifier is required",
          400,
        );
      }
      return workItemId
        ? await workResult(
            ctx,
            baseAuthorization,
            workItemId as Id<"workItems">,
          )
        : await ctx.runQuery(
            internal.gateway.readModels.getWorkByIdentifier,
            {
              authorization: baseAuthorization,
              identifier: identifierValue!,
            },
          );
    }
    case "start_work": {
      const workItemId = stringField(input, "workItemId") as Id<"workItems">;
      const auth = authorization(
        wireContext,
        stringField(input, "externalSessionId"),
      );
      await ctx.runMutation(internal.domains.work.index.start, {
        authorization: auth,
        workItemId,
        expectedRevision: numberField(input, "expectedRevision"),
        leaseSeconds: input.leaseSeconds as number | undefined,
        workspace: input.workspace as
          | {
              kind: "worktree" | "shared_checkout" | "undisclosed";
              worktreeName?: string;
              branch?: string;
            }
          | undefined,
        idempotencyKey: stringField(input, "idempotencyKey"),
      });
      return await workResult(ctx, auth, workItemId);
    }
    case "update_work": {
      const workItemId = stringField(input, "workItemId") as Id<"workItems">;
      const idempotencyKey = stringField(input, "idempotencyKey");
      const runId = await mutationRunId(
        ctx,
        baseAuthorization,
        workItemId,
        "work.update",
        idempotencyKey,
      );
      await ctx.runMutation(internal.domains.work.index.update, {
        authorization: baseAuthorization,
        workItemId,
        runId,
        expectedRevision: numberField(input, "expectedRevision"),
        title: optionalStringField(input, "title"),
        description: optionalStringField(input, "goal"),
        summary: optionalStringField(input, "latestUpdate"),
        artifact: input.artifact ? artifactInput(input.artifact) : undefined,
        idempotencyKey,
      });
      return await workResult(ctx, baseAuthorization, workItemId);
    }
    case "renew_claim": {
      const workItemId = stringField(input, "workItemId") as Id<"workItems">;
      const idempotencyKey = stringField(input, "idempotencyKey");
      const runId = await mutationRunId(
        ctx,
        baseAuthorization,
        workItemId,
        "work.renew_claim",
        idempotencyKey,
      );
      await ctx.runMutation(internal.domains.work.index.renewClaim, {
        authorization: baseAuthorization,
        workItemId,
        runId,
        expectedRevision: numberField(input, "expectedRevision"),
        leaseSeconds: input.leaseSeconds as number | undefined,
        idempotencyKey,
      });
      return await workResult(ctx, baseAuthorization, workItemId);
    }
    case "finish_work": {
      const workItemId = stringField(input, "workItemId") as Id<"workItems">;
      const idempotencyKey = stringField(input, "idempotencyKey");
      const runId = await mutationRunId(
        ctx,
        baseAuthorization,
        workItemId,
        "work.finish",
        idempotencyKey,
      );
      await ctx.runMutation(internal.domains.work.index.finish, {
        authorization: baseAuthorization,
        workItemId,
        runId,
        expectedRevision: numberField(input, "expectedRevision"),
        result: "completed",
        summary: stringField(input, "outcome"),
        artifacts: ((input.artifacts as unknown[] | undefined) ?? []).map(
          artifactInput,
        ),
        idempotencyKey,
      });
      return await workResult(ctx, baseAuthorization, workItemId);
    }
    case "add_comment": {
      const workItemId = stringField(input, "workItemId") as Id<"workItems">;
      await ctx.runMutation(internal.domains.comments.index.createForAgent, {
        authorization: baseAuthorization,
        workItemId,
        body: stringField(input, "body"),
        idempotencyKey: stringField(input, "idempotencyKey"),
      });
      return await workResult(ctx, baseAuthorization, workItemId);
    }
    case "request_attention": {
      const workItemId = stringField(input, "workItemId") as Id<"workItems">;
      const idempotencyKey = stringField(input, "idempotencyKey");
      const runId = await mutationRunId(
        ctx,
        baseAuthorization,
        workItemId,
        "attention.request",
        idempotencyKey,
      );
      const created = await ctx.runMutation(
        internal.domains.attention.index.request,
        {
          authorization: baseAuthorization,
          workItemId,
          runId,
          expectedRevision: numberField(input, "expectedRevision"),
          kind: stringField(input, "kind") as
            | "review"
            | "decision"
            | "question"
            | "blocked",
          title: stringField(input, "title"),
          body: stringField(input, "body"),
          options: input.options as string[] | undefined,
          urgency: input.important ? "important" : "normal",
          idempotencyKey,
        },
      );
      return await attentionResult(
        ctx,
        baseAuthorization,
        created.attentionRequestId,
      );
    }
    case "get_attention":
      return await attentionResult(
        ctx,
        baseAuthorization,
        stringField(input, "attentionId") as Id<"attentionRequests">,
      );
    case "resolve_attention": {
      const attentionRequestId = stringField(
        input,
        "attentionId",
      ) as Id<"attentionRequests">;
      await ctx.runMutation(
        internal.domains.attention.index.resolveForAgent,
        {
          authorization: baseAuthorization,
          attentionRequestId,
          body: optionalStringField(input, "body"),
          selectedOption: optionalStringField(input, "selectedOption"),
          resolveWithoutResponse: input.resolveWithoutResponse as
            | boolean
            | undefined,
          idempotencyKey: stringField(input, "idempotencyKey"),
        },
      );
      return await attentionResult(
        ctx,
        baseAuthorization,
        attentionRequestId,
      );
    }
    case "get_attachment": {
      const attachment = await ctx.runQuery(
        internal.domains.attachments.index.getForAgent,
        {
          authorization: baseAuthorization,
          attachmentId: stringField(
            input,
            "attachmentId",
          ) as Id<"attachments">,
        },
      );
      return await attachmentAccess(attachment);
    }
    case "sync_snapshot":
      return await ctx.runQuery(internal.gateway.readModels.syncSnapshot, {
        authorization: baseAuthorization,
      });
    case "runner_register":
      return await ctx.runMutation(internal.domains.runner.index.register, {
        authorization: baseAuthorization,
        token: stringField(input, "token"),
        label: stringField(input, "label"),
        platform: stringField(input, "platform") as "darwin" | "linux",
        version: stringField(input, "version"),
        harnesses: input.harnesses as Array<"codex" | "claude">,
        approvalMode: stringField(input, "approvalMode") as "ask" | "automatic",
      });
    case "runner_rotate":
      return await ctx.runMutation(internal.domains.runner.index.rotate, {
        authorization: baseAuthorization,
        registrationId: stringField(input, "registrationId") as Id<"runnerRegistrations">,
        token: stringField(input, "token"),
        replacementToken: stringField(input, "replacementToken"),
      });
    case "runner_revoke":
      return await ctx.runMutation(internal.domains.runner.index.revoke, {
        authorization: baseAuthorization,
        registrationId: stringField(input, "registrationId") as Id<"runnerRegistrations">,
        token: stringField(input, "token"),
      });
    case "runner_wait": {
      const waitSeconds = (input.waitSeconds as number | undefined) ?? 0;
      const startedAt = Date.now();
      let intervalMilliseconds = 1_000;
      let result: { registration: unknown; job?: unknown } | undefined;
      try {
        while (true) {
          result = await ctx.runMutation(internal.domains.runner.index.reserve, {
            authorization: baseAuthorization,
            registrationId: stringField(input, "registrationId") as Id<"runnerRegistrations">,
            token: stringField(input, "token"),
            waitSeconds,
            platform: stringField(input, "platform") as "darwin" | "linux",
            version: stringField(input, "version"),
            harnesses: input.harnesses as Array<"codex" | "claude">,
            approvalMode: stringField(input, "approvalMode") as "ask" | "automatic",
          });
          if (result.job || waitSeconds === 0) break;
          const remaining = waitSeconds * 1_000 - (Date.now() - startedAt);
          if (remaining <= 0) break;
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(intervalMilliseconds, remaining))
          );
          intervalMilliseconds = Math.min(intervalMilliseconds * 2, 5_000);
        }
      } finally {
        await ctx.runMutation(internal.domains.runner.index.finishWait, {
          authorization: baseAuthorization,
          registrationId: stringField(input, "registrationId") as Id<"runnerRegistrations">,
          token: stringField(input, "token"),
        });
      }
      if (!result) throw new Error("Runner wait was unavailable");
      return {
        ...result,
        wait: {
          status: result.job
            ? "job_available"
            : waitSeconds > 0
              ? "timed_out"
              : "not_requested",
          requestedSeconds: waitSeconds,
          elapsedMilliseconds: Math.max(0, Date.now() - startedAt),
        },
        serverTime: Date.now(),
      };
    }
    case "runner_update_job": {
      const jobId = stringField(input, "jobId") as Id<"runnerJobs">;
      await ctx.runMutation(internal.domains.runner.index.updateJob, {
        authorization: baseAuthorization,
        registrationId: stringField(input, "registrationId") as Id<"runnerRegistrations">,
        token: stringField(input, "token"),
        jobId,
        expectedRevision: numberField(input, "expectedRevision"),
        state: stringField(input, "state") as
          | "queued" | "delivered" | "awaiting_local_approval" | "starting"
          | "running" | "blocked" | "cancel_requested" | "cancelled"
          | "failed" | "completed" | "expired",
        leaseSeconds: input.leaseSeconds as number | undefined,
        safeCode: optionalStringField(input, "safeCode"),
        safeMessage: optionalStringField(input, "safeMessage"),
        safeSummary: optionalStringField(input, "safeSummary"),
        sessionReferencePresent: input.sessionReferencePresent as boolean | undefined,
        idempotencyKey: stringField(input, "idempotencyKey"),
      });
      return await ctx.runQuery(internal.domains.runner.index.getJob, {
        authorization: baseAuthorization,
        registrationId: stringField(input, "registrationId") as Id<"runnerRegistrations">,
        token: stringField(input, "token"),
        jobId,
      });
    }
  }
}

async function attachmentAccess(attachment: {
  _id: Id<"attachments">;
  filename: string;
  mimeType: string;
  byteSize: number;
  storageKey: string;
}) {
  const baseUrl = process.env.DONGO_ATTACHMENT_DOWNLOAD_BASE_URL;
  const secret = process.env.DONGO_ATTACHMENT_URL_SIGNING_SECRET;
  if (!baseUrl || !secret) {
    throw new GatewayError(
      "internal",
      "Attachment download signing is not configured",
      500,
    );
  }
  let url: URL;
  try {
    url = new URL(
      `${baseUrl.replace(/\/$/, "")}/${encodeURIComponent(attachment._id)}`,
    );
  } catch {
    throw new GatewayError(
      "internal",
      "Attachment download origin is invalid",
      500,
    );
  }
  if (url.protocol !== "https:") {
    throw new GatewayError(
      "internal",
      "Attachment download origin must use HTTPS",
      500,
    );
  }
  const expiresAt = Date.now() + DOWNLOAD_TTL_MS;
  const key = base64UrlEncode(new TextEncoder().encode(attachment.storageKey));
  const signature = await hmacBase64Url(
    secret,
    `${attachment._id}\n${attachment.storageKey}\n${expiresAt}`,
  );
  url.searchParams.set("expires", String(expiresAt));
  url.searchParams.set("key", key);
  url.searchParams.set("signature", signature);
  return {
    attachmentId: attachment._id,
    filename: attachment.filename,
    contentType: attachment.mimeType,
    byteSize: attachment.byteSize,
    downloadUrl: url.toString(),
    expiresAt,
  };
}

async function readAndVerify(
  ctx: ActionCtx,
  request: Request,
  pathname: string,
): Promise<{ body: unknown; bodyHash: string; keyId: string; nonce: string }> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) {
    throw new GatewayError("validation", "Gateway body is too large", 413);
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) {
    throw new GatewayError("validation", "Gateway body is too large", 413);
  }
  const keyId = request.headers.get("x-dongo-key-id") ?? "";
  const timestamp = request.headers.get("x-dongo-timestamp") ?? "";
  const nonce = request.headers.get("x-dongo-nonce") ?? "";
  const signature = request.headers.get("x-dongo-signature") ?? "";
  if (keyId !== GATEWAY_KEY_ID) {
    throw new GatewayError("unauthorized", "Gateway key is not active", 401);
  }
  if (!/^\d{13}$/.test(timestamp)) {
    throw new GatewayError("unauthorized", "Gateway timestamp is invalid", 401);
  }
  const timestampMs = Number(timestamp);
  if (Math.abs(Date.now() - timestampMs) > ALLOWED_CLOCK_SKEW_MS) {
    throw new GatewayError("unauthorized", "Gateway request is stale", 401);
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      nonce,
    )
  ) {
    throw new GatewayError("unauthorized", "Gateway nonce is invalid", 401);
  }
  const secret = process.env.DONGO_INTERNAL_GATEWAY_SECRET;
  if (!secret || secret.length < 32) {
    throw new GatewayError("internal", "Gateway signing is not configured", 500);
  }
  const bodyHash = await sha256Hex(bytes);
  const canonical = `${timestamp}\n${nonce}\n${request.method.toUpperCase()}\n${pathname}\n${bodyHash}`;
  const signatureBytes = base64UrlDecode(signature);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  if (
    !signatureBytes ||
    !(await crypto.subtle.verify(
      "HMAC",
      cryptoKey,
      ownedArrayBuffer(signatureBytes),
      ownedArrayBuffer(new TextEncoder().encode(canonical)),
    ))
  ) {
    throw new GatewayError("unauthorized", "Gateway signature is invalid", 401);
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new GatewayError("validation", "Gateway body is not valid JSON", 400);
  }
  return { body, bodyHash, keyId, nonce };
}

async function consumeNonce(
  ctx: ActionCtx,
  verified: { bodyHash: string; keyId: string; nonce: string },
  requestId: string,
) {
  await ctx.runMutation(internal.gateway.security.consumeNonce, {
    keyId: verified.keyId,
    nonce: verified.nonce,
    requestId,
    requestDigest: verified.bodyHash,
  });
}

function issue(error: z.ZodError) {
  return error.issues.slice(0, 10).map((entry) => ({
    path: entry.path.join("."),
    code: entry.code,
    message: entry.message.slice(0, 300),
  }));
}

function normalizeError(error: unknown): GatewayError {
  if (error instanceof GatewayError) return error;
  const data =
    error && typeof error === "object" && "data" in error
      ? (error as { data?: unknown }).data
      : undefined;
  if (data && typeof data === "object") {
    const recordData = data as {
      code?: unknown;
      message?: unknown;
      details?: unknown;
    };
    if (
      typeof recordData.code === "string" &&
      typeof recordData.message === "string"
    ) {
      const code = domainErrorCodes.includes(
        recordData.code as DomainErrorCode,
      )
        ? (recordData.code as DomainErrorCode)
        : recordData.code === "project_archived"
          ? "forbidden"
          : recordData.code === "invalid_transition"
            ? "validation"
            : "internal";
      const status =
        code === "unauthorized"
          ? 401
          : code === "forbidden" || code === "insufficient_scope"
            ? 403
            : code === "not_found"
              ? 404
              : [
                    "revision_conflict",
                    "claim_conflict",
                    "parallel_execution_unavailable",
                    "concurrency_limit",
                    "session_work_limit",
                    "idempotency_conflict",
                    "already_resolved",
                    "identifier_conflict",
                    "identifier_exhausted",
                    "plan_limit",
                  ].includes(code)
                ? 409
                : code === "quota_exceeded"
                  ? 429
                  : code === "internal"
                    ? 500
                    : 400;
      return new GatewayError(
        code,
        recordData.message,
        status,
        recordData.details,
        code === "rate_limited" || code === "internal",
      );
    }
  }
  return new GatewayError("internal", "Internal gateway error", 500, undefined, true);
}

function jsonResponse(
  payload: unknown,
  status: number,
  requestId: string,
): Response {
  const body = JSON.stringify(payload);
  if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: {
          code: "internal",
          message: "Gateway response exceeded the safe size limit",
          retryable: false,
        },
        requestId,
      }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
  return new Response(body, {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

function errorResponse(error: unknown, requestId: string): Response {
  const normalized = normalizeError(error);
  return jsonResponse(
    {
      ok: false,
      error: {
        code: normalized.code,
        message: normalized.message,
        retryable: normalized.retryable,
        details: normalized.details,
      },
      requestId,
    },
    normalized.status,
    requestId,
  );
}

export const executeAgent = httpAction(async (ctx, request) => {
  let requestId = "unknown";
  try {
    const verified = await readAndVerify(ctx, request, AGENT_PATH);
    const envelope = agentEnvelopeSchema.safeParse(verified.body);
    if (!envelope.success) {
      throw new GatewayError(
        "validation",
        "Gateway envelope is invalid",
        400,
        { issues: issue(envelope.error) },
      );
    }
    requestId = envelope.data.context.requestId;
    await consumeNonce(ctx, verified, requestId);
    if (!(envelope.data.operation in operationRegistry)) {
      throw new GatewayError("not_found", "Agent operation is not supported", 404);
    }
    const operation = envelope.data.operation as OperationName;
    const spec = operationRegistry[operation];
    const parsedInput = spec.inputSchema.safeParse(envelope.data.input);
    if (!parsedInput.success) {
      throw new GatewayError(
        "validation",
        "Agent operation input is invalid",
        400,
        { issues: issue(parsedInput.error) },
      );
    }
    const output = await dispatchAgentOperation(
      ctx,
      operation,
      parsedInput.data,
      envelope.data.context,
    );
    const parsedOutput = spec.outputSchema.safeParse(output);
    if (!parsedOutput.success) {
      throw new GatewayError(
        "internal",
        "Agent operation produced an invalid response",
        500,
        { issues: issue(parsedOutput.error) },
      );
    }
    if (
      new TextEncoder().encode(JSON.stringify(parsedOutput.data)).byteLength >
        MAX_MCP_RESULT_BYTES
    ) {
      throw new GatewayError(
        "internal",
        "Agent operation result exceeded the MCP result limit",
        500,
      );
    }
    let releaseNoticeDelivery:
      | { id: string; sequence: number }
      | undefined;
    if (envelope.data.releaseNotice !== undefined) {
      try {
        const claim = await ctx.runMutation(
          internal.domains.installations.index.claimAgentReleaseNotice,
          {
            authorization: authorization(envelope.data.context),
            releaseId: envelope.data.releaseNotice.id,
            releaseSequence: envelope.data.releaseNotice.sequence,
          },
        );
        if (claim.deliver) {
          releaseNoticeDelivery = {
            id: envelope.data.releaseNotice.id,
            sequence: envelope.data.releaseNotice.sequence,
          };
        }
      } catch {
        console.error(JSON.stringify({
          event: "agent_release_notice_claim_failed",
          requestId,
        }));
      }
    }
    return jsonResponse(
      {
        ok: true,
        data: parsedOutput.data,
        requestId,
        apiVersion: "v1",
        ...(releaseNoticeDelivery === undefined
          ? {}
          : { releaseNoticeDelivery }),
      },
      200,
      requestId,
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
});

export const bindOAuth = httpAction(async (ctx, request) => {
  let requestId = "unknown";
  try {
    const verified = await readAndVerify(ctx, request, OAUTH_BIND_PATH);
    const envelope = oauthBindEnvelopeSchema.safeParse(verified.body);
    if (!envelope.success) {
      throw new GatewayError(
        "validation",
        "OAuth binding envelope is invalid",
        400,
        { issues: issue(envelope.error) },
      );
    }
    requestId = envelope.data.requestId;
    await consumeNonce(ctx, verified, requestId);
    const input = envelope.data.input;
    const result = await ctx.runMutation(
      internal.domains.installations.index.registerOAuthGrant,
      {
        projectRef: input.projectRef,
        authorizedByProfileId: input.profileId as
          | Id<"humanProfiles">
          | undefined,
        authSubject: input.authSubject,
        kind: input.kind,
        clientId: input.clientId,
        label: input.label,
        machineLabel: input.machineLabel,
        resource: input.resource,
        scopes: input.scopes,
        providerIssuer: input.providerIssuer,
        providerGrantId: input.providerGrantId,
        subject: input.subject,
        expiresAt: input.expiresAt,
      },
    );
    const output = oauthBindOutputSchema.safeParse(result);
    if (!output.success) {
      throw new GatewayError(
        "internal",
        "OAuth binding produced an invalid response",
        500,
        { issues: issue(output.error) },
      );
    }
    return jsonResponse(
      { ok: true, data: output.data, requestId, apiVersion: "v1" },
      200,
      requestId,
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
});

export const resolveOAuth = httpAction(async (ctx, request) => {
  let requestId = "unknown";
  try {
    const verified = await readAndVerify(ctx, request, OAUTH_RESOLVE_PATH);
    const envelope = oauthResolveEnvelopeSchema.safeParse(verified.body);
    if (!envelope.success) {
      throw new GatewayError(
        "validation",
        "OAuth resolution envelope is invalid",
        400,
        { issues: issue(envelope.error) },
      );
    }
    requestId = envelope.data.requestId;
    await consumeNonce(ctx, verified, requestId);
    const input = envelope.data.input;
    const result = await ctx.runQuery(
      internal.domains.installations.index.resolveOAuthGrant,
      {
        oauthBindingId: input.oauthBindingId as Id<"oauthBindings">,
        providerIssuer: input.providerIssuer,
        providerGrantId: input.providerGrantId,
        subject: input.subject,
        clientId: input.clientId,
        resource: input.resource,
        projectRef: input.projectRef,
        authorizedByProfileId: input.profileId as
          | Id<"humanProfiles">
          | undefined,
        authSubject: input.authSubject,
      },
    );
    const output = oauthResolveOutputSchema.safeParse(result);
    if (!output.success) {
      throw new GatewayError(
        "internal",
        "OAuth resolution produced an invalid response",
        500,
        { issues: issue(output.error) },
      );
    }
    return jsonResponse(
      { ok: true, data: output.data, requestId, apiVersion: "v1" },
      200,
      requestId,
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
});

export const resolveServiceCredential = httpAction(async (ctx, request) => {
  let requestId = "unknown";
  try {
    const verified = await readAndVerify(
      ctx,
      request,
      SERVICE_CREDENTIAL_RESOLVE_PATH,
    );
    const envelope = serviceCredentialResolveEnvelopeSchema.safeParse(
      verified.body,
    );
    if (!envelope.success) {
      throw new GatewayError(
        "validation",
        "Service credential envelope is invalid",
        400,
        { issues: issue(envelope.error) },
      );
    }
    requestId = envelope.data.requestId;
    await consumeNonce(ctx, verified, requestId);
    const token = envelope.data.input.token;
    const tokenPrefix = serviceCredentialTokenPrefix(token);
    const candidate = tokenPrefix
      ? await ctx.runQuery(
          internal.domains.installations.index.serviceCredentialForVerification,
          { tokenPrefix },
        )
      : null;
    const active = Boolean(
      candidate &&
        (await verifyServiceCredentialToken(token, candidate.tokenHash)),
    );
    const result = active
      ? await ctx.runMutation(
          internal.domains.installations.index.activateServiceCredential,
          { serviceCredentialId: candidate!.serviceCredentialId },
        )
      : null;
    const output = serviceCredentialResolveOutputSchema.safeParse(
      result ? { active: true, ...result } : { active: false },
    );
    if (!output.success) {
      throw new GatewayError(
        "internal",
        "Service credential resolution produced an invalid response",
        500,
        { issues: issue(output.error) },
      );
    }
    return jsonResponse(
      { ok: true, data: output.data, requestId, apiVersion: "v1" },
      200,
      requestId,
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
});

export const finalizeAttachment = httpAction(async (ctx, request) => {
  let requestId = "unknown";
  try {
    const verified = await readAndVerify(
      ctx,
      request,
      ATTACHMENT_FINALIZE_PATH,
    );
    const envelope = attachmentFinalizeEnvelopeSchema.safeParse(verified.body);
    if (!envelope.success) {
      throw new GatewayError(
        "validation",
        "Attachment finalize envelope is invalid",
        400,
        { issues: issue(envelope.error) },
      );
    }
    requestId = envelope.data.requestId;
    await consumeNonce(ctx, verified, requestId);
    const input = envelope.data.input;
    const result = await ctx.runMutation(
      internal.domains.attachments.index.finalize,
      {
        attachmentId: input.attachmentId as Id<"attachments">,
        observedByteSize: input.observedByteSize,
        observedMimeType: input.observedMimeType,
        observedChecksumSha256: input.observedChecksumSha256,
      },
    );
    return jsonResponse(
      { ok: true, data: result, requestId, apiVersion: "v1" },
      200,
      requestId,
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
});

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", ownedArrayBuffer(bytes)),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacBase64Url(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64UrlEncode(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
    ),
  );
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  return owned.buffer;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=";
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}
