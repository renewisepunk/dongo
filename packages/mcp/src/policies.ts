import { operationRegistry } from "@dongo/contracts";
import {
  DONGO_OPERATION_NAMES,
  type DongoOperationName,
  type DongoScope,
  type ToolPolicy,
} from "./types.js";

const PRESENTATION = {
  session_start: {
    title: "Start Dongo session",
    description:
      "Fetch startup context. This starts no work and should be the first Dongo call in a coding session.",
  },
  get_overview: {
    title: "Get project overview",
    description:
      "Read bounded Needs You, Working, Ready, Inbox, and recently completed project context.",
  },
  get_intake: {
    title: "Get intake",
    description:
      "Read one Intake and its finalized attachment metadata before triage.",
  },
  claim_intake: {
    title: "Claim intake",
    description:
      "Atomically lease one new Intake for triage. A claim conflict must be refetched, not blindly retried.",
  },
  renew_intake_claim: {
    title: "Renew intake claim",
    description:
      "Quietly renew an active Intake triage lease held by this installation.",
  },
  complete_triage: {
    title: "Complete intake triage",
    description:
      "Atomically complete claimed Intake triage with the contract-defined outcome.",
  },
  create_work: {
    title: "Create work",
    description:
      "Create independently actionable structured work after checking existing work for duplicates.",
  },
  get_work: {
    title: "Get work",
    description:
      "Read one WorkItem with its current Run, claim, comments, artifacts, and Attention history.",
  },
  start_work: {
    title: "Start work",
    description:
      "Atomically acquire the execution lease, create a Run, and start one Ready WorkItem.",
  },
  update_work: {
    title: "Update work",
    description:
      "Apply a revision-aware meaningful WorkItem or Run update while the execution claim is valid.",
  },
  renew_claim: {
    title: "Renew work claim",
    description:
      "Quietly renew the active execution lease without creating repository export noise.",
  },
  finish_work: {
    title: "Finish work",
    description:
      "Atomically finish the active Run, release its claim, and record the final WorkItem outcome.",
  },
  add_comment: {
    title: "Add comment",
    description: "Add an attributed Markdown comment to a WorkItem.",
  },
  request_attention: {
    title: "Request human attention",
    description:
      "Create a review, decision, question, or blocked Attention request when human judgment is required.",
  },
  get_attention: {
    title: "Get attention",
    description:
      "Read an Attention request and any attributed human response relevant to prior work.",
  },
  resolve_attention: {
    title: "Resolve attention",
    description:
      "Mark an Attention request addressed after consuming the human response or recording the resolution.",
  },
  get_attachment: {
    title: "Get attachment",
    description:
      "Return authorized metadata and a short-lived resource link; the gateway never proxies attachment bytes.",
    sensitiveTextFallback: true,
  },
  sync_snapshot: {
    title: "Get repository snapshot",
    description:
      "Read a deterministic repository-export snapshot. The remote server does not write, stage, commit, or push local files.",
    sensitiveTextFallback: true,
  },
} as const satisfies Record<
  DongoOperationName,
  {
    readonly title: string;
    readonly description: string;
    readonly sensitiveTextFallback?: boolean;
  }
>;

function canonicalPolicy(operation: DongoOperationName): ToolPolicy {
  const canonical = operationRegistry[operation];
  const presentation = PRESENTATION[operation];
  return Object.freeze({
    operation,
    toolName: `dongo_${operation}`,
    title: presentation.title,
    description: presentation.description,
    requiredScopes: Object.freeze([...canonical.scopes]) as readonly DongoScope[],
    effect: canonical.readOnly ? "read" : "write",
    ...(operation === "get_attachment" || operation === "sync_snapshot"
      ? { sensitiveTextFallback: true }
      : {}),
    annotations: Object.freeze({
      title: presentation.title,
      readOnlyHint: canonical.readOnly,
      destructiveHint: canonical.destructive,
      idempotentHint: canonical.idempotent,
      openWorldHint: canonical.openWorld,
    }),
  });
}

export const DONGO_TOOL_POLICIES = Object.freeze(
  Object.fromEntries(
    DONGO_OPERATION_NAMES.map((operation) => [
      operation,
      canonicalPolicy(operation),
    ]),
  ) as Record<DongoOperationName, ToolPolicy>,
);
