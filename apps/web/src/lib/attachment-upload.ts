export const MAX_ATTACHMENT_BYTES = 250 * 1_024 * 1_024;
export const MAX_INTAKE_ATTACHMENTS = 20;

export type AttachmentFileLike = {
  name: string;
  size: number;
  type: string;
};

export type AttachmentUploadProgress = (
  progress: number,
  phase: "reserving" | "uploading" | "available",
) => void;

export type AttachmentUploadReservation =
  | {
      transport: "single";
      attachmentId: string;
      maximumBytes: number;
      uploadUrl: string;
      method: "PUT";
      requiredHeaders: Record<string, string>;
    }
  | {
      transport: "multipart";
      attachmentId: string;
      maximumBytes: number;
      createUrl: string;
      method: "POST";
      partSize: number;
      partCount: number;
    };

type MultipartSession = {
  sessionUrl: string;
  partSize: number;
  partCount: number;
};

type UploadedPart = { partNumber: number; etag: string };

const MULTIPART_CONCURRENCY = 3;
const MULTIPART_RETRY_ATTEMPTS = 3;

function abortError(): DOMException {
  return new DOMException("Upload cancelled", "AbortError");
}

function assertActive(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function safeAttachmentServiceUrl(
  rawUrl: string,
  expectedPath: string,
): URL {
  const url = new URL(rawUrl);
  const browserOrigin = globalThis.location?.origin;
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== expectedPath ||
    url.hash !== "" ||
    (browserOrigin !== undefined && url.origin !== browserOrigin)
  ) throw new Error("Attachment service returned an invalid upload capability");
  return url;
}

function safeMultipartUrl(
  rawSessionUrl: string,
  createUrl: string,
  attachmentId: string,
  suffix: string,
): URL {
  const basePath = `/api/files/multipart/${encodeURIComponent(attachmentId)}`;
  const session = safeAttachmentServiceUrl(rawSessionUrl, basePath);
  const create = safeAttachmentServiceUrl(createUrl, basePath);
  if (
    session.origin !== create.origin ||
    session.pathname !== basePath
  ) throw new Error("Attachment service returned an invalid multipart session");
  session.pathname = `${basePath}${suffix}`;
  return session;
}

async function responseJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) return undefined;
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function parseMultipartSession(
  value: unknown,
  reservation: Extract<AttachmentUploadReservation, { transport: "multipart" }>,
): MultipartSession {
  if (
    typeof value !== "object" ||
    value === null ||
    !("sessionUrl" in value) ||
    typeof value.sessionUrl !== "string" ||
    !("partSize" in value) ||
    value.partSize !== reservation.partSize ||
    !("partCount" in value) ||
    value.partCount !== reservation.partCount
  ) throw new Error("Attachment service returned an invalid multipart session");
  safeMultipartUrl(value.sessionUrl, reservation.createUrl, reservation.attachmentId, "");
  return {
    sessionUrl: value.sessionUrl,
    partSize: value.partSize,
    partCount: value.partCount,
  };
}

function parseUploadedPart(value: unknown, expectedPartNumber: number): UploadedPart {
  if (
    typeof value !== "object" ||
    value === null ||
    !("partNumber" in value) ||
    value.partNumber !== expectedPartNumber ||
    !("etag" in value) ||
    typeof value.etag !== "string" ||
    /^[\x21-\x7e]{1,128}$/u.test(value.etag) === false
  ) throw new Error("Attachment service returned an invalid uploaded part");
  return { partNumber: expectedPartNumber, etag: value.etag };
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function uploadPartWithRetry(
  request: typeof fetch,
  url: URL,
  body: Blob,
  signal: AbortSignal,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MULTIPART_RETRY_ATTEMPTS; attempt += 1) {
    assertActive(signal);
    try {
      const response = await request(url, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body,
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal,
      });
      if (!retryableStatus(response.status) || attempt === MULTIPART_RETRY_ATTEMPTS - 1) {
        return response;
      }
      await response.body?.cancel();
    } catch (error) {
      if (signal.aborted) throw abortError();
      lastError = error;
      if (attempt === MULTIPART_RETRY_ATTEMPTS - 1) throw error;
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        globalThis.clearTimeout(timer);
        reject(abortError());
      };
      const timer = globalThis.setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, 250 * 2 ** attempt);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
  throw lastError instanceof Error ? lastError : new Error("Attachment part upload failed");
}

async function uploadMultipart(
  file: File,
  reservation: Extract<AttachmentUploadReservation, { transport: "multipart" }>,
  onProgress: AttachmentUploadProgress,
  signal: AbortSignal,
  request: typeof fetch,
): Promise<void> {
  assertActive(signal);
  const createUrl = safeAttachmentServiceUrl(
    reservation.createUrl,
    `/api/files/multipart/${encodeURIComponent(reservation.attachmentId)}`,
  );
  const created = await request(createUrl, {
    method: reservation.method,
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    signal,
  });
  if (!created.ok) {
    await created.body?.cancel();
    throw new Error(`Attachment multipart initialization failed with HTTP ${created.status}`);
  }
  const session = parseMultipartSession(await responseJson(created), reservation);
  const uploadController = new AbortController();
  const cancelUploads = () => uploadController.abort();
  signal.addEventListener("abort", cancelUploads, { once: true });
  if (signal.aborted) uploadController.abort();
  const uploadSignal = uploadController.signal;
  const abort = async () => {
    const url = safeMultipartUrl(
      session.sessionUrl,
      reservation.createUrl,
      reservation.attachmentId,
      "",
    );
    await request(url, {
      method: "DELETE",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      keepalive: true,
    }).then((response) => response.body?.cancel()).catch(() => undefined);
  };
  try {
    const parts = new Array<UploadedPart>(session.partCount);
    let nextPartNumber = 1;
    let uploadedBytes = 0;
    const worker = async () => {
      while (true) {
        assertActive(uploadSignal);
        const partNumber = nextPartNumber;
        nextPartNumber += 1;
        if (partNumber > session.partCount) return;
        const start = (partNumber - 1) * session.partSize;
        const end = Math.min(file.size, start + session.partSize);
        const body = file.slice(start, end);
        const url = safeMultipartUrl(
          session.sessionUrl,
          reservation.createUrl,
          reservation.attachmentId,
          `/parts/${partNumber}`,
        );
        const response = await uploadPartWithRetry(request, url, body, uploadSignal);
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`Attachment part upload failed with HTTP ${response.status}`);
        }
        parts[partNumber - 1] = parseUploadedPart(
          await responseJson(response),
          partNumber,
        );
        uploadedBytes += body.size;
        onProgress(
          Math.min(94, 16 + Math.floor((uploadedBytes / file.size) * 78)),
          "uploading",
        );
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(MULTIPART_CONCURRENCY, session.partCount) },
        worker,
      ),
    );
    assertActive(uploadSignal);
    const completeUrl = safeMultipartUrl(
      session.sessionUrl,
      reservation.createUrl,
      reservation.attachmentId,
      "/complete",
    );
    const completeBody = JSON.stringify({ parts });
    let complete: Response | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        complete = await request(completeUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: completeBody,
          credentials: "omit",
          cache: "no-store",
          referrerPolicy: "no-referrer",
          signal: uploadSignal,
        });
        if (complete.ok || !retryableStatus(complete.status) || attempt === 1) break;
        await complete.body?.cancel();
      } catch (error) {
        if (uploadSignal.aborted) throw abortError();
        if (attempt === 1) throw error;
      }
    }
    if (!complete?.ok) {
      await complete?.body?.cancel();
      throw new Error(`Attachment completion failed with HTTP ${complete?.status ?? 0}`);
    }
    await complete.body?.cancel();
  } catch (error) {
    uploadController.abort();
    await abort();
    throw error;
  } finally {
    signal.removeEventListener("abort", cancelUploads);
  }
}

export async function deliverAttachment(
  file: File,
  reservation: AttachmentUploadReservation,
  onProgress: AttachmentUploadProgress,
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<void> {
  if (
    file.size !== reservation.maximumBytes ||
    file.size <= 0 ||
    file.size > MAX_ATTACHMENT_BYTES
  ) throw new Error("Attachment reservation does not match the selected file");
  if (reservation.transport === "multipart") {
    onProgress(14, "uploading");
    await uploadMultipart(file, reservation, onProgress, signal, request);
  } else {
    assertActive(signal);
    onProgress(30, "uploading");
    const uploadUrl = safeAttachmentServiceUrl(
      reservation.uploadUrl,
      `/api/files/upload/${encodeURIComponent(reservation.attachmentId)}`,
    );
    const response = await request(uploadUrl, {
      method: reservation.method,
      headers: reservation.requiredHeaders,
      body: file,
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Attachment upload failed with HTTP ${response.status}`);
    }
    await response.body?.cancel();
  }
  onProgress(100, "available");
}

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
