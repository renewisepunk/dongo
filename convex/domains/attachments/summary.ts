import type { Doc } from "../../_generated/dataModel";

export type AttachmentSummary = Pick<
  Doc<"attachments">,
  "_id" | "filename" | "mimeType" | "byteSize"
>;

export function attachmentSummary(
  attachment: Doc<"attachments">,
): AttachmentSummary {
  return {
    _id: attachment._id,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    byteSize: attachment.byteSize,
  };
}
