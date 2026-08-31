import type { Doc } from "../../_generated/dataModel";

export function actorSummaryForHuman(actor: Doc<"actors">) {
  return {
    _id: actor._id,
    type: actor.type,
    name: actor.name,
    agentType: actor.agentType,
    avatarUrl: actor.avatarUrl,
  };
}

export function workSummaryForHuman(work: Doc<"workItems">) {
  return {
    _id: work._id,
    identifier: work.identifier,
    title: work.title,
    description: work.description,
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

export function intakeSummaryForHuman(intake: Doc<"intakes">) {
  return {
    _id: intake._id,
    clientRequestId: intake.clientRequestId,
    text: intake.text,
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
    workItemId: event.workItemId,
    intakeId: event.intakeId,
    runId: event.runId,
    type: event.type,
    createdAt: event.createdAt,
  };
}
