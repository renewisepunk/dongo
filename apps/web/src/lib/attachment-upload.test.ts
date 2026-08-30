import { describe, expect, it } from "vitest";
import {
  attachmentKind,
  attachmentSelectionError,
  formatAttachmentBytes,
  MAX_ATTACHMENT_BYTES,
} from "./attachment-upload";

describe("attachment upload presentation", () => {
  it("rejects empty and oversized files before reserving quota", () => {
    expect(attachmentSelectionError({ name: "empty.txt", size: 0, type: "text/plain" }))
      .toBe("This file is empty.");
    expect(attachmentSelectionError({
      name: "huge.mov",
      size: MAX_ATTACHMENT_BYTES + 1,
      type: "video/quicktime",
    })).toBe("Files may not exceed 250 MB.");
  });

  it("presents stable media kinds and compact byte sizes", () => {
    expect(attachmentKind({ name: "shot.png", size: 5, type: "image/png" })).toBe("IMG");
    expect(attachmentKind({ name: "demo.mp4", size: 5, type: "video/mp4" })).toBe("VID");
    expect(attachmentKind({ name: "notes.md", size: 5, type: "text/markdown" })).toBe("FILE");
    expect(formatAttachmentBytes(1_536)).toBe("1.5 KB");
    expect(formatAttachmentBytes(12 * 1_024 * 1_024)).toBe("12 MB");
  });
});
