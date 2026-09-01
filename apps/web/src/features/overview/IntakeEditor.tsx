import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
  untrack,
} from "solid-js";

import {
  attachmentKind,
  attachmentSelectionError,
  formatAttachmentBytes,
  MAX_INTAKE_ATTACHMENTS,
} from "../../lib/attachment-upload";
import {
  intakeUpdateErrorCode,
  parseIntakeLinks,
} from "../../lib/intake-editing";
import type {
  IntakeUpdateInput,
  IntakeUpdateResult,
} from "../../lib/project-data";
import type { Intake } from "./model";

type PendingAttachment = {
  localId: string;
  file: File;
  previewUrl?: string;
  state: "uploading" | "available" | "error" | "removing";
  progress: number;
  phase: "reserving" | "uploading" | "available";
  attachmentId?: string;
  error?: string;
};

type IntakeEditorProps = {
  intake: Intake;
  onSave: (input: IntakeUpdateInput) => Promise<IntakeUpdateResult>;
  uploadAttachment: (
    file: File,
    onProgress: (progress: number, phase: "reserving" | "uploading" | "available") => void,
    signal: AbortSignal,
  ) => Promise<string>;
  discardAttachment: (attachmentId: string) => Promise<void>;
  announce: (message: string) => void;
};

function editableText(intake: Intake): string {
  return intake.submittedText ?? "";
}

function editableContext(intake: Intake): string {
  return intake.context ?? "";
}

function editableLinks(intake: Intake): string {
  return (intake.links ?? []).join("\n");
}

export function IntakeEditor(props: IntakeEditorProps) {
  const [text, setText] = createSignal(editableText(props.intake));
  const [context, setContext] = createSignal(editableContext(props.intake));
  const [links, setLinks] = createSignal(editableLinks(props.intake));
  const [baseText, setBaseText] = createSignal(text());
  const [baseContext, setBaseContext] = createSignal(context());
  const [baseLinks, setBaseLinks] = createSignal(links());
  const [baseRevision, setBaseRevision] = createSignal(props.intake.revision ?? 1);
  const [attachments, setAttachments] = createSignal<PendingAttachment[]>([]);
  const [status, setStatus] = createSignal<"idle" | "saving" | "saved" | "synced" | "conflict" | "error">("idle");
  const [message, setMessage] = createSignal("");
  const [saveKey, setSaveKey] = createSignal(crypto.randomUUID());
  const [saveFingerprint, setSaveFingerprint] = createSignal("");
  const controllers = new Map<string, AbortController>();
  let currentIntakeId = props.intake.id;
  let lastIncomingRevision = props.intake.revision ?? 1;
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
  const dirty = createMemo(() =>
    text() !== baseText() ||
    context() !== baseContext() ||
    links() !== baseLinks() ||
    attachments().length > 0,
  );

  const updateAttachment = (localId: string, update: Partial<PendingAttachment>) => {
    setAttachments((items) => items.map((item) =>
      item.localId === localId ? { ...item, ...update } : item,
    ));
  };

  const revokePreview = (attachment: PendingAttachment) => {
    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
  };

  const discardPending = (items = attachments()) => {
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
    for (const attachment of items) revokePreview(attachment);
    setAttachments([]);
    void Promise.allSettled(items.flatMap((attachment) =>
      attachment.attachmentId
        ? [props.discardAttachment(attachment.attachmentId)]
        : [],
    ));
  };

  const applyLatest = (nextStatus: "idle" | "synced") => {
    const nextText = editableText(props.intake);
    const nextContext = editableContext(props.intake);
    const nextLinks = editableLinks(props.intake);
    const nextRevision = props.intake.revision ?? 1;
    setText(nextText);
    setContext(nextContext);
    setLinks(nextLinks);
    setBaseText(nextText);
    setBaseContext(nextContext);
    setBaseLinks(nextLinks);
    setBaseRevision(nextRevision);
    lastIncomingRevision = nextRevision;
    setStatus(nextStatus);
    setMessage(nextStatus === "synced" ? "Updated from live project activity." : "");
  };

  createEffect(() => {
    const incomingId = props.intake.id;
    const incomingRevision = props.intake.revision ?? 1;
    if (incomingId !== currentIntakeId) {
      currentIntakeId = incomingId;
      discardPending();
      applyLatest("idle");
      setSaveKey(crypto.randomUUID());
      setSaveFingerprint("");
      return;
    }
    if (incomingRevision === lastIncomingRevision) return;
    lastIncomingRevision = incomingRevision;
    if (untrack(dirty)) {
      if (!props.intake.editable) {
        setStatus("error");
        setMessage("The agent finished processing this item before your save. Your edits are still here for review.");
      } else {
        setStatus("conflict");
        setMessage("This Inbox item changed elsewhere. Your unsaved edits and uploads are still here.");
      }
      return;
    }
    applyLatest("synced");
  });

  const upload = async (localId: string) => {
    const attachment = attachments().find((item) => item.localId === localId);
    if (!attachment || attachment.state === "removing") return;
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
        error: error instanceof Error && /250 MB|quota/i.test(error.message)
          ? error.message
          : "Upload interrupted. Retry when you are online.",
      });
    } finally {
      if (controllers.get(localId) === controller) controllers.delete(localId);
    }
  };

  const addFiles = (files: File[]) => {
    if (files.length === 0) return;
    const existingCount = props.intake.attachments?.length ?? 0;
    const remaining = MAX_INTAKE_ATTACHMENTS - existingCount - attachments().length;
    if (remaining <= 0) {
      props.announce(`An Inbox item may include at most ${MAX_INTAKE_ATTACHMENTS} attachments`);
      return;
    }
    const accepted = files.slice(0, remaining).map((file) => {
      const error = attachmentSelectionError(file);
      const kind = attachmentKind(file);
      return {
        localId: crypto.randomUUID(),
        file,
        ...(!error && kind !== "FILE" ? { previewUrl: URL.createObjectURL(file) } : {}),
        state: error ? "error" as const : "uploading" as const,
        phase: "reserving" as const,
        progress: error ? 0 : 4,
        ...(error ? { error } : {}),
      } satisfies PendingAttachment;
    });
    setAttachments((items) => [...items, ...accepted]);
    for (const attachment of accepted) {
      if (!attachment.error) void upload(attachment.localId);
    }
    if (files.length > remaining) props.announce(`Only the first ${remaining} files were added`);
  };

  const removeAttachment = async (localId: string) => {
    const attachment = attachments().find((item) => item.localId === localId);
    if (!attachment || attachment.state === "removing") return;
    controllers.get(localId)?.abort();
    controllers.delete(localId);
    if (!attachment.attachmentId) {
      revokePreview(attachment);
      setAttachments((items) => items.filter((item) => item.localId !== localId));
      return;
    }
    updateAttachment(localId, { state: "removing" });
    try {
      await props.discardAttachment(attachment.attachmentId);
      revokePreview(attachment);
      setAttachments((items) => items.filter((item) => item.localId !== localId));
    } catch {
      updateAttachment(localId, { state: "error", error: "Could not remove this upload. Try again." });
    }
  };

  const keepEdits = () => {
    const latestText = editableText(props.intake);
    const latestContext = editableContext(props.intake);
    const latestLinks = editableLinks(props.intake);
    setBaseText(latestText);
    setBaseContext(latestContext);
    setBaseLinks(latestLinks);
    setBaseRevision(props.intake.revision ?? lastIncomingRevision);
    setStatus("idle");
    setMessage("Latest version loaded. Your edits are kept and ready to save.");
    setSaveKey(crypto.randomUUID());
    setSaveFingerprint("");
  };

  const markEdited = () => {
    if (status() === "conflict") return;
    setStatus("idle");
    setMessage("");
  };

  const useLatest = () => {
    discardPending();
    applyLatest("synced");
    setMessage("Latest version loaded. Your unsaved edits were discarded.");
    setSaveKey(crypto.randomUUID());
    setSaveFingerprint("");
  };

  const save = async () => {
    if (!props.intake.editable || status() === "saving" || uploadPending() || uploadFailed() || !dirty()) return;
    const parsedLinks = parseIntakeLinks(links());
    if (parsedLinks.error) {
      setStatus("error");
      setMessage(parsedLinks.error);
      return;
    }
    const submittedText = text().trim();
    if (!submittedText && (props.intake.attachments?.length ?? 0) + readyAttachmentIds().length === 0) {
      setStatus("error");
      setMessage("Add text or at least one attachment before saving.");
      return;
    }
    const payload = {
      intakeId: props.intake.id,
      expectedRevision: baseRevision(),
      text: submittedText,
      context: context().trim(),
      links: parsedLinks.links,
      addAttachmentIds: readyAttachmentIds(),
    };
    const fingerprint = JSON.stringify(payload);
    if (fingerprint !== saveFingerprint()) {
      setSaveFingerprint(fingerprint);
      setSaveKey(crypto.randomUUID());
    }
    setStatus("saving");
    setMessage("Saving changes…");
    try {
      const result = await props.onSave({ ...payload, idempotencyKey: saveKey() });
      const submittedAttachments = attachments();
      for (const attachment of submittedAttachments) revokePreview(attachment);
      setAttachments([]);
      setBaseText(submittedText);
      setBaseContext(context().trim());
      setBaseLinks(parsedLinks.links.join("\n"));
      setText(submittedText);
      setContext(context().trim());
      setLinks(parsedLinks.links.join("\n"));
      setBaseRevision(result.revision);
      lastIncomingRevision = result.revision;
      setStatus("saved");
      setMessage("Changes saved. Connected views update in real time.");
      setSaveFingerprint("");
      setSaveKey(crypto.randomUUID());
      props.announce("Inbox item updated");
    } catch (error) {
      const code = intakeUpdateErrorCode(error);
      if (code === "revision_conflict") {
        setStatus("conflict");
        setMessage("This Inbox item changed elsewhere. Your unsaved edits and uploads are still here.");
      } else if (code === "invalid_transition") {
        setStatus("error");
        setMessage("The agent finished processing this item before your save. Your edits are still here for review.");
      } else {
        setStatus("error");
        setMessage("Changes could not be saved. Your edits are still here; try again.");
      }
    }
  };

  onCleanup(() => discardPending());

  return (
    <section class="detail-section" aria-labelledby="edit-intake-label">
      <div class="detail-section__label" id="edit-intake-label">edit intake</div>
      <div class="detail-card intake-editor">
        <label class="intake-editor__field">
          <span>Text</span>
          <textarea class="textarea" value={text()} rows={3} disabled={!props.intake.editable || status() === "saving"} onInput={(event) => { setText(event.currentTarget.value); markEdited(); }} />
        </label>
        <label class="intake-editor__field">
          <span>Context</span>
          <textarea class="textarea" value={context()} rows={3} placeholder="Add background, constraints, or what good looks like…" disabled={!props.intake.editable || status() === "saving"} onInput={(event) => { setContext(event.currentTarget.value); markEdited(); }} />
        </label>
        <label class="intake-editor__field">
          <span>Links <span class="meta">· one per line</span></span>
          <textarea class="textarea" value={links()} rows={2} placeholder="https://…" disabled={!props.intake.editable || status() === "saving"} onInput={(event) => { setLinks(event.currentTarget.value); markEdited(); }} />
        </label>

        <Show when={attachments().length > 0}>
          <div class="attachment-tray" aria-label="New Intake attachments">
            <For each={attachments()}>{(attachment) => (
              <div class="attachment-row" data-state={attachment.state}>
                <Show when={attachment.previewUrl} fallback={<div class="attachment-row__icon">{attachmentKind(attachment.file)}</div>}>
                  {(previewUrl) => <div class="attachment-row__preview" aria-hidden="true"><img src={previewUrl()} alt="" /></div>}
                </Show>
                <div class="attachment-row__copy">
                  <div class="attachment-row__name">{attachment.file.name}</div>
                  <div class="attachment-row__state">
                    {formatAttachmentBytes(attachment.file.size)} · {attachment.state === "available"
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
                    <div class="attachment-progress" role="progressbar" aria-label={`Uploading ${attachment.file.name}`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={attachment.progress}>
                      <span style={{ width: `${attachment.progress}%` }} />
                    </div>
                  </Show>
                </div>
                <Show when={attachment.state === "error" && attachmentSelectionError(attachment.file) === undefined}>
                  <button class="attachment-row__action" type="button" onClick={() => void upload(attachment.localId)}>Retry</button>
                </Show>
                <button class="attachment-row__action" type="button" disabled={attachment.state === "removing"} aria-label={`Remove ${attachment.file.name}`} onClick={() => void removeAttachment(attachment.localId)}>
                  {attachment.state === "uploading" ? "Cancel" : "Remove"}
                </button>
              </div>
            )}</For>
          </div>
        </Show>

        <div class="intake-editor__actions">
          <input ref={fileInput} class="visually-hidden" type="file" multiple tabindex="-1" aria-label="Choose files to add to Intake" onChange={(event) => { addFiles([...(event.currentTarget.files ?? [])]); event.currentTarget.value = ""; }} />
          <button class="button button--quiet" type="button" disabled={!props.intake.editable || status() === "saving" || (props.intake.attachments?.length ?? 0) + attachments().length >= MAX_INTAKE_ATTACHMENTS} onClick={() => fileInput?.click()}>+ Add files</button>
          <span class="intake-editor__status" data-status={status()} role={status() === "error" || status() === "conflict" ? "alert" : "status"} aria-live="polite">
            {message() || (dirty() ? "Unsaved changes." : "No unsaved changes.")}
          </span>
          <button class="button" type="button" disabled={!props.intake.editable || !dirty() || status() === "saving" || uploadPending() || uploadFailed() || status() === "conflict"} onClick={() => void save()}>
            {status() === "saving" ? "Saving…" : "Save changes"}
          </button>
        </div>
        <Show when={status() === "conflict"}>
          <div class="intake-editor__conflict-actions">
            <button class="button" type="button" onClick={keepEdits}>Keep my edits</button>
            <button class="button button--quiet" type="button" onClick={useLatest}>Use latest</button>
          </div>
        </Show>
        <Show when={!props.intake.editable}>
          <p class="note">This Inbox item has been processed, so its submitted details are read-only.</p>
        </Show>
      </div>
    </section>
  );
}
