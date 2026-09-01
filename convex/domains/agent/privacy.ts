import type { Doc } from "../../_generated/dataModel";

export function intakeForAgent(intake: Doc<"intakes">) {
  const { sourceIdeaId, ...visible } = intake;
  void sourceIdeaId;
  return visible;
}

export function attachmentForAgent(attachment: Doc<"attachments">) {
  const { ideaId, ...visible } = attachment;
  void ideaId;
  return visible;
}
