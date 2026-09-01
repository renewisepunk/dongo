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
  workItemId: Id<"workItems">;
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
