import type {
  OverviewConnection,
  OverviewSession,
} from "../../src/features/overview/Overview";
import type { AttachmentSummary, Intake, WorkItem } from "../../src/features/overview/model";
import type {
  ProjectInfo,
  ProjectConcurrencySnapshot,
  ProjectOverview,
  ProjectSearchPage,
  RunnerJob,
  RunnerSnapshot,
} from "../../src/lib/project-data";
import { intakeDisplayLabel } from "../../src/lib/intake-editing";

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
  activeProjectLimit: null,
  projectCapacitySource: "plan",
  canCreateProject: true,
  repositoryUrl: "https://github.com/renewisepunk/dongo",
  identifierPrefix: "DONGO",
  executionMode: "manual",
  parallelExecution: {
    enabled: true,
    maxConcurrentRuns: 4,
    requiresIsolatedWorkspaces: true,
  },
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
    identifier: "dong007",
    legacyIdentifiers: ["DONGO-7"],
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
    identifier: "dong008",
    legacyIdentifiers: ["DONGO-8"],
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
    identifier: "dong009",
    legacyIdentifiers: ["DONGO-9"],
    title: "Verify fixture search",
    state: "ready",
    age: "8m",
    goal: "Exercise fixture search and keyboard navigation.",
    rank: 300,
    revision: 1,
  },
  {
    id: "work-ready-b",
    identifier: "dong010",
    legacyIdentifiers: ["DONGO-10"],
    title: "Audit mobile controls",
    state: "ready",
    age: "7m",
    goal: "Check mobile target sizes and overflow.",
    rank: 400,
    revision: 1,
  },
  {
    id: "work-done",
    identifier: "dong006",
    legacyIdentifiers: ["DONGO-6"],
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
    }, {
      who: "dongo CLI",
      role: "agent",
      agentType: "cli",
      when: "1h",
      text: "Historical transport-attributed update.",
    }],
    rank: 500,
    revision: 7,
  },
];

let runnerJobs: RunnerJob[] = [];
const runnerListeners = new Set<(value: RunnerSnapshot) => void>();

function runnerSnapshot(): RunnerSnapshot {
  const now = Date.now();
  return {
    registrations: [{
      id: "runner-fixture",
      projectId: currentProject.id,
      installationId: "installation-fixture",
      label: "Fixture Mac",
      platform: "darwin",
      version: "0.1.0",
      harnesses: ["codex", "claude"],
      approvalMode: "ask",
      status: "active",
      lastSeenAt: now,
      waitingUntil: now + 20_000,
      createdAt: now - 60_000,
      updatedAt: now,
    }],
    jobs: runnerJobs,
    serverTime: now,
  };
}

function emitRunners(): void {
  const snapshot = runnerSnapshot();
  for (const listener of runnerListeners) listener(snapshot);
}

let intakes: Intake[] = [
  {
    id: "intake-from-idea",
    sourceIdeaId: "idea-promoted",
    text: "Project health digest",
    submittedText: "Project health digest",
    status: "processed",
    age: "2m",
    attachmentCount: 0,
    createdAt: Date.now() - 2 * 60_000,
    linkedWorkIds: [],
    revision: 2,
    editable: false,
  },
  {
    id: "intake-release",
    text: "Prepare a trustworthy release candidate",
    status: "processed",
    age: "14m",
    attachmentCount: 0,
    createdAt: Date.now() - 14 * 60_000,
    linkedWorkIds: ["work-needs"],
    revision: 2,
    editable: false,
  },
  {
    id: "intake-waiting",
    text: "Investigate the fixture login screen",
    submittedText: "Investigate the fixture login screen",
    context: "Reproduce this from a signed-out browser.",
    links: ["https://example.test/login-report"],
    status: "waiting",
    age: "3m",
    attachmentCount: 0,
    createdAt: Date.now() - 3 * 60_000,
    revision: 1,
    editable: true,
  },
  {
    id: "intake-empty",
    text: "Untitled intake",
    status: "waiting",
    age: "now",
    attachmentCount: 0,
    createdAt: Date.UTC(2026, 8, 1),
    revision: 1,
    editable: true,
  },
  {
    id: "intake-attachment-only",
    text: "capture.png",
    status: "waiting",
    age: "now",
    attachment: "capture.png",
    attachments: [{
      id: "attachment-existing-capture",
      filename: "capture.png",
      mimeType: "image/png",
      byteSize: 256,
    }],
    attachmentCount: 1,
    createdAt: Date.UTC(2026, 8, 1),
    revision: 1,
    editable: true,
  },
];

type WorkListener = (item: WorkItem) => void;
type IntakeListener = (item: Intake) => void;
const overviewListeners = new Set<(overview: ProjectOverview) => void>();
const workListeners = new Map<string, Set<WorkListener>>();
const intakeListeners = new Map<string, Set<IntakeListener>>();
let fixtureIntakeConflictRaised = false;
const uploadAttempts = new Map<string, number>();
const uploadedAttachments = new Map<string, {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  blob: Blob;
}>();

function fixtureScenario(): string | null {
  return new URLSearchParams(window.location.search).get("scenario");
}

function attachmentSummary(attachmentId: string): AttachmentSummary | undefined {
  const attachment = uploadedAttachments.get(attachmentId);
  if (!attachment) return undefined;
  const { blob: _blob, ...summary } = attachment;
  return summary;
}

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
  subscribeConcurrency(onUpdate, onError) {
    if (fixtureScenario() === "concurrency-error") {
      queueMicrotask(() => onError(new Error("fixture concurrency detail must stay hidden")));
      return () => undefined;
    }
    const hasVisibleRuns = () =>
      fixtureScenario() === "concurrency-live" ||
      fixtureScenario() === "concurrency-undisclosed";
    const snapshot = (
      latestProgress: string,
      visibleRuns = hasVisibleRuns(),
    ): ProjectConcurrencySnapshot => ({
      serverTime: Date.now(),
      policy: {
        enabled: true,
        maxConcurrentRuns: 4,
        requiresIsolatedWorkspaces: true,
      },
      capacity: {
        activeRuns: visibleRuns ? 1 : 0,
        maxConcurrentRuns: 4,
        remaining: visibleRuns ? 3 : 4,
      },
      runs: visibleRuns ? [
        {
          id: "run-attachments",
          workItem: {
            id: "work-working",
            identifier: "dong008",
            title: "Harden attachment delivery",
          },
          actor: { _id: "actor-claude", type: "agent", name: "Claude", agentType: "Claude Code" },
          state: "running",
          latestProgress,
          startedAt: Date.now() - 122_000,
          lastHeartbeatAt: Date.now() - 2_000,
          elapsedMilliseconds: 122_000,
          lease: { status: "healthy", expiresAt: Date.now() + 28_000 },
          hostCapabilities: {
            parallelExecution: "supported",
            worktreeIsolation: "supported",
          },
          workspace: {
            kind: "worktree",
            worktreeName: "attachments",
            branch: "codex/attachment-delivery",
          },
        },
        {
          id: "run-release",
          workItem: {
            id: "work-needs",
            identifier: "dong007",
            title: "Approve the release candidate",
          },
          actor: { _id: "actor-codex", type: "agent", name: "Codex", agentType: "Codex" },
          state: "waiting",
          latestProgress: "Waiting for the release decision.",
          startedAt: Date.now() - 362_000,
          lastHeartbeatAt: Date.now() - 8_000,
          elapsedMilliseconds: 362_000,
          lease: { status: "released" },
          hostCapabilities: {
            parallelExecution: fixtureScenario() === "concurrency-undisclosed"
              ? "undisclosed"
              : "supported",
            worktreeIsolation: fixtureScenario() === "concurrency-undisclosed"
              ? "undisclosed"
              : "supported",
          },
          workspace: { kind: "undisclosed" },
        },
      ] : [],
    });
    queueMicrotask(() => onUpdate(snapshot("Testing retry and cancellation semantics.")));
    if (fixtureScenario() === "concurrency-live") {
      const timer = window.setTimeout(() => {
        onUpdate(snapshot("Live progress: retry cancellation verified."));
      }, 650);
      return () => window.clearTimeout(timer);
    }
    if (fixtureScenario() === "concurrency-transition") {
      const publishRun = () =>
        onUpdate(snapshot("Live progress: focus handoff verified.", true));
      window.addEventListener("dongo:test:publish-concurrency", publishRun);
      return () =>
        window.removeEventListener("dongo:test:publish-concurrency", publishRun);
    }
    return () => undefined;
  },
  subscribeRunners(onUpdate) {
    runnerListeners.add(onUpdate);
    queueMicrotask(() => onUpdate(runnerSnapshot()));
    return () => runnerListeners.delete(onUpdate);
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
  subscribeWorkByIdentifier(identifier, onUpdate) {
    const item = work.find((candidate) =>
      candidate.identifier === identifier || candidate.legacyIdentifiers?.includes(identifier),
    );
    return subscribe(
      workListeners,
      item?.id ?? identifier,
      onUpdate,
      item,
    );
  },
  subscribeIntakeDetail(id, onUpdate) {
    const unsubscribe = subscribe(
      intakeListeners,
      id,
      onUpdate,
      intakes.find((candidate) => candidate.id === id),
    );
    if (fixtureScenario() === "intake-edit-live" && id === "intake-waiting") {
      const timer = window.setTimeout(() => {
        intakes = intakes.map((item) => item.id === id ? {
          ...item,
          context: "Live context added from another browser.",
          revision: (item.revision ?? 1) + 1,
        } : item);
        emitIntake(id);
        emitOverview();
      }, 500);
      return () => {
        window.clearTimeout(timer);
        unsubscribe();
      };
    }
    return unsubscribe;
  },
  async searchProject(term): Promise<ProjectSearchPage> {
    const normalized = term.trim().toLowerCase();
    return {
      results: [
        ...work.filter((item) =>
          `${item.identifier} ${item.legacyIdentifiers?.join(" ") ?? ""} ${item.title} ${item.goal}`
            .toLowerCase()
            .includes(normalized)
        ).map((item) => ({
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
        ...intakes.filter((item) =>
          `${item.submittedText ?? ""} ${item.attachments?.map((attachment) => attachment.filename).join(" ") ?? ""} ${item.text}`
            .toLowerCase()
            .includes(normalized)
        ).map((item) => ({
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
      attachments: attachmentIds.flatMap((attachmentId) => {
        const attachment = attachmentSummary(attachmentId);
        return attachment ? [attachment] : [];
      }),
      createdAt: Date.now(),
      revision: 1,
      editable: true,
    };
    intakes = [next, ...intakes];
    emitOverview();
    emitIntake(id);
    return { intakeId: id, revision: 1 };
  },
  async createChildWork(parentWorkItemId, title, goal) {
    const parent = work.find((candidate) => candidate.id === parentWorkItemId);
    if (!parent || parent.parentWork || parent.state === "done") {
      throw Object.assign(new Error("invalid_transition"), {
        data: { code: "invalid_transition" },
      });
    }
    if ((parent.childWork?.length ?? 0) >= 100) {
      throw Object.assign(new Error("quota_exceeded"), {
        data: { code: "quota_exceeded", details: { maxChildren: 100 } },
      });
    }
    const sequence = 11 + (parent.childWork?.length ?? 0);
    const child: WorkItem = {
      id: `work-subtask-${sequence}`,
      identifier: `dong${sequence.toString().padStart(3, "0")}`,
      title,
      state: "ready",
      age: "now",
      goal: goal || title,
      rank: parent.rank + sequence,
      revision: 1,
      parentWork: {
        id: parent.id,
        identifier: parent.identifier,
        title: parent.title,
        state: parent.state === "needs" ? "working" : parent.state,
      },
      childWork: [],
    };
    work = [
      ...work.map((candidate) => candidate.id === parent.id
        ? {
            ...candidate,
            childWork: [
              ...(candidate.childWork ?? []),
              {
                id: child.id,
                identifier: child.identifier,
                title: child.title,
                state: "ready" as const,
              },
            ],
          }
        : candidate),
      child,
    ];
    emitWork(parent.id);
    emitWork(child.id);
    emitOverview();
    document.documentElement.dataset.fixtureCreatedSubtask = JSON.stringify({
      parentWorkItemId,
      title,
      goal,
    });
    return { workItemId: child.id };
  },
  async updateIntake(input) {
    const item = intakes.find((candidate) => candidate.id === input.intakeId);
    if (!item) throw new Error("fixture Intake unavailable");
    if (!item.editable) {
      throw Object.assign(new Error("invalid_transition"), { data: { code: "invalid_transition" } });
    }
    if (fixtureScenario() === "intake-edit-conflict" && !fixtureIntakeConflictRaised) {
      fixtureIntakeConflictRaised = true;
      intakes = intakes.map((candidate) => candidate.id === item.id ? {
        ...candidate,
        context: "Latest context saved from another browser.",
        revision: (candidate.revision ?? 1) + 1,
      } : candidate);
      emitIntake(item.id);
      emitOverview();
      throw Object.assign(new Error("revision_conflict"), {
        data: {
          code: "revision_conflict",
          details: { expectedRevision: input.expectedRevision, currentRevision: (item.revision ?? 1) + 1 },
        },
      });
    }
    if (input.expectedRevision !== (item.revision ?? 1)) {
      throw Object.assign(new Error("revision_conflict"), { data: { code: "revision_conflict" } });
    }
    if (fixtureScenario() === "intake-edit-processed-race") {
      intakes = intakes.map((candidate) => candidate.id === item.id ? {
        ...candidate,
        status: "processed",
        editable: false,
        revision: (candidate.revision ?? 1) + 1,
      } : candidate);
      emitIntake(item.id);
      emitOverview();
      throw Object.assign(new Error("invalid_transition"), { data: { code: "invalid_transition" } });
    }
    if (fixtureScenario() === "intake-edit-error") throw new Error("fixture Intake edit detail must stay hidden");
    const added = (input.addAttachmentIds ?? []).flatMap((attachmentId) => {
      const attachment = attachmentSummary(attachmentId);
      return attachment ? [attachment] : [];
    });
    const nextRevision = (item.revision ?? 1) + 1;
    intakes = intakes.map((candidate) => candidate.id === item.id ? {
      ...candidate,
      submittedText: input.text,
      text: intakeDisplayLabel(
        input.text,
        [...(candidate.attachments ?? []), ...added],
      ),
      context: input.context,
      links: input.links ?? [],
      attachments: [...(candidate.attachments ?? []), ...added],
      attachment: candidate.attachments?.[0]?.filename ?? added[0]?.filename,
      attachmentCount: (candidate.attachments?.length ?? 0) + added.length,
      revision: nextRevision,
    } : candidate);
    emitIntake(item.id);
    emitOverview();
    document.documentElement.dataset.fixtureIntakeEdit = JSON.stringify(input);
    return {
      intakeId: item.id,
      revision: nextRevision,
      updatedAt: Date.now(),
      addedAttachmentIds: added.map((attachment) => attachment.id),
    };
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
      blob: file.slice(0, file.size, file.type || "application/octet-stream"),
    });
    return attachmentId;
  },
  async discardAttachment(attachmentId) {
    uploadedAttachments.delete(attachmentId);
  },
  async downloadAttachment() {},
  async loadAttachmentPreview(attachment, signal) {
    if (signal?.aborted) throw new DOMException("Preview cancelled", "AbortError");
    const uploaded = uploadedAttachments.get(attachment.id);
    if (!uploaded) throw new Error("fixture attachment not found");
    return uploaded.blob.slice(0, uploaded.blob.size, uploaded.mimeType);
  },
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
    if (fixtureScenario() === "attention-conflict") {
      updateWork(item.id, (current) => ({
        ...current,
        state: "working",
        revision: current.revision + 1,
        latest: "The agent resolved this request while your response was open.",
        attention: current.attention
          ? {
              ...current.attention,
              status: "resolved",
              response: "The agent continued with the safe default.",
            }
          : undefined,
      }));
      throw new Error("revision_conflict");
    }
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
            const attachment = attachmentSummary(attachmentId);
            return attachment ? [attachment] : [];
          }),
        },
      ],
    }));
  },
  async enqueueRunnerJob(workItemId, harness) {
    const item = work.find((candidate) => candidate.id === workItemId);
    if (!item || item.state !== "ready") throw new Error("invalid_transition");
    const now = Date.now();
    const job: RunnerJob = {
      id: `runner-job-${runnerJobs.length + 1}`,
      projectId: currentProject.id,
      workItemId,
      workIdentifier: item.identifier,
      harness,
      state: "queued",
      revision: 1,
      requestedAt: now,
      expiresAt: now + 86_400_000,
      updatedAt: now,
    };
    runnerJobs = [job, ...runnerJobs];
    emitRunners();
    return job;
  },
  async cancelRunnerJob(job) {
    const existing = runnerJobs.find((candidate) => candidate.id === job.id);
    if (!existing || existing.revision !== job.revision) throw new Error("revision_conflict");
    const cancelled: RunnerJob = { ...existing, state: "cancelled", revision: existing.revision + 1, updatedAt: Date.now(), terminalAt: Date.now() };
    runnerJobs = runnerJobs.map((candidate) => candidate.id === job.id ? cancelled : candidate);
    emitRunners();
    return cancelled;
  },
  async close() {
    overviewListeners.clear();
    workListeners.clear();
    intakeListeners.clear();
    runnerListeners.clear();
  },
};

export async function connectFixtureProject(
  orgSlug: string,
  projectSlug: string,
): Promise<OverviewConnection> {
  if (orgSlug !== currentProject.organizationSlug || projectSlug !== currentProject.slug) {
    throw new Error("Fixture project not found");
  }
  if (fixtureScenario() === "live-agent-update") {
    window.setTimeout(() => {
      updateWork("work-working", (current) => ({
        ...current,
        revision: current.revision + 1,
        agent: "dongo CLI",
        latest: "Agent update arrived over the live project subscription.",
        elapsed: "now",
      }));
    }, 600);
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
