import { z } from "zod";
import type {
  Artifact,
  Attention,
  Intake,
  Overview,
  ProjectUpdates,
  ResourceClaimResult,
  RunnerJob,
  RunnerRegistration,
  RunnerWait,
  SessionStart,
  SyncSnapshot,
  WorkItem,
} from "./domain.ts";
import {
  attachmentAccessSchema,
  attentionSchema,
  intakeSchema,
  overviewSchema,
  projectUpdatesSchema,
  runnerApprovalModeSchema,
  runnerHarnessSchema,
  runnerJobSchema,
  runnerJobStateSchema,
  runnerPlatformSchema,
  runnerRegistrationSchema,
  runnerWaitSchema,
  resourceClaimResultSchema,
  schemaFields,
  sessionStartSchema,
  syncSnapshotSchema,
  workLinkSchema,
  workItemSchema,
} from "./schemas.ts";

export const agentScopes = [
  "dongo:work:read",
  "dongo:work:write",
  "dongo:attachments:read",
  "offline_access",
] as const;
export type AgentScope = (typeof agentScopes)[number];

export type OperationName = keyof OperationMap;
export type McpOperationName = Exclude<
  OperationName,
  | "runner_register"
  | "runner_rotate"
  | "runner_revoke"
  | "runner_wait"
  | "runner_quarantine_job"
  | "runner_update_job"
>;

export type RequestIdentity = {
  requestId: string;
  installationId: string;
  projectId: string;
  actorId: string;
  scopes: AgentScope[];
  externalSessionId?: string;
};

export type MutationInput = { idempotencyKey: string };
export type AgentArtifactInput = {
  kind: Artifact["kind"];
  label: string;
  url?: string;
  repositoryPath?: string;
};
export type HostCapabilitiesInput = {
  parallelExecution: "supported" | "unsupported";
  worktreeIsolation: "supported" | "unsupported";
};
export type RunWorkspaceInput = {
  kind: "worktree" | "shared_checkout" | "undisclosed";
  worktreeName?: string;
  branch?: string;
};
export type RunActivityInput = {
  kind: "executing" | "verification" | "release" | "waiting_for_resource" | "paused";
  label?: string;
  nextStep?: string;
};

export type OperationMap = {
  session_start: { input: { externalSessionId: string; hostCapabilities?: HostCapabilitiesInput }; output: SessionStart };
  get_overview: { input: Record<string, never>; output: Overview };
  get_updates: { input: { cursor?: number; waitSeconds?: number }; output: ProjectUpdates };
  get_intake: { input: { intakeId: string }; output: Intake };
  claim_intake: { input: MutationInput & { intakeId: string; expectedRevision: number; leaseSeconds?: number }; output: Intake };
  renew_intake_claim: { input: MutationInput & { intakeId: string; expectedRevision: number; leaseSeconds?: number }; output: Intake };
  complete_triage: { input: MutationInput & { intakeId: string; expectedRevision: number; state: "processed" | "dismissed"; explanation?: string; linkedWorkItemIds?: string[] }; output: Intake };
  create_work: { input: MutationInput & { title: string; goal: string; context?: string; links?: string[]; initialComment?: string; sourceIntakeIds?: string[]; parentWorkItemId?: string }; output: WorkItem };
  get_work: { input: { workItemId?: string; identifier?: string }; output: WorkItem };
  start_work: { input: MutationInput & { workItemId: string; expectedRevision: number; externalSessionId: string; leaseSeconds?: number; workspace?: RunWorkspaceInput }; output: WorkItem };
  update_work: { input: MutationInput & { workItemId: string; expectedRevision: number; title?: string; goal?: string; latestUpdate?: string; activity?: RunActivityInput; artifact?: AgentArtifactInput }; output: WorkItem };
  renew_claim: { input: MutationInput & { workItemId: string; expectedRevision: number; leaseSeconds?: number }; output: WorkItem };
  acquire_resource: { input: MutationInput & { workItemId: string; expectedRevision: number; resourceKey: string; resourceLabel?: string; leaseSeconds?: number }; output: ResourceClaimResult };
  release_resource: { input: MutationInput & { workItemId: string; expectedRevision: number; resourceKey: string }; output: ResourceClaimResult };
  finish_work: { input: MutationInput & { workItemId: string; expectedRevision: number; outcome: string; artifacts?: AgentArtifactInput[] }; output: WorkItem };
  add_comment: { input: MutationInput & { workItemId: string; body: string }; output: WorkItem };
  request_attention: { input: MutationInput & { workItemId: string; expectedRevision: number; kind: "review" | "decision" | "question" | "blocked"; title: string; body: string; important?: boolean; options?: string[] }; output: Attention };
  request_owner_attention: { input: MutationInput & { intakeId?: string; kind: "review" | "decision" | "question" | "blocked"; title: string; body: string; important?: boolean; options?: string[] }; output: Attention };
  get_attention: { input: { attentionId: string }; output: Attention };
  resolve_attention: { input: MutationInput & { attentionId: string; body?: string; selectedOption?: string; resolveWithoutResponse?: boolean }; output: Attention };
  get_attachment: { input: { attachmentId: string }; output: { attachmentId: string; filename: string; contentType: string; byteSize: number; downloadUrl: string; expiresAt: number } };
  sync_snapshot: { input: Record<string, never>; output: SyncSnapshot };
  runner_register: { input: MutationInput & { token: string; label: string; platform: "darwin" | "linux"; version: string; harnesses: Array<"codex" | "claude">; approvalMode: "ask" | "automatic" }; output: RunnerRegistration };
  runner_rotate: { input: MutationInput & { registrationId: string; token: string; replacementToken: string }; output: RunnerRegistration };
  runner_revoke: { input: MutationInput & { registrationId: string; token: string }; output: RunnerRegistration };
  runner_wait: { input: MutationInput & { registrationId: string; token: string; waitSeconds?: number; platform: "darwin" | "linux"; version: string; harnesses: Array<"codex" | "claude">; approvalMode: "ask" | "automatic"; activeJobIds?: string[]; hostCapacity?: number; inspectJobId?: string }; output: RunnerWait };
  runner_quarantine_job: { input: MutationInput & { registrationId: string; token: string; jobId: string }; output: RunnerJob };
  runner_update_job: { input: MutationInput & { registrationId: string; token: string; jobId: string; expectedRevision: number; state: RunnerJob["state"]; leaseSeconds?: number; safeCode?: string; safeMessage?: string; safeSummary?: string; sessionReferencePresent?: boolean }; output: RunnerJob };
};

export type OperationInput<N extends OperationName> = OperationMap[N]["input"];
export type OperationOutput<N extends OperationName> = OperationMap[N]["output"];

export type OperationSpec<N extends OperationName = OperationName> = {
  name: N;
  method: "GET" | "POST";
  path: `/api/agent/v1/${string}`;
  scopes: readonly AgentScope[];
  readOnly: boolean;
  idempotent: boolean;
  destructive: boolean;
  openWorld: boolean;
  mcpExposed: boolean;
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
};

const { identifier, boundedText, idempotencyKey, expectedRevision, leaseSeconds } =
  schemaFields;
const read = ["dongo:work:read"] as const;
const write = ["dongo:work:write"] as const;
const attachmentRead = [
  "dongo:work:read",
  "dongo:attachments:read",
] as const;
const emptyInput = z.object({}).strict();
const mutationFields = { idempotencyKey } as const;
const workArtifactInput = z
  .object({
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
  })
  .strict();
const hostCapabilitiesInput = z.object({
  parallelExecution: z.enum(["supported", "unsupported"]),
  worktreeIsolation: z.enum(["supported", "unsupported"]),
}).strict();
const runWorkspaceInput = z.object({
  kind: z.enum(["worktree", "shared_checkout", "undisclosed"]),
  worktreeName: z.string().trim().min(1).max(240).optional(),
  branch: z.string().trim().min(1).max(240).optional(),
}).strict();
const runActivityInput = z.object({
  kind: z.enum([
    "executing",
    "verification",
    "release",
    "waiting_for_resource",
    "paused",
  ]),
  label: z.string().trim().min(1).max(240).optional(),
  nextStep: z.string().trim().min(1).max(500).optional(),
}).strict();
const runnerToken = z.string().regex(
  /^dng_run_[A-Za-z0-9_-]{11}_[A-Za-z0-9_-]{43}$/u,
  "Runner credential format is invalid",
);
const runnerRegistrationFields = {
  token: runnerToken,
  label: z.string().trim().min(1).max(120),
  platform: runnerPlatformSchema,
  version: z.string().trim().min(1).max(64),
  harnesses: z.array(runnerHarnessSchema).min(1).max(2),
  approvalMode: runnerApprovalModeSchema,
} as const;

export const operationRegistry = {
  session_start: spec(
    "session_start", "POST", read, true, true,
    z.object({
      externalSessionId: z.string().min(1).max(500),
      hostCapabilities: hostCapabilitiesInput.optional(),
    }).strict(),
    sessionStartSchema,
  ),
  get_overview: spec(
    "get_overview", "GET", read, true, true, emptyInput, overviewSchema,
  ),
  get_updates: spec(
    "get_updates", "GET", read, true, true,
    z.object({
      cursor: z.number().int().nonnegative().optional(),
      waitSeconds: z.number().int().min(0).max(20).optional(),
    }).strict(),
    projectUpdatesSchema,
  ),
  get_intake: spec(
    "get_intake", "GET", read, true, true,
    z.object({ intakeId: identifier }).strict(), intakeSchema,
  ),
  claim_intake: spec(
    "claim_intake", "POST", write, false, true,
    z.object({ ...mutationFields, intakeId: identifier, expectedRevision, leaseSeconds }).strict(),
    intakeSchema,
  ),
  renew_intake_claim: spec(
    "renew_intake_claim", "POST", write, false, true,
    z.object({ ...mutationFields, intakeId: identifier, expectedRevision, leaseSeconds }).strict(),
    intakeSchema,
  ),
  complete_triage: spec(
    "complete_triage", "POST", write, false, true,
    z.object({
      ...mutationFields,
      intakeId: identifier,
      expectedRevision,
      state: z.enum(["processed", "dismissed"]),
      explanation: boundedText.optional(),
      linkedWorkItemIds: z.array(identifier).max(500).optional(),
    }).strict(),
    intakeSchema,
  ),
  create_work: spec(
    "create_work", "POST", write, false, true,
    z.object({
      ...mutationFields,
      title: z.string().min(1).max(500),
      goal: boundedText,
      context: boundedText.optional(),
      links: z.array(workLinkSchema).max(100).optional(),
      initialComment: z.string().trim().min(1).max(100_000).optional(),
      sourceIntakeIds: z.array(identifier).max(500).optional(),
      parentWorkItemId: identifier
        .describe("Direct parent WorkItem ID. The parent cannot itself be a child.")
        .optional(),
    }).strict(),
    workItemSchema,
  ),
  get_work: spec(
    "get_work", "GET", read, true, true,
    z.object({ workItemId: identifier.optional(), identifier: identifier.optional() }).strict(),
    workItemSchema,
  ),
  start_work: spec(
    "start_work", "POST", write, false, true,
    z.object({
      ...mutationFields,
      workItemId: identifier,
      expectedRevision,
      externalSessionId: z.string().min(1).max(500),
      leaseSeconds,
      workspace: runWorkspaceInput.optional(),
    }).strict(),
    workItemSchema,
  ),
  update_work: spec(
    "update_work", "POST", write, false, true,
    z.object({
      ...mutationFields,
      workItemId: identifier,
      expectedRevision,
      title: z.string().min(1).max(500).optional(),
      goal: boundedText.optional(),
      latestUpdate: boundedText.optional(),
      activity: runActivityInput.optional(),
      artifact: workArtifactInput.optional(),
    }).strict(),
    workItemSchema,
  ),
  renew_claim: spec(
    "renew_claim", "POST", write, false, true,
    z.object({ ...mutationFields, workItemId: identifier, expectedRevision, leaseSeconds }).strict(),
    workItemSchema,
  ),
  acquire_resource: spec(
    "acquire_resource", "POST", write, false, true,
    z.object({
      ...mutationFields,
      workItemId: identifier,
      expectedRevision,
      resourceKey: z.string().trim().regex(/^[a-z0-9](?:[a-z0-9._:/-]{0,118}[a-z0-9])?$/u),
      resourceLabel: z.string().trim().min(1).max(120).optional(),
      leaseSeconds,
    }).strict(),
    resourceClaimResultSchema,
  ),
  release_resource: spec(
    "release_resource", "POST", write, false, true,
    z.object({
      ...mutationFields,
      workItemId: identifier,
      expectedRevision,
      resourceKey: z.string().trim().regex(/^[a-z0-9](?:[a-z0-9._:/-]{0,118}[a-z0-9])?$/u),
    }).strict(),
    resourceClaimResultSchema,
  ),
  finish_work: spec(
    "finish_work", "POST", write, false, true,
    z.object({
      ...mutationFields,
      workItemId: identifier,
      expectedRevision,
      outcome: boundedText,
      artifacts: z.array(workArtifactInput).max(100).optional(),
    }).strict(),
    workItemSchema,
  ),
  add_comment: spec(
    "add_comment", "POST", write, false, true,
    z.object({ ...mutationFields, workItemId: identifier, body: boundedText }).strict(),
    workItemSchema,
  ),
  request_attention: spec(
    "request_attention", "POST", write, false, true,
    z.object({
      ...mutationFields,
      workItemId: identifier,
      expectedRevision,
      kind: z.enum(["review", "decision", "question", "blocked"]),
      title: z.string().min(1).max(500),
      body: boundedText,
      important: z.boolean().optional(),
      options: z.array(z.string().min(1).max(2_000)).min(2).max(20).optional(),
    }).strict(),
    attentionSchema,
  ),
  request_owner_attention: spec(
    "request_owner_attention", "POST", write, false, true,
    z.object({
      ...mutationFields,
      intakeId: identifier.optional(),
      kind: z.enum(["review", "decision", "question", "blocked"]),
      title: z.string().min(1).max(500),
      body: boundedText,
      important: z.boolean().optional(),
      options: z.array(z.string().min(1).max(2_000)).min(2).max(20).optional(),
    }).strict(),
    attentionSchema,
  ),
  get_attention: spec(
    "get_attention", "GET", read, true, true,
    z.object({ attentionId: identifier }).strict(), attentionSchema,
  ),
  resolve_attention: spec(
    "resolve_attention", "POST", write, false, true,
    z.object({
      ...mutationFields,
      attentionId: identifier,
      body: boundedText.optional(),
      selectedOption: z.string().min(1).max(2_000).optional(),
      resolveWithoutResponse: z.boolean().optional(),
    }).strict(),
    attentionSchema,
  ),
  get_attachment: spec(
    "get_attachment", "GET", attachmentRead, true, true,
    z.object({ attachmentId: identifier }).strict(), attachmentAccessSchema, true,
  ),
  sync_snapshot: spec(
    "sync_snapshot", "GET", read, true, true, emptyInput, syncSnapshotSchema,
  ),
  runner_register: spec(
    "runner_register", "POST", write, false, true,
    z.object({ ...mutationFields, ...runnerRegistrationFields }).strict(), runnerRegistrationSchema, false, false,
  ),
  runner_rotate: spec(
    "runner_rotate", "POST", write, false, true,
    z.object({
      ...mutationFields,
      registrationId: identifier,
      token: runnerToken,
      replacementToken: runnerToken,
    }).strict(), runnerRegistrationSchema, false, false,
  ),
  runner_revoke: spec(
    "runner_revoke", "POST", write, false, true,
    z.object({ ...mutationFields, registrationId: identifier, token: runnerToken }).strict(),
    runnerRegistrationSchema, false, false,
  ),
  runner_wait: spec(
    "runner_wait", "POST", write, false, true,
    z.object({
      ...mutationFields,
      registrationId: identifier,
      token: runnerToken,
      waitSeconds: z.number().int().min(0).max(20).optional(),
      platform: runnerPlatformSchema,
      version: z.string().trim().min(1).max(64),
      harnesses: z.array(runnerHarnessSchema).min(1).max(2),
      approvalMode: runnerApprovalModeSchema,
      activeJobIds: z.array(identifier).max(8).optional(),
      hostCapacity: z.number().int().min(1).max(8).optional(),
      inspectJobId: identifier.optional(),
    }).strict().superRefine((input, context) => {
      if (input.activeJobIds !== undefined && input.inspectJobId !== undefined) {
        context.addIssue({
          code: "custom",
          message: "activeJobIds and inspectJobId are mutually exclusive",
          path: ["inspectJobId"],
        });
      }
      if (input.inspectJobId !== undefined && (input.waitSeconds ?? 0) !== 0) {
        context.addIssue({
          code: "custom",
          message: "inspectJobId requires waitSeconds 0",
          path: ["waitSeconds"],
        });
      }
    }), runnerWaitSchema, false, false,
  ),
  runner_quarantine_job: spec(
    "runner_quarantine_job", "POST", write, false, true,
    z.object({
      ...mutationFields,
      registrationId: identifier,
      token: runnerToken,
      jobId: identifier,
    }).strict(), runnerJobSchema, false, false,
  ),
  runner_update_job: spec(
    "runner_update_job", "POST", write, false, true,
    z.object({
      ...mutationFields,
      registrationId: identifier,
      token: runnerToken,
      jobId: identifier,
      expectedRevision,
      state: runnerJobStateSchema,
      leaseSeconds,
      safeCode: z.string().trim().min(1).max(80).optional(),
      safeMessage: z.string().max(500).optional(),
      safeSummary: z.string().max(2_000).optional(),
      sessionReferencePresent: z.boolean().optional(),
    }).strict(), runnerJobSchema, false, false,
  ),
} satisfies { [N in OperationName]: OperationSpec<N> };

function spec<N extends OperationName>(
  name: N,
  method: "GET" | "POST",
  scopes: readonly AgentScope[],
  readOnly: boolean,
  idempotent: boolean,
  inputSchema: z.ZodType,
  outputSchema: z.ZodType,
  openWorld = false,
  mcpExposed = true,
): OperationSpec<N> {
  return {
    name,
    method,
    path: `/api/agent/v1/${name}`,
    scopes,
    readOnly,
    idempotent,
    destructive: false,
    openWorld,
    mcpExposed,
    inputSchema,
    outputSchema,
  };
}

export const mcpOperationNames = Object.values(operationRegistry)
  .filter((operation) => operation.mcpExposed)
  .map((operation) => operation.name) as McpOperationName[];

export const mcpToolNames = mcpOperationNames.map(
  (name) => `dongo_${name}`,
) as Array<`dongo_${McpOperationName}`>;
