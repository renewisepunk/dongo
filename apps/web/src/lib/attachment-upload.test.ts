import { describe, expect, it } from "vitest";
import {
  attachmentKind,
  attachmentSelectionError,
  deliverAttachment,
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

describe("attachment delivery", () => {
  it("uploads multipart files in bounded parts and completes in order", async () => {
    const file = new File(["hello world"], "demo.mov", {
      type: "video/quicktime",
    });
    const createUrl = "https://dev.dongo.so/api/files/multipart/attachment_123?create=capability";
    const sessionUrl = "https://dev.dongo.so/api/files/multipart/attachment_123?session=capability";
    const uploadedSizes = new Map<number, number>();
    let completionBody: unknown;
    const request = async (
      input: URL | RequestInfo,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = new URL(String(input));
      if (url.toString() === createUrl) {
        return Response.json({
          sessionUrl,
          partSize: 5,
          partCount: 3,
        }, { status: 201 });
      }
      const part = /\/parts\/(\d+)$/u.exec(url.pathname);
      if (part) {
        const partNumber = Number(part[1]);
        uploadedSizes.set(
          partNumber,
          init?.body instanceof Blob ? init.body.size : -1,
        );
        return Response.json({ ok: true, partNumber, etag: `etag-${partNumber}` });
      }
      if (url.pathname.endsWith("/complete")) {
        completionBody = JSON.parse(String(init?.body));
        return Response.json({ ok: true }, { status: 201 });
      }
      throw new Error(`Unexpected request ${url.pathname}`);
    };
    const progress: Array<{ value: number; phase: string }> = [];
    await deliverAttachment(
      file,
      {
        transport: "multipart",
        attachmentId: "attachment_123",
        maximumBytes: file.size,
        createUrl,
        method: "POST",
        partSize: 5,
        partCount: 3,
      },
      (value, phase) => progress.push({ value, phase }),
      new AbortController().signal,
      request as typeof fetch,
    );

    expect([...uploadedSizes.entries()].sort(([left], [right]) => left - right))
      .toEqual([[1, 5], [2, 5], [3, 1]]);
    expect(completionBody).toEqual({
      parts: [
        { partNumber: 1, etag: "etag-1" },
        { partNumber: 2, etag: "etag-2" },
        { partNumber: 3, etag: "etag-3" },
      ],
    });
    expect(progress.at(-1)).toEqual({ value: 100, phase: "available" });
  });

  it("rejects a multipart session that escapes the signed service origin", async () => {
    const file = new File(["hello world"], "demo.mov");
    let evilRequests = 0;
    const request = async (input: URL | RequestInfo): Promise<Response> => {
      const url = new URL(String(input));
      if (url.origin === "https://evil.example") evilRequests += 1;
      return Response.json({
        sessionUrl: "https://evil.example/api/files/multipart/attachment_123?session=stolen",
        partSize: 5,
        partCount: 3,
      }, { status: 201 });
    };
    await expect(deliverAttachment(
      file,
      {
        transport: "multipart",
        attachmentId: "attachment_123",
        maximumBytes: file.size,
        createUrl: "https://dev.dongo.so/api/files/multipart/attachment_123?create=capability",
        method: "POST",
        partSize: 5,
        partCount: 3,
      },
      () => undefined,
      new AbortController().signal,
      request as typeof fetch,
    )).rejects.toThrow("invalid multipart session");
    expect(evilRequests).toBe(0);
  });
});
