import type { Doc } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { lowercaseDongoBrand } from "../../lib/brand";
import {
  displayWorkIdentifier,
  legacyWorkIdentifiers,
} from "../work/identifiers";

type InstallationIdentity = Pick<
  Doc<"installations">,
  "kind" | "label" | "machineLabel"
>;

const genericTransportLabels = new Set(["dongo CLI", "MCP host"]);

export function normalizedActorIdentity(
  actor: Pick<Doc<"actors">, "type" | "name" | "agentType">,
  installation?: InstallationIdentity | null,
) {
  const actorName = lowercaseDongoBrand(actor.name.trim());
  const fallbackName = actor.type === "agent"
    ? "Agent"
    : actor.type === "human"
      ? "Member"
      : "dongo";
  const transportLabel = installation?.label.trim()
    ? lowercaseDongoBrand(installation.label.trim())
    : undefined;
  const machineLabel = installation?.machineLabel?.trim()
    ? lowercaseDongoBrand(installation.machineLabel.trim())
    : undefined;
  const agentType = actor.agentType?.trim()
    ? lowercaseDongoBrand(actor.agentType.trim())
    : undefined;
  const transportStoredAsAgentType = actor.type === "agent"
    && installation !== undefined
    && installation !== null
    && agentType === installation.kind;
  const identityUnknown = actor.type === "agent"
    && installation !== undefined
    && installation !== null
    && actorName === transportLabel
    && transportLabel !== undefined
    && genericTransportLabels.has(transportLabel);
  return {
    displayName: identityUnknown ? "Agent" : actorName || fallbackName,
    agentType: transportStoredAsAgentType ? undefined : agentType,
    transport: actor.type === "agent" ? installation?.kind : undefined,
    transportLabel: actor.type === "agent" ? transportLabel : undefined,
    machineLabel: actor.type === "agent" ? machineLabel : undefined,
  };
}

export function actorSummaryForHuman(
  actor: Doc<"actors">,
  installation?: InstallationIdentity | null,
) {
  const identity = normalizedActorIdentity(actor, installation);
  return {
    _id: actor._id,
    type: actor.type,
    name: identity.displayName,
    agentType: identity.agentType,
    transport: identity.transport,
    transportLabel: identity.transportLabel,
    machineLabel: identity.machineLabel,
    avatarUrl: actor.avatarUrl,
  };
}

export async function actorSummaryForHumanWithInstallation(
  ctx: Pick<QueryCtx, "db">,
  actor: Doc<"actors">,
) {
  const installation = actor.installationId
    ? await ctx.db.get(actor.installationId)
    : null;
  return actorSummaryForHuman(actor, installation);
}

export function workSummaryForHuman(
  work: Doc<"workItems">,
  project: Doc<"projects">,
) {
  return {
    _id: work._id,
    identifier: displayWorkIdentifier(project, work),
    legacyIdentifiers: legacyWorkIdentifiers(project, work),
    title: work.title,
    description: work.description,
    context: work.context,
    links: work.links,
    kind: work.kind,
    state: work.state,
    rank: work.rank,
    parentId: work.parentId,
    revision: work.revision,
    createdAt: work.createdAt,
    updatedAt: work.updatedAt,
    completedAt: work.completedAt,
    claimExpiresAt: work.claimExpiresAt,
  };
}

export function runSummaryForHuman(run: Doc<"runs">) {
  return {
    _id: run._id,
    actorId: run.actorId,
    status: run.status,
    summary: run.summary,
    startedAt: run.startedAt,
    lastHeartbeatAt: run.lastHeartbeatAt,
    finishedAt: run.finishedAt,
  };
}

export function attentionSummaryForHuman(request: Doc<"attentionRequests">) {
  return {
    _id: request._id,
    workItemId: request.workItemId,
    requestedByActorId: request.requestedByActorId,
    kind: request.kind,
    title: request.title,
    body: request.body,
    options: request.options,
    urgency: request.urgency,
    status: request.status,
    createdAt: request.createdAt,
    seenAt: request.seenAt,
    resolvedAt: request.resolvedAt,
    resolutionCommentId: request.resolutionCommentId,
    selectedOption: request.selectedOption,
    resolutionKind: request.resolutionKind,
  };
}

export function intakeDisplayLabel(
  intake: Pick<Doc<"intakes">, "text">,
  firstAttachment?: Pick<Doc<"attachments">, "filename"> | null,
): string {
  const firstTextLine = intake.text
    ?.split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
  if (firstTextLine) return firstTextLine.slice(0, 240);
  const filename = firstAttachment?.filename.trim();
  if (filename) return filename.slice(0, 240);
  return "Untitled intake";
}

export function intakeSummaryForHuman(
  intake: Doc<"intakes">,
  firstAttachment?: Pick<Doc<"attachments">, "filename"> | null,
) {
  return {
    _id: intake._id,
    clientRequestId: intake.clientRequestId,
    sourceIdeaId: intake.sourceIdeaId,
    displayLabel: intakeDisplayLabel(intake, firstAttachment),
    text: intake.text,
    context: intake.context,
    links: intake.links,
    status: intake.status,
    revision: intake.revision,
    claimExpiresAt: intake.claimExpiresAt,
    processedAt: intake.processedAt,
    createdAt: intake.createdAt,
    updatedAt: intake.updatedAt,
  };
}

export function commentSummaryForHuman(comment: Doc<"comments">) {
  return {
    _id: comment._id,
    actorId: comment.actorId,
    body: comment.body,
    attachmentIds: comment.attachmentIds ?? [],
    createdAt: comment.createdAt,
  };
}

export function artifactSummaryForHuman(artifact: Doc<"artifacts">) {
  const repositoryPath =
    artifact.metadata &&
    typeof artifact.metadata === "object" &&
    !Array.isArray(artifact.metadata) &&
    typeof (artifact.metadata as Record<string, unknown>).repositoryPath === "string"
      ? (artifact.metadata as Record<string, unknown>).repositoryPath as string
      : undefined;
  return {
    _id: artifact._id,
    actorId: artifact.actorId,
    type: artifact.type,
    title: artifact.title,
    url: artifact.url,
    repositoryPath,
    createdAt: artifact.createdAt,
  };
}

export function eventSummaryForHuman(event: Doc<"events">) {
  return {
    _id: event._id,
    actorId: event.actorId,
    ideaId: event.ideaId,
    workItemId: event.workItemId,
    intakeId: event.intakeId,
    runId: event.runId,
    type: event.type,
    createdAt: event.createdAt,
  };
}
