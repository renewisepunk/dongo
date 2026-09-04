import { A, useNavigate, useSearchParams } from "@solidjs/router";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";

import { Brand } from "../../components/Brand";
import { PageTitle } from "../../components/PageTitle";
import { MarkdownContent } from "../../components/MarkdownContent";
import { ProjectBreadcrumbs } from "../../components/ProjectBreadcrumbs";
import { formatAttachmentBytes } from "../../lib/attachment-upload";
import {
  IDEA_FILTERS,
  ideaAttributionLabel,
  ideaErrorCode,
  ideasForFilter,
  reorderedIdeas,
} from "../../lib/idea-editing";
import {
  ProjectDataConnection,
  type IdeaCreateInput,
  type IdeaDetail,
  type IdeaMutationResult,
  type IdeaPromotionResult,
  type IdeaState,
  type IdeaSummary,
  type IdeaUpdateInput,
} from "../../lib/project-data";
import { projectPageTitle } from "../../lib/page-title";
import { IdeaEditor } from "./IdeaEditor";
import "./ideas.css";

export type IdeasConnection = Pick<
  ProjectDataConnection,
  | "projectId"
  | "projectName"
  | "subscribeIdeas"
  | "subscribeIdeaDetail"
  | "createIdea"
  | "updateIdea"
  | "reorderIdeas"
  | "archiveIdea"
  | "restoreIdea"
  | "promoteIdea"
  | "uploadAttachment"
  | "discardAttachment"
  | "downloadAttachment"
  | "close"
>;

export type IdeasProps = {
  orgSlug: string;
  projectSlug: string;
  connect?: (orgSlug: string, projectSlug: string) => Promise<IdeasConnection>;
};

function filterLabel(filter: IdeaState): string {
  return filter[0]!.toUpperCase() + filter.slice(1);
}

function shortDate(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(timestamp);
}

function actionError(error: unknown, action: string): string {
  const code = ideaErrorCode(error);
  if (code === "revision_conflict") return `This Idea changed elsewhere before it could be ${action}. The latest version is still shown.`;
  if (code === "invalid_transition") return "This Idea changed state elsewhere. The latest version is still shown.";
  return `The Idea could not be ${action}. Try again.`;
}

function IdeaAttachmentRow(props: {
  attachment: IdeaDetail["attachments"][number];
  download: (attachmentId: string) => Promise<void>;
}) {
  const [state, setState] = createSignal<"idle" | "downloading" | "error">("idle");
  const download = async () => {
    if (state() === "downloading") return;
    setState("downloading");
    try {
      await props.download(props.attachment.id);
      setState("idle");
    } catch {
      setState("error");
    }
  };
  return (
    <div class="idea-file">
      <span><strong>{props.attachment.filename}</strong><small>{formatAttachmentBytes(props.attachment.byteSize)}</small></span>
      <button class="button button--quiet" type="button" disabled={state() === "downloading"} onClick={() => void download()}>
        {state() === "downloading" ? "Downloading…" : state() === "error" ? "Retry download" : "Download"}
      </button>
      <Show when={state() === "error"}><span class="visually-hidden" role="alert">Download failed for {props.attachment.filename}. Try again.</span></Show>
    </div>
  );
}

export function Ideas(props: IdeasProps) {
  const navigate = useNavigate();
  const [route, setRoute] = useSearchParams<{ idea?: string; filter?: string }>();
  const [connection, setConnection] = createSignal<IdeasConnection>();
  const [ideas, setIdeas] = createSignal<IdeaSummary[]>([]);
  const [detail, setDetail] = createSignal<IdeaDetail>();
  const [loading, setLoading] = createSignal(true);
  const [detailLoading, setDetailLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [actionMessage, setActionMessage] = createSignal("");
  const [actionPending, setActionPending] = createSignal(false);
  const [confirmPromotion, setConfirmPromotion] = createSignal(false);
  const [promotionKey, setPromotionKey] = createSignal(crypto.randomUUID());
  const [promotionResult, setPromotionResult] = createSignal<IdeaPromotionResult>();
  const [announce, setAnnounce] = createSignal("");
  let disposed = false;
  let unsubscribeIdeas: (() => void) | undefined;
  let unsubscribeDetail: (() => void) | undefined;
  let selectedId: string | undefined;

  const filter = createMemo<IdeaState>(() => IDEA_FILTERS.includes(route.filter as IdeaState)
    ? route.filter as IdeaState
    : "open");
  const visibleIdeas = createMemo(() => ideasForFilter(ideas(), filter()));
  const counts = createMemo(() => Object.fromEntries(IDEA_FILTERS.map((state) => [
    state,
    ideas().filter((idea) => idea.state === state).length,
  ])) as Record<IdeaState, number>);
  const selectedSummary = createMemo(() => ideas().find((idea) => idea._id === route.idea));
  const creating = createMemo(() => route.idea === "new");
  const pageTitle = createMemo(() => projectPageTitle(
    connection()?.projectName ?? props.projectSlug,
    creating() ? "New Idea" : route.idea ? "Idea" : "Ideas",
  ));

  const selectIdea = (ideaId: string | undefined, nextFilter = filter()) => {
    setRoute({ filter: nextFilter === "open" ? undefined : nextFilter, idea: ideaId });
  };

  const closeDetail = () => selectIdea(undefined);

  const subscribeToDetail = (ideaId: string | undefined) => {
    unsubscribeDetail?.();
    unsubscribeDetail = undefined;
    selectedId = ideaId;
    setDetail(undefined);
    setActionMessage("");
    setConfirmPromotion(false);
    setPromotionResult(undefined);
    setPromotionKey(crypto.randomUUID());
    if (!ideaId || ideaId === "new" || !connection()) {
      setDetailLoading(false);
      return;
    }
    setDetailLoading(true);
    unsubscribeDetail = connection()!.subscribeIdeaDetail(
      ideaId,
      (next) => {
        if (disposed || selectedId !== ideaId) return;
        setDetail(next);
        setDetailLoading(false);
      },
      () => {
        if (disposed || selectedId !== ideaId) return;
        setActionMessage("This Idea could not be loaded. Try selecting it again.");
        setDetailLoading(false);
      },
    );
  };

  createEffect(() => subscribeToDetail(route.idea));

  onMount(() => {
    const connect = props.connect ?? ProjectDataConnection.connect;
    void connect(props.orgSlug, props.projectSlug)
      .then((nextConnection) => {
        if (disposed) {
          void nextConnection.close();
          return;
        }
        setConnection(nextConnection);
        unsubscribeIdeas = nextConnection.subscribeIdeas(
          "all",
          (nextIdeas) => {
            if (disposed) return;
            setIdeas(nextIdeas);
            setLoading(false);
            setError("");
          },
          () => {
            if (disposed) return;
            setLoading(false);
            setError("Live Ideas are temporarily unavailable.");
          },
        );
        subscribeToDetail(route.idea);
      })
      .catch(() => {
        if (disposed) return;
        setLoading(false);
        setError("This project could not be loaded for your account.");
      });
  });

  onCleanup(() => {
    disposed = true;
    unsubscribeIdeas?.();
    unsubscribeDetail?.();
    void connection()?.close();
  });

  const mutateState = async (action: "archive" | "restore") => {
    const current = detail();
    const connected = connection();
    if (!current || !connected || actionPending()) return;
    setActionPending(true);
    setActionMessage(action === "archive" ? "Archiving Idea…" : "Restoring Idea…");
    try {
      if (action === "archive") {
        await connected.archiveIdea(current._id, current.revision, crypto.randomUUID());
        setAnnounce("Idea archived");
        setActionMessage("Idea archived.");
        selectIdea(undefined, "open");
      } else {
        await connected.restoreIdea(current._id, current.revision, crypto.randomUUID());
        setAnnounce("Idea restored");
        setActionMessage("Idea restored.");
        selectIdea(current._id, "open");
      }
    } catch (mutationError) {
      setActionMessage(actionError(mutationError, action === "archive" ? "archived" : "restored"));
    } finally {
      setActionPending(false);
    }
  };

  const move = async (ideaId: string, direction: -1 | 1) => {
    const connected = connection();
    if (!connected || actionPending()) return;
    const ordered = ideasForFilter(ideas(), "open");
    const next = reorderedIdeas(ordered, ideaId, direction);
    if (next.every((idea, index) => idea._id === ordered[index]?._id)) return;
    setActionPending(true);
    setActionMessage("Saving Idea order…");
    try {
      await connected.reorderIdeas(next, crypto.randomUUID());
      setActionMessage("Idea order saved.");
      setAnnounce("Idea order saved");
    } catch (mutationError) {
      setActionMessage(actionError(mutationError, "reordered"));
    } finally {
      setActionPending(false);
    }
  };

  const promote = async () => {
    const current = detail();
    const connected = connection();
    if (!current || !connected || actionPending()) return;
    setActionPending(true);
    setActionMessage("Sending Idea to Inbox…");
    try {
      const result = await connected.promoteIdea(current._id, current.revision, promotionKey());
      setPromotionResult(result);
      setConfirmPromotion(false);
      setActionMessage(result.created ? "Idea sent to Inbox" : "Already in Inbox");
      setAnnounce(result.created ? "Idea sent to Inbox" : "Idea was already in Inbox");
      setPromotionKey(crypto.randomUUID());
      selectIdea(current._id, "promoted");
    } catch (mutationError) {
      setActionMessage(actionError(mutationError, "sent to Inbox"));
    } finally {
      setActionPending(false);
    }
  };

  const createIdea = async (input: IdeaCreateInput): Promise<IdeaMutationResult & { created: boolean }> => {
    const result = await connection()!.createIdea(input);
    setAnnounce("Idea captured");
    return result;
  };

  const updateIdea = async (input: IdeaUpdateInput): Promise<IdeaMutationResult> => {
    const result = await connection()!.updateIdea(input);
    setAnnounce("Idea updated");
    return result;
  };

  const inboxHref = (intakeId: string) => `/app/${encodeURIComponent(props.orgSlug)}/${encodeURIComponent(props.projectSlug)}?intake=${encodeURIComponent(intakeId)}`;

  return (
    <>
      <PageTitle value={pageTitle()} />
      <main class="app-page ideas-page">
      <header class="app-header project-header">
        <Brand compact href={`/app/${props.orgSlug}/${props.projectSlug}`} />
        <ProjectBreadcrumbs
          orgSlug={props.orgSlug}
          projectSlug={props.projectSlug}
          projectName={connection()?.projectName ?? props.projectSlug}
          current="ideas"
        />
        <div class="project-header__actions">
          <A class="button button--quiet" href={`/app/${props.orgSlug}/${props.projectSlug}`}>← Overview</A>
        </div>
      </header>

      <div class="ideas-shell">
        <section class="ideas-intro" aria-labelledby="ideas-title">
          <div><div class="eyebrow eyebrow--amber">Notebook</div><h1 id="ideas-title">Ideas</h1></div>
          <p>Possible future work. Agents cannot see or claim Ideas.</p>
          <button class="button button--primary" type="button" onClick={() => selectIdea("new", "open")}>Capture idea</button>
        </section>

        <div class="ideas-filter" role="tablist" aria-label="Idea status">
          <For each={IDEA_FILTERS}>{(state) => (
            <button
              type="button"
              role="tab"
              aria-selected={filter() === state}
              class="ideas-filter__tab"
              data-active={filter() === state}
              onClick={() => selectIdea(undefined, state)}
            >
              <span>{filterLabel(state)}</span><span class="mono">{String(counts()[state]).padStart(2, "0")}</span>
            </button>
          )}</For>
        </div>

        <Show when={error()}><div class="ideas-alert" role="alert">{error()}</div></Show>
        <div class="ideas-grid" data-detail-open={Boolean(route.idea)}>
          <section class="ideas-index" aria-label={`${filterLabel(filter())} Ideas`}>
            <Show when={loading()}><div class="ideas-empty" role="status">Loading Ideas…</div></Show>
            <For each={visibleIdeas()}>{(idea, index) => (
              <article class="idea-row" data-selected={route.idea === idea._id} data-idea-id={idea._id}>
                <button class="idea-row__select" type="button" aria-current={route.idea === idea._id ? "page" : undefined} onClick={() => selectIdea(idea._id)}>
                  <span class="idea-row__rank mono">{String(index() + 1).padStart(2, "0")}</span>
                  <span class="idea-row__copy">
                    <strong>{idea.title}</strong>
                    <span>{idea.text?.trim() || idea.context?.trim() || "A thought waiting for more detail."}</span>
                    <span class="idea-row__meta">{ideaAttributionLabel(idea.updatedBy ?? idea.createdBy)} · {shortDate(idea.updatedAt)}{idea.attachmentCount ? ` · ${idea.attachmentCount} file${idea.attachmentCount === 1 ? "" : "s"}` : ""}</span>
                  </span>
                  <span class="idea-row__state">{idea.state}</span>
                </button>
                <Show when={filter() === "open"}>
                  <div class="idea-row__order" aria-label={`Reorder ${idea.title}`}>
                    <button type="button" disabled={actionPending() || index() === 0} aria-label={`Move ${idea.title} earlier`} onClick={() => void move(idea._id, -1)}>↑</button>
                    <button type="button" disabled={actionPending() || index() === visibleIdeas().length - 1} aria-label={`Move ${idea.title} later`} onClick={() => void move(idea._id, 1)}>↓</button>
                  </div>
                </Show>
              </article>
            )}</For>
            <Show when={!loading() && !error() && visibleIdeas().length === 0}>
              <div class="ideas-empty">No {filterLabel(filter()).toLowerCase()} Ideas.</div>
            </Show>
          </section>

          <Show when={route.idea}>
            <aside class="idea-detail" aria-label={creating() ? "Capture idea" : selectedSummary()?.title ?? "Idea detail"}>
              <div class="idea-detail__head">
                <span class="eyebrow">{creating() ? "New thought" : filterLabel(detail()?.state ?? filter())}</span>
                <button class="idea-detail__close" type="button" aria-label="Close Idea" onClick={closeDetail}>✕ close</button>
              </div>
              <Show when={creating()}>
                <div class="idea-detail__title"><h2>Capture an Idea</h2><p>Keep it outside the agent execution queue until you explicitly promote it.</p></div>
                <Show when={connection()}>{(connected) => (
                  <IdeaEditor
                    projectId={connected().projectId}
                    onCreate={createIdea}
                    onUpdate={updateIdea}
                    onSaved={(ideaId) => selectIdea(ideaId, "open")}
                    uploadAttachment={(file, progress, signal) => connected().uploadAttachment(file, progress, signal)}
                    discardAttachment={(attachmentId) => connected().discardAttachment(attachmentId)}
                    announce={setAnnounce}
                  />
                )}</Show>
              </Show>
              <Show when={!creating() && detailLoading()}><div class="ideas-empty" role="status">Loading Idea…</div></Show>
              <Show when={!creating() && detail()}>{(current) => (
                <>
                  <div class="idea-detail__title">
                    <h2>{current().title}</h2>
                    <p>Created by {ideaAttributionLabel(current().createdBy)} · {shortDate(current().createdAt)}</p>
                  </div>
                  <Show when={current().attachments.length > 0}>
                    <section class="idea-files" aria-label="Idea attachments">
                      <div class="eyebrow">References</div>
                      <For each={current().attachments}>{(attachment) => (
                        <IdeaAttachmentRow attachment={attachment} download={(attachmentId) => connection()!.downloadAttachment(attachmentId)} />
                      )}</For>
                    </section>
                  </Show>
                  <Show when={current().state === "open"} fallback={
                    <section class="idea-readonly">
                      <Show when={current().text}><MarkdownContent source={current().text!} /></Show>
                      <Show when={current().context}><p><strong>Context</strong><br />{current().context}</p></Show>
                      <Show when={current().links?.length}><ul><For each={current().links}>{(link) => <li><a href={link} target="_blank" rel="noreferrer">{link}</a></li>}</For></ul></Show>
                    </section>
                  }>
                    <IdeaEditor
                      projectId={connection()!.projectId}
                      idea={current()}
                      onCreate={createIdea}
                      onUpdate={updateIdea}
                      onSaved={() => undefined}
                      uploadAttachment={(file, progress, signal) => connection()!.uploadAttachment(file, progress, signal)}
                      discardAttachment={(attachmentId) => connection()!.discardAttachment(attachmentId)}
                      announce={setAnnounce}
                    />
                  </Show>

                  <div class="idea-detail__actions">
                    <Show when={current().state === "open"}>
                      <button class="button button--quiet" type="button" onClick={(event) => event.currentTarget.closest(".idea-detail")?.querySelector<HTMLInputElement>("[data-idea-title]")?.focus()}>Edit</button>
                      <button class="button button--quiet" type="button" disabled={actionPending()} onClick={() => void mutateState("archive")}>Archive</button>
                      <button class="button" type="button" disabled={actionPending()} onClick={() => setConfirmPromotion(true)}>Promote to Inbox</button>
                    </Show>
                    <Show when={current().state === "archived"}>
                      <button class="button" type="button" disabled={actionPending()} onClick={() => void mutateState("restore")}>Restore</button>
                    </Show>
                    <Show when={current().state === "promoted"}>
                      <button class="button" type="button" disabled>Already in Inbox</button>
                      <Show when={current().promotedIntakeId}>{(intakeId) => <A class="button button--primary" href={inboxHref(intakeId())}>View in Inbox</A>}</Show>
                    </Show>
                  </div>

                  <Show when={confirmPromotion()}>
                    <div class="idea-confirm" role="dialog" aria-modal="true" aria-labelledby="idea-promote-title">
                      <h3 id="idea-promote-title">Send this idea to Inbox?</h3>
                      <p>This creates one Intake item for agents to triage. The idea becomes Promoted and stays linked.</p>
                      <div class="idea-confirm__actions">
                        <button class="button button--quiet" type="button" disabled={actionPending()} onClick={() => setConfirmPromotion(false)}>Cancel</button>
                        <button class="button button--primary" type="button" disabled={actionPending()} onClick={() => void promote()}>{actionPending() ? "Sending…" : "Send to Inbox"}</button>
                      </div>
                    </div>
                  </Show>
                </>
              )}</Show>
              <Show when={actionMessage()}><p class="idea-action-message" role={/could not|changed elsewhere/iu.test(actionMessage()) ? "alert" : "status"}>{actionMessage()}</p></Show>
              <Show when={promotionResult()?.intakeId}>{(intakeId) => (
                <div class="idea-success" role="status"><strong>{promotionResult()!.created ? "Idea sent to Inbox" : "Already in Inbox"}</strong><A href={inboxHref(intakeId())}>View in Inbox</A></div>
              )}</Show>
            </aside>
          </Show>
        </div>
      </div>
      <div class="visually-hidden" role="status" aria-live="polite">{announce()}</div>
      </main>
    </>
  );
}
