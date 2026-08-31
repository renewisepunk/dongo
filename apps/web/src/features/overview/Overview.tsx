import { useNavigate, useSearchParams } from "@solidjs/router";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Brand } from "../../components/Brand";
import { MarkdownContent } from "../../components/MarkdownContent";
import { SignOutButton } from "../../components/SignOutButton";
import {
  CommandMenu,
  ShortcutDialog,
  type OverviewCommand,
  type OverviewCommandId,
} from "../help/KeyboardOverlays";
import { DONGO_SHORTCUTS } from "../help/shortcuts";
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
import type {
  ProjectInfo,
  ProjectSearchCursor,
  ProjectSearchResult,
} from "../../lib/project-data";
import { searchHighlightSegments } from "../../lib/search-highlight";
import type { AttachmentSummary, Intake, WorkItem } from "./model";
import { CommentComposer } from "./CommentComposer";
import "./overview.css";

export type OverviewConnection = Pick<
  ProjectDataConnection,
  | "projectName"
  | "availableProjects"
  | "subscribeOverview"
  | "subscribeWorkDetail"
  | "subscribeWorkById"
  | "subscribeIntakeDetail"
  | "searchProject"
  | "createIntake"
  | "uploadAttachment"
  | "discardAttachment"
  | "downloadAttachment"
  | "reorderWork"
  | "markAttentionSeen"
  | "respondToAttention"
  | "resolveAttention"
  | "addComment"
  | "close"
>;

export type OverviewSession = {
  user: {
    name?: string | null;
    email?: string | null;
  };
} | null;

type OverviewProps = {
  orgSlug: string;
  projectSlug: string;
  connect?: (orgSlug: string, projectSlug: string) => Promise<OverviewConnection>;
  loadSession?: () => Promise<OverviewSession>;
};

type DraftAttachment = {
  localId: string;
  file: File;
  previewUrl?: string;
  state: "uploading" | "available" | "error" | "removing";
  phase: "reserving" | "uploading" | "available";
  progress: number;
  attachmentId?: string;
  error?: string;
};

function HighlightedSearchText(props: { text: string; query: string }) {
  return (
    <For each={searchHighlightSegments(props.text, props.query)}>{(segment) => (
      <Show when={segment.match} fallback={segment.text}>
        <mark>{segment.text}</mark>
      </Show>
    )}</For>
  );
}

function trapModalFocus(
  event: KeyboardEvent & { currentTarget: HTMLElement },
) {
  if (event.key !== "Tab") return;
  const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => element.getAttribute("aria-hidden") !== "true");
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }
  const first = focusable[0]!;
  const last = focusable.at(-1)!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function restoreFocusAfterRender(
  preferred: HTMLElement | undefined,
  fallback: HTMLElement | undefined | (() => HTMLElement | undefined),
) {
  queueMicrotask(() => {
    const resolvedFallback = typeof fallback === "function" ? fallback() : fallback;
    const canRestorePreferred = preferred?.isConnected &&
      preferred !== document.body &&
      preferred !== document.documentElement;
    const target = canRestorePreferred ? preferred : resolvedFallback;
    target?.focus({ preventScroll: true });
  });
}

function restoreScrollAfterRender(position: { x: number; y: number } | undefined) {
  if (!position) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => window.scrollTo(position.x, position.y));
  });
}

type OverviewRouteState = {
  work?: string;
  intake?: string;
  search?: string;
};

type DetailInitialFocus = "close" | "respond";

const OVERVIEW_COMMANDS: readonly OverviewCommand[] = [
  ...DONGO_SHORTCUTS.map((shortcut) => ({
    id: shortcut.id,
    label: shortcut.label,
    description: shortcut.description,
    keys: shortcut.keys,
    ...(shortcut.id === "working" || shortcut.id === "done"
      ? { status: "agent-owned" }
      : shortcut.id === "edit"
        ? { status: "not available" }
        : {}),
  })),
  {
    id: "help",
    label: "Open help guide",
    description: "Read the core workflow and full shortcut reference.",
    keys: [],
  },
];

function isTextEntryTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(
    target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"),
  );
}

function sameOverviewRoute(
  left: OverviewRouteState,
  right: OverviewRouteState,
): boolean {
  return left.work === right.work &&
    left.intake === right.intake &&
    left.search === right.search;
}

export function Overview(props: OverviewProps) {
  const navigate = useNavigate();
  const [routeParams, setRouteParams] = useSearchParams<{
    work?: string;
    intake?: string;
    search?: string;
  }>();
  const [work, setWork] = createSignal<WorkItem[]>([]);
  const [intakes, setIntakes] = createSignal<Intake[]>([]);
  const [optimisticIntakes, setOptimisticIntakes] = createSignal<Intake[]>([]);
  const [draft, setDraft] = createSignal("");
  const [draftAttachments, setDraftAttachments] = createSignal<DraftAttachment[]>([]);
  const [submissionKey, setSubmissionKey] = createSignal(crypto.randomUUID());
  const [selectedWorkId, setSelectedWorkId] = createSignal<string>();
  const [selectedWorkDetail, setSelectedWorkDetail] = createSignal<WorkItem>();
  const [selectedIntakeId, setSelectedIntakeId] = createSignal<string>();
  const [selectedIntakeDetail, setSelectedIntakeDetail] = createSignal<Intake>();
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [searchResults, setSearchResults] = createSignal<ProjectSearchResult[]>([]);
  const [searchCursor, setSearchCursor] = createSignal<ProjectSearchCursor>();
  const [searchLoading, setSearchLoading] = createSignal(false);
  const [searchError, setSearchError] = createSignal("");
  const [searchRetry, setSearchRetry] = createSignal(0);
  const [toast, setToast] = createSignal("");
  const [loading, setLoading] = createSignal(true);
  const [connectionReady, setConnectionReady] = createSignal(false);
  const [loadError, setLoadError] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [projectName, setProjectName] = createSignal(props.projectSlug);
  const [availableProjects, setAvailableProjects] = createSignal<readonly ProjectInfo[]>([]);
  const [viewer, setViewer] = createSignal<{ name: string; email: string }>();
  const [viewerInitials, setViewerInitials] = createSignal("ME");
  const [projectMenuOpen, setProjectMenuOpen] = createSignal(false);
  const [profileMenuOpen, setProfileMenuOpen] = createSignal(false);
  const [commandMenuOpen, setCommandMenuOpen] = createSignal(false);
  const [shortcutDialogOpen, setShortcutDialogOpen] = createSignal(false);
  const [keyboardSelection, setKeyboardSelection] = createSignal<string>();
  const [detailPeek, setDetailPeek] = createSignal(false);
  const [detailInitialFocus, setDetailInitialFocus] = createSignal<DetailInitialFocus>("close");
  const [draggedReadyId, setDraggedReadyId] = createSignal<string>();
  const [fileDropActive, setFileDropActive] = createSignal(false);
  let connection: OverviewConnection | undefined;
  let unsubscribeOverview: (() => void) | undefined;
  let unsubscribeWork: (() => void) | undefined;
  let unsubscribeIntake: (() => void) | undefined;
  let fileInput: HTMLInputElement | undefined;
  let projectMenuButton: HTMLButtonElement | undefined;
  let projectMenu: HTMLDivElement | undefined;
  let profileMenuButton: HTMLButtonElement | undefined;
  let profileMenu: HTMLDivElement | undefined;
  let searchButton: HTMLButtonElement | undefined;
  let searchInput: HTMLInputElement | undefined;
  let composerInput: HTMLTextAreaElement | undefined;
  let searchReturnFocus: HTMLElement | undefined;
  let commandReturnFocus: HTMLElement | undefined;
  let shortcutReturnFocus: HTMLElement | undefined;
  let detailReturnFocus: HTMLElement | undefined;
  let detailReturnToSearch = false;
  let detailReturnScroll: { x: number; y: number } | undefined;
  const uploadControllers = new Map<string, AbortController>();
  const pendingUploads = new Map<string, Promise<void>>();
  let disposed = false;
  let searchGeneration = 0;
  let fileDragDepth = 0;
  let pendingRouteState: OverviewRouteState | undefined;

  const currentRouteState = (): OverviewRouteState => ({
    work: routeParams.work?.trim() || undefined,
    intake: routeParams.intake?.trim() || undefined,
    search: routeParams.search === "1" ? "1" : undefined,
  });

  const applyRouteUpdate = (update: OverviewRouteState) => {
    const current = currentRouteState();
    const next = { ...(pendingRouteState ?? current), ...update };
    pendingRouteState = sameOverviewRoute(current, next) ? undefined : next;
    setRouteParams(next);
  };

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
  const projectGroups = createMemo(() => {
    const groups = new Map<string, { name: string; projects: ProjectInfo[] }>();
    for (const project of availableProjects()) {
      const group = groups.get(project.organizationSlug);
      if (group) group.projects.push(project);
      else groups.set(project.organizationSlug, {
        name: project.organizationName,
        projects: [project],
      });
    }
    return [...groups.entries()].map(([slug, group]) => ({ slug, ...group }));
  });
  const currentProject = createMemo(() =>
    availableProjects().find(
      (project) =>
        project.organizationSlug === props.orgSlug &&
        project.slug === props.projectSlug,
    ),
  );
  const canCreateProject = createMemo(() => {
    const project = currentProject();
    return project?.membershipRole === "owner" &&
      (project.organizationPlan === "paid" || project.activeProjectCount < 1);
  });
  const selectedWork = createMemo(() => {
    const detail = selectedWorkDetail();
    return detail?.id === selectedWorkId()
      ? detail
      : work().find((item) => item.id === selectedWorkId());
  });
  const selectedIntake = createMemo(() =>
    selectedIntakeDetail()?.id === selectedIntakeId()
      ? selectedIntakeDetail()
      : visibleIntakes().find((item) => item.id === selectedIntakeId()),
  );

  createEffect(() => {
    const open = searchOpen();
    const term = query().trim();
    void searchRetry();
    const generation = ++searchGeneration;
    setSearchResults([]);
    setSearchCursor(undefined);
    setSearchError("");
    if (!open || term.length < 2 || !connection) {
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const timer = window.setTimeout(() => {
      void connection!.searchProject(term).then(
        (page) => {
          if (generation !== searchGeneration) return;
          setSearchResults(page.results);
          setSearchCursor(page.nextCursor);
          setSearchLoading(false);
        },
        () => {
          if (generation !== searchGeneration) return;
          setSearchError("Search is temporarily unavailable.");
          setSearchLoading(false);
        },
      );
    }, 220);
    onCleanup(() => window.clearTimeout(timer));
  });

  const announce = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  };

  const openSearch = (updateRoute = true, preferredReturnFocus?: HTMLElement) => {
    if (!searchOpen() && document.activeElement instanceof HTMLElement) {
      searchReturnFocus = preferredReturnFocus ?? document.activeElement;
    }
    if (updateRoute) applyRouteUpdate({ search: "1" });
    setProjectMenuOpen(false);
    setProfileMenuOpen(false);
    setSearchOpen(true);
    queueMicrotask(() => searchInput?.focus());
  };

  const closeSearch = (updateRoute = true, restoreFocus = true) => {
    const returnFocus = searchReturnFocus;
    searchReturnFocus = undefined;
    if (updateRoute) applyRouteUpdate({ search: undefined });
    setSearchOpen(false);
    setQuery("");
    if (restoreFocus) restoreFocusAfterRender(returnFocus, searchButton);
  };

  const closeCommandMenu = (restoreFocus = true) => {
    const returnFocus = commandReturnFocus;
    commandReturnFocus = undefined;
    setCommandMenuOpen(false);
    if (restoreFocus) restoreFocusAfterRender(returnFocus, searchButton);
  };

  const openCommandMenu = () => {
    if (!commandMenuOpen() && document.activeElement instanceof HTMLElement) {
      commandReturnFocus = document.activeElement;
    }
    if (searchOpen()) closeSearch(true, false);
    if (shortcutDialogOpen()) closeShortcutDialog(false);
    setProjectMenuOpen(false);
    setProfileMenuOpen(false);
    setShortcutDialogOpen(false);
    setCommandMenuOpen(true);
  };

  const closeShortcutDialog = (restoreFocus = true) => {
    const returnFocus = shortcutReturnFocus;
    shortcutReturnFocus = undefined;
    setShortcutDialogOpen(false);
    if (restoreFocus) restoreFocusAfterRender(returnFocus, searchButton);
  };

  const openShortcutDialog = (preferredReturnFocus?: HTMLElement) => {
    if (!shortcutDialogOpen() && document.activeElement instanceof HTMLElement) {
      shortcutReturnFocus = preferredReturnFocus ?? document.activeElement;
    }
    setProjectMenuOpen(false);
    setProfileMenuOpen(false);
    if (commandMenuOpen()) closeCommandMenu(false);
    setShortcutDialogOpen(true);
  };

  const switchProject = (project: ProjectInfo) => {
    setProjectMenuOpen(false);
    if (
      project.organizationSlug === props.orgSlug &&
      project.slug === props.projectSlug
    ) return;
    window.location.assign(
      `/app/${encodeURIComponent(project.organizationSlug)}/${encodeURIComponent(project.slug)}`,
    );
  };

  const openSettings = (tab: "General" | "Members") => {
    setProjectMenuOpen(false);
    setProfileMenuOpen(false);
    navigate(
      `/app/${encodeURIComponent(props.orgSlug)}/${encodeURIComponent(props.projectSlug)}/settings?tab=${encodeURIComponent(tab)}`,
    );
  };

  const menuItems = (menu: HTMLElement): HTMLElement[] =>
    [...menu.querySelectorAll<HTMLElement>(
      '[role="menuitem"], [role="menuitemradio"]',
    )].filter((item) => !item.hasAttribute("disabled"));

  const focusFirstMenuItem = (getMenu: () => HTMLElement | undefined) => {
    queueMicrotask(() => {
      const menu = getMenu();
      if (menu) menuItems(menu)[0]?.focus();
    });
  };

  const handleMenuKeyDown = (
    event: KeyboardEvent,
    menu: HTMLElement,
    close: () => void,
    trigger: HTMLElement | undefined,
  ) => {
    const items = menuItems(menu);
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next: number | undefined;
    if (event.key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % items.length;
    if (event.key === "ArrowUp") next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = items.length - 1;
    if (next !== undefined && items[next]) {
      event.preventDefault();
      items[next].focus();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      queueMicrotask(() => trigger?.focus());
    } else if (event.key === "Tab") {
      window.setTimeout(close, 0);
    }
  };

  const closeDetail = (updateRoute = true) => {
    const returnFocus = detailReturnFocus;
    const returnWorkId = selectedWorkId();
    const returnToSearch = detailReturnToSearch;
    const returnScroll = detailReturnScroll;
    detailReturnFocus = undefined;
    detailReturnToSearch = false;
    detailReturnScroll = undefined;
    if (updateRoute) {
      applyRouteUpdate({ work: undefined, intake: undefined });
    }
    unsubscribeWork?.();
    unsubscribeWork = undefined;
    unsubscribeIntake?.();
    unsubscribeIntake = undefined;
    setSelectedWorkDetail(undefined);
    setSelectedIntakeDetail(undefined);
    setSelectedWorkId(undefined);
    setSelectedIntakeId(undefined);
    setDetailPeek(false);
    setDetailInitialFocus("close");
    restoreFocusAfterRender(returnToSearch ? undefined : returnFocus, () => {
      if (returnToSearch) return searchButton;
      if (returnWorkId) {
        const replacement = [...document.querySelectorAll<HTMLElement>("[data-work-id]")]
          .find((element) => element.dataset.workId === returnWorkId);
        if (replacement) return replacement;
      }
      return searchButton;
    });
    restoreScrollAfterRender(returnScroll);
  };

  const openWork = (
    id: string,
    updateRoute = true,
    returnFocus?: HTMLElement,
    peek = false,
    initialFocus: DetailInitialFocus = "close",
  ) => {
    if (!selectedWorkId() && !selectedIntakeId()) {
      const resolvedReturnFocus = returnFocus ?? (
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : undefined
      );
      detailReturnFocus = resolvedReturnFocus;
      detailReturnToSearch = resolvedReturnFocus === searchButton ||
        resolvedReturnFocus?.classList.contains("search-button") === true;
      detailReturnScroll = { x: window.scrollX, y: window.scrollY };
    }
    if (updateRoute) applyRouteUpdate({ work: id, intake: undefined });
    unsubscribeWork?.();
    unsubscribeWork = undefined;
    unsubscribeIntake?.();
    unsubscribeIntake = undefined;
    setSelectedWorkDetail(undefined);
    setSelectedIntakeDetail(undefined);
    setSelectedIntakeId(undefined);
    setDetailPeek(peek);
    setDetailInitialFocus(initialFocus);
    setSelectedWorkId(id);
    const item = work().find((candidate) => candidate.id === id);
    if (!connection) return;
    if (item?.unseen && item.attention) {
      void connection.markAttentionSeen(item.attention.id).catch(() => {
        announce("Could not mark the request as seen");
      });
    }
    unsubscribeWork = item
      ? connection.subscribeWorkDetail(
          item,
          setSelectedWorkDetail,
          () => {
            announce("Could not load the latest work detail");
            closeDetail();
          },
        )
      : connection.subscribeWorkById(
          id,
          setSelectedWorkDetail,
          () => {
            announce("This Work item is unavailable");
            closeDetail();
          },
        );
  };

  const openIntake = (
    id: string,
    updateRoute = true,
    returnFocus?: HTMLElement,
    peek = false,
  ) => {
    if (!selectedWorkId() && !selectedIntakeId()) {
      const resolvedReturnFocus = returnFocus ?? (
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : undefined
      );
      detailReturnFocus = resolvedReturnFocus;
      detailReturnToSearch = resolvedReturnFocus === searchButton ||
        resolvedReturnFocus?.classList.contains("search-button") === true;
      detailReturnScroll = { x: window.scrollX, y: window.scrollY };
    }
    if (updateRoute) applyRouteUpdate({ work: undefined, intake: id });
    unsubscribeWork?.();
    unsubscribeWork = undefined;
    unsubscribeIntake?.();
    unsubscribeIntake = undefined;
    setSelectedWorkDetail(undefined);
    setSelectedIntakeDetail(undefined);
    setSelectedWorkId(undefined);
    setDetailPeek(peek);
    setDetailInitialFocus("close");
    setSelectedIntakeId(id);
    if (!connection || id.startsWith("optimistic:")) return;
    unsubscribeIntake = connection.subscribeIntakeDetail(
      id,
      setSelectedIntakeDetail,
      () => {
        announce("This Intake is unavailable");
        closeDetail();
      },
    );
  };

  createEffect(() => {
    if (!connectionReady()) return;
    const workId = routeParams.work?.trim();
    const intakeId = routeParams.intake?.trim();
    const shouldSearch = routeParams.search === "1";
    const current = currentRouteState();
    if (pendingRouteState) {
      if (!sameOverviewRoute(current, pendingRouteState)) return;
      pendingRouteState = undefined;
    }
    if (shouldSearch && !searchOpen()) openSearch(false);
    if (!shouldSearch && searchOpen()) closeSearch(false);
    if (workId) {
      if (selectedWorkId() !== workId) openWork(workId, false);
      return;
    }
    if (intakeId) {
      if (selectedIntakeId() !== intakeId) openIntake(intakeId, false);
      return;
    }
    if ((selectedWorkId() || selectedIntakeId()) && !detailPeek()) closeDetail(false);
  });

  const updateDraftAttachment = (
    localId: string,
    update: Partial<DraftAttachment>,
  ) => {
    setDraftAttachments((items) => items.map((item) =>
      item.localId === localId ? { ...item, ...update } : item,
    ));
  };

  const revokeAttachmentPreview = (attachment: DraftAttachment) => {
    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
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

  const pastedFiles = (clipboard: DataTransfer | null): File[] => {
    if (!clipboard) return [];
    const itemFiles = [...clipboard.items].flatMap((item) => {
      const file = item.kind === "file" ? item.getAsFile() : null;
      return file ? [file] : [];
    });
    return itemFiles.length > 0 ? itemFiles : [...clipboard.files];
  };

  const removeDraftAttachment = async (localId: string) => {
    const item = draftAttachments().find((candidate) => candidate.localId === localId);
    if (!item || item.state === "removing") return;
    uploadControllers.get(localId)?.abort();
    uploadControllers.delete(localId);
    if (!item.attachmentId || !connection) {
      revokeAttachmentPreview(item);
      setDraftAttachments((items) => items.filter((candidate) => candidate.localId !== localId));
      setSubmissionKey(crypto.randomUUID());
      return;
    }
    updateDraftAttachment(localId, { state: "removing" });
    try {
      await connection.discardAttachment(item.attachmentId);
      revokeAttachmentPreview(item);
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
      for (const attachment of availableAttachments) {
        revokeAttachmentPreview(attachment);
      }
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

  const reorderReady = async (id: string, targetIndex: number) => {
    const readyItems = ready();
    const sourceIndex = readyItems.findIndex((item) => item.id === id);
    const item = readyItems[sourceIndex];
    if (!connection || !item || sourceIndex < 0) return;
    const remaining = readyItems.filter((candidate) => candidate.id !== id);
    const insertionIndex = Math.max(0, Math.min(targetIndex, remaining.length));
    if (insertionIndex === sourceIndex) return;
    const before = remaining[insertionIndex - 1];
    const after = remaining[insertionIndex];
    const rank = !before
      ? after!.rank - 1_024
      : !after
        ? before.rank + 1_024
        : (before.rank + after.rank) / 2;
    try {
      await connection.reorderWork(item, rank);
      announce("Ready order updated");
    } catch {
      announce("The Ready order changed; try again");
    }
  };

  const moveReady = (id: string, direction: -1 | 1) => {
    const index = ready().findIndex((item) => item.id === id);
    if (index < 0) return;
    void reorderReady(id, index + direction);
  };

  const dropReady = (
    event: DragEvent & { currentTarget: HTMLDivElement },
    targetId: string,
  ) => {
    const sourceId = draggedReadyId() || event.dataTransfer?.getData("text/plain");
    setDraggedReadyId(undefined);
    if (!sourceId || sourceId === targetId) return;
    const readyItems = ready();
    const sourceIndex = readyItems.findIndex((item) => item.id === sourceId);
    const targetIndex = readyItems.findIndex((item) => item.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const afterTarget = event.clientY >= bounds.top + bounds.height / 2;
    let insertionIndex = targetIndex + (afterTarget ? 1 : 0);
    if (sourceIndex < insertionIndex) insertionIndex -= 1;
    void reorderReady(sourceId, insertionIndex);
  };

  const downloadAttachment = async (attachmentId: string) => {
    if (!connection) throw new Error("download_unavailable");
    try {
      await connection.downloadAttachment(attachmentId);
      announce("Download started");
    } catch {
      announce("This attachment could not be downloaded");
      throw new Error("download_failed");
    }
  };

  const loadMoreSearch = async () => {
    const cursor = searchCursor();
    const term = query().trim();
    if (!cursor || !connection || searchLoading() || term.length < 2) return;
    const generation = searchGeneration;
    setSearchLoading(true);
    setSearchError("");
    try {
      const page = await connection.searchProject(term, cursor);
      if (generation !== searchGeneration) return;
      setSearchResults((items) => {
        const seen = new Set(items.map((item) => `${item.kind}:${item.id}`));
        return [
          ...items,
          ...page.results.filter((item) => !seen.has(`${item.kind}:${item.id}`)),
        ];
      });
      setSearchCursor(page.nextCursor);
    } catch {
      if (generation === searchGeneration) {
        setSearchError("More results could not be loaded.");
      }
    } finally {
      if (generation === searchGeneration) setSearchLoading(false);
    }
  };

  const selectSearchResult = (result: ProjectSearchResult) => {
    const returnFocus = searchReturnFocus;
    closeSearch(true, false);
    if (result.targetKind === "work") openWork(result.targetId, true, returnFocus);
    else openIntake(result.targetId, true, returnFocus);
  };

  const navigableItems = (): HTMLElement[] =>
    [...document.querySelectorAll<HTMLElement>("[data-nav-item]")]
      .filter((element) => element.offsetParent !== null);

  const navKey = (element: HTMLElement): string | undefined => {
    const kind = element.dataset.navKind;
    const id = element.dataset.navId;
    return kind && id ? `${kind}:${id}` : undefined;
  };

  const selectedNavItem = (): HTMLElement | undefined => {
    const focused = document.activeElement instanceof Element
      ? document.activeElement.closest<HTMLElement>("[data-nav-item]")
      : null;
    if (focused) return focused;
    const selected = keyboardSelection();
    return selected
      ? navigableItems().find((element) => navKey(element) === selected)
      : undefined;
  };

  const focusRelativeItem = (direction: -1 | 1) => {
    const items = navigableItems();
    if (items.length === 0) return;
    const current = selectedNavItem();
    const currentIndex = current ? items.indexOf(current) : -1;
    const nextIndex = currentIndex < 0
      ? direction === 1
        ? Math.min(1, items.length - 1)
        : items.length - 1
      : Math.max(0, Math.min(items.length - 1, currentIndex + direction));
    const next = items[nextIndex]!;
    const key = navKey(next);
    if (key) setKeyboardSelection(key);
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block: "nearest" });
  };

  const requireSelectedItem = (): HTMLElement | undefined => {
    const selected = selectedNavItem();
    if (!selected) announce("Use J or K to select an item first");
    return selected;
  };

  const openSelectedItem = (peek = false, respond = false) => {
    const selected = requireSelectedItem();
    if (!selected) return;
    const id = selected.dataset.navId;
    if (!id) return;
    if (selected.dataset.navKind === "work") {
      openWork(id, !peek, selected, peek, respond ? "respond" : "close");
      return;
    }
    if (respond) {
      announce("Respond and review are available on Work items");
      return;
    }
    openIntake(id, !peek, selected, peek);
  };

  const explainAgentOwnedCommand = (command: "working" | "done" | "edit") => {
    const selected = requireSelectedItem();
    if (!selected) return;
    if (selected.dataset.navKind !== "work") {
      announce("This command applies to Work items");
      return;
    }
    const item = work().find((candidate) => candidate.id === selected.dataset.navId);
    if (!item) return;
    if (command === "working") {
      announce(item.state === "ready"
        ? "Starting work is agent-owned. Ask the connected agent to claim it."
        : `This item is already ${item.state === "needs" ? "waiting for you" : item.state}.`);
      return;
    }
    if (command === "done") {
      announce(item.state === "done"
        ? "This item is already done."
        : "Only the active agent run can mark work done.");
      return;
    }
    announce("Human work editing is not available yet. Add a comment with the correction.");
  };

  const focusCapture = () => {
    if (searchOpen()) closeSearch(true, false);
    if (selectedWorkId() || selectedIntakeId()) closeDetail();
    queueMicrotask(() => {
      composerInput?.focus({ preventScroll: true });
      composerInput?.scrollIntoView({ block: "center" });
    });
  };

  const runOverviewCommand = (id: OverviewCommandId) => {
    const returnFocus = commandReturnFocus;
    if (commandMenuOpen()) closeCommandMenu(false);
    queueMicrotask(() => {
      switch (id) {
        case "capture":
          focusCapture();
          break;
        case "search":
          openSearch(true, returnFocus);
          break;
        case "next":
          focusRelativeItem(1);
          break;
        case "previous":
          focusRelativeItem(-1);
          break;
        case "open":
          openSelectedItem();
          break;
        case "peek":
          openSelectedItem(true);
          break;
        case "respond":
          openSelectedItem(false, true);
          break;
        case "working":
        case "done":
        case "edit":
          explainAgentOwnedCommand(id);
          break;
        case "submit":
          if (document.activeElement === composerInput) void submitIntake();
          else announce("Use ⌘ Enter while editing a composer");
          break;
        case "shortcuts":
          openShortcutDialog(returnFocus);
          break;
        case "help":
          navigate(`/app/${encodeURIComponent(props.orgSlug)}/${encodeURIComponent(props.projectSlug)}/help`);
          break;
        case "close":
        case "commands":
          break;
      }
    });
  };

  onMount(() => {
    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (commandMenuOpen()) closeCommandMenu();
        else if (!loading() && !loadError()) openCommandMenu();
        return;
      }
      if (event.key === "Escape") {
        if (commandMenuOpen()) {
          event.preventDefault();
          closeCommandMenu();
          return;
        }
        if (shortcutDialogOpen()) {
          event.preventDefault();
          closeShortcutDialog();
          return;
        }
        if (projectMenuOpen() || profileMenuOpen()) {
          event.preventDefault();
          const trigger = projectMenuOpen()
            ? projectMenuButton
            : profileMenuButton;
          setProjectMenuOpen(false);
          setProfileMenuOpen(false);
          queueMicrotask(() => trigger?.focus());
          return;
        }
        if (searchOpen()) {
          event.preventDefault();
          closeSearch();
        } else if (selectedWorkId() || selectedIntakeId()) {
          event.preventDefault();
          closeDetail();
        }
        return;
      }
      if (
        commandMenuOpen() ||
        shortcutDialogOpen() ||
        projectMenuOpen() ||
        profileMenuOpen() ||
        searchOpen() ||
        selectedWorkId() ||
        selectedIntakeId() ||
        loading() ||
        Boolean(loadError()) ||
        isTextEntryTarget(event.target) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) return;

      const key = event.key.toLowerCase();
      if (key === "?" || (event.key === "/" && event.shiftKey)) {
        event.preventDefault();
        openShortcutDialog();
      } else if (key === "c") {
        event.preventDefault();
        focusCapture();
      } else if (key === "/") {
        event.preventDefault();
        openSearch();
      } else if (key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        focusRelativeItem(1);
      } else if (key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        focusRelativeItem(-1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        openSelectedItem();
      } else if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        openSelectedItem(true);
      } else if (key === "r") {
        event.preventDefault();
        openSelectedItem(false, true);
      } else if (key === "w" || key === "d" || key === "e") {
        event.preventDefault();
        explainAgentOwnedCommand(
          key === "w" ? "working" : key === "d" ? "done" : "edit",
        );
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest(".header-menu")) {
        setProjectMenuOpen(false);
        setProfileMenuOpen(false);
      }
    };
    const carriesFiles = (event: DragEvent) =>
      [...(event.dataTransfer?.types ?? [])].includes("Files");
    const targetsCommentComposer = (event: DragEvent) =>
      event.target instanceof Element && Boolean(event.target.closest(".comment-drop-target"));
    const handOffToCommentComposer = (event: DragEvent) => {
      if (!targetsCommentComposer(event)) return false;
      fileDragDepth = 0;
      setFileDropActive(false);
      return true;
    };
    const onFileDragEnter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      if (handOffToCommentComposer(event)) return;
      event.preventDefault();
      event.stopPropagation();
      fileDragDepth += 1;
      setFileDropActive(true);
    };
    const onFileDragOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      if (handOffToCommentComposer(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      setFileDropActive(true);
    };
    const onFileDragLeave = (event: DragEvent) => {
      if (handOffToCommentComposer(event)) return;
      if (!fileDropActive()) return;
      event.preventDefault();
      event.stopPropagation();
      fileDragDepth = Math.max(0, fileDragDepth - 1);
      if (fileDragDepth === 0 || event.relatedTarget === null) {
        fileDragDepth = 0;
        setFileDropActive(false);
      }
    };
    const onFileDrop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      if (handOffToCommentComposer(event)) return;
      event.preventDefault();
      event.stopPropagation();
      fileDragDepth = 0;
      setFileDropActive(false);
      addFiles([...(event.dataTransfer?.files ?? [])]);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("dragenter", onFileDragEnter, true);
    window.addEventListener("dragover", onFileDragOver, true);
    window.addEventListener("dragleave", onFileDragLeave, true);
    window.addEventListener("drop", onFileDrop, true);
    void (async () => {
      try {
        const [connected, session] = await Promise.all([
          props.connect
            ? props.connect(props.orgSlug, props.projectSlug)
            : ProjectDataConnection.connect(props.orgSlug, props.projectSlug),
          props.loadSession ? props.loadSession() : humanSession(),
        ]);
        if (disposed) {
          await connected.close();
          return;
        }
        connection = connected;
        setAvailableProjects(connected.availableProjects);
        setConnectionReady(true);
        setProjectName(connected.projectName);
        const name = session?.user.name || session?.user.email || "Me";
        setViewer({
          name,
          email: session?.user.email || "Email unavailable",
        });
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
    onCleanup(() => {
      window.history.scrollRestoration = previousScrollRestoration;
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("dragenter", onFileDragEnter, true);
      window.removeEventListener("dragover", onFileDragOver, true);
      window.removeEventListener("dragleave", onFileDragLeave, true);
      window.removeEventListener("drop", onFileDrop, true);
    });
  });

  onCleanup(() => {
    disposed = true;
    const connected = connection;
    const unattachedIds = availableAttachmentIds();
    for (const attachment of draftAttachments()) {
      revokeAttachmentPreview(attachment);
    }
    for (const controller of uploadControllers.values()) controller.abort();
    uploadControllers.clear();
    unsubscribeOverview?.();
    unsubscribeWork?.();
    unsubscribeIntake?.();
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
      <Show when={fileDropActive()}>
        <div class="file-drop-zone" role="status" aria-live="polite">
          <div class="file-drop-zone__message">
            <span class="file-drop-zone__icon" aria-hidden="true">+</span>
            <strong>Drop to attach</strong>
            <span>Add files to your new issue</span>
          </div>
        </div>
      </Show>
      <header class="app-header">
        <Brand compact href={`/app/${props.orgSlug}/${props.projectSlug}`} />
        <div class="header-menu">
          <button
            ref={projectMenuButton}
            class="project-button"
            type="button"
            aria-label="Select organization or project"
            aria-haspopup="menu"
            aria-expanded={projectMenuOpen()}
            onClick={() => {
              const next = !projectMenuOpen();
              setProjectMenuOpen(next);
              setProfileMenuOpen(false);
              if (next) focusFirstMenuItem(() => projectMenu);
            }}
          >
            <span>{projectName()}</span><span style={{ color: "var(--text-faint)" }}>▾</span>
          </button>
          <Show when={projectMenuOpen()}>
            <div
              ref={projectMenu}
              class="menu-popover project-menu-popover"
              role="menu"
              aria-label="Organizations and projects"
              onKeyDown={(event) => handleMenuKeyDown(
                event,
                event.currentTarget,
                () => setProjectMenuOpen(false),
                projectMenuButton,
              )}
            >
              <For each={projectGroups()}>{(group) => (
                <div class="menu-group">
                  <div class="menu-label">{group.name}</div>
                  <For each={group.projects}>{(project) => {
                    const selected = () =>
                      project.organizationSlug === props.orgSlug &&
                      project.slug === props.projectSlug;
                    return (
                      <button
                        class="menu-action menu-action--project"
                        type="button"
                        role="menuitemradio"
                        aria-checked={selected()}
                        onClick={() => switchProject(project)}
                      >
                        <span class="menu-check" aria-hidden="true">{selected() ? "✓" : ""}</span>
                        <span>{project.name}</span>
                      </button>
                    );
                  }}</For>
                </div>
              )}</For>
              <div class="menu-divider" />
              <Show when={canCreateProject()}>
                <button class="menu-action" type="button" role="menuitem" onClick={() => navigate("/onboarding")}>+ Create project</button>
              </Show>
              <button class="menu-action" type="button" role="menuitem" onClick={() => openSettings("Members")}>Organization settings</button>
              <button class="menu-action" type="button" role="menuitem" onClick={() => openSettings("General")}>Project settings</button>
            </div>
          </Show>
        </div>
        <div class="header-spacer" />
        <button ref={searchButton} class="search-button" type="button" disabled={loading() || Boolean(loadError())} onClick={() => openSearch()} aria-label="Search this project" aria-keyshortcuts="/">
          <span>search</span><span class="shortcut">/</span>
        </button>
        <div class="header-menu header-menu--right">
          <button
            ref={profileMenuButton}
            class="avatar-button"
            type="button"
            aria-label="Profile and settings"
            aria-haspopup="menu"
            aria-expanded={profileMenuOpen()}
            onClick={() => {
              const next = !profileMenuOpen();
              setProfileMenuOpen(next);
              setProjectMenuOpen(false);
              if (next) focusFirstMenuItem(() => profileMenu);
            }}
          >
            {viewerInitials()}
          </button>
          <Show when={profileMenuOpen()}>
            <div
              ref={profileMenu}
              class="menu-popover profile-menu-popover"
              role="menu"
              aria-label="Profile and settings"
              onKeyDown={(event) => handleMenuKeyDown(
                event,
                event.currentTarget,
                () => setProfileMenuOpen(false),
                profileMenuButton,
              )}
            >
              <div class="profile-summary" role="presentation">
                <strong>{viewer()?.name ?? "dongo user"}</strong>
                <span>{viewer()?.email ?? ""}</span>
                <span>{currentProject()?.organizationName ?? projectName()} · {currentProject()?.membershipRole ?? "member"}</span>
              </div>
              <div class="menu-divider" />
              <button class="menu-action" type="button" role="menuitem" onClick={() => openSettings("Members")}>Organization settings</button>
              <button class="menu-action" type="button" role="menuitem" onClick={() => openSettings("General")}>Project settings</button>
              <button
                class="menu-action"
                type="button"
                role="menuitem"
                aria-keyshortcuts="?"
                onClick={() => {
                  setProfileMenuOpen(false);
                  navigate(`/app/${encodeURIComponent(props.orgSlug)}/${encodeURIComponent(props.projectSlug)}/help`);
                }}
              >
                Help <span class="menu-action__shortcut">?</span>
              </button>
              <SignOutButton class="menu-action menu-action--danger" role="menuitem" />
            </div>
          </Show>
        </div>
      </header>

      <div class="overview-scroll">
        <div class="overview-content">
          <section
            class="composer"
            aria-label="Add something"
          >
            <textarea
              ref={composerInput}
              class="composer__input"
              data-nav-item
              data-nav-kind="capture"
              data-nav-id="composer"
              data-keyboard-selected={keyboardSelection() === "capture:composer"}
              aria-keyshortcuts="C ArrowDown Meta+Enter Control+Enter"
              rows={draft().length > 60 ? 4 : 2}
              value={draft()}
              onFocus={() => setKeyboardSelection("capture:composer")}
              onInput={(event) => {
                setDraft(event.currentTarget.value);
                setSubmissionKey(crypto.randomUUID());
              }}
              onPaste={(event) => {
                const files = pastedFiles(event.clipboardData);
                if (files.length) addFiles(files);
              }}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void submitIntake();
                else if (
                  event.key === "ArrowDown" &&
                  !event.metaKey &&
                  !event.ctrlKey &&
                  !event.altKey &&
                  draft().length === 0
                ) {
                  event.preventDefault();
                  focusRelativeItem(1);
                }
              }}
              placeholder="Add something…"
            />
            <Show when={draftAttachments().length}>
              <div class="attachment-tray" aria-label="Selected attachments">
                <For each={draftAttachments()}>{(attachment) => (
                  <div class="attachment-row" data-state={attachment.state}>
                    <Show
                      when={attachment.previewUrl}
                      fallback={<div class="attachment-row__icon">{attachmentKind(attachment.file)}</div>}
                    >
                      {(previewUrl) => (
                        <div class="attachment-row__preview" aria-hidden="true">
                          <Show
                            when={attachmentKind(attachment.file) === "IMG"}
                            fallback={
                              <video
                                src={previewUrl()}
                                muted
                                playsinline
                                preload="metadata"
                              />
                            }
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
                <button
                  class="work-row work-row--attention"
                  data-work-id={item.id}
                  data-nav-item
                  data-nav-kind="work"
                  data-nav-id={item.id}
                  data-keyboard-selected={keyboardSelection() === `work:${item.id}`}
                  type="button"
                  aria-keyshortcuts="J ArrowDown K ArrowUp Enter Space R W D E"
                  onFocus={() => setKeyboardSelection(`work:${item.id}`)}
                  onClick={() => openWork(item.id)}
                >
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
                <button
                  class="work-row"
                  data-work-id={item.id}
                  data-nav-item
                  data-nav-kind="work"
                  data-nav-id={item.id}
                  data-keyboard-selected={keyboardSelection() === `work:${item.id}`}
                  type="button"
                  aria-keyshortcuts="J ArrowDown K ArrowUp Enter Space R W D E"
                  onFocus={() => setKeyboardSelection(`work:${item.id}`)}
                  onClick={() => openWork(item.id)}
                >
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
                <div
                  class="ready-row"
                  data-ready-id={item.id}
                  data-dragging={draggedReadyId() === item.id}
                  draggable="true"
                  onDragStart={(event) => {
                    setDraggedReadyId(item.id);
                    if (event.dataTransfer) {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", item.id);
                    }
                  }}
                  onDragEnd={() => setDraggedReadyId(undefined)}
                  onDragOver={(event) => {
                    const sourceId = draggedReadyId();
                    if (!sourceId || sourceId === item.id) return;
                    event.preventDefault();
                    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => dropReady(event, item.id)}
                >
                  <div class="reorder-controls">
                    <button class="reorder-button" type="button" disabled={index() === 0} aria-label={`Move ${item.title} up`} onClick={() => moveReady(item.id, -1)}>▲</button>
                    <button class="reorder-button" type="button" disabled={index() === ready().length - 1} aria-label={`Move ${item.title} down`} onClick={() => moveReady(item.id, 1)}>▼</button>
                  </div>
                  <button
                    class="ready-row__open"
                    data-work-id={item.id}
                    data-nav-item
                    data-nav-kind="work"
                    data-nav-id={item.id}
                    data-keyboard-selected={keyboardSelection() === `work:${item.id}`}
                    draggable="true"
                    type="button"
                    aria-keyshortcuts="J ArrowDown K ArrowUp Enter Space R W D E"
                    onFocus={() => setKeyboardSelection(`work:${item.id}`)}
                    onClick={() => openWork(item.id)}
                  >
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
                <button
                  class="work-row"
                  data-nav-item
                  data-nav-kind="intake"
                  data-nav-id={intake.id}
                  data-keyboard-selected={keyboardSelection() === `intake:${intake.id}`}
                  type="button"
                  aria-keyshortcuts="J ArrowDown K ArrowUp Enter Space"
                  onFocus={() => setKeyboardSelection(`intake:${intake.id}`)}
                  onClick={() => openIntake(intake.id)}
                >
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
                <button
                  class="work-row work-row--done"
                  data-work-id={item.id}
                  data-nav-item
                  data-nav-kind="work"
                  data-nav-id={item.id}
                  data-keyboard-selected={keyboardSelection() === `work:${item.id}`}
                  type="button"
                  aria-keyshortcuts="J ArrowDown K ArrowUp Enter Space R W D E"
                  onFocus={() => setKeyboardSelection(`work:${item.id}`)}
                  onClick={() => openWork(item.id)}
                >
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
          peek={detailPeek()}
          initialFocus={detailInitialFocus()}
          mobileCloseLabel="←  back"
          onClose={closeDetail}
          onOpenIntake={openIntake}
          onDownload={downloadAttachment}
          uploadAttachment={async (file, onProgress, signal) => {
            if (!connection) throw new Error("upload_unavailable");
            return await connection.uploadAttachment(file, onProgress, signal);
          }}
          discardAttachment={async (attachmentId) => {
            if (!connection) throw new Error("discard_unavailable");
            await connection.discardAttachment(attachmentId);
          }}
          announce={announce}
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
          onComment={async (body, attachmentIds) => {
            if (!connection) return;
            try {
              await connection.addComment(item().id, body, attachmentIds);
              announce("Comment added");
            } catch {
              announce("Comment could not be added");
              throw new Error("comment_failed");
            }
          }}
        />
      )}</Show>

      <Show when={selectedIntake()}>{(intake) => (
        <IntakeDetail intake={intake()} work={work()} onClose={closeDetail} onOpenWork={openWork} onDownload={downloadAttachment} />
      )}</Show>

      <Show when={searchOpen()}>
        <div
          class="search-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Search this project"
          onKeyDown={trapModalFocus}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeSearch();
          }}
        >
          <div class="search-box">
            <div class="search-box__head">
              <span class="mono" style={{ color: "var(--text-faint)" }}>/</span>
              <input
                ref={searchInput}
                class="search-box__input"
                value={query()}
                onInput={(event) => setQuery(event.currentTarget.value)}
                placeholder="Search work, comments and intake…"
              />
              <Show when={query()}>
                <button class="icon-button mono" type="button" aria-label="Clear search" onClick={() => setQuery("")}>clear</button>
              </Show>
              <button class="icon-button mono" type="button" onClick={() => closeSearch()}>esc</button>
            </div>
            <div class="search-box__results">
              <div class="search-scope">
                scope · {props.projectSlug} · work, comments, intake
                <Show when={searchResults().length}> · {searchResults().length} result{searchResults().length === 1 ? "" : "s"}</Show>
              </div>
              <Show when={query().trim().length < 2}>
                <div class="search-empty">Type at least two characters to search this project.</div>
              </Show>
              <For each={searchResults()}>{(result) => (
                <button class="search-result" type="button" onClick={() => selectSearchResult(result)}>
                  <span class="search-result__meta">
                    <span>{result.kind}</span>
                    <Show when={result.identifier}><span>{result.identifier}</span></Show>
                    <Show when={result.state}><span>{result.state}</span></Show>
                    <span>{result.age}</span>
                  </span>
                  <span class="search-result__title">
                    <HighlightedSearchText text={result.title} query={query()} />
                  </span>
                  <Show when={result.excerpt !== result.title}>
                    <span class="search-result__excerpt">
                      <HighlightedSearchText text={result.excerpt} query={query()} />
                    </span>
                  </Show>
                </button>
              )}</For>
              <Show when={searchLoading()}>
                <div class="search-empty" role="status">Searching this project…</div>
              </Show>
              <Show when={searchError()}>
                <div class="search-empty" role="alert">
                  <span>{searchError()}</span>{" "}
                  <button class="search-retry" type="button" onClick={() => setSearchRetry((value) => value + 1)}>Retry</button>
                </div>
              </Show>
              <Show when={query().trim().length >= 2 && !searchLoading() && !searchError() && searchResults().length === 0}>
                <div class="search-empty">Nothing found in this project.</div>
              </Show>
              <Show when={searchCursor() && !searchError()}>
                <button class="search-load-more" type="button" disabled={searchLoading()} onClick={() => void loadMoreSearch()}>
                  {searchLoading() ? "loading…" : "load more"}
                </button>
              </Show>
            </div>
          </div>
        </div>
      </Show>

      <Show when={commandMenuOpen()}>
        <CommandMenu
          commands={OVERVIEW_COMMANDS}
          onRun={runOverviewCommand}
          onClose={() => closeCommandMenu()}
        />
      </Show>

      <Show when={shortcutDialogOpen()}>
        <ShortcutDialog onClose={() => closeShortcutDialog()} />
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
  peek: boolean;
  initialFocus: DetailInitialFocus;
  mobileCloseLabel: string;
  onClose: () => void;
  onOpenIntake: (id: string) => void;
  onDownload: (attachmentId: string) => Promise<void>;
  uploadAttachment: OverviewConnection["uploadAttachment"];
  discardAttachment: OverviewConnection["discardAttachment"];
  announce: (message: string) => void;
  onRespond: (selectedOption?: string, body?: string) => Promise<void>;
  onResolve: () => Promise<void>;
  onComment: (body: string | undefined, attachmentIds: string[]) => Promise<void>;
};

function WorkDetail(props: WorkDetailProps) {
  const [choice, setChoice] = createSignal<string>();
  const [response, setResponse] = createSignal("");
  const [pending, setPending] = createSignal(false);
  let detailPanel: HTMLElement | undefined;
  let closeButton: HTMLButtonElement | undefined;

  onMount(() => {
    if (props.initialFocus === "respond") {
      queueMicrotask(() => {
        const target = detailPanel?.querySelector<HTMLElement>(
          ".attention-option, [data-response-composer], [data-comment-composer]",
        );
        (target ?? closeButton)?.focus();
      });
      return;
    }
    closeButton?.focus();
  });

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

  return (
    <aside ref={detailPanel} class="detail" data-peek={props.peek} role="dialog" aria-modal="true" aria-labelledby="work-detail-title" onKeyDown={trapModalFocus}>
      <div class="detail__head">
        <button ref={closeButton} class="detail__close" type="button" onClick={props.onClose}>
          <span class="detail-close-desktop">✕&nbsp; close</span><span class="detail-close-mobile">{props.mobileCloseLabel}</span>
        </button>
        <div class="detail__head-spacer" />
        <Show when={props.peek}><span class="detail__peek">peek · esc closes</span></Show>
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
            <MarkdownContent source={attention().body} class="attention-card__body" />
            <Show when={!attention().response} fallback={
              <div class="resolved-response">
                <div class="resolved-response__status">✓ answered</div>
                <MarkdownContent source={attention().response ?? ""} class="detail-section__body" />
                <div class="note">Your agent will see this on its next pull.</div>
              </div>
            }>
              <div class="attention-options">
                <For each={attention().options ?? []}>{(option) => (
                  <button class="attention-option" data-selected={choice() === option} type="button" onClick={() => setChoice(option)}>
                    <span class="attention-option__dot" /><span>{option}</span>
                  </button>
                )}</For>
                <textarea
                  class="textarea"
                  data-response-composer
                  aria-keyshortcuts="Meta+Enter Control+Enter"
                  value={response()}
                  onInput={(event) => setResponse(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      event.preventDefault();
                      void respond();
                    }
                  }}
                  placeholder="Add anything the agent should know…"
                  rows={3}
                />
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
          <MarkdownContent source={props.item.goal} class="detail-section__body" />
        </section>

        <Show when={props.item.sources?.length}>
          <section class="detail-section">
            <div class="detail-section__label">source intake</div>
            <div class="detail-attachment-list">
              <For each={props.item.sources}>{(source) => (
                <div class="detail-card source-intake-card">
                  <button class="source-intake-card__open" type="button" onClick={() => props.onOpenIntake(source.id)}>
                    <span>{source.text}</span>
                    <span class="mono">You · {source.age} →</span>
                  </button>
                  <For each={source.attachments}>{(attachment) => (
                    <AttachmentDownloadRow attachment={attachment} onDownload={props.onDownload} />
                  )}</For>
                </div>
              )}</For>
            </div>
          </section>
        </Show>

        <Show when={props.item.attachments?.length}>
          <section class="detail-section">
            <div class="detail-section__label">attachments</div>
            <div class="detail-attachment-list">
              <For each={props.item.attachments}>{(attachment) => (
                <AttachmentDownloadRow attachment={attachment} onDownload={props.onDownload} />
              )}</For>
            </div>
          </section>
        </Show>

        <Show when={props.item.latest}>
          <section class="detail-section">
            <div class="detail-section__label">latest from {props.item.agent ?? "agent"}</div>
            <div class="detail-card"><MarkdownContent source={props.item.latest ?? ""} /></div>
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
                <div class="conversation-entry__meta">
                  <span class="conversation-entry__who" data-role={entry.role ?? (entry.human ? "human" : "agent")}>{entry.who}</span>
                  <span class="conversation-entry__role">{entry.role === "system" ? "system" : entry.human || entry.role === "human" ? "human" : entry.agentType ? `${entry.agentType} agent` : "agent"}</span>
                  <span>{entry.when}</span>
                </div>
                <Show when={entry.text}><MarkdownContent source={entry.text} class="conversation-entry__text" /></Show>
                <Show when={entry.attachments?.length}>
                  <div class="conversation-entry__attachments">
                    <For each={entry.attachments}>{(attachment) => (
                      <AttachmentDownloadRow attachment={attachment} onDownload={props.onDownload} />
                    )}</For>
                  </div>
                </Show>
              </div>
            )}</For>
          </section>
        </Show>

        <CommentComposer
          onSubmit={props.onComment}
          uploadAttachment={props.uploadAttachment}
          discardAttachment={props.discardAttachment}
          announce={props.announce}
        />
      </div>
    </aside>
  );
}

type IntakeDetailProps = {
  intake: Intake;
  work: WorkItem[];
  onClose: () => void;
  onOpenWork: (id: string) => void;
  onDownload: (attachmentId: string) => Promise<void>;
};

function IntakeDetail(props: IntakeDetailProps) {
  const linked = () => props.work.filter((item) => props.intake.linkedWorkIds?.includes(item.id));
  let closeButton: HTMLButtonElement | undefined;

  onMount(() => closeButton?.focus());

  return (
    <aside class="detail" role="dialog" aria-modal="true" aria-labelledby="intake-detail-title" onKeyDown={trapModalFocus}>
      <div class="detail__head">
        <button ref={closeButton} class="detail__close" type="button" onClick={props.onClose}>
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
            <Show when={props.intake.attachments?.length}>
              <div class="detail-attachment-list" style={{ "margin-top": "11px" }}>
                <For each={props.intake.attachments}>{(attachment) => (
                  <AttachmentDownloadRow attachment={attachment} onDownload={props.onDownload} />
                )}</For>
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

function AttachmentDownloadRow(props: {
  attachment: AttachmentSummary;
  onDownload: (attachmentId: string) => Promise<void>;
}) {
  const [pending, setPending] = createSignal(false);

  const download = async () => {
    if (pending()) return;
    setPending(true);
    try {
      await props.onDownload(props.attachment.id);
    } catch {
      return;
    } finally {
      setPending(false);
    }
  };

  return (
    <div class="attachment-row">
      <div class="attachment-row__icon">
        {props.attachment.mimeType.startsWith("image/")
          ? "IMG"
          : props.attachment.mimeType.startsWith("video/")
            ? "VID"
            : "FILE"}
      </div>
      <div class="attachment-row__copy">
        <div class="attachment-row__name">{props.attachment.filename}</div>
        <div class="attachment-row__state">{formatAttachmentBytes(props.attachment.byteSize)} · secure download</div>
      </div>
      <button
        class="attachment-row__action"
        type="button"
        disabled={pending()}
        aria-label={`Download ${props.attachment.filename}`}
        onClick={() => void download()}
      >
        {pending() ? "Preparing…" : "Download"}
      </button>
    </div>
  );
}
