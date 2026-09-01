import type { IdeasConnection } from "../../src/features/ideas/Ideas";
import type { AttachmentSummary } from "../../src/features/overview/model";
import type { IdeaDetail, IdeaSummary } from "../../src/lib/project-data";

const fixtureHuman = { _id: "actor-owner", type: "human" as const, name: "Fixture Owner" };
const now = Date.UTC(2026, 8, 1, 12);

let ideas: IdeaSummary[] = [
  {
    _id: "idea-editorial",
    projectId: "project-fixture",
    title: "Editorial release notes",
    text: "Explore a quieter, narrative release format.",
    context: "Keep it useful for people outside the repository.",
    links: ["https://example.test/release-notes"],
    state: "open",
    position: 1024,
    revision: 1,
    createdBy: fixtureHuman,
    updatedBy: fixtureHuman,
    attachmentCount: 1,
    createdAt: now - 20_000,
    updatedAt: now - 10_000,
  },
  {
    _id: "idea-offline",
    projectId: "project-fixture",
    title: "Offline field notes",
    text: "Collect thoughts during travel, then synchronize later.",
    state: "open",
    position: 2048,
    revision: 2,
    createdBy: fixtureHuman,
    updatedBy: fixtureHuman,
    attachmentCount: 0,
    createdAt: now - 16_000,
    updatedAt: now - 8_000,
  },
  {
    _id: "idea-archived",
    projectId: "project-fixture",
    title: "Ambient project soundtrack",
    text: "An experiment for another season.",
    state: "archived",
    position: 3072,
    revision: 3,
    createdBy: fixtureHuman,
    updatedBy: fixtureHuman,
    attachmentCount: 0,
    archivedAt: now - 4_000,
    createdAt: now - 30_000,
    updatedAt: now - 4_000,
  },
  {
    _id: "idea-promoted",
    projectId: "project-fixture",
    title: "Project health digest",
    text: "Summarize the signals that need a human decision.",
    state: "promoted",
    position: 4096,
    revision: 4,
    createdBy: fixtureHuman,
    updatedBy: fixtureHuman,
    attachmentCount: 0,
    promotedAt: now - 2_000,
    promotedIntakeId: "intake-from-idea",
    createdAt: now - 40_000,
    updatedAt: now - 2_000,
  },
];

const ideaAttachments = new Map<string, AttachmentSummary[]>([[
  "idea-editorial",
  [{ id: "attachment-moodboard", filename: "release-moodboard.png", mimeType: "image/png", byteSize: 2048 }],
]]);
const uploadedAttachments = new Map<string, AttachmentSummary>();
const listListeners = new Set<(ideas: IdeaSummary[]) => void>();
const detailListeners = new Map<string, Set<(idea: IdeaDetail) => void>>();
let conflictRaised = false;
let promotionIntakeId = "intake-from-new-promotion";

function scenario(): string | null {
  return new URLSearchParams(window.location.search).get("scenario");
}

function detail(ideaId: string): IdeaDetail | undefined {
  const idea = ideas.find((candidate) => candidate._id === ideaId);
  return idea ? { ...idea, attachments: [...(ideaAttachments.get(ideaId) ?? [])] } : undefined;
}

function emit(): void {
  const snapshot = structuredClone(ideas);
  for (const listener of listListeners) listener(snapshot);
}

function emitDetail(ideaId: string): void {
  const value = detail(ideaId);
  if (!value) return;
  for (const listener of detailListeners.get(ideaId) ?? []) listener(structuredClone(value));
}

function updateIdea(ideaId: string, update: (idea: IdeaSummary) => IdeaSummary): IdeaSummary {
  ideas = ideas.map((idea) => idea._id === ideaId ? update(idea) : idea);
  const next = ideas.find((idea) => idea._id === ideaId)!;
  emit();
  emitDetail(ideaId);
  return next;
}

export async function connectFixtureIdeas(orgSlug: string, projectSlug: string): Promise<IdeasConnection> {
  document.documentElement.dataset.fixtureIdeasTarget = `${orgSlug}/${projectSlug}`;
  if (scenario() === "ideas-connect-error") throw new Error("fixture Ideas connection detail must stay hidden");
  return {
    projectId: "project-fixture",
    projectName: "dongo",
    subscribeIdeas(_state, onUpdate, onError) {
      if (scenario() === "ideas-subscription-error") {
        queueMicrotask(() => onError(new Error("fixture Ideas subscription detail must stay hidden")));
        return () => undefined;
      }
      listListeners.add(onUpdate);
      queueMicrotask(() => onUpdate(structuredClone(ideas)));
      return () => listListeners.delete(onUpdate);
    },
    subscribeIdeaDetail(ideaId, onUpdate, onError) {
      const current = detail(ideaId);
      if (!current) {
        queueMicrotask(() => onError(new Error("fixture Idea unavailable")));
        return () => undefined;
      }
      const listeners = detailListeners.get(ideaId) ?? new Set();
      listeners.add(onUpdate);
      detailListeners.set(ideaId, listeners);
      queueMicrotask(() => onUpdate(structuredClone(current)));
      let timer: number | undefined;
      if (scenario() === "ideas-live" && ideaId === "idea-editorial") {
        timer = window.setTimeout(() => {
          updateIdea(ideaId, (idea) => ({ ...idea, context: "Live context from another browser.", revision: idea.revision + 1, updatedAt: Date.now() }));
        }, 650);
      }
      return () => {
        if (timer) window.clearTimeout(timer);
        listeners.delete(onUpdate);
      };
    },
    async createIdea(input) {
      const ideaId = `idea-created-${ideas.length}`;
      const created: IdeaSummary = {
        _id: ideaId,
        projectId: "project-fixture",
        title: input.title,
        text: input.text,
        context: input.context,
        links: input.links,
        state: "open",
        position: input.position ?? Math.max(0, ...ideas.filter((idea) => idea.state === "open").map((idea) => idea.position)) + 1024,
        revision: 1,
        createdBy: fixtureHuman,
        updatedBy: fixtureHuman,
        attachmentCount: input.attachmentIds?.length ?? 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      ideas = [...ideas, created];
      if (input.attachmentIds?.length) {
        ideaAttachments.set(ideaId, input.attachmentIds.flatMap((id) => {
          const attachment = uploadedAttachments.get(id);
          return attachment ? [attachment] : [];
        }));
      }
      document.documentElement.dataset.fixtureIdeaCreated = JSON.stringify(input);
      emit();
      return { ideaId, revision: 1, created: true };
    },
    async updateIdea(input) {
      const current = ideas.find((idea) => idea._id === input.ideaId);
      if (!current) throw new Error("not_found");
      if (scenario() === "ideas-conflict" && !conflictRaised) {
        conflictRaised = true;
        updateIdea(input.ideaId, (idea) => ({ ...idea, context: "Latest context from another browser.", revision: idea.revision + 1, updatedAt: Date.now() }));
        throw Object.assign(new Error("revision_conflict"), { data: { code: "revision_conflict" } });
      }
      if (input.expectedRevision !== current.revision) throw Object.assign(new Error("revision_conflict"), { data: { code: "revision_conflict" } });
      const additions = (input.addAttachmentIds ?? []).flatMap((id) => {
        const attachment = uploadedAttachments.get(id);
        return attachment ? [attachment] : [];
      });
      if (additions.length) ideaAttachments.set(input.ideaId, [...(ideaAttachments.get(input.ideaId) ?? []), ...additions]);
      const next = updateIdea(input.ideaId, (idea) => ({
        ...idea,
        title: input.title ?? idea.title,
        text: input.text ?? idea.text,
        context: input.context ?? idea.context,
        links: input.links ?? idea.links,
        attachmentCount: idea.attachmentCount + additions.length,
        revision: idea.revision + 1,
        updatedAt: Date.now(),
      }));
      document.documentElement.dataset.fixtureIdeaUpdated = JSON.stringify(input);
      return { ideaId: next._id, revision: next.revision };
    },
    async reorderIdeas(ordered) {
      ideas = ideas.map((idea) => {
        const index = ordered.findIndex((candidate) => candidate._id === idea._id);
        return index < 0 ? idea : { ...idea, position: (index + 1) * 1024, revision: idea.revision + 1 };
      });
      document.documentElement.dataset.fixtureIdeaOrder = ordered.map((idea) => idea._id).join(",");
      emit();
      for (const idea of ordered) emitDetail(idea._id);
      return { ideas: ordered.map((idea, index) => ({ ideaId: idea._id, revision: idea.revision + 1, position: (index + 1) * 1024 })) };
    },
    async archiveIdea(ideaId, expectedRevision) {
      const current = ideas.find((idea) => idea._id === ideaId)!;
      if (current.revision !== expectedRevision) throw Object.assign(new Error("revision_conflict"), { data: { code: "revision_conflict" } });
      const next = updateIdea(ideaId, (idea) => ({ ...idea, state: "archived", archivedAt: Date.now(), revision: idea.revision + 1, updatedAt: Date.now() }));
      return { ideaId, revision: next.revision };
    },
    async restoreIdea(ideaId, expectedRevision) {
      const current = ideas.find((idea) => idea._id === ideaId)!;
      if (current.revision !== expectedRevision) throw Object.assign(new Error("revision_conflict"), { data: { code: "revision_conflict" } });
      const next = updateIdea(ideaId, (idea) => ({ ...idea, state: "open", archivedAt: undefined, revision: idea.revision + 1, updatedAt: Date.now() }));
      return { ideaId, revision: next.revision };
    },
    async promoteIdea(ideaId, expectedRevision) {
      const current = ideas.find((idea) => idea._id === ideaId)!;
      if (current.state === "promoted") return { ideaId, intakeId: current.promotedIntakeId!, revision: current.revision, created: false };
      if (current.revision !== expectedRevision) throw Object.assign(new Error("revision_conflict"), { data: { code: "revision_conflict" } });
      const created = scenario() !== "ideas-promotion-existing";
      const next = updateIdea(ideaId, (idea) => ({ ...idea, state: "promoted", promotedAt: Date.now(), promotedIntakeId: promotionIntakeId, revision: idea.revision + 1, updatedAt: Date.now() }));
      document.documentElement.dataset.fixtureIdeaPromotions = String(Number(document.documentElement.dataset.fixtureIdeaPromotions ?? "0") + (created ? 1 : 0));
      return { ideaId, intakeId: promotionIntakeId, revision: next.revision, created };
    },
    async uploadAttachment(file, onProgress, signal) {
      if (signal.aborted) throw new DOMException("Upload cancelled", "AbortError");
      onProgress(20, "reserving");
      await new Promise((resolve) => window.setTimeout(resolve, 25));
      onProgress(70, "uploading");
      const id = `idea-upload-${file.name}`;
      uploadedAttachments.set(id, { id, filename: file.name, mimeType: file.type || "application/octet-stream", byteSize: file.size });
      onProgress(100, "available");
      return id;
    },
    async discardAttachment(attachmentId) {
      uploadedAttachments.delete(attachmentId);
    },
    async downloadAttachment(attachmentId) {
      document.documentElement.dataset.fixtureIdeaDownloaded = attachmentId;
    },
    async close() {
      document.documentElement.dataset.fixtureIdeasClosed = "true";
    },
  };
}
