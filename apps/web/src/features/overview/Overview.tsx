import { useNavigate } from "@solidjs/router";
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Brand } from "../../components/Brand";
import { humanSession } from "../../lib/auth-client";
import {
  attachmentKind,
  attachmentSelectionError,
  formatAttachmentBytes,
  MAX_INTAKE_ATTACHMENTS,
} from "../../lib/attachment-upload";
import {
  createOptimisticIntake,
  mergeOptimisticIntakes,
} from "../../lib/optimistic-intake";
import { ProjectDataConnection } from "../../lib/project-data";
import type { Intake, WorkItem } from "./model";
import "./overview.css";

type OverviewProps = {
  orgSlug: string;
  projectSlug: string;
};

type SearchResult = {
  kind: "work" | "intake";
  id: string;
  identifier: string;
  title: string;
};

type DraftAttachment = {
  localId: string;
  file: File;
  state: "uploading" | "available" | "error" | "removing";
  phase: "reserving" | "uploading" | "available";
  progress: number;
  attachmentId?: string;
  error?: string;
};

export function Overview(props: OverviewProps) {
  const navigate = useNavigate();
  const [work, setWork] = createSignal<WorkItem[]>([]);
  const [intakes, setIntakes] = createSignal<Intake[]>([]);
  const [optimisticIntakes, setOptimisticIntakes] = createSignal<Intake[]>([]);
  const [draft, setDraft] = createSignal("");
  const [draftAttachments, setDraftAttachments] = createSignal<DraftAttachment[]>([]);
  const [submissionKey, setSubmissionKey] = createSignal(crypto.randomUUID());
  const [selectedWorkId, setSelectedWorkId] = createSignal<string>();
  const [selectedWorkDetail, setSelectedWorkDetail] = createSignal<WorkItem>();
  const [selectedIntakeId, setSelectedIntakeId] = createSignal<string>();
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [toast, setToast] = createSignal("");
  const [loading, setLoading] = createSignal(true);
  const [loadError, setLoadError] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [projectName, setProjectName] = createSignal(props.projectSlug);
  const [viewerInitials, setViewerInitials] = createSignal("ME");
  let connection: ProjectDataConnection | undefined;
  let unsubscribeOverview: (() => void) | undefined;
  let unsubscribeWork: (() => void) | undefined;
  let fileInput: HTMLInputElement | undefined;
  const uploadControllers = new Map<string, AbortController>();
  const pendingUploads = new Map<string, Promise<void>>();
  let disposed = false;

  const needs = createMemo(() => work().filter((item) => item.state === "needs"));
  const working = createMemo(() => work().filter((item) => item.state === "working"));
  const ready = createMemo(() => work().filter((item) => item.state === "ready"));
  const done = createMemo(() => work().filter((item) => item.state === "done"));
  const uploadPending = createMemo(() =>
    draftAttachments().some((attachment) =>
      attachment.state === "uploading" || attachment.state === "removing",
    ),
  );
  const uploadFailed = createMemo(() =>
    draftAttachments().some((attachment) => attachment.state === "error"),
  );
  const availableAttachmentIds = createMemo(() =>
    draftAttachments().flatMap((attachment) =>
      attachment.state === "available" && attachment.attachmentId
        ? [attachment.attachmentId]
        : [],
    ),
  );
  const visibleIntakes = createMemo(() =>
    mergeOptimisticIntakes(intakes(), optimisticIntakes()),
  );
  const selectedWork = createMemo(() => {
    const detail = selectedWorkDetail();
    return detail?.id === selectedWorkId()
      ? detail
      : work().find((item) => item.id === selectedWorkId());
  });
  const selectedIntake = createMemo(() =>
    visibleIntakes().find((item) => item.id === selectedIntakeId()),
  );

  const results = createMemo<SearchResult[]>(() => {
    const value = query().trim().toLowerCase();
    if (value.length < 2) return [];
    return [
      ...work()
        .filter((item) => `${item.title} ${item.goal} ${item.identifier}`.toLowerCase().includes(value))
        .map((item) => ({ kind: "work" as const, id: item.id, identifier: item.identifier, title: item.title })),
      ...visibleIntakes()
        .filter((item) => item.text.toLowerCase().includes(value))
        .map((item) => ({ kind: "intake" as const, id: item.id, identifier: "inbox", title: item.text })),
    ];
  });

  const announce = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  };

  const closeDetail = () => {
    unsubscribeWork?.();
    unsubscribeWork = undefined;
    setSelectedWorkDetail(undefined);
    setSelectedWorkId(undefined);
    setSelectedIntakeId(undefined);
  };

  const openWork = (id: string) => {
    unsubscribeWork?.();
    unsubscribeWork = undefined;
    setSelectedWorkDetail(undefined);
    setSelectedIntakeId(undefined);
    setSelectedWorkId(id);
    const item = work().find((candidate) => candidate.id === id);
    if (!item || !connection) return;
    if (item.unseen && item.attention) {
      void connection.markAttentionSeen(item.attention.id).catch(() => {
        announce("Could not mark the request as seen");
      });
    }
    unsubscribeWork = connection.subscribeWorkDetail(
      item,
      setSelectedWorkDetail,
      () => announce("Could not load the latest work detail"),
    );
  };

  const openIntake = (id: string) => {
    setSelectedWorkId(undefined);
    setSelectedIntakeId(id);
  };

  const updateDraftAttachment = (
    localId: string,
    update: Partial<DraftAttachment>,
  ) => {
    setDraftAttachments((items) => items.map((item) =>
      item.localId === localId ? { ...item, ...update } : item,
    ));
  };

  const uploadDraftAttachment = async (localId: string) => {
    const item = draftAttachments().find((candidate) => candidate.localId === localId);
    if (!item || !connection || item.state === "removing") return;
    const controller = new AbortController();
    uploadControllers.get(localId)?.abort();
    uploadControllers.set(localId, controller);
    updateDraftAttachment(localId, {
      state: "uploading",
      phase: "reserving",
      progress: 8,
      error: undefined,
      attachmentId: undefined,
    });
    try {
      const attachmentId = await connection.uploadAttachment(
        item.file,
        (progress, phase) => updateDraftAttachment(localId, { progress, phase }),
        controller.signal,
      );
      if (controller.signal.aborted || disposed) {
        await connection.discardAttachment(attachmentId).catch(() => undefined);
        return;
      }
      updateDraftAttachment(localId, {
        state: "available",
        phase: "available",
        progress: 100,
        attachmentId,
      });
      setSubmissionKey(crypto.randomUUID());
    } catch (error) {
      if (controller.signal.aborted) return;
      updateDraftAttachment(localId, {
        state: "error",
        progress: 0,
        error:
          error instanceof Error && /250 MB|quota/i.test(error.message)
            ? error.message
            : "Upload interrupted. Retry when you are online.",
      });
    } finally {
      if (uploadControllers.get(localId) === controller) {
        uploadControllers.delete(localId);
      }
    }
  };

  const startDraftUpload = (localId: string) => {
    const task = uploadDraftAttachment(localId);
    pendingUploads.set(localId, task);
    void task.finally(() => {
      if (pendingUploads.get(localId) === task) pendingUploads.delete(localId);
    });
  };

  const addFiles = (files: File[]) => {
    if (!connection || files.length === 0) return;
    const remaining = MAX_INTAKE_ATTACHMENTS - draftAttachments().length;
    if (remaining <= 0) {
      announce(`An Intake may include at most ${MAX_INTAKE_ATTACHMENTS} attachments`);
      return;
    }
    const accepted = files.slice(0, remaining).map((file) => {
      const error = attachmentSelectionError(file);
      return {
        localId: crypto.randomUUID(),
        file,
        state: error ? "error" as const : "uploading" as const,
        phase: "reserving" as const,
        progress: error ? 0 : 4,
        ...(error ? { error } : {}),
      } satisfies DraftAttachment;
    });
    setDraftAttachments((items) => [...items, ...accepted]);
    setSubmissionKey(crypto.randomUUID());
    for (const item of accepted) {
      if (!item.error) startDraftUpload(item.localId);
    }
    if (files.length > remaining) {
      announce(`Only the first ${remaining} files were added`);
    }
  };

  const removeDraftAttachment = async (localId: string) => {
    const item = draftAttachments().find((candidate) => candidate.localId === localId);
    if (!item || item.state === "removing") return;
    uploadControllers.get(localId)?.abort();
    uploadControllers.delete(localId);
    if (!item.attachmentId || !connection) {
      setDraftAttachments((items) => items.filter((candidate) => candidate.localId !== localId));
      setSubmissionKey(crypto.randomUUID());
      return;
    }
    updateDraftAttachment(localId, { state: "removing" });
    try {
      await connection.discardAttachment(item.attachmentId);
      setDraftAttachments((items) => items.filter((candidate) => candidate.localId !== localId));
      setSubmissionKey(crypto.randomUUID());
    } catch {
      updateDraftAttachment(localId, {
        state: "error",
        error: "Could not remove this upload. Try again.",
      });
    }
  };

  const submitIntake = async () => {
    const text = draft().trim();
    const attachmentIds = availableAttachmentIds();
    if (
      (!text && attachmentIds.length === 0) ||
      !connection ||
      submitting() ||
      uploadPending() ||
      uploadFailed()
    ) return;
    const key = submissionKey();
    const availableAttachments = draftAttachments().filter(
      (attachment) => attachment.state === "available",
    );
    const optimistic = createOptimisticIntake({
      submissionKey: key,
      ...(text ? { text } : {}),
      ...(availableAttachments[0]
        ? { firstAttachmentName: availableAttachments[0].file.name }
        : {}),
      attachmentCount: attachmentIds.length,
      createdAt: Date.now(),
    });
    setOptimisticIntakes((items) => [optimistic, ...items]);
    setSubmitting(true);
    try {
      await connection.createIntake(
        text || undefined,
        attachmentIds,
        key,
      );
      setDraft("");
      setDraftAttachments([]);
      setSubmissionKey(crypto.randomUUID());
      announce("Added to Inbox");
    } catch {
      setOptimisticIntakes((items) =>
        items.filter((item) => item.submissionKey !== key),
      );
      announce("Could not add this Intake");
    } finally {
      setSubmitting(false);
    }
  };

  const moveReady = async (id: string, direction: -1 | 1) => {
    const readyItems = ready();
    const index = readyItems.findIndex((item) => item.id === id);
    const target = index + direction;
    const item = readyItems[index];
    const targetItem = readyItems[target];
    if (!connection || !item || !targetItem || target < 0 || target >= readyItems.length) return;
    const rank = direction < 0
      ? target === 0
        ? targetItem.rank - 1_024
        : (readyItems[target - 1]!.rank + targetItem.rank) / 2
      : target === readyItems.length - 1
        ? targetItem.rank + 1_024
        : (targetItem.rank + readyItems[target + 1]!.rank) / 2;
    try {
      await connection.reorderWork(item, rank);
      announce("Ready order updated");
    } catch {
      announce("The Ready order changed; try again");
    }
  };

  const selectSearchResult = (result: SearchResult) => {
    setSearchOpen(false);
    setQuery("");
    if (result.kind === "work") openWork(result.id);
    else openIntake(result.id);
  };

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === "Escape") {
        if (searchOpen()) {
          setSearchOpen(false);
          setQuery("");
        } else {
          closeDetail();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    void (async () => {
      try {
        const [connected, session] = await Promise.all([
          ProjectDataConnection.connect(props.orgSlug, props.projectSlug),
          humanSession(),
        ]);
        if (disposed) {
          await connected.close();
          return;
        }
        connection = connected;
        setProjectName(connected.projectName);
        const name = session?.user.name || session?.user.email || "Me";
        const initials = name
          .split(/\s+|@/)
          .filter(Boolean)
          .slice(0, 2)
          .map((part) => part[0]!.toUpperCase())
          .join("");
        setViewerInitials(initials || "ME");
        unsubscribeOverview = connected.subscribeOverview(
          (overview) => {
            setProjectName(overview.projectName);
            setWork(overview.work);
            setIntakes(overview.intakes);
            const committedKeys = new Set(
              overview.intakes.flatMap((intake) =>
                intake.submissionKey ? [intake.submissionKey] : [],
              ),
            );
            setOptimisticIntakes((items) =>
              items.filter(
                (item) =>
                  item.submissionKey === undefined ||
                  !committedKeys.has(item.submissionKey),
              ),
            );
            setLoadError("");
            setLoading(false);
          },
          () => {
            setLoadError("Live project data is temporarily unavailable.");
            setLoading(false);
          },
        );
      } catch {
        setLoadError("This project could not be loaded for your account.");
        setLoading(false);
      }
    })();
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  onCleanup(() => {
    disposed = true;
    const connected = connection;
    const unattachedIds = availableAttachmentIds();
    for (const controller of uploadControllers.values()) controller.abort();
    uploadControllers.clear();
    unsubscribeOverview?.();
    unsubscribeWork?.();
    void (async () => {
      await Promise.allSettled([...pendingUploads.values()]);
      if (connected) {
        await Promise.allSettled(
          unattachedIds.map(async (attachmentId) =>
            await connected.discardAttachment(attachmentId),
          ),
        );
        await connected.close();
      }
    })();
  });

  return (
    <main class="app-page">
      <header class="app-header">
        <Brand compact href={`/app/${props.orgSlug}/${props.projectSlug}`} />
        <button class="project-button" type="button" aria-label="Select organization or project">
          <span>{projectName()}</span><span style={{ color: "var(--text-faint)" }}>▾</span>
        </button>
        <div class="header-spacer" />
        <button class="search-button" type="button" onClick={() => setSearchOpen(true)} aria-label="Search this project">
          <span>search</span><span class="shortcut">⌘K</span>
        </button>
        <button class="avatar-button" type="button" aria-label="Profile and settings" onClick={() => navigate(`/app/${props.orgSlug}/${props.projectSlug}/settings`)}>
          {viewerInitials()}
        </button>
      </header>

      <div class="overview-scroll">
        <div class="overview-content">
          <section
            class="composer"
            aria-label="Add something"
            onDragOver={(event) => {
              if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
            }}
            onDrop={(event) => {
              if (!event.dataTransfer?.files.length) return;
              event.preventDefault();
              addFiles([...event.dataTransfer.files]);
            }}
          >
            <textarea
              class="composer__input"
              rows={draft().length > 60 ? 4 : 2}
              value={draft()}
              onInput={(event) => {
                setDraft(event.currentTarget.value);
                setSubmissionKey(crypto.randomUUID());
              }}
              onPaste={(event) => {
                const files = [...(event.clipboardData?.files ?? [])];
                if (files.length) addFiles(files);
              }}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void submitIntake();
              }}
              placeholder="Add something…"
            />
            <Show when={draftAttachments().length}>
              <div class="attachment-tray" aria-label="Selected attachments">
                <For each={draftAttachments()}>{(attachment) => (
                  <div class="attachment-row" data-state={attachment.state}>
                    <div class="attachment-row__icon">{attachmentKind(attachment.file)}</div>
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
                    <Show when={
                      attachment.state === "error" &&
                      attachmentSelectionError(attachment.file) === undefined
                    }>
                      <button class="attachment-row__action" type="button" onClick={() => startDraftUpload(attachment.localId)}>Retry</button>
                    </Show>
                    <button
                      class="attachment-row__action"
                      type="button"
                      disabled={attachment.state === "removing"}
                      aria-label={`Remove ${attachment.file.name}`}
                      onClick={() => void removeDraftAttachment(attachment.localId)}
                    >
                      {attachment.state === "uploading" ? "Cancel" : "Remove"}
                    </button>
                  </div>
                )}</For>
              </div>
            </Show>
            <div class="composer__actions">
              <input
                ref={fileInput}
                class="visually-hidden"
                type="file"
                multiple
                tabindex="-1"
                onChange={(event) => {
                  addFiles([...(event.currentTarget.files ?? [])]);
                  event.currentTarget.value = "";
                }}
              />
              <button
                class="attach-button"
                type="button"
                disabled={loading() || Boolean(loadError()) || draftAttachments().length >= MAX_INTAKE_ATTACHMENTS}
                onClick={() => fileInput?.click()}
              >
                <span class="mono">+</span><span>Attach</span>
              </button>
              <span class="composer__hint">
                {uploadPending()
                  ? "finish uploads before submitting"
                  : uploadFailed()
                    ? "retry or remove failed files"
                    : draftAttachments().length
                      ? "no categorization needed"
                      : "bug · idea · screenshot · video · request"}
              </span>
              <button
                class="submit-button"
                type="button"
                disabled={
                  (!draft().trim() && availableAttachmentIds().length === 0) ||
                  submitting() ||
                  uploadPending() ||
                  uploadFailed() ||
                  loading() ||
                  Boolean(loadError())
                }
                aria-label="Submit to Inbox"
                onClick={() => void submitIntake()}
              >
                {submitting() ? "…" : "↵"}
              </button>
            </div>
          </section>

          <Show when={loading()}>
            <div class="empty-state" role="status">Loading live project activity…</div>
          </Show>

          <Show when={loadError()}>
            <div class="empty-state" role="alert">
              <div>{loadError()}</div>
              <button class="button" type="button" onClick={() => window.location.reload()}>Retry</button>
            </div>
          </Show>

          <Show when={!loading() && !loadError() && work().length === 0 && visibleIntakes().length === 0}>
            <div class="empty-state">
              <div>Add anything you want the agent to look at.</div>
              <div class="empty-state__types">bug · idea · screenshot · video · request</div>
            </div>
          </Show>

          <Show when={needs().length}>
            <section class="work-section work-section--attention" aria-labelledby="needs-heading">
              <div class="section-heading section-heading--attention" id="needs-heading">
                <span class="section-heading__pulse" aria-hidden="true" />
                <span>needs you</span><span class="section-heading__count">{needs().length}</span>
              </div>
              <For each={needs()}>{(item) => (
                <button class="work-row work-row--attention" type="button" onClick={() => openWork(item.id)}>
                  <span class="work-row__head">
                    <span class="work-row__title">{item.title}</span>
                    <Show when={item.unseen}><span class="unseen-dot" aria-label="Unseen" /></Show>
                  </span>
                  <span class="work-row__summary">{item.agent} needs a {item.attention?.kind.toLowerCase()}</span>
                  <span class="work-row__meta">
                    <span class="attention-kind">{item.attention?.kind}</span>
                    <Show when={item.attention?.important}><span class="attention-important">important</span></Show>
                    <span>{item.agent}</span><span>·</span><span>{item.age}</span>
                  </span>
                </button>
              )}</For>
            </section>
          </Show>

          <Show when={working().length}>
            <section class="work-section" aria-labelledby="working-heading">
              <div class="section-heading" id="working-heading">
                <span>working</span><span class="section-heading__count">{working().length}</span>
              </div>
              <For each={working()}>{(item) => (
                <button class="work-row" type="button" onClick={() => openWork(item.id)}>
                  <span class="work-row__head">
                    <span class="work-row__title">{item.title}</span>
                    <span class="work-row__identifier mono">{item.identifier}</span>
                  </span>
                  <span class="work-row__meta">
                    <span class="activity-dot" aria-hidden="true" /><span>{item.agent}</span><span>·</span><span>{item.elapsed}</span>
                  </span>
                  <Show when={item.latest}><span class="work-row__latest">{item.latest}</span></Show>
                </button>
              )}</For>
            </section>
          </Show>

          <Show when={ready().length}>
            <section class="work-section" aria-labelledby="ready-heading">
              <div class="section-heading" id="ready-heading">
                <span>ready</span><span class="section-heading__count">{ready().length}</span><span class="section-heading__aside">order = priority</span>
              </div>
              <For each={ready()}>{(item, index) => (
                <div class="ready-row">
                  <div class="reorder-controls">
                    <button class="reorder-button" type="button" disabled={index() === 0} aria-label={`Move ${item.title} up`} onClick={() => void moveReady(item.id, -1)}>▲</button>
                    <button class="reorder-button" type="button" disabled={index() === ready().length - 1} aria-label={`Move ${item.title} down`} onClick={() => void moveReady(item.id, 1)}>▼</button>
                  </div>
                  <button class="ready-row__open" type="button" onClick={() => openWork(item.id)}>
                    <span class="ready-row__position">{String(index() + 1).padStart(2, "0")}</span>
                    <span class="work-row__title">{item.title}</span>
                    <span class="work-row__identifier mono">{item.identifier}</span>
                  </button>
                </div>
              )}</For>
            </section>
          </Show>

          <Show when={visibleIntakes().length}>
            <section class="work-section" aria-labelledby="inbox-heading">
              <div class="section-heading" id="inbox-heading">
                <span>inbox</span><span class="section-heading__count">{visibleIntakes().length}</span>
              </div>
              <For each={visibleIntakes()}>{(intake) => (
                <button class="work-row" type="button" onClick={() => openIntake(intake.id)}>
                  <span class="work-row__summary">{intake.text}</span>
                  <span class="work-row__meta">
                    <span style={{ color: intake.status === "processed" ? "var(--green)" : "var(--amber)" }}>
                      {intake.optimistic
                        ? "sending securely…"
                        : intake.status === "waiting"
                          ? "waiting for local agent"
                          : intake.status === "triaging"
                            ? "agent is triaging"
                            : "processed"}
                    </span>
                    <span>·</span><span>{intake.attachmentCount ? `${intake.attachmentCount} attachment${intake.attachmentCount === 1 ? "" : "s"}` : "no attachment"}</span><span>·</span><span>{intake.age}</span>
                  </span>
                </button>
              )}</For>
            </section>
          </Show>

          <Show when={done().length}>
            <section class="work-section" aria-labelledby="done-heading">
              <div class="section-heading" id="done-heading">
                <span>recently done</span><span class="section-heading__aside"><button class="view-all" type="button" onClick={() => navigate(`/app/${props.orgSlug}/${props.projectSlug}/done`)}>view all →</button></span>
              </div>
              <For each={done()}>{(item) => (
                <button class="work-row work-row--done" type="button" onClick={() => openWork(item.id)}>
                  <span style={{ color: "var(--green)" }} class="mono">✓</span>
                  <span class="work-row__title work-row__title--done">{item.title}</span>
                  <span class="work-row__identifier mono">{item.completedAt}</span>
                </button>
              )}</For>
            </section>
          </Show>
        </div>
      </div>

      <Show when={selectedWork()}>{(item) => (
        <WorkDetail
          item={item()}
          mobileCloseLabel="←  back"
          onClose={closeDetail}
          onRespond={async (selectedOption, body) => {
            const attention = item().attention;
            if (!connection || !attention) return;
            try {
              await connection.respondToAttention(attention.id, selectedOption, body);
              announce("Response sent to your agent");
            } catch {
              announce("Your response could not be sent");
              throw new Error("response_failed");
            }
          }}
          onResolve={async () => {
            const attention = item().attention;
            if (!connection || !attention) return;
            try {
              await connection.resolveAttention(attention.id);
              announce("Attention resolved");
            } catch {
              announce("Attention could not be resolved");
              throw new Error("resolve_failed");
            }
          }}
          onComment={async (body) => {
            if (!connection) return;
            try {
              await connection.addComment(item().id, body);
              announce("Comment added");
            } catch {
              announce("Comment could not be added");
              throw new Error("comment_failed");
            }
          }}
        />
      )}</Show>

      <Show when={selectedIntake()}>{(intake) => (
        <IntakeDetail intake={intake()} work={work()} onClose={closeDetail} onOpenWork={openWork} />
      )}</Show>

      <Show when={searchOpen()}>
        <div class="search-overlay" role="dialog" aria-modal="true" aria-label="Search this project" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSearchOpen(false);
        }}>
          <div class="search-box">
            <div class="search-box__head">
              <span class="mono" style={{ color: "var(--text-faint)" }}>/</span>
              <input
                class="search-box__input"
                autofocus
                value={query()}
                onInput={(event) => setQuery(event.currentTarget.value)}
                placeholder="Search work, comments and intake…"
              />
              <button class="icon-button mono" type="button" onClick={() => setSearchOpen(false)}>esc</button>
            </div>
            <div class="search-box__results">
              <div class="search-scope">scope · {props.projectSlug} · work, comments, intake</div>
              <Show when={query().trim().length < 2}>
                <div class="search-empty">Type at least two characters to search this project.</div>
              </Show>
              <For each={results()}>{(result) => (
                <button class="search-result" type="button" onClick={() => selectSearchResult(result)}>
                  <span class="search-result__meta"><span>{result.kind}</span><span>{result.identifier}</span></span>
                  <span class="search-result__title">{result.title}</span>
                </button>
              )}</For>
              <Show when={query().trim().length >= 2 && results().length === 0}>
                <div class="search-empty">Nothing found in this project.</div>
              </Show>
            </div>
          </div>
        </div>
      </Show>

      <Show when={toast()}>
        <div class="toast-wrap" role="status" aria-live="polite">
          <div class="toast"><span class="toast__check">✓</span><span>{toast()}</span></div>
        </div>
      </Show>
    </main>
  );
}

type WorkDetailProps = {
  item: WorkItem;
  mobileCloseLabel: string;
  onClose: () => void;
  onRespond: (selectedOption?: string, body?: string) => Promise<void>;
  onResolve: () => Promise<void>;
  onComment: (body: string) => Promise<void>;
};

function WorkDetail(props: WorkDetailProps) {
  const [choice, setChoice] = createSignal<string>();
  const [response, setResponse] = createSignal("");
  const [comment, setComment] = createSignal("");
  const [pending, setPending] = createSignal(false);

  const stateLine = () => {
    if (props.item.state === "needs") return `Working · waiting for your ${props.item.attention?.kind.toLowerCase()}`;
    if (props.item.state === "working") return `Working · ${props.item.agent}`;
    if (props.item.state === "done") return `Done · ${props.item.completedAt}`;
    return "Ready";
  };

  const respond = async () => {
    const selectedOption = choice();
    const body = response().trim();
    if ((!selectedOption && !body) || pending()) return;
    setPending(true);
    try {
      await props.onRespond(selectedOption, body || undefined);
      setChoice(undefined);
      setResponse("");
    } catch {
      return;
    } finally {
      setPending(false);
    }
  };

  const resolveWithoutResponse = async () => {
    if (pending()) return;
    setPending(true);
    try {
      await props.onResolve();
    } catch {
      return;
    } finally {
      setPending(false);
    }
  };

  const addComment = async () => {
    const text = comment().trim();
    if (!text || pending()) return;
    setPending(true);
    try {
      await props.onComment(text);
      setComment("");
    } catch {
      return;
    } finally {
      setPending(false);
    }
  };

  return (
    <aside class="detail" role="dialog" aria-modal="true" aria-labelledby="work-detail-title">
      <div class="detail__head">
        <button class="detail__close" type="button" onClick={props.onClose}>
          <span class="detail-close-desktop">✕&nbsp; close</span><span class="detail-close-mobile">{props.mobileCloseLabel}</span>
        </button>
        <div class="detail__head-spacer" />
        <span class="detail__identifier">{props.item.identifier}</span>
      </div>
      <div class="detail__scroll">
        <div class="detail__title-group">
          <h2 class="detail__title" id="work-detail-title">{props.item.title}</h2>
          <div class="detail__state"><span class="detail__state-dot" data-state={props.item.state} /><span>{stateLine()}</span></div>
        </div>

        <Show when={props.item.attention}>{(attention) => (
          <div class="attention-card" data-resolved={Boolean(attention().response)}>
            <div class="attention-card__head">
              <span class="attention-kind">{attention().kind}</span>
              <Show when={attention().important && !attention().response}><span class="attention-important mono">important</span></Show>
              <span class="attention-card__when">{props.item.age}</span>
            </div>
            <div class="attention-card__title">{attention().title}</div>
            <div class="attention-card__body">{attention().body}</div>
            <Show when={!attention().response} fallback={
              <div class="resolved-response">
                <div class="resolved-response__status">✓ answered</div>
                <div class="detail-section__body">{attention().response}</div>
                <div class="note">Your agent will see this on its next pull.</div>
              </div>
            }>
              <div class="attention-options">
                <For each={attention().options ?? []}>{(option) => (
                  <button class="attention-option" data-selected={choice() === option} type="button" onClick={() => setChoice(option)}>
                    <span class="attention-option__dot" /><span>{option}</span>
                  </button>
                )}</For>
                <textarea class="textarea" value={response()} onInput={(event) => setResponse(event.currentTarget.value)} placeholder="Add anything the agent should know…" rows={3} />
                <div class="response-actions">
                  <button class="button button--primary" type="button" disabled={pending() || (!choice() && !response().trim())} onClick={() => void respond()}>Respond</button>
                  <button class="button button--quiet" type="button" disabled={pending()} onClick={() => void resolveWithoutResponse()}>Resolve without response</button>
                </div>
              </div>
            </Show>
          </div>
        )}</Show>

        <section class="detail-section">
          <div class="detail-section__label">goal</div>
          <div class="detail-section__body">{props.item.goal}</div>
        </section>

        <Show when={props.item.latest}>
          <section class="detail-section">
            <div class="detail-section__label">latest from {props.item.agent ?? "agent"}</div>
            <div class="detail-card">{props.item.latest}</div>
            <div class="security-note">{props.item.state === "done" ? "run finished" : props.item.elapsed ?? "waiting to start"}</div>
          </section>
        </Show>

        <Show when={props.item.artifacts?.length}>
          <section class="detail-section">
            <div class="detail-section__label">artifacts</div>
            <For each={props.item.artifacts}>{(artifact) => (
              <Show
                when={artifact.href}
                fallback={<div class="artifact-row"><span class="artifact-row__kind">{artifact.kind}</span><span class="artifact-row__label">{artifact.label}</span></div>}
              >
                {(href) => <a class="artifact-row" href={href()} target="_blank" rel="noreferrer"><span class="artifact-row__kind">{artifact.kind}</span><span class="artifact-row__label">{artifact.label}</span><span style={{ color: "var(--amber)" }}>↗</span></a>}
              </Show>
            )}</For>
          </section>
        </Show>

        <Show when={props.item.conversation?.length}>
          <section class="conversation">
            <div class="detail-section__label">conversation</div>
            <For each={props.item.conversation}>{(entry) => (
              <div class="conversation-entry">
                <div class="conversation-entry__meta"><span class="conversation-entry__who" data-human={entry.human}>{entry.who}</span><span>{entry.when}</span></div>
                <div class="conversation-entry__text">{entry.text}</div>
              </div>
            )}</For>
          </section>
        </Show>

        <div class="comment-form">
          <textarea class="textarea" value={comment()} onInput={(event) => setComment(event.currentTarget.value)} placeholder="Add a comment…" rows={2} />
          <button class="button" type="button" disabled={pending() || !comment().trim()} onClick={() => void addComment()}>Add comment</button>
        </div>
      </div>
    </aside>
  );
}

type IntakeDetailProps = {
  intake: Intake;
  work: WorkItem[];
  onClose: () => void;
  onOpenWork: (id: string) => void;
};

function IntakeDetail(props: IntakeDetailProps) {
  const linked = () => props.work.filter((item) => props.intake.linkedWorkIds?.includes(item.id));
  return (
    <aside class="detail" role="dialog" aria-modal="true" aria-labelledby="intake-detail-title">
      <div class="detail__head">
        <button class="detail__close" type="button" onClick={props.onClose}>
          <span class="detail-close-desktop">✕&nbsp; close</span><span class="detail-close-mobile">←&nbsp; back</span>
        </button>
        <div class="detail__head-spacer" /><span class="detail__identifier">inbox</span>
      </div>
      <div class="detail__scroll">
        <div class="detail__title-group">
          <h2 class="detail__title" id="intake-detail-title">{props.intake.text}</h2>
          <div class="detail__state"><span class="detail__state-dot" data-state={props.intake.status === "processed" ? "done" : "working"} /><span>{props.intake.status === "processed" ? `Processed · ${linked().length} work items created` : "Waiting for local agent"}</span></div>
        </div>
        <section class="detail-section">
          <div class="detail-section__label">submitted</div>
          <div class="detail-card">
            <div class="detail-section__body">You · {props.intake.age}</div>
            <Show when={props.intake.attachment}>
              <div class="attachment-row" style={{ "margin-top": "11px" }}>
                <div class="attachment-row__icon">FILE</div>
                <div class="attachment-row__copy"><div class="attachment-row__name">{props.intake.attachment}</div><div class="attachment-row__state">available to authorized agents</div></div>
              </div>
            </Show>
          </div>
        </section>
        <Show when={linked().length}>
          <section class="detail-section">
            <div class="detail-section__label">linked work</div>
            <For each={linked()}>{(item) => (
              <button class="artifact-row" type="button" onClick={() => props.onOpenWork(item.id)}>
                <span class="work-row__identifier mono">{item.identifier}</span><span class="work-row__title">{item.title}</span><span class="meta">{item.state}</span>
              </button>
            )}</For>
          </section>
        </Show>
      </div>
    </aside>
  );
}
