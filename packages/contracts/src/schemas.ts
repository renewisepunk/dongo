import { z } from "zod";

export const workLinkSchema = z.url({ protocol: /^https?$/ });

const identifier = z.string().min(1).max(256);
const timestamp = z.number().int().nonnegative();
const boundedText = z.string().max(100_000);

export const actorSummarySchema = z
  .object({
    id: identifier,
    kind: z.enum(["human", "installation", "service"]),
    displayName: z.string().min(1).max(240),
    agentType: z.string().min(1).max(120).optional(),
    transport: z.enum(["cli", "mcp", "service", "development"]).optional(),
    transportLabel: z.string().min(1).max(240).optional(),
    machineLabel: z.string().min(1).max(240).optional(),
  })
  .strict();

export const projectSummarySchema = z
  .object({
    id: identifier,
    publicRef: z.string().min(3).max(128),
    organizationId: identifier,
    organizationSlug: z.string().min(1).max(128),
    name: z.string().min(1).max(240),
    slug: z.string().min(1).max(128),
    identifierPrefix: z.string().min(1).max(16),
    compactIdentifierPrefix: z.string().regex(/^[a-z]{4}$/u).optional(),
    repositoryUrl: z.url().optional(),
    executionMode: z.enum(["manual", "autonomous"]),
    parallelExecution: z.object({
      enabled: z.boolean(),
      maxConcurrentRuns: z.number().int().min(1).max(8),
      requiresIsolatedWorkspaces: z.literal(true),
    }).strict().optional(),
    archivedAt: timestamp.optional(),
  })
  .strict();

export const attachmentSchema = z
  .object({
    id: identifier,
    filename: z.string().min(1).max(500),
    contentType: z.string().min(1).max(255),
    byteSize: z.number().int().nonnegative(),
    state: z.enum(["reserved", "uploading", "ready", "failed", "deleted"]),
    createdAt: timestamp,
  })
  .strict();

export const intakeSchema = z
  .object({
    id: identifier,
    projectId: identifier,
    text: boundedText,
    context: boundedText.optional(),
    links: z.array(workLinkSchema).max(100).optional(),
    state: z.enum([
      "waiting",
      "claimed",
      "clarification_needed",
      "processed",
      "dismissed",
    ]),
    revision: z.number().int().positive(),
    createdBy: actorSummarySchema,
    claimedBy: actorSummarySchema.optional(),
    claimExpiresAt: timestamp.optional(),
    hasOpenAttention: z.boolean().optional(),
    attachmentIds: z.array(identifier).max(20),
    linkedWorkItemIds: z.array(identifier).max(500),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();

export const artifactSchema = z
  .object({
    id: identifier,
    kind: z.enum([
      "commit",
      "pull_request",
      "deployment",
      "preview",
      "url",
      "image",
      "file",
      "report",
    ]),
    label: z.string().min(1).max(500),
    url: z.url().optional(),
    repositoryPath: z.string().min(1).max(2_048).optional(),
    createdAt: timestamp,
  })
  .strict();

export const conversationEntrySchema = z
  .object({
    id: identifier,
    actor: actorSummarySchema,
    body: boundedText,
    attachmentIds: z.array(identifier).max(20),
    createdAt: timestamp,
  })
  .strict();

export const attentionSchema = z
  .object({
    id: identifier,
    workItemId: identifier.optional(),
    intakeId: identifier.optional(),
    kind: z.enum(["review", "decision", "question", "blocked"]),
    title: z.string().min(1).max(500),
    body: boundedText,
    important: z.boolean(),
    options: z.array(z.string().min(1).max(2_000)).min(2).max(20).optional(),
    requestedBy: actorSummarySchema,
    requestedAt: timestamp,
    resolvedAt: timestamp.optional(),
    resolvedBy: actorSummarySchema.optional(),
    resolutionCommentId: identifier.optional(),
    resolution: z
      .object({
        kind: z.enum(["responded", "resolved", "cancelled"]),
        body: boundedText.optional(),
        selectedOption: z.string().min(1).max(2_000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const runSchema = z
  .object({
    id: identifier,
    workItemId: identifier,
    installationActor: actorSummarySchema,
    externalSessionId: z.string().min(1).max(500),
    state: z.enum([
      "running",
      "waiting_for_human",
      "finished",
      "failed",
      "abandoned",
    ]),
    hostCapabilities: z.object({
      parallelExecution: z.enum(["supported", "unsupported", "undisclosed"]),
      worktreeIsolation: z.enum(["supported", "unsupported", "undisclosed"]),
    }).strict().optional(),
    workspace: z.object({
      kind: z.enum(["worktree", "shared_checkout", "undisclosed"]),
      worktreeName: z.string().min(1).max(240).optional(),
      branch: z.string().min(1).max(240).optional(),
    }).strict().optional(),
    latestUpdate: boundedText.optional(),
    startedAt: timestamp,
    activeUntil: timestamp.optional(),
    finishedAt: timestamp.optional(),
  })
  .strict();

export const workRelationshipSchema = z
  .object({
    id: identifier,
    identifier: z.string().min(1).max(64),
    title: z.string().min(1).max(500),
    state: z.enum(["ready", "working", "done", "cancelled"]),
  })
  .strict();

export const workItemSchema = z
  .object({
    id: identifier,
    projectId: identifier,
    identifier: z.string().min(1).max(64),
    legacyIdentifiers: z.array(z.string().min(1).max(64)).max(4).optional(),
    sequence: z.number().int().positive(),
    title: z.string().min(1).max(500),
    goal: boundedText,
    context: boundedText.optional(),
    links: z.array(workLinkSchema).max(100).optional(),
    outcome: boundedText.optional(),
    state: z.enum(["ready", "working", "done", "cancelled"]),
    orderKey: z.string().min(1).max(128),
    revision: z.number().int().positive(),
    sourceIntakeIds: z.array(identifier).max(500),
    parentWorkItem: workRelationshipSchema.optional(),
    childWorkItems: z.array(workRelationshipSchema).max(100).default([]),
    activeRun: runSchema.optional(),
    openAttention: attentionSchema.optional(),
    artifacts: z.array(artifactSchema).max(500),
    conversation: z.array(conversationEntrySchema).max(500),
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: timestamp.optional(),
  })
  .strict();

export const overviewSchema = z
  .object({
    project: projectSummarySchema,
    needsYou: z.array(workItemSchema).max(100),
    working: z.array(workItemSchema).max(100),
    ready: z.array(workItemSchema).max(500),
    inbox: z.array(intakeSchema).max(500),
    recentlyDone: z.array(workItemSchema).max(100),
    serverTime: timestamp,
  })
  .strict();

export const projectUpdateSchema = z
  .object({
    id: identifier,
    version: z.number().int().positive(),
    kind: z.literal("intake_available"),
    intakeId: identifier,
    priority: z.enum(["normal", "important"]),
    createdAt: timestamp,
  })
  .strict();

export const projectUpdatesSchema = z
  .object({
    cursor: z.number().int().nonnegative(),
    updates: z.array(projectUpdateSchema).max(100),
    hasMore: z.boolean(),
    wait: z.object({
      status: z.enum(["updates_available", "timed_out", "not_requested"]),
      requestedSeconds: z.number().int().min(0).max(20),
      elapsedMilliseconds: z.number().int().nonnegative(),
    }).strict(),
    delivery: z.object({
      mechanism: z.literal("bounded_pull"),
      stoppedAgentsRestarted: z.literal(false),
    }).strict(),
    serverTime: timestamp,
  })
  .strict();

export const sessionStartSchema = z
  .object({
    project: projectSummarySchema,
    installation: actorSummarySchema,
    overview: overviewSchema,
    newlyResolvedAttention: z.array(attentionSchema).max(100),
    instructions: z
      .object({
        executionMode: z.enum(["manual", "autonomous"]),
        maxStartedWorkItemsPerSession: z
          .literal(1)
          .describe("Maximum Ready work items an autonomous session may start."),
        maxNewWorkItemsPerSession: z
          .literal(1)
          .describe("Deprecated compatibility alias; this never limited WorkItem creation."),
        wakeUpSemantics: z.literal("next_pull"),
        parallelExecution: z.object({
          policy: projectSummarySchema.shape.parallelExecution.unwrap(),
          hostCapabilities: runSchema.shape.hostCapabilities.unwrap(),
          mode: z.enum(["serial", "parallel"]),
          reason: z.enum([
            "project_disabled",
            "host_unsupported",
            "host_undisclosed",
            "parallel_available",
          ]),
        }).strict().optional(),
      })
      .strict(),
  })
  .strict();

export const syncSnapshotSchema = z
  .object({
    version: z.literal(1),
    generatedAt: timestamp,
    project: projectSummarySchema,
    workItems: z.array(workItemSchema).max(5_000),
  })
  .strict();

export const attachmentAccessSchema = z
  .object({
    attachmentId: identifier,
    filename: z.string().min(1).max(500),
    contentType: z.string().min(1).max(255),
    byteSize: z.number().int().nonnegative(),
    downloadUrl: z.url(),
    expiresAt: timestamp,
  })
  .strict();

export const runnerHarnessSchema = z.enum(["codex", "claude"]);
export const runnerPlatformSchema = z.enum(["darwin", "linux"]);
export const runnerApprovalModeSchema = z.enum(["ask", "automatic"]);
export const runnerJobKindSchema = z.enum(["work", "intake"]);
export const runnerJobStateSchema = z.enum([
  "queued",
  "delivered",
  "awaiting_local_approval",
  "starting",
  "running",
  "blocked",
  "cancel_requested",
  "cancelled",
  "failed",
  "completed",
  "expired",
]);

export const runnerRegistrationSchema = z.object({
  id: identifier,
  projectId: identifier,
  installationId: identifier,
  label: z.string().min(1).max(120),
  platform: runnerPlatformSchema,
  version: z.string().min(1).max(64),
  harnesses: z.array(runnerHarnessSchema).min(1).max(2),
  approvalMode: runnerApprovalModeSchema,
  status: z.enum(["active", "revoked"]),
  lastSeenAt: timestamp.optional(),
  waitingUntil: timestamp.optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
  revokedAt: timestamp.optional(),
}).strict();

export const runnerJobSchema = z.object({
  id: identifier,
  projectId: identifier,
  kind: runnerJobKindSchema,
  workItemId: identifier.optional(),
  workIdentifier: z.string().min(1).max(64).optional(),
  intakeId: identifier.optional(),
  targetRegistrationId: identifier.optional(),
  harness: runnerHarnessSchema,
  state: runnerJobStateSchema,
  revision: z.number().int().positive(),
  registrationId: identifier.optional(),
  safeCode: z.string().min(1).max(80).optional(),
  safeMessage: z.string().max(500).optional(),
  safeSummary: z.string().max(2_000).optional(),
  sessionReferencePresent: z.boolean().optional(),
  requestedAt: timestamp,
  expiresAt: timestamp,
  deliveredAt: timestamp.optional(),
  reservationExpiresAt: timestamp.optional(),
  leaseExpiresAt: timestamp.optional(),
  cancellationRequestedAt: timestamp.optional(),
  mutationQuarantinedAt: timestamp.optional(),
  terminalAt: timestamp.optional(),
  updatedAt: timestamp,
}).strict().superRefine((job, context) => {
  const workTarget = job.workItemId !== undefined && job.workIdentifier !== undefined;
  const anyWorkTarget = job.workItemId !== undefined || job.workIdentifier !== undefined;
  const intakeTarget = job.intakeId !== undefined;
  if (
    (job.kind === "work" && (!workTarget || intakeTarget)) ||
    (job.kind === "intake" && (!intakeTarget || anyWorkTarget))
  ) {
    context.addIssue({
      code: "custom",
      message: "Runner job target does not match its kind",
      path: ["kind"],
    });
  }
});

export const runnerWaitSchema = z.object({
  registration: runnerRegistrationSchema,
  job: runnerJobSchema.optional(),
  wait: z.object({
    status: z.enum(["job_available", "timed_out", "not_requested"]),
    requestedSeconds: z.number().int().min(0).max(20),
    elapsedMilliseconds: z.number().int().nonnegative(),
  }).strict(),
  serverTime: timestamp,
}).strict();

export const schemaFields = {
  identifier,
  boundedText,
  idempotencyKey: z.string().min(8).max(256),
  expectedRevision: z.number().int().positive(),
  leaseSeconds: z.number().int().min(30).max(3_600).optional(),
} as const;
