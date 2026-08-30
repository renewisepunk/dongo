export type WorkState = "needs" | "working" | "ready" | "done";

export type Attention = {
  kind: "Decision" | "Question" | "Review" | "Blocked";
  title: string;
  body: string;
  important?: boolean;
  options?: string[];
  response?: string;
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
};

export type Intake = {
  id: string;
  text: string;
  attachment?: string;
  status: "waiting" | "triaging" | "processed";
  age: string;
  linkedWorkIds?: string[];
};

export const initialWork: WorkItem[] = [
  {
    id: "work-attention",
    identifier: "DON-143",
    title: "Unblock checkout session migration",
    state: "needs",
    agent: "Claude Code",
    age: "12m",
    unseen: true,
    goal: "Prevent checkout sessions from stalling while preserving existing carts during the migration.",
    latest: "The fallback path is implemented. The remaining choice changes how old sessions are migrated.",
    attention: {
      kind: "Decision",
      title: "Choose how to migrate active checkout sessions",
      body: "I can preserve every active session with a short dual-write period, or switch immediately and invalidate sessions older than 24 hours.",
      important: true,
      options: ["Use a 48-hour dual-write period", "Switch immediately and expire old sessions"],
    },
    artifacts: [{ kind: "pr", label: "#184 · checkout session recovery" }],
    conversation: [
      { who: "Claude Code", when: "18m", text: "I reproduced the stall and isolated it to the legacy session handoff." },
    ],
  },
  {
    id: "work-running",
    identifier: "DON-144",
    title: "Add upload recovery for interrupted screen recordings",
    state: "working",
    agent: "Codex",
    elapsed: "active 8m",
    latest: "Multipart resume tests are passing; checking quota reconciliation next.",
    goal: "Allow a large attachment upload to resume safely after an ordinary network interruption.",
    artifacts: [{ kind: "commit", label: "8c4d11f · multipart checkpoint store" }],
    conversation: [],
  },
  {
    id: "work-ready-1",
    identifier: "DON-145",
    title: "Show truthful expired agent sessions",
    state: "ready",
    goal: "Never present a stopped agent or expired execution lease as active work.",
    conversation: [],
  },
  {
    id: "work-ready-2",
    identifier: "DON-146",
    title: "Render typed deployment artifacts",
    state: "ready",
    goal: "Make preview and deployment artifacts easy to distinguish and open safely.",
    conversation: [],
  },
  {
    id: "work-done",
    identifier: "DON-142",
    title: "Make Intake submission idempotent",
    state: "done",
    agent: "Codex",
    completedAt: "34m",
    goal: "Prevent duplicate Intake when a successful mutation response is lost and retried.",
    latest: "Added client mutation IDs and canonical reconciliation.",
    artifacts: [
      { kind: "commit", label: "e129a88 · idempotent Intake mutation" },
      { kind: "report", label: "retry matrix" },
    ],
    conversation: [
      { who: "Codex", when: "41m", text: "The response-loss fixture now produces exactly one Intake." },
    ],
  },
];

export const initialIntakes: Intake[] = [
  {
    id: "intake-1",
    text: "Checkout gets stuck here after returning from the payment provider.",
    attachment: "checkout-stall.mov",
    status: "processed",
    age: "22m",
    linkedWorkIds: ["work-attention", "work-ready-1"],
  },
];
