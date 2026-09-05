import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";

import { MarkdownDraftPreview } from "../../components/MarkdownContent";
import {
  attachmentKind,
  attachmentSelectionError,
  formatAttachmentBytes,
  MAX_INTAKE_ATTACHMENTS,
} from "../../lib/attachment-upload";
import {
  clearLocalDraft,
  readLocalDraft,
  writeLocalDraft,
} from "../../lib/local-drafts";

type CommentDraftAttachment = {
  localId: string;
  file: File;
  previewUrl?: string;
  state: "uploading" | "available" | "error" | "removing";
  phase: "reserving" | "uploading" | "available";
  progress: number;
  attachmentId?: string;
  error?: string;
};

type CommentComposerProps = {
  draftKey: string;
  onSubmit: (body: string | undefined, attachmentIds: string[]) => Promise<void>;
  uploadAttachment: (
    file: File,
    onProgress: (
      progress: number,
      phase: "reserving" | "uploading" | "available",
    ) => void,
    signal: AbortSignal,
  ) => Promise<string>;
  discardAttachment: (attachmentId: string) => Promise<void>;
  announce: (message: string) => void;
};

function pastedFiles(clipboard: DataTransfer | null): File[] {
  if (!clipboard) return [];
  const itemFiles = [...clipboard.items].flatMap((item) => {
    const file = item.kind === "file" ? item.getAsFile() : null;
    return file ? [file] : [];
  });
  return itemFiles.length > 0 ? itemFiles : [...clipboard.files];
}

export function CommentComposer(props: CommentComposerProps) {
  const [body, setBody] = createSignal(readLocalDraft(props.draftKey));
  const [attachments, setAttachments] = createSignal<CommentDraftAttachment[]>([]);
  const [submitting, setSubmitting] = createSignal(false);
  const [dragging, setDragging] = createSignal(false);
  const controllers = new Map<string, AbortController>();
  let fileInput: HTMLInputElement | undefined;

  const availableAttachmentIds = createMemo(() =>
    attachments().flatMap((attachment) =>
      attachment.state === "available" && attachment.attachmentId
        ? [attachment.attachmentId]
        : [],
    ),
  );
  const uploadPending = createMemo(() =>
    attachments().some((attachment) =>
      attachment.state === "uploading" || attachment.state === "removing",
    ),
  );
  const uploadFailed = createMemo(() =>
    attachments().some((attachment) => attachment.state === "error"),
  );
  const canSubmit = createMemo(() =>
    (body().trim().length > 0 || availableAttachmentIds().length > 0) &&
    !submitting() &&
    !uploadPending() &&
    !uploadFailed(),
  );

  createEffect(() => writeLocalDraft(props.draftKey, body()));

  const updateAttachment = (
    localId: string,
    update: Partial<CommentDraftAttachment>,
  ) => setAttachments((items) => items.map((item) =>
    item.localId === localId ? { ...item, ...update } : item,
  ));

  const revokePreview = (attachment: CommentDraftAttachment) => {
    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
  };

  const upload = async (localId: string) => {
    const item = attachments().find((candidate) => candidate.localId === localId);
    if (!item || item.state === "removing") return;
    controllers.get(localId)?.abort();
    const controller = new AbortController();
    controllers.set(localId, controller);
    updateAttachment(localId, {
      state: "uploading",
      phase: "reserving",
      progress: 8,
      attachmentId: undefined,
      error: undefined,
    });
    try {
      const attachmentId = await props.uploadAttachment(
        item.file,
        (progress, phase) => updateAttachment(localId, { progress, phase }),
        controller.signal,
      );
      if (controller.signal.aborted) {
        await props.discardAttachment(attachmentId).catch(() => undefined);
        return;
      }
      updateAttachment(localId, {
        state: "available",
        phase: "available",
        progress: 100,
        attachmentId,
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      updateAttachment(localId, {
        state: "error",
        progress: 0,
        error:
          error instanceof Error && /250 MB|quota/i.test(error.message)
            ? error.message
            : "Upload interrupted. Retry when you are online.",
      });
    } finally {
      if (controllers.get(localId) === controller) controllers.delete(localId);
    }
  };

  const addFiles = (files: File[]) => {
    if (files.length === 0) return;
    const remaining = MAX_INTAKE_ATTACHMENTS - attachments().length;
    if (remaining <= 0) {
      props.announce(`A comment may include at most ${MAX_INTAKE_ATTACHMENTS} attachments`);
      return;
    }
    const accepted = files.slice(0, remaining).map((file) => {
      const error = attachmentSelectionError(file);
      const kind = attachmentKind(file);
      return {
        localId: crypto.randomUUID(),
        file,
        ...(!error && kind !== "FILE"
          ? { previewUrl: URL.createObjectURL(file) }
          : {}),
        state: error ? "error" as const : "uploading" as const,
        phase: "reserving" as const,
        progress: error ? 0 : 4,
        ...(error ? { error } : {}),
      } satisfies CommentDraftAttachment;
    });
    setAttachments((items) => [...items, ...accepted]);
    for (const attachment of accepted) {
      if (!attachment.error) void upload(attachment.localId);
    }
    if (files.length > remaining) {
      props.announce(`Only the first ${remaining} files were added`);
    }
  };

  const removeAttachment = async (localId: string) => {
    const item = attachments().find((candidate) => candidate.localId === localId);
    if (!item || item.state === "removing") return;
    controllers.get(localId)?.abort();
    controllers.delete(localId);
    if (!item.attachmentId) {
      revokePreview(item);
      setAttachments((items) => items.filter((candidate) => candidate.localId !== localId));
      return;
    }
    updateAttachment(localId, { state: "removing" });
    try {
      await props.discardAttachment(item.attachmentId);
      revokePreview(item);
      setAttachments((items) => items.filter((candidate) => candidate.localId !== localId));
    } catch {
      updateAttachment(localId, {
        state: "error",
        error: "Could not remove this upload. Try again.",
      });
    }
  };

  const submit = async () => {
    if (!canSubmit()) return;
    const text = body().trim();
    const attachmentIds = availableAttachmentIds();
    const submittedAttachments = attachments();
    const submittedDraftKey = props.draftKey;
    setSubmitting(true);
    try {
      await props.onSubmit(text || undefined, attachmentIds);
      for (const attachment of submittedAttachments) revokePreview(attachment);
      clearLocalDraft(submittedDraftKey);
      if (props.draftKey === submittedDraftKey) setBody("");
      setAttachments([]);
    } catch {
      return;
    } finally {
      setSubmitting(false);
    }
  };

  onCleanup(() => {
    const unattachedIds = availableAttachmentIds();
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
    for (const attachment of attachments()) revokePreview(attachment);
    void Promise.allSettled(
      unattachedIds.map(async (attachmentId) =>
        await props.discardAttachment(attachmentId),
      ),
    );
  });

  return (
    <div
      class="comment-form comment-drop-target"
      data-dragging={dragging()}
      onDragEnter={(event) => {
        if (![...(event.dataTransfer?.types ?? [])].includes("Files")) return;
        event.preventDefault();
        event.stopPropagation();
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (![...(event.dataTransfer?.types ?? [])].includes("Files")) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDragging(false);
      }}
      onDrop={(event) => {
        if (![...(event.dataTransfer?.types ?? [])].includes("Files")) return;
        event.preventDefault();
        event.stopPropagation();
        setDragging(false);
        addFiles([...(event.dataTransfer?.files ?? [])]);
      }}
    >
      <textarea
        class="textarea"
        data-comment-composer
        aria-keyshortcuts="Meta+Enter Control+Enter"
        value={body()}
        onInput={(event) => {
          const nextBody = event.currentTarget.value;
          setBody(nextBody);
          writeLocalDraft(props.draftKey, nextBody);
        }}
        onPaste={(event) => {
          const files = pastedFiles(event.clipboardData);
          if (files.length === 0) return;
          event.preventDefault();
          addFiles(files);
        }}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            void submit();
          }
        }}
        placeholder="Add a comment…"
        aria-label="Add a comment"
        rows={2}
      />

      <MarkdownDraftPreview source={body()} label="comment" />

      <Show when={attachments().length > 0}>
        <div class="attachment-tray" aria-label="Comment attachments">
          <For each={attachments()}>{(attachment) => (
            <div class="attachment-row" data-state={attachment.state}>
              <Show
                when={attachment.previewUrl}
                fallback={<div class="attachment-row__icon">{attachmentKind(attachment.file)}</div>}
              >
                {(previewUrl) => (
                  <div class="attachment-row__preview" aria-hidden="true">
                    <Show
                      when={attachmentKind(attachment.file) === "IMG"}
                      fallback={<video src={previewUrl()} muted />}
                    >
                      <img src={previewUrl()} alt="" />
                    </Show>
                  </div>
                )}
              </Show>
              <div class="attachment-row__copy">
                <div class="attachment-row__name">{attachment.file.name}</div>
                <div class="attachment-row__state">
                  <span>{formatAttachmentBytes(attachment.file.size)}</span>
                  <span> · </span>
                  <span>
                    {attachment.state === "available"
                      ? "ready"
                      : attachment.state === "error"
                        ? attachment.error
                        : attachment.state === "removing"
                          ? "removing…"
                          : attachment.phase === "reserving"
                            ? "reserving secure upload…"
                            : "uploading directly to secure storage…"}
                  </span>
                </div>
                <Show when={attachment.state === "uploading"}>
                  <div
                    class="attachment-progress"
                    role="progressbar"
                    aria-label={`Uploading ${attachment.file.name}`}
                    aria-valuemin="0"
                    aria-valuemax="100"
                    aria-valuenow={attachment.progress}
                  >
                    <span style={{ width: `${attachment.progress}%` }} />
                  </div>
                </Show>
              </div>
              <Show
                when={
                  attachment.state === "error" &&
                  attachmentSelectionError(attachment.file) === undefined
                }
              >
                <button
                  class="attachment-row__action"
                  type="button"
                  onClick={() => void upload(attachment.localId)}
                >
                  Retry
                </button>
              </Show>
              <button
                class="attachment-row__action"
                type="button"
                disabled={attachment.state === "removing"}
                aria-label={`Remove ${attachment.file.name}`}
                onClick={() => void removeAttachment(attachment.localId)}
              >
                {attachment.state === "uploading" ? "Cancel" : "Remove"}
              </button>
            </div>
          )}</For>
        </div>
      </Show>

      <div class="comment-form__actions">
        <input
          ref={fileInput}
          class="visually-hidden"
          type="file"
          multiple
          tabindex="-1"
          aria-label="Choose files to attach to comment"
          onChange={(event) => {
            addFiles([...(event.currentTarget.files ?? [])]);
            event.currentTarget.value = "";
          }}
        />
        <button
          class="button button--quiet"
          type="button"
          disabled={submitting() || attachments().length >= MAX_INTAKE_ATTACHMENTS}
          onClick={() => fileInput?.click()}
        >
          + Attach
        </button>
        <span class="comment-form__hint mono" aria-live="polite">
          {uploadPending()
            ? "finish uploads before submitting"
            : uploadFailed()
              ? "remove or retry failed uploads"
              : body()
                ? "draft saved on this device · ⌘ enter to submit"
                : "Markdown supported · paste or drop files · ⌘ enter to submit"}
        </span>
        <button
          class="button"
          type="button"
          disabled={!canSubmit()}
          onClick={() => void submit()}
        >
          {submitting() ? "Adding…" : "Add comment"}
        </button>
      </div>
      <Show when={dragging()}>
        <div class="comment-drop-target__label" role="status">Drop to attach to this comment</div>
      </Show>
    </div>
  );
}
