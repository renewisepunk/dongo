import { ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

import type {
  Artifact,
  Attention,
  ConversationEntry,
  Intake,
  WorkItem,
} from "../features/overview/model";
import { convexAccessToken } from "./auth-client";
import { convexDeploymentUrl } from "./auth-config";

type ProjectGroup = {
  membership: { organizationId: string; role: "owner" | "member" };
  organization: { _id: string; name: string; slug: string } | null;
  projects: Array<{
    _id: string;
    publicRef: string;
    name: string;
    slug: string;
    repositoryUrl?: string;
    executionMode: "manual" | "autonomous";
    archivedAt?: number;
  }>;
};

export type ProjectInfo = {
  id: string;
  name: string;
  slug: string;
  publicRef: string;
  organizationName: string;
  organizationSlug: string;
  membershipRole: "owner" | "member";
  activeProjectCount: number;
  repositoryUrl?: string;
  executionMode: "manual" | "autonomous";
};

export type ProjectInstallation = {
  id: string;
  kind: "cli" | "mcp" | "service" | "development";
  status: "pending" | "active" | "needs_reauth" | "revoked";
  clientId: string;
  label: string;
  machineLabel?: string;
  scopes: string[];
  createdAt: number;
  lastUsedAt?: number;
};

type WorkDoc = {
  _id: string;
  identifier: string;
  title: string;
  description?: string;
  state: "ready" | "working" | "done" | "cancelled";
  rank: number;
  revision: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
};

type ActorDoc = {
  _id: string;
  type: "human" | "agent" | "system";
  name: string;
};

type RunDoc = {
  _id: string;
  actorId: string;
  status: "running" | "waiting" | "completed" | "failed" | "cancelled";
  summary?: string;
  startedAt: number;
  lastHeartbeatAt: number;
  finishedAt?: number;
};

type AttentionDoc = {
  _id: string;
  requestedByActorId: string;
  kind: "review" | "decision" | "question" | "blocked";
  title: string;
  body?: string;
  options?: string[];
  urgency: "normal" | "important";
  status: "open" | "seen" | "resolved";
  createdAt: number;
  selectedOption?: string;
  resolutionCommentId?: string;
  resolutionKind?: "responded" | "resolved" | "cancelled";
};

type IntakeDoc = {
  _id: string;
  clientRequestId?: string;
  text?: string;
  status: "new" | "claimed" | "processed" | "dismissed";
  createdAt: number;
};

type AttachmentDoc = {
  _id: string;
  filename: string;
};

type CommentDoc = {
  _id: string;
  actorId: string;
  body: string;
  createdAt: number;
};

type ArtifactDoc = {
  _id: string;
  actorId: string;
  type: "commit" | "pull_request" | "deployment" | "preview" | "url" | "image" | "file" | "report";
  title: string;
  url?: string;
  createdAt: number;
};

export type OverviewSnapshot = {
  project: { _id: string; name: string; publicRef: string };
  generatedAt: number;
  needsYou: Array<{ request: AttentionDoc; work: WorkDoc | null; actor?: ActorDoc | null }>;
  working: Array<{ work: WorkDoc; run: RunDoc | null; actor: ActorDoc | null }>;
  ready: Array<{ work: WorkDoc; effectiveState: "ready"; staleClaim: boolean }>;
  inbox: Array<{ intake: IntakeDoc; attachments: AttachmentDoc[] }>;
  recentlyDone: WorkDoc[];
};

type WorkDetailSnapshot = {
  work: WorkDoc;
  runs: RunDoc[];
  comments: CommentDoc[];
  artifacts: ArtifactDoc[];
  attention: AttentionDoc[];
  actors: ActorDoc[];
};

export type ProjectOverview = {
  projectId: string;
  projectName: string;
  work: WorkItem[];
  intakes: Intake[];
};

const listProjectsReference = makeFunctionReference<"query", Record<string, never>, ProjectGroup[]>(
  "domains/projects/index:listMine",
);
const overviewReference = makeFunctionReference<"query", { projectId: string }, OverviewSnapshot>(
  "domains/overview/index:getForHuman",
);
const workDetailReference = makeFunctionReference<"query", { workItemId: string }, WorkDetailSnapshot>(
  "domains/work/index:getDetailForHuman",
);
const createIntakeReference = makeFunctionReference<
  "mutation",
  { projectId: string; text?: string; attachmentIds: string[]; idempotencyKey: string },
  { intakeId: string; revision: number }
>("domains/intake/index:create");
const reorderWorkReference = makeFunctionReference<
  "mutation",
  { workItemId: string; expectedRevision: number; rank: number; idempotencyKey: string },
  { revision: number; rank: number }
>("domains/work/index:reorder");
const markAttentionSeenReference = makeFunctionReference<
  "mutation",
  { attentionRequestId: string },
  { status: string }
>("domains/attention/index:markSeen");
const respondAttentionReference = makeFunctionReference<
  "mutation",
  { attentionRequestId: string; body?: string; selectedOption?: string; idempotencyKey: string },
  { attentionRequestId: string; commentId: string; status: "resolved" }
>("domains/attention/index:respond");
const resolveAttentionReference = makeFunctionReference<
  "mutation",
  { attentionRequestId: string; idempotencyKey: string },
  { attentionRequestId: string; status: "resolved" }
>("domains/attention/index:resolveWithoutResponse");
const addCommentReference = makeFunctionReference<
  "mutation",
  { workItemId: string; body: string; idempotencyKey: string },
  { commentId: string }
>("domains/comments/index:createForHuman");
const listInstallationsReference = makeFunctionReference<
  "query",
  { projectId: string },
  Array<{
    _id: string;
    kind: ProjectInstallation["kind"];
    status: ProjectInstallation["status"];
    clientId: string;
    label: string;
    machineLabel?: string;
    scopes: string[];
    createdAt: number;
    lastUsedAt?: number;
  }>
>("domains/installations/index:listForProject");
const revokeInstallationReference = makeFunctionReference<
  "mutation",
  { installationId: string },
  { revoked: true }
>("domains/installations/index:revoke");
const archiveProjectReference = makeFunctionReference<
  "mutation",
  { projectId: string },
  { archived: true }
>("domains/projects/index:archiveProject");
const reserveUploadReference = makeFunctionReference<
  "action",
  {
    projectId: string;
    filename: string;
    mimeType: string;
    byteSize: number;
    idempotencyKey: string;
  },
  {
    attachmentId: string;
    expiresAt: number;
    maximumBytes: number;
    uploadUrl: string;
    method: "PUT";
    requiredHeaders: Record<string, string>;
  }
>("domains/attachments/actions:reserveUpload");
const discardUploadReference = makeFunctionReference<
  "action",
  { attachmentId: string },
  { attachmentId: string; deleted: true }
>("domains/attachments/actions:discardUpload");

function relativeTime(timestamp: number | undefined, now: number): string | undefined {
  if (timestamp === undefined) return undefined;
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1_000));
  if (seconds < 10) return "now";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function attentionKind(kind: AttentionDoc["kind"]): Attention["kind"] {
  return `${kind[0]!.toUpperCase()}${kind.slice(1)}` as Attention["kind"];
}

function baseWork(work: WorkDoc, state: WorkItem["state"], now: number): WorkItem {
  return {
    id: work._id,
    identifier: work.identifier,
    title: work.title,
    state,
    goal: work.description || work.title,
    age: relativeTime(work.updatedAt, now),
    rank: work.rank,
    revision: work.revision,
    completedAt: relativeTime(work.completedAt, now),
    artifacts: [],
    conversation: [],
  };
}

export function mapOverviewSnapshot(snapshot: OverviewSnapshot): ProjectOverview {
  const now = snapshot.generatedAt;
  const needs = snapshot.needsYou.flatMap(({ request, work, actor }) => {
    if (!work) return [];
    return [{
      ...baseWork(work, "needs", now),
      agent: actor?.name || "Agent",
      unseen: request.status === "open",
      attention: {
        id: request._id,
        kind: attentionKind(request.kind),
        title: request.title,
        body: request.body || "Your agent needs your input before it can continue.",
        important: request.urgency === "important",
        options: request.options,
        status: request.status,
      },
    } satisfies WorkItem];
  });
  const working = snapshot.working.map(({ work, run, actor }) => ({
    ...baseWork(work, "working", now),
    agent: actor?.name || "Agent",
    elapsed: run ? `active ${relativeTime(run.startedAt, now)}` : undefined,
    latest: run?.summary,
  }));
  const ready = snapshot.ready.map(({ work }) => baseWork(work, "ready", now));
  const done = snapshot.recentlyDone.map((work) => baseWork(work, "done", now));
  const intakes = snapshot.inbox.map(({ intake, attachments }) => ({
    id: intake._id,
    submissionKey: intake.clientRequestId,
    text: intake.text || attachments[0]?.filename || "Attachment",
    attachment: attachments[0]?.filename,
    attachmentCount: attachments.length,
    status: intake.status === "claimed" ? "triaging" as const : "waiting" as const,
    age: relativeTime(intake.createdAt, now) || "now",
    createdAt: intake.createdAt,
  }));
  return {
    projectId: snapshot.project._id,
    projectName: snapshot.project.name,
    work: [...needs, ...working, ...ready, ...done],
    intakes,
  };
}

function artifactKind(type: ArtifactDoc["type"]): Artifact["kind"] {
  if (type === "pull_request") return "pr";
  if (type === "deployment" || type === "preview" || type === "url") return "preview";
  if (type === "file" || type === "image") return "file";
  if (type === "commit") return "commit";
  return "report";
}

export function mapWorkDetail(base: WorkItem, detail: WorkDetailSnapshot): WorkItem {
  const now = Date.now();
  const actors = new Map(detail.actors.map((actor) => [actor._id, actor]));
  const latestRun = detail.runs[0];
  const conversation: ConversationEntry[] = detail.comments.map((comment) => {
    const actor = actors.get(comment.actorId);
    return {
      who: actor?.name || "Dongo",
      when: relativeTime(comment.createdAt, now) || "now",
      text: comment.body,
      human: actor?.type === "human",
    };
  });
  const artifacts: Artifact[] = detail.artifacts.map((artifact) => ({
    kind: artifactKind(artifact.type),
    label: artifact.title,
    href: artifact.url,
  }));
  const latestAttention = detail.attention[0];
  const resolution = latestAttention?.resolutionCommentId
    ? detail.comments.find((comment) => comment._id === latestAttention.resolutionCommentId)?.body
    : undefined;
  const mappedAttention: Attention | undefined = latestAttention
    ? {
        id: latestAttention._id,
        kind: attentionKind(latestAttention.kind),
        title: latestAttention.title,
        body: latestAttention.body || "Your agent needs your input before it can continue.",
        important: latestAttention.urgency === "important",
        options: latestAttention.options,
        status: latestAttention.status,
        ...(latestAttention.status === "resolved"
          ? {
              response:
                resolution ||
                latestAttention.selectedOption ||
                (latestAttention.resolutionKind === "cancelled"
                  ? "Cancelled by the agent"
                  : "Resolved without response"),
            }
          : {}),
      }
    : undefined;
  return {
    ...base,
    state:
      latestAttention?.status === "open" || latestAttention?.status === "seen"
        ? "needs"
        : detail.work.state === "done"
          ? "done"
          : detail.work.state === "working"
            ? "working"
            : "ready",
    unseen: latestAttention?.status === "open",
    attention: mappedAttention,
    goal: detail.work.description || detail.work.title,
    latest: latestRun?.summary || base.latest,
    agent: latestRun ? actors.get(latestRun.actorId)?.name || base.agent : base.agent,
    elapsed:
      latestRun?.status === "running"
        ? `active ${relativeTime(latestRun.startedAt, now)}`
        : base.elapsed,
    artifacts,
    conversation,
  };
}

export class ProjectDataConnection {
  readonly #client: ConvexClient;

  private constructor(
    client: ConvexClient,
    readonly project: ProjectInfo,
  ) {
    this.#client = client;
  }

  get projectId(): string {
    return this.project.id;
  }

  get projectName(): string {
    return this.project.name;
  }

  static async #resolve(
    select: (groups: ProjectGroup[]) => { group: ProjectGroup; project: ProjectGroup["projects"][number] } | undefined,
  ): Promise<ProjectDataConnection> {
    const client = new ConvexClient(convexDeploymentUrl);
    client.setAuth(async () => await convexAccessToken());
    try {
      const groups = await client.query(listProjectsReference, {});
      const selected = select(groups);
      if (!selected?.group.organization || selected.project.archivedAt !== undefined) {
        throw new Error("Project not found");
      }
      return new ProjectDataConnection(client, {
        id: selected.project._id,
        name: selected.project.name,
        slug: selected.project.slug,
        publicRef: selected.project.publicRef,
        organizationName: selected.group.organization.name,
        organizationSlug: selected.group.organization.slug,
        membershipRole: selected.group.membership.role,
        activeProjectCount: selected.group.projects.filter(
          (project) => project.archivedAt === undefined,
        ).length,
        repositoryUrl: selected.project.repositoryUrl,
        executionMode: selected.project.executionMode,
      });
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  static async connect(orgSlug: string, projectSlug: string): Promise<ProjectDataConnection> {
    return await ProjectDataConnection.#resolve((groups) => {
      const group = groups.find((candidate) => candidate.organization?.slug === orgSlug);
      const project = group?.projects.find(
        (candidate) => candidate.slug === projectSlug && candidate.archivedAt === undefined,
      );
      return group && project ? { group, project } : undefined;
    });
  }

  static async connectFirst(preferredProjectId?: string): Promise<ProjectDataConnection> {
    return await ProjectDataConnection.#resolve((groups) => {
      for (const group of groups) {
        const project = group.projects.find(
          (candidate) =>
            candidate.archivedAt === undefined &&
            (preferredProjectId === undefined || candidate._id === preferredProjectId),
        );
        if (project) return { group, project };
      }
      if (preferredProjectId !== undefined) {
        for (const group of groups) {
          const project = group.projects.find((candidate) => candidate.archivedAt === undefined);
          if (project) return { group, project };
        }
      }
      return undefined;
    });
  }

  subscribeOverview(
    onUpdate: (overview: ProjectOverview) => void,
    onError: (error: Error) => void,
  ): () => void {
    return this.#client.onUpdate(
      overviewReference,
      { projectId: this.projectId },
      (snapshot) => onUpdate(mapOverviewSnapshot(snapshot)),
      onError,
    );
  }

  subscribeWorkDetail(
    workItem: WorkItem,
    onUpdate: (work: WorkItem) => void,
    onError: (error: Error) => void,
  ): () => void {
    return this.#client.onUpdate(
      workDetailReference,
      { workItemId: workItem.id },
      (detail) => onUpdate(mapWorkDetail(workItem, detail)),
      onError,
    );
  }

  async createIntake(
    text: string | undefined,
    attachmentIds: string[],
    idempotencyKey: string,
  ): Promise<{ intakeId: string; revision: number }> {
    return await this.#client.mutation(createIntakeReference, {
      projectId: this.projectId,
      ...(text ? { text } : {}),
      attachmentIds,
      idempotencyKey,
    });
  }

  async uploadAttachment(
    file: File,
    onProgress: (progress: number, phase: "reserving" | "uploading" | "available") => void,
    signal: AbortSignal,
  ): Promise<string> {
    onProgress(8, "reserving");
    const reservation = await this.#client.action(reserveUploadReference, {
      projectId: this.projectId,
      filename: file.name,
      mimeType: file.type.trim() || "application/octet-stream",
      byteSize: file.size,
      idempotencyKey: crypto.randomUUID(),
    });
    const discard = async () => {
      await this.#client.action(discardUploadReference, {
        attachmentId: reservation.attachmentId,
      });
    };
    if (signal.aborted) {
      await discard().catch(() => undefined);
      throw new DOMException("Upload cancelled", "AbortError");
    }
    try {
      onProgress(30, "uploading");
      const response = await fetch(reservation.uploadUrl, {
        method: reservation.method,
        headers: reservation.requiredHeaders,
        body: file,
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal,
      });
      if (!response.ok) throw new Error(`Attachment upload failed with HTTP ${response.status}`);
      onProgress(100, "available");
      return reservation.attachmentId;
    } catch (error) {
      await discard().catch(() => undefined);
      throw error;
    }
  }

  async discardAttachment(attachmentId: string): Promise<void> {
    await this.#client.action(discardUploadReference, { attachmentId });
  }

  async reorderWork(work: WorkItem, rank: number): Promise<void> {
    await this.#client.mutation(reorderWorkReference, {
      workItemId: work.id,
      expectedRevision: work.revision,
      rank,
      idempotencyKey: crypto.randomUUID(),
    });
  }

  async markAttentionSeen(attentionRequestId: string): Promise<void> {
    await this.#client.mutation(markAttentionSeenReference, { attentionRequestId });
  }

  async respondToAttention(attentionRequestId: string, selectedOption?: string, body?: string): Promise<void> {
    await this.#client.mutation(respondAttentionReference, {
      attentionRequestId,
      ...(selectedOption ? { selectedOption } : {}),
      ...(body ? { body } : {}),
      idempotencyKey: crypto.randomUUID(),
    });
  }

  async resolveAttention(attentionRequestId: string): Promise<void> {
    await this.#client.mutation(resolveAttentionReference, {
      attentionRequestId,
      idempotencyKey: crypto.randomUUID(),
    });
  }

  async addComment(workItemId: string, body: string): Promise<void> {
    await this.#client.mutation(addCommentReference, {
      workItemId,
      body,
      idempotencyKey: crypto.randomUUID(),
    });
  }

  subscribeInstallations(
    onUpdate: (installations: ProjectInstallation[]) => void,
    onError: (error: Error) => void,
  ): () => void {
    return this.#client.onUpdate(
      listInstallationsReference,
      { projectId: this.projectId },
      (installations) => onUpdate(installations.map((installation) => ({
        id: installation._id,
        kind: installation.kind,
        status: installation.status,
        clientId: installation.clientId,
        label: installation.label,
        machineLabel: installation.machineLabel,
        scopes: installation.scopes,
        createdAt: installation.createdAt,
        lastUsedAt: installation.lastUsedAt,
      }))),
      onError,
    );
  }

  async revokeInstallation(installationId: string): Promise<void> {
    await this.#client.mutation(revokeInstallationReference, { installationId });
  }

  async archive(): Promise<void> {
    await this.#client.mutation(archiveProjectReference, { projectId: this.projectId });
  }

  async close(): Promise<void> {
    await this.#client.close();
  }
}
