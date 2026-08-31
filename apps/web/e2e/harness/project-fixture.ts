import type {
  OverviewConnection,
  OverviewSession,
} from "../../src/features/overview/Overview";
import type { Intake, WorkItem } from "../../src/features/overview/model";
import type {
  ProjectInfo,
  ProjectOverview,
  ProjectSearchPage,
} from "../../src/lib/project-data";

const currentProject: ProjectInfo = {
  id: "project-fixture",
  name: "dongo",
  slug: "dongo",
  publicRef: "fixture-dongo",
  organizationName: "Fixture Studio",
  organizationSlug: "fixture-studio",
  organizationPlan: "paid",
  membershipRole: "owner",
  activeProjectCount: 2,
  repositoryUrl: "https://github.com/renewisepunk/dongo",
  identifierPrefix: "DONGO",
  executionMode: "manual",
};

const availableProjects: readonly ProjectInfo[] = [
  currentProject,
  {
    ...currentProject,
    id: "project-companion",
    name: "Companion",
    slug: "companion",
    publicRef: "fixture-companion",
  },
];

let work: WorkItem[] = [
  {
    id: "work-needs",
    identifier: "DONGO-7",
    title: "Approve the release candidate",
    state: "needs",
    agent: "Codex",
    age: "now",
    elapsed: "6m",
    latest: "All automated checks are green.",
    goal: "Confirm whether the verified candidate can move to staging.",
    attention: {
      id: "attention-release",
      kind: "Decision",
      title: "Choose the release path",
      body: "The candidate passed contracts, security checks, and the golden journey.",
      important: true,
      options: ["Approve staging", "Request another pass"],
      status: "open",
    },
    sources: [{
      id: "intake-release",
      text: "Prepare a trustworthy release candidate",
      age: "14m",
      attachments: [],
    }],
    artifacts: [{ kind: "report", label: "Release evidence" }],
    rank: 100,
    revision: 3,
    unseen: true,
  },
  {
    id: "work-working",
    identifier: "DONGO-8",
    title: "Harden attachment delivery",
    state: "working",
    agent: "Claude",
    elapsed: "2m",
    age: "2m",
    latest: "Testing retry and cancellation semantics.",
    goal: "Make browser uploads reliable under transient failures.",
    rank: 200,
    revision: 2,
  },
  {
    id: "work-ready-a",
    identifier: "DONGO-9",
    title: "Verify fixture search",
    state: "ready",
    age: "8m",
    goal: "Exercise fixture search and keyboard navigation.",
    rank: 300,
    revision: 1,
  },
  {
    id: "work-ready-b",
    identifier: "DONGO-10",
    title: "Audit mobile controls",
    state: "ready",
    age: "7m",
    goal: "Check mobile target sizes and overflow.",
    rank: 400,
    revision: 1,
  },
  {
    id: "work-done",
    identifier: "DONGO-6",
    title: "Complete the agent golden journey",
    state: "done",
    agent: "Codex",
    age: "1h",
    completedAt: "1h",
    latest: "Intake, Work, Attention, completion, and sync passed.",
    goal: "Prove the live agent-first workflow.",
    artifacts: [
      { kind: "file", label: "Build plan" },
      { kind: "report", label: "Release gates" },
    ],
    conversation: [{
      who: "Codex",
      role: "agent",
      agentType: "mcp",
      when: "1h",
      text: [
        "## Verification",
        "",
        "✅ **Shipped the verified path.**",
        "",
        "- `npm test` is green",
        "- [Review evidence](https://example.test/evidence)",
        "",
        "| Gate | Result |",
        "| --- | --- |",
        "| Contracts | Pass |",
        "",
        "```text",
        "231 tests passed",
        "```",
        "",
        "<img src=x onerror=alert(1)>",
      ].join("\n"),
    }],
    rank: 500,
    revision: 7,
  },
];

let intakes: Intake[] = [
  {
    id: "intake-release",
    text: "Prepare a trustworthy release candidate",
    status: "processed",
    age: "14m",
    attachmentCount: 0,
    createdAt: Date.now() - 14 * 60_000,
    linkedWorkIds: ["work-needs"],
  },
  {
    id: "intake-waiting",
    text: "Investigate the fixture login screen",
    status: "waiting",
    age: "3m",
    attachmentCount: 0,
    createdAt: Date.now() - 3 * 60_000,
  },
];

type WorkListener = (item: WorkItem) => void;
type IntakeListener = (item: Intake) => void;
const overviewListeners = new Set<(overview: ProjectOverview) => void>();
const workListeners = new Map<string, Set<WorkListener>>();
const intakeListeners = new Map<string, Set<IntakeListener>>();
const uploadAttempts = new Map<string, number>();
const uploadedAttachments = new Map<string, {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
}>();

function overview(): ProjectOverview {
  return {
    projectId: currentProject.id,
    projectName: currentProject.name,
    work: [...work],
    intakes: [...intakes],
  };
}

function emitOverview(): void {
  const value = overview();
  for (const listener of overviewListeners) listener(value);
}

function emitWork(id: string): void {
  const item = work.find((candidate) => candidate.id === id);
  if (!item) return;
  for (const listener of workListeners.get(id) ?? []) listener(item);
}

function emitIntake(id: string): void {
  const item = intakes.find((candidate) => candidate.id === id);
  if (!item) return;
  for (const listener of intakeListeners.get(id) ?? []) listener(item);
}

function updateWork(id: string, update: (item: WorkItem) => WorkItem): void {
  work = work.map((item) => item.id === id ? update(item) : item);
  emitWork(id);
  emitOverview();
}

function subscribe<T>(
  listeners: Map<string, Set<(value: T) => void>>,
  id: string,
  listener: (value: T) => void,
  initial: T | undefined,
): () => void {
  const group = listeners.get(id) ?? new Set<(value: T) => void>();
  group.add(listener);
  listeners.set(id, group);
  if (initial) queueMicrotask(() => listener(initial));
  return () => {
    group.delete(listener);
    if (group.size === 0) listeners.delete(id);
  };
}

const connection: OverviewConnection = {
  projectName: currentProject.name,
  availableProjects,
  subscribeOverview(onUpdate) {
    overviewListeners.add(onUpdate);
    queueMicrotask(() => onUpdate(overview()));
    return () => overviewListeners.delete(onUpdate);
  },
  subscribeWorkDetail(item, onUpdate) {
    return subscribe(
      workListeners,
      item.id,
      onUpdate,
      work.find((candidate) => candidate.id === item.id),
    );
  },
  subscribeWorkById(id, onUpdate) {
    return subscribe(
      workListeners,
      id,
      onUpdate,
      work.find((candidate) => candidate.id === id),
    );
  },
  subscribeIntakeDetail(id, onUpdate) {
    return subscribe(
      intakeListeners,
      id,
      onUpdate,
      intakes.find((candidate) => candidate.id === id),
    );
  },
  async searchProject(term): Promise<ProjectSearchPage> {
    const normalized = term.trim().toLowerCase();
    return {
      results: [
        ...work.filter((item) => `${item.title} ${item.goal}`.toLowerCase().includes(normalized)).map((item) => ({
          kind: "work" as const,
          id: item.id,
          targetKind: "work" as const,
          targetId: item.id,
          title: item.title,
          excerpt: item.goal,
          identifier: item.identifier,
          state: item.state,
          age: item.age ?? "now",
          createdAt: Date.now() - 1_000,
        })),
        ...intakes.filter((item) => item.text.toLowerCase().includes(normalized)).map((item) => ({
          kind: "intake" as const,
          id: item.id,
          targetKind: "intake" as const,
          targetId: item.id,
          title: "Intake",
          excerpt: item.text,
          age: item.age,
          createdAt: item.createdAt,
        })),
      ],
    };
  },
  async createIntake(text, attachmentIds, idempotencyKey) {
    const id = `intake-${idempotencyKey}`;
    const next: Intake = {
      id,
      text: text || "Attachment",
      submissionKey: idempotencyKey,
      status: "waiting",
      age: "now",
      attachmentCount: attachmentIds.length,
      attachments: attachmentIds.map((attachmentId) => ({
        id: attachmentId,
        filename: "fixture.txt",
        mimeType: "text/plain",
        byteSize: 16,
      })),
      createdAt: Date.now(),
    };
    intakes = [next, ...intakes];
    emitOverview();
    emitIntake(id);
    return { intakeId: id, revision: 1 };
  },
  async uploadAttachment(file, onProgress, signal) {
    if (signal.aborted) throw new DOMException("Upload cancelled", "AbortError");
    const attempt = (uploadAttempts.get(file.name) ?? 0) + 1;
    uploadAttempts.set(file.name, attempt);
    onProgress(42, "uploading");
    await new Promise((resolve) => setTimeout(resolve, file.name.startsWith("slow-") ? 250 : 10));
    if (signal.aborted) throw new DOMException("Upload cancelled", "AbortError");
    if (file.name.startsWith("retry-") && attempt === 1) {
      throw new Error("fixture upload interruption");
    }
    onProgress(100, "available");
    const attachmentId = `attachment-${file.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
    uploadedAttachments.set(attachmentId, {
      id: attachmentId,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      byteSize: file.size,
    });
    return attachmentId;
  },
  async discardAttachment(attachmentId) {
    uploadedAttachments.delete(attachmentId);
  },
  async downloadAttachment() {},
  async reorderWork(item, rank) {
    updateWork(item.id, (current) => ({
      ...current,
      rank,
      revision: current.revision + 1,
    }));
    work = [...work].sort((left, right) => left.rank - right.rank);
    emitOverview();
  },
  async markAttentionSeen(attentionRequestId) {
    const item = work.find((candidate) => candidate.attention?.id === attentionRequestId);
    if (item) updateWork(item.id, (current) => ({ ...current, unseen: false }));
  },
  async respondToAttention(attentionRequestId, selectedOption, body) {
    const item = work.find((candidate) => candidate.attention?.id === attentionRequestId);
    if (!item) throw new Error("fixture attention not found");
    const response = [selectedOption, body].filter(Boolean).join(" — ");
    updateWork(item.id, (current) => ({
      ...current,
      state: "ready",
      revision: current.revision + 1,
      unseen: false,
      attention: current.attention
        ? { ...current.attention, status: "resolved", response }
        : undefined,
      conversation: [
        ...(current.conversation ?? []),
        { who: "Fixture Owner", when: "now", text: response, human: true },
      ],
    }));
  },
  async resolveAttention(attentionRequestId) {
    await this.respondToAttention(attentionRequestId, undefined, "Resolved without response");
  },
  async addComment(workItemId, body, attachmentIds = []) {
    updateWork(workItemId, (current) => ({
      ...current,
      conversation: [
        ...(current.conversation ?? []),
        {
          who: "Fixture Owner",
          when: "now",
          text: body ?? "",
          human: true,
          attachments: attachmentIds.flatMap((attachmentId) => {
            const attachment = uploadedAttachments.get(attachmentId);
            return attachment ? [attachment] : [];
          }),
        },
      ],
    }));
  },
  async close() {
    overviewListeners.clear();
    workListeners.clear();
    intakeListeners.clear();
  },
};

export async function connectFixtureProject(
  orgSlug: string,
  projectSlug: string,
): Promise<OverviewConnection> {
  if (orgSlug !== currentProject.organizationSlug || projectSlug !== currentProject.slug) {
    throw new Error("Fixture project not found");
  }
  return connection;
}

export async function fixtureSession(): Promise<OverviewSession> {
  return {
    user: {
      name: "Fixture Owner",
      email: "fixture@example.test",
    },
  };
}
