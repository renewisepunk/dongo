import { v } from "convex/values";

export const roleValidator = v.union(v.literal("owner"), v.literal("member"));
export const workKindValidator = v.union(
  v.literal("task"),
  v.literal("bug"),
  v.literal("feature"),
  v.literal("investigation"),
  v.literal("decision"),
);
export const workStateValidator = v.union(
  v.literal("ready"),
  v.literal("working"),
  v.literal("done"),
  v.literal("cancelled"),
);
export const closureReasonValidator = v.union(
  v.literal("completed"),
  v.literal("no_longer_relevant"),
  v.literal("incorrect"),
  v.literal("other"),
);
export const attentionKindValidator = v.union(
  v.literal("review"),
  v.literal("decision"),
  v.literal("question"),
  v.literal("blocked"),
);
export const urgencyValidator = v.union(
  v.literal("normal"),
  v.literal("important"),
);
export const artifactTypeValidator = v.union(
  v.literal("commit"),
  v.literal("pull_request"),
  v.literal("deployment"),
  v.literal("preview"),
  v.literal("url"),
  v.literal("image"),
  v.literal("file"),
  v.literal("report"),
);
export const agentContextValidator = v.object({
  requestId: v.string(),
  installationId: v.id("installations"),
  actorId: v.id("actors"),
  organizationId: v.id("organizations"),
  projectId: v.id("projects"),
  projectRef: v.string(),
  oauthBindingId: v.optional(v.id("oauthBindings")),
  serviceCredentialId: v.optional(v.id("serviceCredentials")),
  issuer: v.optional(v.string()),
  resource: v.string(),
  clientId: v.string(),
  scopes: v.array(v.string()),
  externalSessionId: v.optional(v.string()),
});

export const MAX_TITLE_LENGTH = 500;
export const MAX_BODY_LENGTH = 100_000;
export const MAX_DESCRIPTION_LENGTH = 100_000;
export const MAX_IDEMPOTENCY_KEY_LENGTH = 200;
export const MAX_SESSION_ID_LENGTH = 300;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

export function boundedLimit(value?: number): number {
  if (value === undefined) return DEFAULT_PAGE_SIZE;
  return Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(value)));
}
