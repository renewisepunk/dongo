export type Id<T extends string> = string & { readonly __table: T };

export type OrganizationRole = "owner" | "member";
export type ExecutionMode = "manual" | "autonomous";
export type HostCapabilityState = "supported" | "unsupported" | "undisclosed";
export type ParallelExecutionPolicy = {
  enabled: boolean;
  maxConcurrentRuns: number;
  requiresIsolatedWorkspaces: true;
};
export type HostCapabilities = {
  parallelExecution: HostCapabilityState;
  worktreeIsolation: HostCapabilityState;
};
export type RunWorkspace = {
  kind: "worktree" | "shared_checkout" | "undisclosed";
  worktreeName?: string;
  branch?: string;
};
export type IntakeState = "waiting" | "claimed" | "clarification_needed" | "processed" | "dismissed";
export type WorkState = "ready" | "working" | "done" | "cancelled";
export type RunState = "running" | "waiting_for_human" | "finished" | "failed" | "abandoned";
export type AttentionKind = "review" | "decision" | "question" | "blocked";
export type ArtifactKind = "commit" | "pull_request" | "deployment" | "preview" | "url" | "image" | "file" | "report";
export type ActorKind = "human" | "installation" | "service";
export type RunnerHarness = "codex" | "claude";
export type RunnerPlatform = "darwin" | "linux";
export type RunnerApprovalMode = "ask" | "automatic";
export type RunnerRegistrationStatus = "active" | "revoked";
export type RunnerJobKind = "work" | "intake";
export type RunnerJobState =
  | "queued"
  | "delivered"
  | "awaiting_local_approval"
  | "starting"
  | "running"
  | "blocked"
  | "cancel_requested"
  | "cancelled"
  | "failed"
  | "completed"
  | "expired";

export type ActorSummary = {
  id: Id<"actors">;
  kind: ActorKind;
  displayName: string;
  agentType?: string;
  transport?: "cli" | "mcp" | "service" | "development";
  transportLabel?: string;
  machineLabel?: string;
};

export type ProjectSummary = {
  id: Id<"projects">;
  publicRef: string;
  organizationId: Id<"organizations">;
  organizationSlug: string;
  name: string;
  slug: string;
  identifierPrefix: string;
  compactIdentifierPrefix?: string;
  repositoryUrl?: string;
  executionMode: ExecutionMode;
  parallelExecution?: ParallelExecutionPolicy;
  archivedAt?: number;
};

export type Attachment = {
  id: Id<"attachments">;
  filename: string;
  contentType: string;
  byteSize: number;
  state: "reserved" | "uploading" | "ready" | "failed" | "deleted";
  createdAt: number;
};

export type Intake = {
  id: Id<"intakes">;
  projectId: Id<"projects">;
  text: string;
  context?: string;
  links?: string[];
  state: IntakeState;
  revision: number;
  createdBy: ActorSummary;
  claimedBy?: ActorSummary;
  claimExpiresAt?: number;
  hasOpenAttention?: boolean;
  attachmentIds: Array<Id<"attachments">>;
  linkedWorkItemIds: Array<Id<"workItems">>;
  createdAt: number;
  updatedAt: number;
};

export type Artifact = {
  id: Id<"artifacts">;
  kind: ArtifactKind;
  label: string;
  url?: string;
  repositoryPath?: string;
  createdAt: number;
};

export type ConversationEntry = {
  id: Id<"comments">;
  actor: ActorSummary;
  body: string;
  attachmentIds: Array<Id<"attachments">>;
  createdAt: number;
};

export type Attention = {
  id: Id<"attentionRequests">;
  workItemId?: Id<"workItems">;
  intakeId?: Id<"intakes">;
  kind: AttentionKind;
  title: string;
  body: string;
  important: boolean;
  options?: string[];
  requestedBy: ActorSummary;
  requestedAt: number;
  resolvedAt?: number;
  resolvedBy?: ActorSummary;
  resolutionCommentId?: Id<"comments">;
  resolution?: {
    kind: "responded" | "resolved" | "cancelled";
    body?: string;
    selectedOption?: string;
  };
};

export type Run = {
  id: Id<"runs">;
  workItemId: Id<"workItems">;
  installationActor: ActorSummary;
  externalSessionId: string;
  state: RunState;
  hostCapabilities?: HostCapabilities;
  workspace?: RunWorkspace;
  latestUpdate?: string;
  startedAt: number;
  activeUntil?: number;
  finishedAt?: number;
};

export type WorkRelationship = {
  id: Id<"workItems">;
  identifier: string;
  title: string;
  state: WorkState;
};

export type WorkItem = {
  id: Id<"workItems">;
  projectId: Id<"projects">;
  identifier: string;
  legacyIdentifiers?: string[];
  sequence: number;
  title: string;
  goal: string;
  context?: string;
  links?: string[];
  outcome?: string;
  state: WorkState;
  orderKey: string;
  revision: number;
  sourceIntakeIds: Array<Id<"intakes">>;
  parentWorkItem?: WorkRelationship;
  childWorkItems: WorkRelationship[];
  activeRun?: Run;
  openAttention?: Attention;
  artifacts: Artifact[];
  conversation: ConversationEntry[];
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
};

export type Overview = {
  project: ProjectSummary;
  needsYou: WorkItem[];
  working: WorkItem[];
  ready: WorkItem[];
  inbox: Intake[];
  recentlyDone: WorkItem[];
  serverTime: number;
};

export type ProjectUpdate = {
  id: string;
  version: number;
  kind: "intake_available";
  intakeId: string;
  priority: "normal" | "important";
  createdAt: number;
};

export type ProjectUpdates = {
  cursor: number;
  updates: ProjectUpdate[];
  hasMore: boolean;
  wait: {
    status: "updates_available" | "timed_out" | "not_requested";
    requestedSeconds: number;
    elapsedMilliseconds: number;
  };
  delivery: {
    mechanism: "bounded_pull";
    stoppedAgentsRestarted: false;
  };
  serverTime: number;
};

export type SessionStart = {
  project: ProjectSummary;
  installation: ActorSummary;
  overview: Overview;
  newlyResolvedAttention: Attention[];
  instructions: {
    executionMode: ExecutionMode;
    /** Maximum Ready work items this autonomous session may start. */
    maxStartedWorkItemsPerSession: 1;
    /** @deprecated Compatibility alias; this never limited WorkItem creation. */
    maxNewWorkItemsPerSession: 1;
    wakeUpSemantics: "next_pull";
    parallelExecution?: {
      policy: ParallelExecutionPolicy;
      hostCapabilities: HostCapabilities;
      mode: "serial" | "parallel";
      reason:
        | "project_disabled"
        | "host_unsupported"
        | "host_undisclosed"
        | "parallel_available";
    };
  };
};

export type SyncSnapshot = {
  version: 1;
  generatedAt: number;
  project: ProjectSummary;
  workItems: WorkItem[];
};

export type RunnerRegistration = {
  id: Id<"runnerRegistrations">;
  projectId: Id<"projects">;
  installationId: Id<"installations">;
  label: string;
  platform: RunnerPlatform;
  version: string;
  harnesses: RunnerHarness[];
  approvalMode: RunnerApprovalMode;
  status: RunnerRegistrationStatus;
  lastSeenAt?: number;
  waitingUntil?: number;
  createdAt: number;
  updatedAt: number;
  revokedAt?: number;
};

export type AutomaticIntakeRunnerPolicy = {
  enabled: boolean;
  revision: number;
  registrationId?: Id<"runnerRegistrations">;
  harness?: RunnerHarness;
  configuredAt?: number;
};

export type RunnerJob = {
  id: Id<"runnerJobs">;
  projectId: Id<"projects">;
  kind: RunnerJobKind;
  workItemId?: Id<"workItems">;
  workIdentifier?: string;
  intakeId?: Id<"intakes">;
  targetRegistrationId?: Id<"runnerRegistrations">;
  harness: RunnerHarness;
  state: RunnerJobState;
  revision: number;
  registrationId?: Id<"runnerRegistrations">;
  safeCode?: string;
  safeMessage?: string;
  safeSummary?: string;
  sessionReferencePresent?: boolean;
  requestedAt: number;
  expiresAt: number;
  deliveredAt?: number;
  reservationExpiresAt?: number;
  leaseExpiresAt?: number;
  cancellationRequestedAt?: number;
  terminalAt?: number;
  updatedAt: number;
};

export type RunnerWait = {
  registration: RunnerRegistration;
  job?: RunnerJob;
  wait: {
    status: "job_available" | "timed_out" | "not_requested";
    requestedSeconds: number;
    elapsedMilliseconds: number;
  };
  serverTime: number;
};
