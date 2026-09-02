import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const role = v.union(v.literal("owner"), v.literal("member"));
const platformRole = v.literal("super_admin");
const workItemCountState = v.union(
  v.literal("exact"),
  v.literal("at_least_limit"),
);
const executionMode = v.union(v.literal("manual"), v.literal("autonomous"));
const actorType = v.union(
  v.literal("human"),
  v.literal("agent"),
  v.literal("system"),
);
const installationKind = v.union(
  v.literal("cli"),
  v.literal("mcp"),
  v.literal("service"),
  v.literal("development"),
);
const installationStatus = v.union(
  v.literal("pending"),
  v.literal("active"),
  v.literal("needs_reauth"),
  v.literal("revoked"),
);
const workKind = v.union(
  v.literal("task"),
  v.literal("bug"),
  v.literal("feature"),
  v.literal("investigation"),
  v.literal("decision"),
);
const workState = v.union(
  v.literal("ready"),
  v.literal("working"),
  v.literal("done"),
  v.literal("cancelled"),
);
const runStatus = v.union(
  v.literal("running"),
  v.literal("waiting"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
);
const attentionKind = v.union(
  v.literal("review"),
  v.literal("decision"),
  v.literal("question"),
  v.literal("blocked"),
);
const attentionStatus = v.union(
  v.literal("open"),
  v.literal("seen"),
  v.literal("resolved"),
);

export default defineSchema({
  humanProfiles: defineTable({
    authSubject: v.string(),
    email: v.optional(v.string()),
    name: v.string(),
    avatarUrl: v.optional(v.string()),
    platformRole: v.optional(platformRole),
    createdWorkItemCount: v.optional(v.number()),
    closedWorkItemCount: v.optional(v.number()),
    usageTrackingStartedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_auth_subject", ["authSubject"])
    .index("by_email", ["email"]),

  organizations: defineTable({
    name: v.string(),
    slug: v.string(),
    createdByProfileId: v.id("humanProfiles"),
    plan: v.union(v.literal("free"), v.literal("paid")),
    activeProjectLimitOverride: v.optional(v.number()),
    totalWorkItemLimitOverride: v.optional(v.number()),
    createdWorkItemCount: v.optional(v.number()),
    workItemCountState: v.optional(workItemCountState),
    closedWorkItemCount: v.optional(v.number()),
    usageTrackingStartedAt: v.optional(v.number()),
    projectCapacityRevision: v.optional(v.number()),
    workCapacityRevision: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_work_item_count_state", ["workItemCountState"]),

  memberships: defineTable({
    organizationId: v.id("organizations"),
    profileId: v.id("humanProfiles"),
    role,
    createdAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_profile", ["profileId"])
    .index("by_organization_profile", ["organizationId", "profileId"]),

  projects: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(),
    slug: v.string(),
    publicRef: v.string(),
    repositoryUrl: v.optional(v.string()),
    identifierPrefix: v.string(),
    compactIdentifierPrefix: v.optional(v.string()),
    nextWorkNumber: v.number(),
    executionMode,
    parallelExecutionEnabled: v.optional(v.boolean()),
    maxConcurrentRuns: v.optional(v.number()),
    agentUpdateVersion: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    archivedAt: v.optional(v.number()),
  })
    .index("by_organization", ["organizationId"])
    .index("by_organization_slug", ["organizationId", "slug"])
    .index("by_organization_prefix", ["organizationId", "identifierPrefix"])
    .index("by_organization_archived", ["organizationId", "archivedAt"])
    .index("by_public_ref", ["publicRef"]),

  actors: defineTable({
    organizationId: v.id("organizations"),
    type: actorType,
    name: v.string(),
    avatarUrl: v.optional(v.string()),
    profileId: v.optional(v.id("humanProfiles")),
    installationId: v.optional(v.id("installations")),
    agentType: v.optional(v.string()),
    createdAt: v.number(),
    lastSeenAt: v.optional(v.number()),
  })
    .index("by_organization_type", ["organizationId", "type"])
    .index("by_organization_profile", ["organizationId", "profileId"])
    .index("by_installation", ["installationId"]),

  installations: defineTable({
    organizationId: v.id("organizations"),
    projectId: v.id("projects"),
    actorId: v.id("actors"),
    kind: installationKind,
    status: installationStatus,
    clientId: v.string(),
    label: v.string(),
    machineLabel: v.optional(v.string()),
    resource: v.string(),
    scopes: v.array(v.string()),
    authorizedByProfileId: v.optional(v.id("humanProfiles")),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    lastAgentReleaseNoticeSequence: v.optional(v.number()),
    lastAgentReleaseNoticeId: v.optional(v.string()),
    lastAgentReleaseNoticeAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_project_status", ["projectId", "status"])
    .index("by_organization_authorizer", ["organizationId", "authorizedByProfileId"])
    .index("by_actor", ["actorId"])
    .index("by_project_client", ["projectId", "clientId"]),

  agentReleaseNoticeChannels: defineTable({
    channel: v.literal("stable"),
    activeReleaseId: v.string(),
    activeReleaseSequence: v.number(),
    activatedAt: v.number(),
  }).index("by_channel", ["channel"]),

  agentUpdateSignals: defineTable({
    organizationId: v.id("organizations"),
    projectId: v.id("projects"),
    version: v.number(),
    kind: v.literal("intake_available"),
    intakeId: v.id("intakes"),
    priority: v.union(v.literal("normal"), v.literal("important")),
    createdByActorId: v.id("actors"),
    createdAt: v.number(),
  })
    .index("by_project_version", ["projectId", "version"])
    .index("by_project_created", ["projectId", "createdAt"]),

  agentUpdatePresence: defineTable({
    organizationId: v.id("organizations"),
    projectId: v.id("projects"),
    installationId: v.id("installations"),
    actorId: v.id("actors"),
    capability: v.literal("get_updates"),
    lastPulledAt: v.number(),
    waitingUntil: v.optional(v.number()),
    waitRequestId: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_installation", ["installationId"])
    .index("by_project_updated", ["projectId", "updatedAt"]),

  agentSessions: defineTable({
    organizationId: v.id("organizations"),
    projectId: v.id("projects"),
    installationId: v.id("installations"),
    actorId: v.id("actors"),
    externalSessionId: v.string(),
    parallelExecutionCapability: v.optional(
      v.union(v.literal("supported"), v.literal("unsupported")),
    ),
    worktreeIsolationCapability: v.optional(
      v.union(v.literal("supported"), v.literal("unsupported")),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_installation_session", ["installationId", "externalSessionId"])
    .index("by_project_updated", ["projectId", "updatedAt"]),

  oauthBindings: defineTable({
    organizationId: v.id("organizations"),
    projectId: v.id("projects"),
    installationId: v.id("installations"),
    providerIssuer: v.string(),
    providerGrantId: v.string(),
    subject: v.string(),
    clientId: v.string(),
    resource: v.string(),
    scopes: v.array(v.string()),
    status: v.union(v.literal("active"), v.literal("revoked")),
    authorizedByProfileId: v.id("humanProfiles"),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastValidatedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_provider_grant", ["providerIssuer", "providerGrantId"])
    .index("by_installation", ["installationId"])
    .index("by_project_status", ["projectId", "status"]),

  serviceCredentials: defineTable({
    organizationId: v.id("organizations"),
    projectId: v.id("projects"),
    installationId: v.id("installations"),
    tokenPrefix: v.string(),
    tokenHash: v.string(),
    scopes: v.array(v.string()),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_token_prefix", ["tokenPrefix"])
    .index("by_installation", ["installationId"]),

  runnerRegistrations: defineTable({
    organizationId: v.id("organizations"),
    projectId: v.id("projects"),
    installationId: v.id("installations"),
    actorId: v.id("actors"),
    tokenPrefix: v.string(),
    tokenHash: v.string(),
    previousTokenHash: v.optional(v.string()),
    previousTokenValidUntil: v.optional(v.number()),
    label: v.string(),
    platform: v.union(v.literal("darwin"), v.literal("linux")),
    version: v.string(),
    harnesses: v.array(v.union(v.literal("codex"), v.literal("claude"))),
    approvalMode: v.union(v.literal("ask"), v.literal("automatic")),
    status: v.union(v.literal("active"), v.literal("revoked")),
    lastSeenAt: v.optional(v.number()),
    waitingUntil: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    revokedAt: v.optional(v.number()),
  })
    .index("by_token_prefix", ["tokenPrefix"])
    .index("by_project_status", ["projectId", "status"])
    .index("by_installation_status", ["installationId", "status"]),

  runnerJobs: defineTable({
    organizationId: v.id("organizations"),
    projectId: v.id("projects"),
    workItemId: v.id("workItems"),
    requestedByActorId: v.id("actors"),
    harness: v.union(v.literal("codex"), v.literal("claude")),
    state: v.union(
      v.literal("queued"),
      v.literal("delivered"),
      v.literal("awaiting_local_approval"),
      v.literal("starting"),
      v.literal("running"),
      v.literal("blocked"),
      v.literal("cancel_requested"),
      v.literal("cancelled"),
      v.literal("failed"),
      v.literal("completed"),
      v.literal("expired"),
    ),
    revision: v.number(),
    registrationId: v.optional(v.id("runnerRegistrations")),
    safeCode: v.optional(v.string()),
    safeMessage: v.optional(v.string()),
    safeSummary: v.optional(v.string()),
    sessionReferencePresent: v.optional(v.boolean()),
    requestedAt: v.number(),
    expiresAt: v.number(),
    deliveredAt: v.optional(v.number()),
    reservationExpiresAt: v.optional(v.number()),
    leaseExpiresAt: v.optional(v.number()),
    cancellationRequestedAt: v.optional(v.number()),
    terminalAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_project_requested", ["projectId", "requestedAt"])
    .index("by_project_state_requested", ["projectId", "state", "requestedAt"])
    .index("by_project_work_requested", ["projectId", "workItemId", "requestedAt"])
    .index("by_registration_state_updated", ["registrationId", "state", "updatedAt"]),

  runnerJobEvents: defineTable({
    organizationId: v.id("organizations"),
    projectId: v.id("projects"),
    jobId: v.id("runnerJobs"),
    registrationId: v.optional(v.id("runnerRegistrations")),
    actorId: v.id("actors"),
    sequence: v.number(),
    state: v.union(
      v.literal("queued"),
      v.literal("delivered"),
      v.literal("awaiting_local_approval"),
      v.literal("starting"),
      v.literal("running"),
      v.literal("blocked"),
      v.literal("cancel_requested"),
      v.literal("cancelled"),
      v.literal("failed"),
      v.literal("completed"),
      v.literal("expired"),
    ),
    safeCode: v.optional(v.string()),
    safeMessage: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_job_sequence", ["jobId", "sequence"])
    .index("by_project_created", ["projectId", "createdAt"]),

  ideas: defineTable({
    organizationId: v.id("organizations"),
    projectId: v.id("projects"),
    title: v.string(),
    text: v.optional(v.string()),
    context: v.optional(v.string()),
    links: v.optional(v.array(v.string())),
    state: v.union(
      v.literal("open"),
      v.literal("archived"),
      v.literal("promoted"),
    ),
    position: v.number(),
    revision: v.number(),
    createdByProfileId: v.id("humanProfiles"),
    createdByActorId: v.id("actors"),
    updatedByActorId: v.id("actors"),
    archivedAt: v.optional(v.number()),
    promotedAt: v.optional(v.number()),
    promotedIntakeId: v.optional(v.id("intakes")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project_state_position", ["projectId", "state", "position"])
    .index("by_project_created", ["projectId", "createdAt"]),

  intakes: defineTable({
    organizationId: v.id("organizations"),
    projectId: v.id("projects"),
    createdByProfileId: v.id("humanProfiles"),
    createdByActorId: v.id("actors"),
    sourceIdeaId: v.optional(v.id("ideas")),
    clientRequestId: v.optional(v.string()),
    text: v.optional(v.string()),
    context: v.optional(v.string()),
    links: v.optional(v.array(v.string())),
    status: v.union(
      v.literal("new"),
      v.literal("claimed"),
      v.literal("processed"),
      v.literal("dismissed"),
    ),
    claimedByActorId: v.optional(v.id("actors")),
    claimedByInstallationId: v.optional(v.id("installations")),
    claimedAt: v.optional(v.number()),
    claimExpiresAt: v.optional(v.number()),
    processedAt: v.optional(v.number()),
    revision: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project_status_created", ["projectId", "status", "createdAt"])
    .index("by_project_claim_expiry", ["projectId", "claimExpiresAt"])
    .index("by_claim_expiry", ["claimExpiresAt"])
    .searchIndex("search_text", {
      searchField: "text",
      filterFields: ["projectId"],
    }),

  attachments: defineTable({
    organizationId: v.id("organizations"),
    projectId: v.id("projects"),
    ideaId: v.optional(v.id("ideas")),
    intakeId: v.optional(v.id("intakes")),
    workItemId: v.optional(v.id("workItems")),
    createdByProfileId: v.id("humanProfiles"),
    filename: v.string(),
    mimeType: v.string(),
    byteSize: v.number(),
    storageKey: v.string(),
    checksumSha256: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("available"),
      v.literal("deleted"),
    ),
    createdAt: v.number(),
    finalizedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
  })
    .index("by_idea", ["ideaId"])
    .index("by_intake", ["intakeId"])
    .index("by_work", ["workItemId"])
    .index("by_project_status", ["projectId", "status"])
    .index("by_status_expires", ["status", "expiresAt"]),

  storageLedgers: defineTable({
    organizationId: v.id("organizations"),
    reservedBytes: v.number(),
    activeBytes: v.number(),
    updatedAt: v.number(),
  }).index("by_organization", ["organizationId"]),

  workItems: defineTable({
    organizationId: v.id("organizations"),
    projectId: v.id("projects"),
    number: v.number(),
    identifier: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    context: v.optional(v.string()),
    links: v.optional(v.array(v.string())),
    kind: workKind,
    state: workState,
    rank: v.number(),
    createdByActorId: v.id("actors"),
    assignedActorId: v.optional(v.id("actors")),
    claimedByActorId: v.optional(v.id("actors")),
    claimedByInstallationId: v.optional(v.id("installations")),
    claimedRunId: v.optional(v.id("runs")),
    claimedAt: v.optional(v.number()),
    claimExpiresAt: v.optional(v.number()),
    parentId: v.optional(v.id("workItems")),
    revision: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_organization", ["organizationId"])
    .index("by_project_identifier", ["projectId", "identifier"])
    .index("by_project_number", ["projectId", "number"])
    .index("by_project_state_rank", ["projectId", "state", "rank"])
    .index("by_project_state_updated", ["projectId", "state", "updatedAt"])
    .index("by_project_claim_expiry", ["projectId", "claimExpiresAt"])
    .index("by_claim_expiry", ["claimExpiresAt"])
    .index("by_parent", ["parentId"])
    .searchIndex("search_title", {
      searchField: "title",
      filterFields: ["projectId", "state"],
    }),

  intakeWorkLinks: defineTable({
    organizationId: v.id("organizations"),
    projectId: v.id("projects"),
    intakeId: v.id("intakes"),
    workItemId: v.id("workItems"),
    relation: v.union(
      v.literal("created"),
      v.literal("linked"),
      v.literal("duplicate"),
    ),
    createdAt: v.number(),
  })
    .index("by_intake_work", ["intakeId", "workItemId"])
    .index("by_intake", ["intakeId"])
    .index("by_work", ["workItemId"]),

  runs: defineTable({
    organizationId: v.id("organizations"),
    projectId: v.id("projects"),
    workItemId: v.id("workItems"),
    actorId: v.id("actors"),
    installationId: v.id("installations"),
    status: runStatus,
    summary: v.optional(v.string()),
    externalSessionId: v.optional(v.string()),
    parallelExecutionCapability: v.optional(
      v.union(v.literal("supported"), v.literal("unsupported")),
    ),
    worktreeIsolationCapability: v.optional(
      v.union(v.literal("supported"), v.literal("unsupported")),
    ),
    workspaceKind: v.optional(
      v.union(
        v.literal("worktree"),
        v.literal("shared_checkout"),
        v.literal("undisclosed"),
      ),
    ),
    worktreeName: v.optional(v.string()),
    branch: v.optional(v.string()),
    failureCode: v.optional(v.string()),
    startedAt: v.number(),
    lastHeartbeatAt: v.number(),
    finishedAt: v.optional(v.number()),
  })
    .index("by_work_started", ["workItemId", "startedAt"])
    .index("by_project_status", ["projectId", "status"])
    .index("by_actor_status", ["actorId", "status"])
    .index("by_installation_status", ["installationId", "status"]),

  attentionRequests: defineTable({
    organizationId: v.id("organizations"),
    projectId: v.id("projects"),
    workItemId: v.id("workItems"),
    runId: v.optional(v.id("runs")),
    requestedByActorId: v.id("actors"),
    requestedFromProfileId: v.id("humanProfiles"),
    kind: attentionKind,
    title: v.string(),
    body: v.optional(v.string()),
    options: v.optional(v.array(v.string())),
    urgency: v.union(v.literal("normal"), v.literal("important")),
    status: attentionStatus,
    createdAt: v.number(),
    seenAt: v.optional(v.number()),
    resolvedAt: v.optional(v.number()),
    resolvedByActorId: v.optional(v.id("actors")),
    resolutionCommentId: v.optional(v.id("comments")),
    selectedOption: v.optional(v.string()),
    resolutionKind: v.optional(
      v.union(v.literal("responded"), v.literal("resolved"), v.literal("cancelled")),
    ),
  })
    .index("by_profile_status_created", ["requestedFromProfileId", "status", "createdAt"])
    .index("by_project_profile_status_created", [
      "projectId",
      "requestedFromProfileId",
      "status",
      "createdAt",
    ])
    .index("by_requester_resolved", ["requestedByActorId", "resolvedAt"])
    .index("by_work_status", ["workItemId", "status"])
    .index("by_project_status_created", ["projectId", "status", "createdAt"]),

  devices: defineTable({
    profileId: v.id("humanProfiles"),
    platform: v.union(v.literal("ios"), v.literal("android")),
    appInstallationId: v.string(),
    pushToken: v.string(),
    pushTokenHash: v.string(),
    enabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastSeenAt: v.number(),
    disabledAt: v.optional(v.number()),
  })
    .index("by_profile_enabled", ["profileId", "enabled"])
    .index("by_profile_installation", ["profileId", "appInstallationId"])
    .index("by_push_token_hash", ["pushTokenHash"]),

  notificationOutbox: defineTable({
    organizationId: v.id("organizations"),
    projectId: v.id("projects"),
    attentionRequestId: v.id("attentionRequests"),
    recipientProfileId: v.id("humanProfiles"),
    eventType: v.literal("attention.requested"),
    channel: v.optional(v.union(v.literal("push"), v.literal("email"))),
    deviceId: v.optional(v.id("devices")),
    dedupeKey: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("delivering"),
      v.literal("delivered"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    attemptCount: v.number(),
    availableAt: v.number(),
    createdAt: v.number(),
    deliveryAttemptId: v.optional(v.string()),
    deliveredAt: v.optional(v.number()),
    failedAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
    providerMessageId: v.optional(v.string()),
    lastErrorCode: v.optional(v.string()),
  })
    .index("by_status_available", ["status", "availableAt"])
    .index("by_attention", ["attentionRequestId"])
    .index("by_dedupe", ["dedupeKey"])
    .index("by_device_status", ["deviceId", "status"]),

  agentSyncCursors: defineTable({
    organizationId: v.id("organizations"),
    projectId: v.id("projects"),
    installationId: v.id("installations"),
    lastAcknowledgedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_installation", ["installationId"])
    .index("by_project_installation", ["projectId", "installationId"]),

  comments: defineTable({
    organizationId: v.id("organizations"),
    projectId: v.id("projects"),
    workItemId: v.id("workItems"),
    actorId: v.id("actors"),
    body: v.string(),
    attachmentIds: v.optional(v.array(v.id("attachments"))),
    createdAt: v.number(),
  })
    .index("by_work_created", ["workItemId", "createdAt"])
    .searchIndex("search_body", {
      searchField: "body",
      filterFields: ["projectId"],
    }),

  artifacts: defineTable({
    organizationId: v.id("organizations"),
    projectId: v.id("projects"),
    workItemId: v.id("workItems"),
    runId: v.optional(v.id("runs")),
    actorId: v.id("actors"),
    type: v.union(
      v.literal("commit"),
      v.literal("pull_request"),
      v.literal("deployment"),
      v.literal("preview"),
      v.literal("url"),
      v.literal("image"),
      v.literal("file"),
      v.literal("report"),
    ),
    title: v.string(),
    url: v.optional(v.string()),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_work_created", ["workItemId", "createdAt"])
    .index("by_run", ["runId"]),

  events: defineTable({
    organizationId: v.id("organizations"),
    projectId: v.optional(v.id("projects")),
    ideaId: v.optional(v.id("ideas")),
    intakeId: v.optional(v.id("intakes")),
    workItemId: v.optional(v.id("workItems")),
    runId: v.optional(v.id("runs")),
    actorId: v.id("actors"),
    type: v.string(),
    data: v.any(),
    requestId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_organization_created", ["organizationId", "createdAt"])
    .index("by_actor_created", ["actorId", "createdAt"])
    .index("by_project_created", ["projectId", "createdAt"])
    .index("by_idea_created", ["ideaId", "createdAt"])
    .index("by_work_created", ["workItemId", "createdAt"])
    .index("by_intake_created", ["intakeId", "createdAt"])
    .index("by_run_created", ["runId", "createdAt"]),

  platformAdminMutationKeys: defineTable({
    profileId: v.id("humanProfiles"),
    operation: v.string(),
    key: v.string(),
    canonicalPayload: v.string(),
    resultJson: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_profile_operation_key", ["profileId", "operation", "key"])
    .index("by_expires_at", ["expiresAt"]),

  idempotencyKeys: defineTable({
    organizationId: v.id("organizations"),
    projectId: v.id("projects"),
    principalKey: v.string(),
    operation: v.string(),
    key: v.string(),
    canonicalPayload: v.string(),
    resultJson: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_scope_operation_key", [
      "projectId",
      "principalKey",
      "operation",
      "key",
    ])
    .index("by_expires_at", ["expiresAt"]),

  gatewayNonces: defineTable({
    keyId: v.string(),
    nonce: v.string(),
    requestId: v.string(),
    requestDigest: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_key_nonce", ["keyId", "nonce"])
    .index("by_expires_at", ["expiresAt"]),
});
