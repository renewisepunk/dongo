export const MAX_ATTACHMENT_BYTES = 250 * 1_024 * 1_024;
export const MAX_INTAKE_ATTACHMENTS = 20;

export type AttachmentFileLike = {
  name: string;
  size: number;
  type: string;
};

export function attachmentSelectionError(file: AttachmentFileLike): string | undefined {
  if (!file.name.trim()) return "This file has no usable name.";
  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    return "This file is empty.";
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return "Files may not exceed 250 MB.";
  }
  return undefined;
}

export function attachmentKind(file: AttachmentFileLike): "IMG" | "VID" | "FILE" {
  if (file.type.toLowerCase().startsWith("image/")) return "IMG";
  if (file.type.toLowerCase().startsWith("video/")) return "VID";
  return "FILE";
}

export function formatAttachmentBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(bytes < 10 * 1_024 ? 1 : 0)} KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(bytes < 10 * 1_024 * 1_024 ? 1 : 0)} MB`;
}
