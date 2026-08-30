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
};

export type WorkItem = {
  id: string;
  identifier: string;
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
  completedAt?: string;
  unseen?: boolean;
  rank: number;
  revision: number;
};

export type Intake = {
  id: string;
  text: string;
  attachment?: string;
  status: "waiting" | "triaging" | "processed";
  age: string;
  attachmentCount?: number;
  createdAt: number;
  linkedWorkIds?: string[];
};
