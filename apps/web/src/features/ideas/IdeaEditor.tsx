import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js";

import { MarkdownContent } from "../../components/MarkdownContent";
import {
  attachmentKind,
  attachmentSelectionError,
  formatAttachmentBytes,
  MAX_INTAKE_ATTACHMENTS,
} from "../../lib/attachment-upload";
import { ideaDraftKey, ideaErrorCode } from "../../lib/idea-editing";
import { parseIntakeLinks } from "../../lib/intake-editing";
import { clearLocalDraft, readLocalDraft, writeLocalDraft } from "../../lib/local-drafts";
import type {
  IdeaCreateInput,
  IdeaDetail,
  IdeaMutationResult,
  IdeaUpdateInput,
} from "../../lib/project-data";

type DraftAttachment = {
  localId: string;
  file?: File;
  filename: string;
  mimeType: string;
  byteSize: number;
  previewUrl?: string;
  state: "uploading" | "available" | "error" | "removing";
  progress: number;
  phase: "reserving" | "uploading" | "available";
  attachmentId?: string;
  error?: string;
};

type StoredIdeaDraft = {
  title: string;
  text: string;
  context: string;
  links: string;
  attachments: Array<{
    attachmentId: string;
    filename: string;
    mimeType: string;
    byteSize: number;
  }>;
};

export type IdeaEditorProps = {
  projectId: string;
  idea?: IdeaDetail;
  onCreate: (input: IdeaCreateInput) => Promise<IdeaMutationResult & { created: boolean }>;
  onUpdate: (input: IdeaUpdateInput) => Promise<IdeaMutationResult>;
  onSaved: (ideaId: string) => void;
  uploadAttachment: (
    file: File,
    onProgress: (progress: number, phase: "reserving" | "uploading" | "available") => void,
    signal: AbortSignal,
  ) => Promise<string>;
  discardAttachment: (attachmentId: string) => Promise<void>;
  announce: (message: string) => void;
};

function storedDraft(key: string): StoredIdeaDraft | undefined {
  const value = readLocalDraft(key);
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<StoredIdeaDraft>;
    if (
      typeof parsed.title !== "string" ||
      typeof parsed.text !== "string" ||
      typeof parsed.context !== "string" ||
      typeof parsed.links !== "string" ||
      !Array.isArray(parsed.attachments)
    ) return undefined;
    return {
      title: parsed.title,
      text: parsed.text,
      context: parsed.context,
      links: parsed.links,
      attachments: parsed.attachments.flatMap((attachment) =>
        attachment &&
        typeof attachment === "object" &&
        typeof attachment.attachmentId === "string" &&
        typeof attachment.filename === "string" &&
        typeof attachment.mimeType === "string" &&
        typeof attachment.byteSize === "number"
          ? [{
              attachmentId: attachment.attachmentId,
              filename: attachment.filename,
              mimeType: attachment.mimeType,
              byteSize: attachment.byteSize,
            }]
          : [],
      ),
    };
  } catch {
    return undefined;
  }
}

function ideaFields(idea: IdeaDetail | undefined) {
  return {
    title: idea?.title ?? "",
    text: idea?.text ?? "",
    context: idea?.context ?? "",
    links: (idea?.links ?? []).join("\n"),
  };
}

function captureDraftBody(draft: StoredIdeaDraft | undefined): string {
  if (!draft) return "";
  return [draft.text, draft.context, draft.links]
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n\n");
}

function pastedFiles(clipboard: DataTransfer | null): File[] {
  if (!clipboard) return [];
  const itemFiles = [...clipboard.items].flatMap((item) => {
    const file = item.kind === "file" ? item.getAsFile() : null;
    return file ? [file] : [];
  });
  return itemFiles.length > 0 ? itemFiles : [...clipboard.files];
}

export function IdeaEditor(props: IdeaEditorProps) {
  const initial = ideaFields(props.idea);
  const initialDraftKey = ideaDraftKey(props.projectId, props.idea?._id);
  const initialDraft = storedDraft(initialDraftKey);
  const [title, setTitle] = createSignal(initialDraft?.title ?? initial.title);
  const [text, setText] = createSignal(props.idea
    ? initialDraft?.text ?? initial.text
    : captureDraftBody(initialDraft));
  const [context, setContext] = createSignal(props.idea ? initialDraft?.context ?? initial.context : "");
  const [links, setLinks] = createSignal(props.idea ? initialDraft?.links ?? initial.links : "");
  const [baseTitle, setBaseTitle] = createSignal(initial.title);
  const [baseText, setBaseText] = createSignal(initial.text);
  const [baseContext, setBaseContext] = createSignal(initial.context);
  const [baseLinks, setBaseLinks] = createSignal(initial.links);
  const [baseRevision, setBaseRevision] = createSignal(props.idea?.revision ?? 0);
  const [attachments, setAttachments] = createSignal<DraftAttachment[]>((initialDraft?.attachments ?? []).map((attachment) => ({
    localId: crypto.randomUUID(),
    ...attachment,
    state: "available",
    phase: "available",
    progress: 100,
  })));
  const [status, setStatus] = createSignal<"idle" | "saving" | "saved" | "synced" | "conflict" | "error">("idle");
  const [message, setMessage] = createSignal(initialDraft ? "Draft restored for this Idea." : "");
  const [saveKey, setSaveKey] = createSignal(crypto.randomUUID());
  const [saveFingerprint, setSaveFingerprint] = createSignal("");
  const [draggingFiles, setDraggingFiles] = createSignal(false);
  const controllers = new Map<string, AbortController>();
  let fileDragDepth = 0;
  let captureInput: HTMLTextAreaElement | undefined;
  let activeDraftKey = initialDraftKey;
  let activeIdeaId = props.idea?._id;
  let lastIncomingRevision = props.idea?.revision ?? 0;
  let fileInput: HTMLInputElement | undefined;

  const readyAttachmentIds = createMemo(() => attachments().flatMap((attachment) =>
    attachment.state === "available" && attachment.attachmentId
      ? [attachment.attachmentId]
      : [],
  ));
  const uploadPending = createMemo(() => attachments().some((attachment) =>
    attachment.state === "uploading" || attachment.state === "removing",
  ));
  const uploadFailed = createMemo(() => attachments().some((attachment) => attachment.state === "error"));
  const editable = createMemo(() => props.idea === undefined || props.idea.state === "open");
  const dirty = createMemo(() =>
    title() !== baseTitle() ||
    text() !== baseText() ||
    context() !== baseContext() ||
    links() !== baseLinks() ||
    attachments().length > 0,
  );
  const hasCreateTitle = createMemo(() => title().trim().length > 0);

  const revokePreview = (attachment: DraftAttachment) => {
    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
  };

  const persistedAttachments = () => attachments().flatMap((attachment) =>
    attachment.state === "available" && attachment.attachmentId
      ? [{
          attachmentId: attachment.attachmentId,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          byteSize: attachment.byteSize,
        }]
      : [],
  );

  const restoreTarget = (nextIdea: IdeaDetail | undefined) => {
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
    for (const attachment of attachments()) revokePreview(attachment);
    const base = ideaFields(nextIdea);
    const key = ideaDraftKey(props.projectId, nextIdea?._id);
    const saved = storedDraft(key);
    setBaseTitle(base.title);
    setBaseText(base.text);
    setBaseContext(base.context);
    setBaseLinks(base.links);
    setBaseRevision(nextIdea?.revision ?? 0);
    setTitle(saved?.title ?? base.title);
    setText(nextIdea ? saved?.text ?? base.text : captureDraftBody(saved));
    setContext(nextIdea ? saved?.context ?? base.context : "");
    setLinks(nextIdea ? saved?.links ?? base.links : "");
    setAttachments((saved?.attachments ?? []).map((attachment) => ({
      localId: crypto.randomUUID(),
      ...attachment,
      state: "available",
      phase: "available",
      progress: 100,
    })));
    activeDraftKey = key;
    activeIdeaId = nextIdea?._id;
    lastIncomingRevision = nextIdea?.revision ?? 0;
    setStatus("idle");
    setMessage(saved ? "Draft restored for this Idea." : "");
    setSaveKey(crypto.randomUUID());
    setSaveFingerprint("");
  };

  createEffect(() => {
    const incomingId = props.idea?._id;
    const incomingRevision = props.idea?.revision ?? 0;
    if (incomingId !== activeIdeaId) {
      restoreTarget(props.idea);
      return;
    }
    if (incomingRevision === lastIncomingRevision) return;
    lastIncomingRevision = incomingRevision;
    if (untrack(dirty)) {
      setStatus("conflict");
      setMessage("This Idea changed elsewhere. Your unsaved edits and finalized uploads are still here.");
      return;
    }
    const latest = ideaFields(props.idea);
    setTitle(latest.title);
    setText(latest.text);
    setContext(latest.context);
    setLinks(latest.links);
    setBaseTitle(latest.title);
    setBaseText(latest.text);
    setBaseContext(latest.context);
    setBaseLinks(latest.links);
    setBaseRevision(incomingRevision);
    setStatus("synced");
    setMessage("Updated from live Ideas activity.");
  });

  createEffect(() => {
    const draft: StoredIdeaDraft = {
      title: title(), text: text(), context: context(), links: links(),
      attachments: persistedAttachments(),
    };
    if (dirty()) writeLocalDraft(activeDraftKey, JSON.stringify(draft));
    else clearLocalDraft(activeDraftKey);
  });

  const updateAttachment = (localId: string, update: Partial<DraftAttachment>) => {
    setAttachments((items) => items.map((item) => item.localId === localId ? { ...item, ...update } : item));
  };

  const upload = async (localId: string) => {
    const attachment = attachments().find((item) => item.localId === localId);
    if (!attachment?.file || attachment.state === "removing") return;
    controllers.get(localId)?.abort();
    const controller = new AbortController();
    controllers.set(localId, controller);
    updateAttachment(localId, { state: "uploading", phase: "reserving", progress: 8, error: undefined });
    try {
      const attachmentId = await props.uploadAttachment(
        attachment.file,
        (progress, phase) => updateAttachment(localId, { progress, phase }),
        controller.signal,
      );
      if (controller.signal.aborted) {
        await props.discardAttachment(attachmentId).catch(() => undefined);
        return;
      }
      updateAttachment(localId, {
        attachmentId,
        state: "available",
        phase: "available",
        progress: 100,
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      updateAttachment(localId, {
        state: "error",
        progress: 0,
        error: error instanceof Error && /250 MB|quota/iu.test(error.message)
          ? error.message
          : "Upload interrupted. Retry when you are online.",
      });
    } finally {
      if (controllers.get(localId) === controller) controllers.delete(localId);
    }
  };

  const addFiles = (files: File[]) => {
    if (files.length === 0) return;
    const existingCount = props.idea?.attachmentCount ?? 0;
    const remaining = MAX_INTAKE_ATTACHMENTS - existingCount - attachments().length;
    if (remaining <= 0) {
      props.announce(`An Idea may include at most ${MAX_INTAKE_ATTACHMENTS} attachments`);
      return;
    }
    const accepted = files.slice(0, remaining).map((file) => {
      const error = attachmentSelectionError(file);
      const kind = attachmentKind(file);
      return {
        localId: crypto.randomUUID(),
        file,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        byteSize: file.size,
        ...(!error && kind !== "FILE" ? { previewUrl: URL.createObjectURL(file) } : {}),
        state: error ? "error" as const : "uploading" as const,
        phase: "reserving" as const,
        progress: error ? 0 : 4,
        ...(error ? { error } : {}),
      } satisfies DraftAttachment;
    });
    setAttachments((items) => [...items, ...accepted]);
    markEdited();
    for (const attachment of accepted) if (!attachment.error) void upload(attachment.localId);
    if (files.length > remaining) props.announce(`Only the first ${remaining} files were added`);
  };

  const attachPastedFiles = (event: ClipboardEvent) => {
    const files = pastedFiles(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    addFiles(files);
    props.announce(`${files.length} pasted file${files.length === 1 ? "" : "s"} added`);
  };

  const carriesFiles = (transfer: DataTransfer | null) =>
    [...(transfer?.types ?? [])].includes("Files");

  const enterFileDrop = (event: DragEvent) => {
    if (!carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    fileDragDepth += 1;
    setDraggingFiles(true);
  };

  const continueFileDrop = (event: DragEvent) => {
    if (!carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    setDraggingFiles(true);
  };

  const leaveFileDrop = (event: DragEvent) => {
    if (!draggingFiles()) return;
    event.preventDefault();
    fileDragDepth = Math.max(0, fileDragDepth - 1);
    if (fileDragDepth === 0 || event.relatedTarget === null) {
      fileDragDepth = 0;
      setDraggingFiles(false);
    }
  };

  const dropFiles = (event: DragEvent) => {
    if (!carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    fileDragDepth = 0;
    setDraggingFiles(false);
    addFiles([...(event.dataTransfer?.files ?? [])]);
  };

  const removeAttachment = async (localId: string) => {
    const attachment = attachments().find((item) => item.localId === localId);
    if (!attachment || attachment.state === "removing") return;
    controllers.get(localId)?.abort();
    controllers.delete(localId);
    if (attachment.attachmentId) {
      updateAttachment(localId, { state: "removing" });
      try {
        await props.discardAttachment(attachment.attachmentId);
      } catch {
        updateAttachment(localId, { state: "error", error: "Could not remove this upload. Try again." });
        return;
      }
    }
    revokePreview(attachment);
    setAttachments((items) => items.filter((item) => item.localId !== localId));
  };

  const keepEdits = () => {
    const latest = ideaFields(props.idea);
    setBaseTitle(latest.title);
    setBaseText(latest.text);
    setBaseContext(latest.context);
    setBaseLinks(latest.links);
    setBaseRevision(props.idea?.revision ?? lastIncomingRevision);
    setStatus("idle");
    setMessage("Latest version loaded. Your edits are kept and ready to save.");
    setSaveKey(crypto.randomUUID());
    setSaveFingerprint("");
  };

  const useLatest = () => {
    const pending = attachments();
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
    void Promise.allSettled(pending.flatMap((attachment) =>
      attachment.attachmentId ? [props.discardAttachment(attachment.attachmentId)] : [],
    ));
    clearLocalDraft(activeDraftKey);
    restoreTarget(props.idea);
    setStatus("synced");
    setMessage("Latest version loaded. Your draft was discarded.");
  };

  const markEdited = () => {
    if (status() !== "conflict") {
      setStatus("idle");
      setMessage("");
    }
  };

  const save = async () => {
    if (
      !editable() || status() === "saving" || uploadPending() || uploadFailed() ||
      !dirty() || (!props.idea && !hasCreateTitle())
    ) return;
    const normalizedTitle = title().trim();
    if (!normalizedTitle) {
      setStatus("error");
      setMessage("Give this Idea a title.");
      return;
    }
    let normalizedLinks: string[] = [];
    if (props.idea) {
      const parsed = parseIntakeLinks(links());
      if (parsed.error) {
        setStatus("error");
        setMessage(parsed.error);
        return;
      }
      normalizedLinks = parsed.links;
    }
    const values = {
      title: normalizedTitle,
      text: text().trim(),
      context: props.idea ? context().trim() : "",
      links: normalizedLinks,
    };
    const payload = props.idea
      ? {
          ideaId: props.idea._id,
          expectedRevision: baseRevision(),
          ...values,
          addAttachmentIds: readyAttachmentIds(),
        }
      : {
          ...values,
          attachmentIds: readyAttachmentIds(),
        };
    const fingerprint = JSON.stringify(payload);
    if (fingerprint !== saveFingerprint()) {
      setSaveFingerprint(fingerprint);
      setSaveKey(crypto.randomUUID());
    }
    setStatus("saving");
    setMessage(props.idea ? "Saving changes…" : "Capturing Idea…");
    try {
      const result = props.idea
        ? await props.onUpdate({ ...payload, idempotencyKey: saveKey() } as IdeaUpdateInput)
        : await props.onCreate({ ...payload, idempotencyKey: saveKey() } as IdeaCreateInput);
      for (const attachment of attachments()) revokePreview(attachment);
      setAttachments([]);
      setTitle(values.title);
      setText(values.text);
      setContext(values.context);
      setLinks(values.links.join("\n"));
      setBaseTitle(values.title);
      setBaseText(values.text);
      setBaseContext(values.context);
      setBaseLinks(values.links.join("\n"));
      setBaseRevision(result.revision);
      lastIncomingRevision = result.revision;
      clearLocalDraft(activeDraftKey);
      setStatus("saved");
      setMessage(props.idea ? "Changes saved. Connected views update in real time." : "Idea captured.");
      setSaveFingerprint("");
      setSaveKey(crypto.randomUUID());
      props.announce(props.idea ? "Idea updated" : "Idea captured");
      props.onSaved(result.ideaId);
    } catch (error) {
      const code = ideaErrorCode(error);
      if (code === "revision_conflict") {
        setStatus("conflict");
        setMessage("This Idea changed elsewhere. Your unsaved edits and finalized uploads are still here.");
      } else if (code === "invalid_transition") {
        setStatus("conflict");
        setMessage("This Idea changed state before your save. Your draft is still here for review.");
      } else {
        setStatus("error");
        setMessage("The Idea could not be saved. Your draft is still here; try again.");
      }
    }
  };

  const submitOnShortcut = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void save();
    }
  };

  onCleanup(() => {
    for (const controller of controllers.values()) controller.abort();
    for (const attachment of attachments()) revokePreview(attachment);
  });

  return (
    <form
      class="idea-editor"
      data-mode={props.idea ? "edit" : "create"}
      data-dragging={draggingFiles()}
      aria-busy={status() === "saving"}
      onSubmit={(event) => { event.preventDefault(); void save(); }}
      onDragEnter={enterFileDrop}
      onDragOver={continueFileDrop}
      onDragLeave={leaveFileDrop}
      onDrop={dropFiles}
    >
      <Show when={!props.idea} fallback={
        <>
          <label class="idea-editor__field">
            <span>Title</span>
            <input class="input" data-idea-title value={title()} maxlength="240" disabled={!editable() || status() === "saving"} onInput={(event) => { setTitle(event.currentTarget.value); markEdited(); }} placeholder="A possible direction…" />
          </label>
          <label class="idea-editor__field">
            <span>Idea <span class="meta">· Markdown supported</span></span>
            <textarea class="textarea" value={text()} rows={6} disabled={!editable() || status() === "saving"} aria-keyshortcuts="Control+Enter Meta+Enter" onInput={(event) => { setText(event.currentTarget.value); markEdited(); }} onPaste={attachPastedFiles} onKeyDown={submitOnShortcut} placeholder="Explore the thought without turning it into agent work yet…" />
          </label>
          <Show when={text().trim()}>
            <details class="idea-editor__preview">
              <summary>Preview formatted Idea</summary>
              <MarkdownContent source={text()} />
            </details>
          </Show>
          <label class="idea-editor__field">
            <span>Context</span>
            <textarea class="textarea" value={context()} rows={3} disabled={!editable() || status() === "saving"} onInput={(event) => { setContext(event.currentTarget.value); markEdited(); }} placeholder="Background, constraints, questions, or what would make this worth pursuing…" />
          </label>
          <label class="idea-editor__field">
            <span>Links <span class="meta">· one per line</span></span>
            <textarea class="textarea" value={links()} rows={2} disabled={!editable() || status() === "saving"} onInput={(event) => { setLinks(event.currentTarget.value); markEdited(); }} placeholder="https://…" />
          </label>
        </>
      }>
        <label class="idea-editor__field">
          <span>Title</span>
          <input
            class="input"
            data-idea-title
            autofocus
            required
            aria-required="true"
            value={title()}
            maxlength="240"
            disabled={!editable() || status() === "saving"}
            onInput={(event) => { setTitle(event.currentTarget.value); markEdited(); }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
                event.preventDefault();
                captureInput?.focus();
                return;
              }
              submitOnShortcut(event);
            }}
            placeholder="A possible direction…"
          />
        </label>
        <label class="idea-editor__field idea-editor__capture">
          <span>Idea <span class="meta">· Markdown supported</span></span>
          <textarea
            ref={captureInput}
            class="textarea"
            data-idea-capture
            value={text()}
            rows={10}
            disabled={!editable() || status() === "saving"}
            aria-describedby="idea-capture-hint"
            aria-keyshortcuts="Control+Enter Meta+Enter"
            onInput={(event) => { setText(event.currentTarget.value); markEdited(); }}
            onPaste={attachPastedFiles}
            onKeyDown={submitOnShortcut}
            placeholder="Write or paste your idea…"
          />
        </label>
        <p class="idea-editor__capture-hint" id="idea-capture-hint">Paste images or drop files here · Ctrl/⌘ + Enter to capture</p>
      </Show>

      <Show when={draggingFiles()}>
        <div class="idea-editor__drop-target" role="status" aria-live="polite">
          <span aria-hidden="true">+</span>
          <strong>Drop to attach</strong>
        </div>
      </Show>

      <Show when={attachments().length > 0}>
        <div class="attachment-tray" aria-label="New Idea attachments">
          <For each={attachments()}>{(attachment) => (
            <div class="attachment-row" data-state={attachment.state}>
              <Show when={attachment.previewUrl} fallback={<div class="attachment-row__icon">{attachment.file ? attachmentKind(attachment.file) : "FILE"}</div>}>
                {(previewUrl) => <div class="attachment-row__preview" aria-hidden="true"><img src={previewUrl()} alt="" /></div>}
              </Show>
              <div class="attachment-row__copy">
                <div class="attachment-row__name">{attachment.filename}</div>
                <div class="attachment-row__state">
                  {formatAttachmentBytes(attachment.byteSize)} · {attachment.state === "available"
                    ? "ready to save"
                    : attachment.state === "error"
                      ? attachment.error
                      : attachment.state === "removing"
                        ? "removing…"
                        : attachment.phase === "reserving"
                          ? "reserving secure upload…"
                          : "uploading directly to secure storage…"}
                </div>
                <Show when={attachment.state === "uploading"}>
                  <div class="attachment-progress" role="progressbar" aria-label={`Uploading ${attachment.filename}`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={attachment.progress}>
                    <span style={{ width: `${attachment.progress}%` }} />
                  </div>
                </Show>
              </div>
              <Show when={attachment.state === "error" && attachment.file && attachmentSelectionError(attachment.file) === undefined}>
                <button class="attachment-row__action" type="button" onClick={() => void upload(attachment.localId)}>Retry</button>
              </Show>
              <button class="attachment-row__action" type="button" disabled={attachment.state === "removing"} aria-label={`Remove ${attachment.filename}`} onClick={() => void removeAttachment(attachment.localId)}>
                {attachment.state === "uploading" ? "Cancel" : "Remove"}
              </button>
            </div>
          )}</For>
        </div>
      </Show>

      <div class="idea-editor__actions">
        <input ref={fileInput} class="visually-hidden" type="file" multiple tabindex="-1" aria-label="Choose files to add to Idea" onChange={(event) => { addFiles([...(event.currentTarget.files ?? [])]); event.currentTarget.value = ""; }} />
        <button class="button button--quiet" type="button" disabled={!editable() || status() === "saving" || (props.idea?.attachmentCount ?? 0) + attachments().length >= MAX_INTAKE_ATTACHMENTS} onClick={() => fileInput?.click()}>+ Add files</button>
        <span class="idea-editor__status" data-status={status()} role={status() === "error" || status() === "conflict" ? "alert" : "status"} aria-live="polite">
          {message() || (dirty() ? "Draft saved on this device." : "No unsaved changes.")}
        </span>
        <button class="button button--primary" type="submit" disabled={!editable() || !dirty() || (!props.idea && !hasCreateTitle()) || status() === "saving" || uploadPending() || uploadFailed() || status() === "conflict"}>
          {status() === "saving" ? (props.idea ? "Saving…" : "Capturing…") : (props.idea ? "Save changes" : "Capture idea")}
        </button>
      </div>
      <Show when={status() === "conflict"}>
        <div class="idea-editor__conflict-actions">
          <button class="button" type="button" onClick={keepEdits}>Keep my edits</button>
          <button class="button button--quiet" type="button" onClick={useLatest}>Use latest</button>
        </div>
      </Show>
      <Show when={!editable()}><p class="note">This Idea is historical and read-only.</p></Show>
    </form>
  );
}
