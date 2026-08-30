import { useNavigate } from "@solidjs/router";
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Brand } from "../../components/Brand";
import { initialIntakes, initialWork, type Intake, type WorkItem } from "./model";
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

export function Overview(props: OverviewProps) {
  const navigate = useNavigate();
  const [work, setWork] = createSignal<WorkItem[]>(initialWork);
  const [intakes, setIntakes] = createSignal<Intake[]>(initialIntakes);
  const [draft, setDraft] = createSignal("");
  const [attachment, setAttachment] = createSignal(false);
  const [selectedWorkId, setSelectedWorkId] = createSignal<string>();
  const [selectedIntakeId, setSelectedIntakeId] = createSignal<string>();
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [toast, setToast] = createSignal("");

  const needs = createMemo(() => work().filter((item) => item.state === "needs"));
  const working = createMemo(() => work().filter((item) => item.state === "working"));
  const ready = createMemo(() => work().filter((item) => item.state === "ready"));
  const done = createMemo(() => work().filter((item) => item.state === "done"));
  const selectedWork = createMemo(() => work().find((item) => item.id === selectedWorkId()));
  const selectedIntake = createMemo(() => intakes().find((item) => item.id === selectedIntakeId()));

  const results = createMemo<SearchResult[]>(() => {
    const value = query().trim().toLowerCase();
    if (value.length < 2) return [];
    return [
      ...work()
        .filter((item) => `${item.title} ${item.goal} ${item.identifier}`.toLowerCase().includes(value))
        .map((item) => ({ kind: "work" as const, id: item.id, identifier: item.identifier, title: item.title })),
      ...intakes()
        .filter((item) => item.text.toLowerCase().includes(value))
        .map((item) => ({ kind: "intake" as const, id: item.id, identifier: "inbox", title: item.text })),
    ];
  });

  const announce = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  };

  const closeDetail = () => {
    setSelectedWorkId(undefined);
    setSelectedIntakeId(undefined);
  };

  const openWork = (id: string) => {
    setWork((items) => items.map((item) => item.id === id ? { ...item, unseen: false } : item));
    setSelectedIntakeId(undefined);
    setSelectedWorkId(id);
  };

  const openIntake = (id: string) => {
    setSelectedWorkId(undefined);
    setSelectedIntakeId(id);
  };

  const submitIntake = () => {
    if (!draft().trim() && !attachment()) return;
    setIntakes((items) => [{
      id: `intake-${crypto.randomUUID()}`,
      text: draft().trim() || "New screen recording",
      attachment: attachment() ? "checkout-stall.mov" : undefined,
      status: "waiting",
      age: "now",
    }, ...items]);
    setDraft("");
    setAttachment(false);
    announce("Added to Inbox");
  };

  const moveReady = (id: string, direction: -1 | 1) => {
    setWork((items) => {
      const readyItems = items.filter((item) => item.state === "ready");
      const index = readyItems.findIndex((item) => item.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= readyItems.length) return items;
      const reordered = [...readyItems];
      const [moved] = reordered.splice(index, 1);
      reordered.splice(target, 0, moved);
      let readyIndex = 0;
      return items.map((item) => item.state === "ready" ? reordered[readyIndex++] : item);
    });
    announce("Ready order updated");
  };

  const updateWork = (id: string, update: (item: WorkItem) => WorkItem) => {
    setWork((items) => items.map((item) => item.id === id ? update(item) : item));
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
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  return (
    <main class="app-page">
      <header class="app-header">
        <Brand compact href={`/app/${props.orgSlug}/${props.projectSlug}`} />
        <button class="project-button" type="button" aria-label="Select organization or project">
          <span>{props.projectSlug}</span><span style={{ color: "var(--text-faint)" }}>▾</span>
        </button>
        <div class="header-spacer" />
        <button class="search-button" type="button" onClick={() => setSearchOpen(true)} aria-label="Search this project">
          <span>search</span><span class="shortcut">⌘K</span>
        </button>
        <button class="avatar-button" type="button" aria-label="Profile and settings" onClick={() => navigate(`/app/${props.orgSlug}/${props.projectSlug}/settings`)}>
          RB
        </button>
      </header>

      <div class="overview-scroll">
        <div class="overview-content">
          <section class="composer" aria-label="Add something">
            <textarea
              class="composer__input"
              rows={draft().length > 60 ? 4 : 2}
              value={draft()}
              onInput={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submitIntake();
              }}
              placeholder="Add something…"
            />
            <Show when={attachment()}>
              <div class="attachment-row">
                <div class="attachment-row__icon">MOV</div>
                <div class="attachment-row__copy">
                  <div class="attachment-row__name">checkout-stall.mov</div>
                  <div class="attachment-row__state">18.4 MB · ready</div>
                </div>
                <button class="icon-button" type="button" aria-label="Remove attachment" onClick={() => setAttachment(false)}>✕</button>
              </div>
            </Show>
            <div class="composer__actions">
              <button class="attach-button" type="button" onClick={() => setAttachment(true)}>
                <span class="mono">+</span><span>Attach</span>
              </button>
              <span class="composer__hint">no categories, no fields</span>
              <button
                class="submit-button"
                type="button"
                disabled={!draft().trim() && !attachment()}
                aria-label="Submit to Inbox"
                onClick={submitIntake}
              >
                ↵
              </button>
            </div>
          </section>

          <Show when={work().length === 0 && intakes().length === 0}>
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
                    <button class="reorder-button" type="button" disabled={index() === 0} aria-label={`Move ${item.title} up`} onClick={() => moveReady(item.id, -1)}>▲</button>
                    <button class="reorder-button" type="button" disabled={index() === ready().length - 1} aria-label={`Move ${item.title} down`} onClick={() => moveReady(item.id, 1)}>▼</button>
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

          <Show when={intakes().length}>
            <section class="work-section" aria-labelledby="inbox-heading">
              <div class="section-heading" id="inbox-heading">
                <span>inbox</span><span class="section-heading__count">{intakes().length}</span>
              </div>
              <For each={intakes()}>{(intake) => (
                <button class="work-row" type="button" onClick={() => openIntake(intake.id)}>
                  <span class="work-row__summary">{intake.text}</span>
                  <span class="work-row__meta">
                    <span style={{ color: intake.status === "processed" ? "var(--green)" : "var(--amber)" }}>
                      {intake.status === "waiting" ? "waiting for local agent" : intake.status === "triaging" ? "agent is triaging" : "processed"}
                    </span>
                    <span>·</span><span>{intake.attachment ? "1 attachment" : "no attachment"}</span><span>·</span><span>{intake.age}</span>
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
          onUpdate={(update) => updateWork(item().id, update)}
          onAnnounce={announce}
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
  onUpdate: (update: (item: WorkItem) => WorkItem) => void;
  onAnnounce: (message: string) => void;
};

function WorkDetail(props: WorkDetailProps) {
  const [choice, setChoice] = createSignal<string>();
  const [response, setResponse] = createSignal("");
  const [comment, setComment] = createSignal("");

  const stateLine = () => {
    if (props.item.state === "needs") return `Working · waiting for your ${props.item.attention?.kind.toLowerCase()}`;
    if (props.item.state === "working") return `Working · ${props.item.agent}`;
    if (props.item.state === "done") return `Done · ${props.item.completedAt}`;
    return "Ready";
  };

  const respond = () => {
    const text = [choice(), response().trim()].filter(Boolean).join(" — ");
    if (!text) return;
    props.onUpdate((item) => ({
      ...item,
      state: "working",
      unseen: false,
      attention: item.attention ? { ...item.attention, response: text } : undefined,
      conversation: [...(item.conversation ?? []), { who: "René Bauer", when: "now", text, human: true }],
    }));
    setChoice(undefined);
    setResponse("");
    props.onAnnounce("Response sent to your agent");
  };

  const resolveWithoutResponse = () => {
    props.onUpdate((item) => ({
      ...item,
      state: "working",
      unseen: false,
      attention: item.attention ? { ...item.attention, response: "Resolved without response" } : undefined,
    }));
    props.onAnnounce("Attention resolved");
  };

  const addComment = () => {
    const text = comment().trim();
    if (!text) return;
    props.onUpdate((item) => ({ ...item, conversation: [...(item.conversation ?? []), { who: "René Bauer", when: "now", text, human: true }] }));
    setComment("");
    props.onAnnounce("Comment added");
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
                  <button class="button button--primary" type="button" disabled={!choice() && !response().trim()} onClick={respond}>Respond</button>
                  <button class="button button--quiet" type="button" onClick={resolveWithoutResponse}>Resolve without response</button>
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
              <div class="artifact-row">
                <span class="artifact-row__kind">{artifact.kind}</span><span class="artifact-row__label">{artifact.label}</span><span style={{ color: "var(--amber)" }}>↗</span>
              </div>
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
          <button class="button" type="button" disabled={!comment().trim()} onClick={addComment}>Add comment</button>
        </div>

        <Show when={props.item.state === "done"}>
          <div class="export-note">synced to .agent-work/{props.item.identifier}.md</div>
        </Show>
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
            <div class="detail-section__body">René Bauer · {props.intake.age}</div>
            <Show when={props.intake.attachment}>
              <div class="attachment-row" style={{ "margin-top": "11px" }}>
                <div class="attachment-row__icon">MOV</div>
                <div class="attachment-row__copy"><div class="attachment-row__name">{props.intake.attachment}</div><div class="attachment-row__state">18.4 MB · screen recording</div></div>
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
