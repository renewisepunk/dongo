export type ClosureReason = "completed" | "no_longer_relevant" | "incorrect" | "other";
export type WorkState = "needs" | "working" | "ready" | "done" | "cancelled";

export type Attention = {
  id: string;
  kind: "Decision" | "Question" | "Review" | "Blocked";
  title: string;
  body: string;
  important?: boolean;
  options?: string[];
  response?: string;
  status: "open" | "seen" | "resolved";
};

export type OwnerAttention = {
  id: string;
  intakeId?: string;
  agent?: string;
  agentType?: string;
  age?: string;
  unseen: boolean;
  attention: Attention;
};

export type Artifact = {
  kind: "commit" | "pr" | "preview" | "file" | "report";
  label: string;
  href?: string;
};

export type ConversationEntry = {
  who: string;
  when: string;
  text: string;
  human?: boolean;
  role?: "human" | "agent" | "system";
  agentType?: string;
  attachments?: AttachmentSummary[];
};

export type AttachmentSummary = {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
};

export type SourceIntakeSummary = {
  id: string;
  text: string;
  age: string;
  attachments: AttachmentSummary[];
};

export type WorkRelationshipSummary = {
  id: string;
  identifier: string;
  title: string;
  state: "ready" | "working" | "done" | "cancelled";
};

export type WorkItem = {
  id: string;
  identifier: string;
  legacyIdentifiers?: string[];
  title: string;
  state: WorkState;
  agent?: string;
  agentType?: string;
  age?: string;
  elapsed?: string;
  latest?: string;
  goal: string;
  attention?: Attention;
  artifacts?: Artifact[];
  conversation?: ConversationEntry[];
  attachments?: AttachmentSummary[];
  sources?: SourceIntakeSummary[];
  parentWork?: WorkRelationshipSummary;
  childWork?: WorkRelationshipSummary[];
  completedAt?: string;
  canonicalState?: "ready" | "working" | "done" | "cancelled";
  closureReason?: ClosureReason;
  closureNote?: string;
  closedAt?: string;
  unseen?: boolean;
  rank: number;
  revision: number;
};

export type Intake = {
  id: string;
  sourceIdeaId?: string;
  text: string;
  submittedText?: string;
  context?: string;
  links?: string[];
  revision?: number;
  editable?: boolean;
  submissionKey?: string;
  optimistic?: boolean;
  attachment?: string;
  attachments?: AttachmentSummary[];
  status: "waiting" | "triaging" | "processed" | "dismissed";
  closureReason?: ClosureReason;
  closureNote?: string;
  closedAt?: string;
  age: string;
  attachmentCount?: number;
  createdAt: number;
  linkedWorkIds?: string[];
};
