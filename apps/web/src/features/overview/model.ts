export type WorkState = "needs" | "working" | "ready" | "done";

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

export type WorkItem = {
  id: string;
  identifier: string;
  legacyIdentifiers?: string[];
  title: string;
  state: WorkState;
  agent?: string;
  age?: string;
  elapsed?: string;
  latest?: string;
  goal: string;
  attention?: Attention;
  artifacts?: Artifact[];
  conversation?: ConversationEntry[];
  attachments?: AttachmentSummary[];
  sources?: SourceIntakeSummary[];
  completedAt?: string;
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
  status: "waiting" | "triaging" | "processed";
  age: string;
  attachmentCount?: number;
  createdAt: number;
  linkedWorkIds?: string[];
};
