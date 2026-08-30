import { z } from "zod";

const identifier = z.string().min(1).max(256);
const timestamp = z.number().int().nonnegative();
const boundedText = z.string().max(100_000);

export const actorSummarySchema = z
  .object({
    id: identifier,
    kind: z.enum(["human", "installation", "service"]),
    displayName: z.string().min(1).max(240),
    agentType: z.string().min(1).max(120).optional(),
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
    repositoryUrl: z.url().optional(),
    executionMode: z.enum(["manual", "autonomous"]),
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
    createdAt: timestamp,
  })
  .strict();

export const attentionSchema = z
  .object({
    id: identifier,
    workItemId: identifier,
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
    latestUpdate: boundedText.optional(),
    startedAt: timestamp,
    activeUntil: timestamp.optional(),
    finishedAt: timestamp.optional(),
  })
  .strict();

export const workItemSchema = z
  .object({
    id: identifier,
    projectId: identifier,
    identifier: z.string().min(1).max(64),
    sequence: z.number().int().positive(),
    title: z.string().min(1).max(500),
    goal: boundedText,
    outcome: boundedText.optional(),
    state: z.enum(["ready", "working", "done", "cancelled"]),
    orderKey: z.string().min(1).max(128),
    revision: z.number().int().positive(),
    sourceIntakeIds: z.array(identifier).max(500),
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

export const sessionStartSchema = z
  .object({
    project: projectSummarySchema,
    installation: actorSummarySchema,
    overview: overviewSchema,
    newlyResolvedAttention: z.array(attentionSchema).max(100),
    instructions: z
      .object({
        executionMode: z.enum(["manual", "autonomous"]),
        maxNewWorkItemsPerSession: z.literal(1),
        wakeUpSemantics: z.literal("next_pull"),
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

export const schemaFields = {
  identifier,
  boundedText,
  idempotencyKey: z.string().min(8).max(256),
  expectedRevision: z.number().int().positive(),
  leaseSeconds: z.number().int().min(30).max(3_600).optional(),
} as const;
