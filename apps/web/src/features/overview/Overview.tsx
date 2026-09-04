import { useNavigate, useSearchParams } from "@solidjs/router";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Brand } from "../../components/Brand";
import { AgentIdentity } from "../../components/AgentIdentity";
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
import {
  actorDisplayIdentity,
  isInlineImagePreviewAvailable,
  ProjectDataConnection,
} from "../../lib/project-data";
import {
  clearLocalDraft,
  readLocalDraft,
  writeLocalDraft,
} from "../../lib/local-drafts";
import type {
  IntakeUpdateInput,
  IntakeUpdateResult,
  IssueClosureInput,
  ProjectInfo,
  ProjectSearchCursor,
  ProjectSearchResult,
  ProjectConcurrencySnapshot,
  RunnerHarness,
  RunnerJob,
  RunnerJobState,
  RunnerSnapshot,
} from "../../lib/project-data";
import { searchHighlightSegments } from "../../lib/search-highlight";
import { projectCapacityLabel, projectCreationAction } from "../../lib/plans";
import {
  attentionNotificationBody,
  attentionPageTitle,
  desktopAlertPreferenceKey,
  newlyObservedAttentionIds,
  readDesktopAlertPreference,
  readSeenAttentionIds,
  seenAttentionStorageKey,
  writeDesktopAlertPreference,
  writeSeenAttentionIds,
  type DesktopAlertPermission,
} from "../../lib/attention-alerts";
import { loadPlatformAdminAccess } from "../../lib/platform-data";
import type { AttachmentSummary, Intake, OwnerAttention, WorkItem } from "./model";
import { CommentComposer } from "./CommentComposer";
import { IntakeEditor } from "./IntakeEditor";
import { ConcurrentActivity } from "./ConcurrentActivity";
import { closureReasonLabel, IssueCloseForm } from "./IssueCloseForm";
import "./overview.css";

export type OverviewConnection = Pick<
  ProjectDataConnection,
  | "projectName"
  | "availableProjects"
  | "subscribeOverview"
  | "subscribeConcurrency"
  | "subscribeRunners"
  | "subscribeWorkDetail"
  | "subscribeWorkById"
  | "subscribeWorkByIdentifier"
  | "subscribeIntakeDetail"
  | "searchProject"
  | "createIntake"
  | "createChildWork"
  | "updateIntake"
  | "dismissIntake"
  | "closeWork"
  | "uploadAttachment"
  | "discardAttachment"
  | "downloadAttachment"
  | "loadAttachmentPreview"
  | "reorderWork"
  | "markAttentionSeen"
  | "respondToAttention"
  | "resolveAttention"
  | "addComment"
  | "enqueueRunnerJob"
  | "cancelRunnerJob"
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
  loadPlatformAccess?: () => Promise<boolean>;
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

type DetailInitialFocus = "close" | "respond" | "comment" | "detail" | "preserve";

class ConcurrentWorkChangeError extends Error {
  constructor() {
    super("The work item changed while this response was being sent");
    this.name = "ConcurrentWorkChangeError";
  }
}

function isConcurrentWorkChange(error: unknown): boolean {
  const data = typeof error === "object" && error !== null && "data" in error
    ? (error as { data?: unknown }).data
    : undefined;
  const code = typeof data === "object" && data !== null && "code" in data
    ? (data as { code?: unknown }).code
    : undefined;
  const message = error instanceof Error ? error.message : "";
  return code === "revision_conflict" ||
    code === "idempotency_conflict" ||
    /revision_conflict|idempotency_conflict|already resolved|changed since/i.test(message);
}

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

export function isHumanWorkIdentifier(value: string): boolean {
  return /^[a-z]{4}\d{3}$/.test(value) || /^[A-Z][A-Z0-9]{1,7}-[1-9]\d*$/.test(value);
}

function sameOverviewRoute(
  left: OverviewRouteState,
  right: OverviewRouteState,
): boolean {
  return left.work === right.work &&
    left.intake === right.intake &&
    left.search === right.search;
}

function runnerJobLabel(state: RunnerJobState): string {
  switch (state) {
    case "queued": return "Queued · waiting for an online runner";
    case "delivered": return "Delivered to a runner";
    case "awaiting_local_approval": return "Waiting for approval on the runner computer";
    case "starting": return "Starting locally";
    case "running": return "Running locally";
    case "blocked": return "Blocked";
    case "cancel_requested": return "Cancellation requested";
    case "cancelled": return "Cancelled";
    case "failed": return "Failed";
    case "completed": return "Completed";
    case "expired": return "Expired before it could start";
  }
}

function runnerHarnessName(harness: RunnerHarness): "Claude Code" | "Codex" {
  return harness === "claude" ? "Claude Code" : "Codex";
}

function readyRunnerJobLabel(job: RunnerJob): string {
  const agent = runnerHarnessName(job.harness);
  switch (job.state) {
    case "queued": return `Queued for ${agent}`;
    case "delivered": return `Sent to ${agent}`;
    case "awaiting_local_approval": return `${agent} needs approval`;
    case "starting":
    case "running": return `${agent} is starting`;
    case "blocked": return `${agent} is waiting`;
    case "cancel_requested": return `Stopping ${agent}`;
    case "cancelled": return "Local run cancelled";
    case "failed": return "Local run failed";
    case "completed": return "Local run completed";
    case "expired": return "Local run expired";
  }
}

export function Overview(props: OverviewProps) {
  const navigate = useNavigate();
  const [routeParams, setRouteParams] = useSearchParams<{
    work?: string;
    intake?: string;
    search?: string;
  }>();
  const [work, setWork] = createSignal<WorkItem[]>([]);
  const [ownerAttention, setOwnerAttention] = createSignal<OwnerAttention[]>([]);
  const [intakes, setIntakes] = createSignal<Intake[]>([]);
  const [optimisticIntakes, setOptimisticIntakes] = createSignal<Intake[]>([]);
  const [composerOpen, setComposerOpen] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  const [draftAttachments, setDraftAttachments] = createSignal<DraftAttachment[]>([]);
  const [submissionKey, setSubmissionKey] = createSignal(crypto.randomUUID());
  const [selectedWorkId, setSelectedWorkId] = createSignal<string>();
  const [selectedWorkReference, setSelectedWorkReference] = createSignal<string>();
  const [selectedWorkDetail, setSelectedWorkDetail] = createSignal<WorkItem>();
  const [selectedIntakeId, setSelectedIntakeId] = createSignal<string>();
  const [selectedIntakeDetail, setSelectedIntakeDetail] = createSignal<Intake>();
  const [concurrency, setConcurrency] = createSignal<ProjectConcurrencySnapshot>();
  const [concurrencyStatus, setConcurrencyStatus] = createSignal<"loading" | "ready" | "error">("loading");
  const [runnerSnapshot, setRunnerSnapshot] = createSignal<RunnerSnapshot>({ registrations: [], jobs: [], automaticIntake: { enabled: false, revision: 0 }, serverTime: Date.now() });
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
  const [platformAdmin, setPlatformAdmin] = createSignal(false);
  const [projectMenuOpen, setProjectMenuOpen] = createSignal(false);
  const [profileMenuOpen, setProfileMenuOpen] = createSignal(false);
  const [commandMenuOpen, setCommandMenuOpen] = createSignal(false);
  const [shortcutDialogOpen, setShortcutDialogOpen] = createSignal(false);
  const [keyboardSelection, setKeyboardSelection] = createSignal<string>();
  const [detailPeek, setDetailPeek] = createSignal(false);
  const [detailInitialFocus, setDetailInitialFocus] = createSignal<DetailInitialFocus>("close");
  const [draggedReadyId, setDraggedReadyId] = createSignal<string>();
  const [fileDropActive, setFileDropActive] = createSignal(false);
  const [wideDetailLayout, setWideDetailLayout] = createSignal(false);
  const [desktopAlertsAvailable, setDesktopAlertsAvailable] = createSignal(false);
  const [desktopAlertsEnabled, setDesktopAlertsEnabled] = createSignal(false);
  const [desktopAlertPermission, setDesktopAlertPermission] = createSignal<DesktopAlertPermission>("unsupported");
  let connection: OverviewConnection | undefined;
  let unsubscribeOverview: (() => void) | undefined;
  let unsubscribeConcurrency: (() => void) | undefined;
  let unsubscribeRunners: (() => void) | undefined;
  let unsubscribeWork: (() => void) | undefined;
  let unsubscribeIntake: (() => void) | undefined;
  let fileInput: HTMLInputElement | undefined;
  let projectMenuButton: HTMLButtonElement | undefined;
  let projectMenu: HTMLDivElement | undefined;
  let profileMenuButton: HTMLButtonElement | undefined;
  let profileMenu: HTMLDivElement | undefined;
  let searchButton: HTMLButtonElement | undefined;
  let searchInput: HTMLInputElement | undefined;
  let composerButton: HTMLButtonElement | undefined;
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
  const originalPageTitle = typeof document === "undefined" ? undefined : document.title;
  let previousAttentionIds: Set<string> | undefined;
  let seenAttentionIds = new Set<string>();
  const alertPreferenceKey = desktopAlertPreferenceKey(props.orgSlug, props.projectSlug);
  const seenAlertKey = seenAttentionStorageKey(props.orgSlug, props.projectSlug);

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
  const attentionCount = createMemo(() => needs().length + ownerAttention().length);
  const actionableAttentionIds = createMemo(() => [
    ...ownerAttention().map((item) => item.attention.id),
    ...needs().flatMap((item) => item.attention?.id ? [item.attention.id] : [item.id]),
  ]);
  const activeRunWorkIds = createMemo(() =>
    concurrencyStatus() === "ready"
      ? new Set((concurrency()?.runs ?? []).map((run) => run.workItem.id))
      : new Set<string>(),
  );
  const working = createMemo(() =>
    work().filter(
      (item) => item.state === "working" && !activeRunWorkIds().has(item.id),
    ),
  );
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
  const canRequestProjectCreation = createMemo(() =>
    currentProject()?.membershipRole === "owner",
  );
  const projectAllowance = createMemo(() => {
    const project = currentProject();
    if (!project) return "";
    return projectCapacityLabel({
      plan: project.organizationPlan,
      activeProjectCount: project.activeProjectCount,
      activeProjectLimit: project.activeProjectLimit,
      projectCapacitySource: project.projectCapacitySource,
      canCreateProject: project.canCreateProject,
    });
  });
  const projectAction = createMemo(() => {
    const project = currentProject();
    if (!project) return undefined;
    return projectCreationAction({
      plan: project.organizationPlan,
      activeProjectCount: project.activeProjectCount,
      activeProjectLimit: project.activeProjectLimit,
      projectCapacitySource: project.projectCapacitySource,
      canCreateProject: project.canCreateProject,
    }, project.organizationSlug, project.slug);
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
    const title = attentionPageTitle(attentionCount());
    if (typeof document !== "undefined") document.title = title;
  });

  createEffect(() => {
    const ids = actionableAttentionIds();
    if (loading()) return;

    if (!previousAttentionIds) {
      previousAttentionIds = new Set(ids);
      for (const id of ids) seenAttentionIds.add(id);
      if (typeof sessionStorage !== "undefined") {
        writeSeenAttentionIds(sessionStorage, seenAlertKey, seenAttentionIds);
      }
      return;
    }

    const newIds = newlyObservedAttentionIds(ids, previousAttentionIds, seenAttentionIds);
    previousAttentionIds = new Set(ids);
    if (newIds.length === 0) return;

    for (const id of newIds) seenAttentionIds.add(id);
    if (typeof sessionStorage !== "undefined") {
      writeSeenAttentionIds(sessionStorage, seenAlertKey, seenAttentionIds);
    }

    if (
      !desktopAlertsAvailable() ||
      !desktopAlertsEnabled() ||
      typeof document === "undefined" ||
      (document.visibilityState !== "hidden" && document.hasFocus()) ||
      window.Notification.permission !== "granted"
    ) return;

    try {
      const notification = new window.Notification("dongo needs you", {
        body: attentionNotificationBody(newIds.length),
        tag: "dongo-needs-you",
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } catch {
      setDesktopAlertsEnabled(false);
      writeDesktopAlertPreference(localStorage, alertPreferenceKey, false);
    }
  });

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

  const toggleDesktopAlerts = async () => {
    if (!desktopAlertsAvailable()) return;
    if (desktopAlertsEnabled()) {
      setDesktopAlertsEnabled(false);
      writeDesktopAlertPreference(localStorage, alertPreferenceKey, false);
      announce("Desktop alerts turned off");
      return;
    }

    try {
      const permission = window.Notification.permission === "granted"
        ? "granted"
        : await window.Notification.requestPermission();
      setDesktopAlertPermission(permission);
      if (permission !== "granted") {
        setDesktopAlertsEnabled(false);
        writeDesktopAlertPreference(localStorage, alertPreferenceKey, false);
        announce(permission === "denied"
          ? "Desktop alerts are blocked in browser settings"
          : "Desktop alerts were not turned on");
        return;
      }
      setDesktopAlertsEnabled(true);
      writeDesktopAlertPreference(localStorage, alertPreferenceKey, true);
      announce("Desktop alerts turned on while dongo is open");
    } catch {
      setDesktopAlertPermission("unsupported");
      setDesktopAlertsAvailable(false);
      announce("Desktop alerts are not available in this browser");
    }
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

  const closeDetail = (updateRoute = true, restoreFocus = true) => {
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
    setSelectedWorkReference(undefined);
    setSelectedIntakeId(undefined);
    setDetailPeek(false);
    setDetailInitialFocus("close");
    if (restoreFocus) {
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
    }
  };

  const closeDetailFromBackdrop = (event: PointerEvent) => {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    event.stopPropagation();
    closeDetail();
  };

  const openWork = (
    reference: string,
    updateRoute = true,
    returnFocus?: HTMLElement,
    peek = false,
    initialFocus?: DetailInitialFocus,
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
    } else {
      detailReturnFocus = returnFocus;
      detailReturnToSearch = returnFocus === searchButton ||
        returnFocus?.classList.contains("search-button") === true;
    }
    const item = work().find((candidate) =>
      candidate.id === reference ||
      candidate.identifier === reference ||
      candidate.legacyIdentifiers?.includes(reference),
    );
    const routeReference = item?.identifier ?? reference;
    if (updateRoute) applyRouteUpdate({ work: routeReference, intake: undefined });
    unsubscribeWork?.();
    unsubscribeWork = undefined;
    unsubscribeIntake?.();
    unsubscribeIntake = undefined;
    setSelectedWorkDetail(undefined);
    setSelectedIntakeDetail(undefined);
    setSelectedIntakeId(undefined);
    setDetailPeek(peek);
    setDetailInitialFocus(
      initialFocus ?? (item?.attention && !item.attention.response ? "respond" : "comment"),
    );
    setSelectedWorkReference(updateRoute ? routeReference : reference);
    setSelectedWorkId(item?.id ?? reference);
    if (item) setKeyboardSelection(`work:${item.id}`);
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
      : isHumanWorkIdentifier(reference)
        ? connection.subscribeWorkByIdentifier(
          reference,
          (detail) => {
            setSelectedWorkId(detail.id);
            setSelectedWorkDetail(detail);
            setKeyboardSelection(`work:${detail.id}`);
          },
          () => {
            announce("This Work item is unavailable");
            closeDetail();
          },
        )
        : connection.subscribeWorkById(
          reference,
          (detail) => {
            setSelectedWorkId(detail.id);
            setSelectedWorkDetail(detail);
            setKeyboardSelection(`work:${detail.id}`);
          },
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
    } else {
      detailReturnFocus = returnFocus;
      detailReturnToSearch = returnFocus === searchButton ||
        returnFocus?.classList.contains("search-button") === true;
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
    setDetailInitialFocus(initialFocus);
    setSelectedIntakeId(id);
    setKeyboardSelection(`intake:${id}`);
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

  const overviewPath = () =>
    `/app/${encodeURIComponent(props.orgSlug)}/${encodeURIComponent(props.projectSlug)}`;
  const workDetailHref = (identifier: string) =>
    `${overviewPath()}?work=${encodeURIComponent(identifier)}`;
  const intakeDetailHref = (id: string) =>
    `${overviewPath()}?intake=${encodeURIComponent(id)}`;
  const handleWorkLink = (
    event: MouseEvent & { currentTarget: HTMLAnchorElement },
    id: string,
  ) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) return;
    event.preventDefault();
    openWork(id, true, event.currentTarget);
  };
  const handleIntakeLink = (
    event: MouseEvent & { currentTarget: HTMLAnchorElement },
    id: string,
  ) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) return;
    event.preventDefault();
    openIntake(id, true, event.currentTarget);
  };

  const activateNavigationItem = (
    kind: "work" | "intake",
    id: string,
    element: HTMLElement,
    initialFocus: DetailInitialFocus = "close",
  ) => {
    setKeyboardSelection(`${kind}:${id}`);
    if (kind === "work") {
      const item = work().find((candidate) => candidate.id === id);
      const routeReference = item?.identifier ?? id;
      if (
        selectedWorkId() !== id ||
        Boolean(selectedIntakeId()) ||
        currentRouteState().work !== routeReference
      ) {
        openWork(id, true, element, false, initialFocus);
      }
      return;
    }
    if (
      selectedIntakeId() !== id ||
      Boolean(selectedWorkId()) ||
      currentRouteState().intake !== id
    ) {
      openIntake(id, true, element, false, initialFocus);
    }
  };

  const trackNavigationItemFocus = (kind: "work" | "intake", id: string) => {
    const noActiveIssue = !selectedWorkId() && !selectedIntakeId();
    const alreadyActive = kind === "work"
      ? selectedWorkId() === id && !selectedIntakeId()
      : selectedIntakeId() === id && !selectedWorkId();
    if (noActiveIssue || alreadyActive) setKeyboardSelection(`${kind}:${id}`);
  };

  const activateCaptureNavigation = () => {
    setKeyboardSelection("capture:composer");
    if (selectedWorkId() || selectedIntakeId()) closeDetail(true, false);
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
      if (selectedWorkReference() !== workId) openWork(workId, false);
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
    setComposerOpen(true);
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
      setComposerOpen(false);
      announce("Added to Inbox");
      queueMicrotask(() => composerButton?.focus({ preventScroll: true }));
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
      announce("Another person or agent changed Ready. The latest order is shown; try again");
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

  const loadAttachmentPreview = async (
    attachment: AttachmentSummary,
    signal?: AbortSignal,
  ) => {
    if (!connection) throw new Error("preview_unavailable");
    return await connection.loadAttachmentPreview(attachment, signal);
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
    if (result.targetKind === "work") {
      openWork(result.identifier ?? result.targetId, true, returnFocus);
    }
    else openIntake(result.targetId, true, returnFocus);
  };

  const navigableItems = (): HTMLElement[] => {
    const visible = [...document.querySelectorAll<HTMLElement>("[data-nav-item]")]
      .filter((element) => element.offsetParent !== null);
    const capture = visible.filter((element) => element.dataset.navKind === "capture");
    const issues = visible.filter((element) => element.dataset.navKind !== "capture");
    // J/K remains an issue navigator: its first forward stop is the highest
    // priority issue, while K from that boundary still exposes quick capture.
    return [...capture, ...issues];
  };

  const navKey = (element: HTMLElement): string | undefined => {
    const kind = element.dataset.navKind;
    const id = element.dataset.navId;
    return kind && id ? `${kind}:${id}` : undefined;
  };

  const selectedNavItem = (): HTMLElement | undefined => {
    const selected = keyboardSelection();
    if (selected) {
      const matching = navigableItems().find((element) => navKey(element) === selected);
      if (matching) return matching;
    }
    const focused = document.activeElement instanceof Element
      ? document.activeElement.closest<HTMLElement>("[data-nav-item]")
      : null;
    return focused ?? undefined;
  };

  const selectedDetailNavItem = (): HTMLElement | undefined => {
    const key = selectedWorkId()
      ? `work:${selectedWorkId()}`
      : selectedIntakeId()
        ? `intake:${selectedIntakeId()}`
        : undefined;
    return key
      ? navigableItems().find((element) => navKey(element) === key)
      : undefined;
  };

  const focusSelectedDetailInSidebar = () => {
    const selected = selectedDetailNavItem();
    if (!selected) {
      announce("Open an issue before returning to the issue list");
      return;
    }
    const key = navKey(selected);
    if (key) setKeyboardSelection(key);
    selected.focus({ preventScroll: true });
    selected.scrollIntoView({ block: "nearest" });
  };

  const focusCurrentOpenDetail = () => {
    const selected = selectedDetailNavItem();
    const id = selected?.dataset.navId;
    if (!selected || !id) {
      announce("Open an issue before moving focus into its detail");
      return;
    }
    const key = navKey(selected);
    if (key) setKeyboardSelection(key);
    const detail = [...document.querySelectorAll<HTMLElement>(".detail[data-detail-id]")]
      .find((element) => element.dataset.detailId === id);
    if (!detail) {
      announce("The open issue detail is not available yet");
      return;
    }
    detail.focus({ preventScroll: true });
    detail.scrollIntoView({ block: "nearest" });
  };

  const focusCurrentWorkResponse = (id: string): boolean => {
    const detail = [...document.querySelectorAll<HTMLElement>(".detail[data-detail-id]")]
      .find((element) => element.dataset.detailId === id);
    const target = detail?.querySelector<HTMLElement>(
      ".attention-option, [data-response-composer], [data-comment-composer]",
    );
    if (!target) return false;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "nearest" });
    return true;
  };

  const focusCurrentWorkComment = (id: string): boolean => {
    const detail = [...document.querySelectorAll<HTMLElement>(".detail[data-detail-id]")]
      .find((element) => element.dataset.detailId === id);
    const target = detail?.querySelector<HTMLElement>("[data-comment-composer]");
    if (!target) return false;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "nearest" });
    return true;
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
    const kind = next.dataset.navKind;
    const id = next.dataset.navId;
    if ((kind === "work" || kind === "intake") && id) {
      const preserveSidebarFocus = window.matchMedia("(min-width: 1100px)").matches;
      activateNavigationItem(kind, id, next, preserveSidebarFocus ? "preserve" : "close");
      if (preserveSidebarFocus) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (keyboardSelection() !== key) return;
            if (document.activeElement instanceof Element && document.activeElement.closest(".detail")) return;
            const activeRow = navigableItems().find((element) => navKey(element) === key);
            activeRow?.focus({ preventScroll: true });
          });
        });
      }
    }
  };

  const requireSelectedItem = (): HTMLElement | undefined => {
    const selected = selectedNavItem();
    if (!selected) announce("Use J or K to select an item first");
    return selected;
  };

  const focusWideDetailWhenReady = (id: string) => {
    let remainingFrames = 12;
    const focusRenderedDetail = () => {
      if (!wideDetailLayout()) return;
      const detail = [...document.querySelectorAll<HTMLElement>(".detail[data-detail-id]")]
        .find((element) => element.dataset.detailId === id);
      if (detail) {
        detail.focus({ preventScroll: true });
        return;
      }
      remainingFrames -= 1;
      if (remainingFrames > 0) requestAnimationFrame(focusRenderedDetail);
    };
    requestAnimationFrame(focusRenderedDetail);
  };

  const openSelectedItem = (peek = false, respond = false) => {
    const selected = requireSelectedItem();
    if (!selected) return;
    const id = selected.dataset.navId;
    if (!id) return;
    if (selected.dataset.navKind === "work") {
      if (!peek && wideDetailLayout() && selectedWorkId() === id) {
        const item = work().find((candidate) => candidate.id === id);
        const focused = respond || (item?.attention && !item.attention.response)
          ? focusCurrentWorkResponse(id)
          : focusCurrentWorkComment(id);
        if (focused) return;
      }
      openWork(
        id,
        !peek,
        selected,
        peek,
        respond ? "respond" : undefined,
      );
      return;
    }
    if (respond) {
      announce("Respond and review are available on Work items");
      return;
    }
    if (!peek && wideDetailLayout() && selectedIntakeId() === id) {
      focusCurrentOpenDetail();
      return;
    }
    openIntake(
      id,
      !peek,
      selected,
      peek,
      wideDetailLayout() && !peek ? "detail" : "close",
    );
    if (wideDetailLayout() && !peek) focusWideDetailWhenReady(id);
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
    const id = selected.dataset.navId;
    if (!id) return;
    if (!(wideDetailLayout() && selectedWorkId() === id && focusCurrentWorkComment(id))) {
      openWork(id, true, selected, false, "comment");
    }
    announce("Add your correction as a comment for the agent.");
  };

  const focusCapture = () => {
    if (searchOpen()) closeSearch(true, false);
    if (selectedWorkId() || selectedIntakeId()) closeDetail(true, false);
    setComposerOpen(true);
    queueMicrotask(() => {
      composerInput?.focus({ preventScroll: true });
      composerInput?.scrollIntoView({ block: "center" });
    });
  };

  const closeCapture = () => {
    setComposerOpen(false);
    setKeyboardSelection("capture:composer");
    queueMicrotask(() => composerButton?.focus({ preventScroll: true }));
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
        case "sidebar":
          if (
            wideDetailLayout() &&
            Boolean(selectedWorkId() || selectedIntakeId()) &&
            Boolean(returnFocus?.closest("[data-nav-item]"))
          ) focusCurrentOpenDetail();
          else focusSelectedDetailInSidebar();
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
    const wideDetailMedia = window.matchMedia("(min-width: 1100px)");
    const updateWideDetailLayout = () => setWideDetailLayout(wideDetailMedia.matches);
    updateWideDetailLayout();
    wideDetailMedia.addEventListener("change", updateWideDetailLayout);
    const desktopAlertMedia = window.matchMedia("(min-width: 700px)");
    const notificationsSupported = window.isSecureContext && typeof window.Notification === "function";
    const updateDesktopAlertAvailability = () => {
      setDesktopAlertsAvailable(notificationsSupported && desktopAlertMedia.matches);
    };
    updateDesktopAlertAvailability();
    desktopAlertMedia.addEventListener("change", updateDesktopAlertAvailability);
    if (notificationsSupported) {
      const permission = window.Notification.permission;
      setDesktopAlertPermission(permission);
      setDesktopAlertsEnabled(
        permission === "granted" &&
        readDesktopAlertPreference(localStorage, alertPreferenceKey),
      );
    }
    seenAttentionIds = readSeenAttentionIds(sessionStorage, seenAlertKey);
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
        } else if (composerOpen()) {
          event.preventDefault();
          closeCapture();
        }
        return;
      }
      if (
        commandMenuOpen() ||
        shortcutDialogOpen() ||
        projectMenuOpen() ||
        profileMenuOpen() ||
        searchOpen() ||
        ((selectedWorkId() || selectedIntakeId()) && !wideDetailLayout()) ||
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
      } else if (
        event.key === "ArrowLeft" &&
        wideDetailLayout() &&
        Boolean(selectedWorkId() || selectedIntakeId())
      ) {
        event.preventDefault();
        const fromSidebarItem = event.target instanceof Element &&
          Boolean(event.target.closest("[data-nav-item]"));
        if (fromSidebarItem) focusCurrentOpenDetail();
        else focusSelectedDetailInSidebar();
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
        const [connected, session, hasPlatformAccess] = await Promise.all([
          props.connect
            ? props.connect(props.orgSlug, props.projectSlug)
            : ProjectDataConnection.connect(props.orgSlug, props.projectSlug),
          props.loadSession ? props.loadSession() : humanSession(),
          props.loadPlatformAccess
            ? props.loadPlatformAccess()
            : loadPlatformAdminAccess(),
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
        setPlatformAdmin(hasPlatformAccess);
        unsubscribeOverview = connected.subscribeOverview(
          (overview) => {
            setProjectName(overview.projectName);
            setWork(overview.work);
            setIntakes(overview.intakes);
            setOwnerAttention(overview.ownerAttention ?? []);
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
        unsubscribeConcurrency = connected.subscribeConcurrency(
          (snapshot) => {
            const focusedWorkId = document.activeElement instanceof HTMLElement
              ? document.activeElement.closest<HTMLElement>("[data-work-id]")?.dataset.workId
              : undefined;
            const focusedWorkingId = work().some(
              (item) => item.id === focusedWorkId && item.state === "working",
            )
              ? focusedWorkId
              : undefined;
            const replacementRun = focusedWorkingId
              ? snapshot.runs.find((run) => run.workItem.id === focusedWorkingId)
              : undefined;
            if (replacementRun) {
              restoreFocusAfterRender(undefined, () =>
                [...document.querySelectorAll<HTMLElement>("[data-run-id]")]
                  .find((element) => element.dataset.runId === replacementRun.id),
              );
            }
            setConcurrency(snapshot);
            setConcurrencyStatus("ready");
          },
          () => setConcurrencyStatus("error"),
        );
        unsubscribeRunners = connected.subscribeRunners(
          setRunnerSnapshot,
          () => announce("Local runner status is temporarily unavailable"),
        );
      } catch {
        setLoadError("This project could not be loaded for your account.");
        setLoading(false);
      }
    })();
    onCleanup(() => {
      wideDetailMedia.removeEventListener("change", updateWideDetailLayout);
      desktopAlertMedia.removeEventListener("change", updateDesktopAlertAvailability);
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
    if (originalPageTitle !== undefined) document.title = originalPageTitle;
    const connected = connection;
    const unattachedIds = availableAttachmentIds();
    for (const attachment of draftAttachments()) {
      revokeAttachmentPreview(attachment);
    }
    for (const controller of uploadControllers.values()) controller.abort();
    uploadControllers.clear();
    unsubscribeOverview?.();
    unsubscribeConcurrency?.();
    unsubscribeRunners?.();
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
    <main
      class="app-page"
      data-detail-open={Boolean(selectedWorkId() || selectedIntakeId())}
      data-wide-detail={wideDetailLayout()}
    >
      <Show when={fileDropActive()}>
        <div class="file-drop-zone" role="status" aria-live="polite">
          <div class="file-drop-zone__message">
            <span class="file-drop-zone__icon" aria-hidden="true">+</span>
            <strong>Drop to attach</strong>
            <span>Add files to your new issue</span>
          </div>
        </div>
      </Show>
      <header class="app-header app-header--overview">
        <Brand compact href={`/app/${props.orgSlug}/${props.projectSlug}`} />
        <div class="header-menu">
          <span class="visually-hidden" id="overview-current-project">
            Current project: {projectName()}
          </span>
          <button
            ref={projectMenuButton}
            class="project-button"
            type="button"
            aria-label="Select organization or project"
            aria-describedby="overview-current-project"
            aria-haspopup="menu"
            aria-expanded={projectMenuOpen()}
            onClick={() => {
              const next = !projectMenuOpen();
              setProjectMenuOpen(next);
              setProfileMenuOpen(false);
              if (next) focusFirstMenuItem(() => projectMenu);
            }}
          >
            <span class="project-button__name" title={projectName()}>{projectName()}</span>
            <span class="project-button__chevron" aria-hidden="true">▾</span>
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
              <button
                class="menu-action"
                type="button"
                role="menuitem"
                onClick={() => navigate("/app/projects")}
              >All projects</button>
              <div class="menu-divider" />
              <Show when={currentProject()}>
                <div class="menu-label">{projectAllowance()}</div>
              </Show>
              <Show when={canRequestProjectCreation()}>
                <button
                  class="menu-action"
                  type="button"
                  role="menuitem"
                  onClick={() => navigate(projectAction()!.href)}
                >{projectAction()!.intent === "create" ? "+ Create project" : projectAction()!.label}</button>
              </Show>
              <button class="menu-action" type="button" role="menuitem" onClick={() => openSettings("Members")}>Organization settings</button>
              <button class="menu-action" type="button" role="menuitem" onClick={() => openSettings("General")}>Project settings</button>
            </div>
          </Show>
        </div>
        <div class="header-spacer" />
        <nav class="overview-header__nav" aria-label="Project navigation">
          <button
            class="button button--quiet"
            type="button"
            onClick={() => navigate(`/app/${encodeURIComponent(props.orgSlug)}/${encodeURIComponent(props.projectSlug)}/ideas`)}
          >Ideas</button>
          <button ref={searchButton} class="search-button" type="button" disabled={loading() || Boolean(loadError())} onClick={() => openSearch()} aria-label="Search this project" aria-keyshortcuts="/">
            <span>search</span><span class="shortcut">/</span>
          </button>
        </nav>
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
              <Show when={platformAdmin()}>
                <button class="menu-action" type="button" role="menuitem" onClick={() => navigate("/admin")}>Platform administration</button>
              </Show>
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
          <Show when={attentionCount()}>
            <section class="work-section work-section--attention" aria-labelledby="needs-heading">
              <div class="section-heading section-heading--attention" id="needs-heading">
                <span class="section-heading__pulse" aria-hidden="true" />
                <span>needs you</span><span class="section-heading__count">{attentionCount()}</span>
                <Show when={desktopAlertsAvailable() && desktopAlertPermission() !== "denied"}>
                  <span class="section-heading__aside attention-alerts">
                    <button
                      class="attention-alerts__button"
                      type="button"
                      aria-pressed={desktopAlertsEnabled()}
                      title="Alerts arrive for new action while dongo is open in this browser"
                      onClick={() => void toggleDesktopAlerts()}
                    >
                      {desktopAlertsEnabled() ? "desktop alerts on" : "turn on desktop alerts"}
                    </button>
                  </span>
                </Show>
              </div>
              <For each={ownerAttention()}>{(item) => (
                <OwnerAttentionCard
                  item={item}
                  draftScope={`${props.orgSlug}/${props.projectSlug}`}
                  onSeen={async () => {
                    if (!connection || !item.unseen) return;
                    await connection.markAttentionSeen(item.attention.id);
                  }}
                  onRespond={async (selectedOption, body) => {
                    if (!connection) return;
                    await connection.respondToAttention(item.attention.id, selectedOption, body);
                    announce("Response sent to your agent");
                  }}
                  onResolve={async () => {
                    if (!connection) return;
                    await connection.resolveAttention(item.attention.id);
                    announce("Attention resolved");
                  }}
                />
              )}</For>
              <For each={needs()}>{(item) => (
                <a
                  class="work-row work-row--attention"
                  href={workDetailHref(item.identifier)}
                  data-work-id={item.id}
                  data-nav-item
                  data-nav-kind="work"
                  data-nav-id={item.id}
                  data-keyboard-selected={keyboardSelection() === `work:${item.id}`}
                  aria-current={selectedWorkId() === item.id ? "page" : undefined}
                  aria-keyshortcuts="J ArrowDown K ArrowUp ArrowLeft Enter Space R W D E"
                  onFocus={() => trackNavigationItemFocus("work", item.id)}
                  onClick={(event) => handleWorkLink(event, item.identifier)}
                >
                  <span class="work-row__head">
                    <span class="work-row__title">{item.title}</span>
                    <span class="work-row__identifier mono">{item.identifier}</span>
                    <Show when={item.unseen}><span class="unseen-dot" aria-label="Unseen" /></Show>
                  </span>
                  <span class="work-row__summary">{item.agent} needs a {item.attention?.kind.toLowerCase()}</span>
                  <span class="work-row__meta">
                    <span class="attention-kind">{item.attention?.kind}</span>
                    <Show when={item.attention?.important}><span class="attention-important">important</span></Show>
                    <AgentIdentity agentName={item.agent} agentType={item.agentType} />
                    <span>·</span><span>{item.age}</span>
                  </span>
                </a>
              )}</For>
            </section>
          </Show>

          <Show
            when={composerOpen()}
            fallback={
              <div class="capture-launcher">
                <button
                  ref={composerButton}
                  class="capture-launcher__button"
                  type="button"
                  data-nav-item
                  data-nav-kind="capture"
                  data-nav-id="composer"
                  data-keyboard-selected={keyboardSelection() === "capture:composer"}
                  aria-keyshortcuts="C ArrowDown"
                  disabled={loading() || Boolean(loadError())}
                  onFocus={activateCaptureNavigation}
                  onClick={focusCapture}
                >
                  <span aria-hidden="true">+</span> New
                </button>
                <Show when={draft().trim() || draftAttachments().length > 0}>
                  <span class="capture-launcher__draft">Draft saved</span>
                </Show>
              </div>
            }
          >
          <section class="composer" aria-label="Add something">
            <div class="composer__heading">
              <h2 class="composer__heading-copy">
                <span class="composer__label">New Intake</span>
                <span class="composer__heading-divider" aria-hidden="true">/</span>
                <span class="visually-hidden"> for </span>
                <strong class="composer__project" title={projectName()}>{projectName()}</strong>
              </h2>
              <button
                class="composer__close"
                type="button"
                aria-label="Close new Intake"
                onClick={closeCapture}
              >×</button>
            </div>
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
              onFocus={activateCaptureNavigation}
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
                aria-label="Choose files to attach to intake"
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
          </Show>

          <Show when={loading()}>
            <div class="empty-state" role="status">Loading live project activity…</div>
          </Show>

          <Show when={loadError()}>
            <div class="empty-state" role="alert">
              <div>{loadError()}</div>
              <button class="button" type="button" onClick={() => window.location.reload()}>Retry</button>
            </div>
          </Show>

          <Show when={!loading() && !loadError()}>
            <ConcurrentActivity
              snapshot={concurrency()}
              status={concurrencyStatus()}
              selectedWorkId={selectedWorkId()}
              workHref={workDetailHref}
              onSelect={handleWorkLink}
            />
          </Show>

          <Show when={!loading() && !loadError() && work().length === 0 && ownerAttention().length === 0 && visibleIntakes().length === 0}>
            <div class="empty-state">
              <div>Add anything you want the agent to look at.</div>
              <div class="empty-state__types">bug · idea · screenshot · video · request</div>
            </div>
          </Show>

          <Show when={working().length}>
            <section class="work-section" aria-labelledby="working-heading">
              <div class="section-heading" id="working-heading">
                <span>working</span><span class="section-heading__count">{working().length}</span>
              </div>
              <For each={working()}>{(item) => (
                <a
                  class="work-row"
                  href={workDetailHref(item.identifier)}
                  data-work-id={item.id}
                  data-nav-item
                  data-nav-kind="work"
                  data-nav-id={item.id}
                  data-keyboard-selected={keyboardSelection() === `work:${item.id}`}
                  aria-current={selectedWorkId() === item.id ? "page" : undefined}
                  aria-keyshortcuts="J ArrowDown K ArrowUp ArrowLeft Enter Space R W D E"
                  onFocus={() => trackNavigationItemFocus("work", item.id)}
                  onClick={(event) => handleWorkLink(event, item.identifier)}
                >
                  <span class="work-row__head">
                    <span class="work-row__title">{item.title}</span>
                    <span class="work-row__identifier mono">{item.identifier}</span>
                  </span>
                  <span class="work-row__meta">
                    <span class="activity-dot" aria-hidden="true" />
                    <AgentIdentity agentName={item.agent} agentType={item.agentType} />
                    <span>·</span><span>{item.elapsed}</span>
                  </span>
                  <Show when={item.latest}><span class="work-row__latest">{item.latest}</span></Show>
                </a>
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
                  <a
                    class="ready-row__open"
                    href={workDetailHref(item.identifier)}
                    data-work-id={item.id}
                    data-nav-item
                    data-nav-kind="work"
                    data-nav-id={item.id}
                    data-keyboard-selected={keyboardSelection() === `work:${item.id}`}
                    draggable="true"
                    aria-current={selectedWorkId() === item.id ? "page" : undefined}
                    aria-keyshortcuts="J ArrowDown K ArrowUp ArrowLeft Enter Space R W D E"
                    onFocus={() => trackNavigationItemFocus("work", item.id)}
                    onClick={(event) => handleWorkLink(event, item.identifier)}
                  >
                    <span class="ready-row__position">{String(index() + 1).padStart(2, "0")}</span>
                    <span class="work-row__title">{item.title}</span>
                    <Show when={runnerSnapshot().jobs.find((job) => job.kind === "work" && job.workItemId === item.id)}>{(job) => (
                      <span class="ready-row__runner mono" data-state={job().state}>
                        <AgentIdentity
                          agentName={runnerHarnessName(job().harness)}
                          label={readyRunnerJobLabel(job())}
                        />
                      </span>
                    )}</Show>
                    <span class="work-row__identifier mono">{item.identifier}</span>
                  </a>
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
                <a
                  class="work-row"
                  href={intakeDetailHref(intake.id)}
                  data-nav-item
                  data-nav-kind="intake"
                  data-nav-id={intake.id}
                  data-keyboard-selected={keyboardSelection() === `intake:${intake.id}`}
                  aria-current={selectedIntakeId() === intake.id ? "page" : undefined}
                  aria-label={intake.text}
                  aria-keyshortcuts="J ArrowDown K ArrowUp ArrowLeft Enter Space"
                  onFocus={() => trackNavigationItemFocus("intake", intake.id)}
                  onClick={(event) => handleIntakeLink(event, intake.id)}
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
                </a>
              )}</For>
            </section>
          </Show>

          <Show when={done().length}>
            <section class="work-section" aria-labelledby="done-heading">
              <div class="section-heading" id="done-heading">
                <span>recently closed</span><span class="section-heading__aside"><button class="view-all" type="button" onClick={() => navigate(`/app/${props.orgSlug}/${props.projectSlug}/done`)}>view all →</button></span>
              </div>
              <For each={done()}>{(item) => (
                <a
                  class="work-row work-row--done"
                  href={workDetailHref(item.identifier)}
                  data-work-id={item.id}
                  data-nav-item
                  data-nav-kind="work"
                  data-nav-id={item.id}
                  data-keyboard-selected={keyboardSelection() === `work:${item.id}`}
                  aria-current={selectedWorkId() === item.id ? "page" : undefined}
                  aria-keyshortcuts="J ArrowDown K ArrowUp ArrowLeft Enter Space R W D E"
                  onFocus={() => trackNavigationItemFocus("work", item.id)}
                  onClick={(event) => handleWorkLink(event, item.identifier)}
                >
                  <span style={{ color: item.state === "done" ? "var(--green)" : "var(--text-faint)" }} class="mono">{item.state === "done" ? "✓" : "×"}</span>
                  <span class="work-row__title work-row__title--done">{item.title}</span>
                  <span class="work-row__identifier mono">
                    {[item.identifier, item.state === "cancelled" ? "cancelled" : undefined, item.closedAt ?? item.completedAt].filter(Boolean).join(" · ")}
                  </span>
                </a>
              )}</For>
            </section>
          </Show>
        </div>
      </div>

      <Show when={selectedWorkId() || selectedIntakeId()}>
        <div
          class="detail-backdrop"
          aria-hidden="true"
          onPointerDown={closeDetailFromBackdrop}
        />
      </Show>

      <For each={selectedWorkId() ? [selectedWorkId()!] : []}>{() => (
        <Show when={selectedWork()}>{(item) => (
          <WorkDetail
          item={item()}
          draftScope={`${props.orgSlug}/${props.projectSlug}/${item().id}`}
          wide={wideDetailLayout()}
          peek={detailPeek()}
          initialFocus={detailInitialFocus()}
          mobileCloseLabel="←  back"
          onClose={closeDetail}
          onOpenIntake={openIntake}
          onOpenWork={(id) => openWork(id, false)}
          onDownload={downloadAttachment}
          loadAttachmentPreview={loadAttachmentPreview}
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
            } catch (error) {
              if (isConcurrentWorkChange(error)) {
                announce("This issue changed; the latest update is shown and your draft was kept");
                throw new ConcurrentWorkChangeError();
              }
              announce("Your response could not be sent; your draft was kept");
              throw error;
            }
          }}
          onResolve={async () => {
            const attention = item().attention;
            if (!connection || !attention) return;
            try {
              await connection.resolveAttention(attention.id);
              announce("Attention resolved");
            } catch (error) {
              if (isConcurrentWorkChange(error)) {
                announce("This issue changed; the latest update is shown");
                throw new ConcurrentWorkChangeError();
              }
              announce("Attention could not be resolved");
              throw error;
            }
          }}
          onComment={async (body, attachmentIds) => {
            if (!connection) return;
            try {
              await connection.addComment(item().id, body, attachmentIds);
              announce("Comment added");
            } catch (error) {
              if (isConcurrentWorkChange(error)) {
                announce("This issue changed; the latest update is shown and your draft was kept");
                throw new ConcurrentWorkChangeError();
              }
              announce("Comment could not be added; your draft was kept");
              throw error;
            }
          }}
          onCreateChild={async (title, goal) => {
            if (!connection) throw new Error("create_child_unavailable");
            const created = await connection.createChildWork(item().id, title, goal);
            announce("Subtask added");
            return created;
          }}
          onCloseIssue={async (input) => {
            if (!connection) throw new Error("close_work_unavailable");
            await connection.closeWork(item().id, item().revision, input);
            announce(input.reason === "completed" ? "Issue marked done" : "Issue closed");
          }}
          runnerJob={runnerSnapshot().jobs.find((job) => job.kind === "work" && job.workItemId === item().id)}
          runnerHarnesses={[...new Set(
            runnerSnapshot().registrations
              .filter((runner) => runner.status === "active")
              .flatMap((runner) => runner.harnesses),
          )]}
          runnerOnline={runnerSnapshot().registrations.some((runner) =>
            runner.status === "active" &&
            ((runner.waitingUntil !== undefined && runner.waitingUntil > runnerSnapshot().serverTime) ||
              (runner.lastSeenAt !== undefined && runner.lastSeenAt >= runnerSnapshot().serverTime - 45_000))
          )}
          runnerSettingsHref={`/app/${props.orgSlug}/${props.projectSlug}/settings?tab=Local%20runner`}
          onQueueRunner={async (harness) => {
            if (!connection) return;
            await connection.enqueueRunnerJob(item().id, harness);
            announce(`${harness === "claude" ? "Claude Code" : "Codex"} work queued`);
          }}
          onCancelRunner={async (job) => {
            if (!connection) return;
            await connection.cancelRunnerJob(job);
            announce("Runner cancellation requested");
          }}
        />
        )}</Show>
      )}</For>

      <Show when={selectedIntake()}>{(intake) => (
        <IntakeDetail
          wide={wideDetailLayout()}
          initialFocus={detailInitialFocus()}
          intake={intake()}
          ideasHref={`/app/${encodeURIComponent(props.orgSlug)}/${encodeURIComponent(props.projectSlug)}/ideas`}
          work={work()}
          onClose={closeDetail}
          onOpenWork={openWork}
          onDownload={downloadAttachment}
          loadAttachmentPreview={loadAttachmentPreview}
          uploadAttachment={connection?.uploadAttachment.bind(connection)}
          discardAttachment={connection?.discardAttachment.bind(connection)}
          announce={announce}
          onSave={async (input) => {
            if (!connection) throw new Error("intake_update_unavailable");
            return await connection.updateIntake(input);
          }}
          onCloseIssue={async (input) => {
            if (!connection) throw new Error("close_intake_unavailable");
            await connection.dismissIntake(intake().id, intake().revision ?? 0, input);
            announce("Inbox issue closed");
          }}
        />
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

type OwnerAttentionCardProps = {
  item: OwnerAttention;
  draftScope: string;
  onSeen: () => Promise<void>;
  onRespond: (selectedOption?: string, body?: string) => Promise<void>;
  onResolve: () => Promise<void>;
};

function OwnerAttentionCard(props: OwnerAttentionCardProps) {
  const draftKey = () => `${props.draftScope}:attention:${props.item.id}`;
  const readDraft = () => {
    try {
      const parsed = JSON.parse(readLocalDraft(draftKey())) as {
        choice?: string;
        response?: string;
      };
      return {
        choice: typeof parsed.choice === "string" ? parsed.choice : undefined,
        response: typeof parsed.response === "string" ? parsed.response : "",
      };
    } catch {
      return { choice: undefined, response: "" };
    }
  };
  const initialDraft = readDraft();
  const [choice, setChoice] = createSignal<string | undefined>(initialDraft.choice);
  const [response, setResponse] = createSignal(initialDraft.response);
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal("");
  let seenRequested = false;

  const persistDraft = (savedChoice: string | undefined, savedResponse: string) => {
    writeLocalDraft(
      draftKey(),
      savedChoice || savedResponse
        ? JSON.stringify({ choice: savedChoice, response: savedResponse })
        : "",
    );
  };

  const markSeen = () => {
    if (seenRequested || !props.item.unseen) return;
    seenRequested = true;
    void props.onSeen().catch(() => {
      seenRequested = false;
    });
  };

  const respond = async () => {
    const selectedOption = choice();
    const body = response().trim();
    if ((!selectedOption && !body) || pending()) return;
    setPending(true);
    setError("");
    try {
      await props.onRespond(selectedOption, body || undefined);
      clearLocalDraft(draftKey());
      setChoice(undefined);
      setResponse("");
    } catch {
      setError("Your response could not be sent; your draft was kept.");
    } finally {
      setPending(false);
    }
  };

  const resolve = async () => {
    if (pending()) return;
    setPending(true);
    setError("");
    try {
      await props.onResolve();
      clearLocalDraft(draftKey());
      setChoice(undefined);
      setResponse("");
    } catch {
      setError("Attention could not be resolved.");
    } finally {
      setPending(false);
    }
  };

  return (
    <article
      class="attention-card owner-attention-card"
      aria-labelledby={`owner-attention-${props.item.id}`}
      onFocusIn={markSeen}
      onPointerEnter={markSeen}
    >
      <div class="attention-card__head">
        <span class="attention-kind">{props.item.attention.kind}</span>
        <Show when={props.item.attention.important}>
          <span class="attention-important mono">important</span>
        </Show>
        <span class="attention-card__when">{props.item.age}</span>
      </div>
      <div class="attention-card__title" id={`owner-attention-${props.item.id}`}>
        {props.item.attention.title}
      </div>
      <MarkdownContent source={props.item.attention.body} class="attention-card__body" />
      <div class="note">
        <AgentIdentity agentName={props.item.agent} agentType={props.item.agentType} /> is asking about {props.item.intakeId ? "Intake" : "this project"}. Your answer stays in dongo even if the agent session has ended.
      </div>
      <div class="attention-options">
        <For each={props.item.attention.options ?? []}>{(option) => (
          <button
            class="attention-option"
            data-selected={choice() === option}
            type="button"
            onClick={() => {
              setChoice(option);
              persistDraft(option, response());
            }}
          >
            <span class="attention-option__dot" /><span>{option}</span>
          </button>
        )}</For>
        <textarea
          class="textarea"
          aria-label="Response to agent"
          aria-keyshortcuts="Meta+Enter Control+Enter"
          value={response()}
          onInput={(event) => {
            const next = event.currentTarget.value;
            setResponse(next);
            persistDraft(choice(), next);
          }}
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
          <button class="button button--quiet" type="button" disabled={pending()} onClick={() => void resolve()}>Resolve without response</button>
        </div>
        <Show when={error()}><div class="security-note" role="alert">{error()}</div></Show>
      </div>
    </article>
  );
}

type WorkDetailProps = {
  item: WorkItem;
  draftScope: string;
  wide: boolean;
  peek: boolean;
  initialFocus: DetailInitialFocus;
  mobileCloseLabel: string;
  onClose: () => void;
  onOpenIntake: (id: string) => void;
  onOpenWork: (id: string) => void;
  onDownload: (attachmentId: string) => Promise<void>;
  loadAttachmentPreview: OverviewConnection["loadAttachmentPreview"];
  uploadAttachment: OverviewConnection["uploadAttachment"];
  discardAttachment: OverviewConnection["discardAttachment"];
  announce: (message: string) => void;
  onRespond: (selectedOption?: string, body?: string) => Promise<void>;
  onResolve: () => Promise<void>;
  onComment: (body: string | undefined, attachmentIds: string[]) => Promise<void>;
  onCreateChild: (
    title: string,
    goal: string | undefined,
  ) => Promise<{ workItemId: string }>;
  onCloseIssue: (input: IssueClosureInput) => Promise<void>;
  runnerJob?: RunnerJob;
  runnerHarnesses: RunnerHarness[];
  runnerOnline: boolean;
  runnerSettingsHref: string;
  onQueueRunner: (harness: RunnerHarness) => Promise<void>;
  onCancelRunner: (job: RunnerJob) => Promise<void>;
};

function WorkDetail(props: WorkDetailProps) {
  const responseDraftKey = () =>
    `${props.draftScope}:attention:${props.item.attention?.id ?? "none"}`;
  const readResponseDraft = () => {
    try {
      const parsed = JSON.parse(readLocalDraft(responseDraftKey())) as {
        choice?: string;
        response?: string;
      };
      return {
        choice: typeof parsed.choice === "string" ? parsed.choice : undefined,
        response: typeof parsed.response === "string" ? parsed.response : "",
      };
    } catch {
      return { choice: undefined, response: "" };
    }
  };
  const initialResponseDraft = readResponseDraft();
  const [choice, setChoice] = createSignal<string | undefined>(initialResponseDraft.choice);
  const [response, setResponse] = createSignal(initialResponseDraft.response);
  const [pending, setPending] = createSignal(false);
  const [editNotice, setEditNotice] = createSignal("");
  const [identifierCopied, setIdentifierCopied] = createSignal(false);
  const [runnerPending, setRunnerPending] = createSignal(false);
  const [runnerError, setRunnerError] = createSignal("");
  const [childComposerOpen, setChildComposerOpen] = createSignal(false);
  const [childTitle, setChildTitle] = createSignal("");
  const [childGoal, setChildGoal] = createSignal("");
  const [childPending, setChildPending] = createSignal(false);
  const [childError, setChildError] = createSignal("");
  let detailPanel: HTMLElement | undefined;
  let closeButton: HTMLButtonElement | undefined;
  let addChildButton: HTMLButtonElement | undefined;
  let childTitleInput: HTMLInputElement | undefined;
  let identifierCopyTimer: number | undefined;
  let activeResponseDraftKey = responseDraftKey();

  const persistResponseDraft = (key: string, savedChoice: string | undefined, savedResponse: string) => {
    writeLocalDraft(
      key,
      savedChoice || savedResponse
        ? JSON.stringify({ choice: savedChoice, response: savedResponse })
        : "",
    );
  };

  createEffect(() => {
    const key = responseDraftKey();
    if (key !== activeResponseDraftKey) {
      activeResponseDraftKey = key;
      const saved = readResponseDraft();
      setChoice(saved.choice);
      setResponse(saved.response);
      setEditNotice("");
      return;
    }
    const savedChoice = choice();
    const savedResponse = response();
    persistResponseDraft(key, savedChoice, savedResponse);
  });

  onCleanup(() => window.clearTimeout(identifierCopyTimer));

  onMount(() => {
    if (props.initialFocus === "comment") {
      queueMicrotask(() => {
        const target = detailPanel?.querySelector<HTMLElement>("[data-comment-composer]");
        (target ?? closeButton)?.focus();
      });
      return;
    }
    if (props.initialFocus === "respond") {
      queueMicrotask(() => {
        const target = detailPanel?.querySelector<HTMLElement>(
          ".attention-option, [data-response-composer], [data-comment-composer]",
        );
        (target ?? closeButton)?.focus();
      });
      return;
    }
    if (props.wide && props.initialFocus === "detail") {
      detailPanel?.focus({ preventScroll: true });
      return;
    }
    if (!props.wide) closeButton?.focus();
  });

  const stateLine = () => {
    if (props.item.state === "needs") return `Working · waiting for your ${props.item.attention?.kind.toLowerCase()}`;
    if (props.item.state === "working") return `Working · ${props.item.agent}`;
    if (props.item.state === "done") return `Done · ${props.item.completedAt}`;
    if (props.item.state === "cancelled") return `Closed · ${props.item.closedAt ?? props.item.age}`;
    return "Ready";
  };

  const respond = async () => {
    const selectedOption = choice();
    const body = response().trim();
    if ((!selectedOption && !body) || pending()) return;
    setPending(true);
    try {
      await props.onRespond(selectedOption, body || undefined);
      clearLocalDraft(responseDraftKey());
      setChoice(undefined);
      setResponse("");
      setEditNotice("");
    } catch (error) {
      if (error instanceof ConcurrentWorkChangeError) {
        setEditNotice(
          "This issue changed while you were responding. The latest agent update is shown and your draft was kept.",
        );
      }
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
      clearLocalDraft(responseDraftKey());
      setChoice(undefined);
      setResponse("");
      setEditNotice("");
    } catch (error) {
      if (error instanceof ConcurrentWorkChangeError) {
        setEditNotice(
          "This issue changed while you were resolving it. The latest agent update is shown.",
        );
      }
      return;
    } finally {
      setPending(false);
    }
  };

  const copyIdentifier = async () => {
    try {
      await navigator.clipboard.writeText(props.item.identifier);
      window.clearTimeout(identifierCopyTimer);
      setIdentifierCopied(true);
      props.announce(`${props.item.identifier} copied`);
      identifierCopyTimer = window.setTimeout(() => setIdentifierCopied(false), 2200);
    } catch {
      setIdentifierCopied(false);
      props.announce("This issue ID could not be copied");
    }
  };

  const queueRunner = async (harness: RunnerHarness) => {
    if (runnerPending()) return;
    setRunnerPending(true);
    setRunnerError("");
    try {
      await props.onQueueRunner(harness);
    } catch {
      setRunnerError("This work could not be queued. Its state or runner availability may have changed.");
    } finally {
      setRunnerPending(false);
    }
  };

  const cancelRunner = async () => {
    if (!props.runnerJob || runnerPending()) return;
    setRunnerPending(true);
    setRunnerError("");
    try {
      await props.onCancelRunner(props.runnerJob);
    } catch {
      setRunnerError("Cancellation could not be requested because this job changed. The latest state is shown.");
    } finally {
      setRunnerPending(false);
    }
  };

  const createChild = async (event: SubmitEvent) => {
    event.preventDefault();
    const title = childTitle().trim();
    const goal = childGoal().trim();
    if (!title || childPending()) return;
    setChildPending(true);
    setChildError("");
    try {
      await props.onCreateChild(title, goal || undefined);
      setChildTitle("");
      setChildGoal("");
      setChildComposerOpen(false);
      queueMicrotask(() => addChildButton?.focus());
    } catch {
      setChildError(
        "This subtask could not be added. The parent may have changed or reached its child limit.",
      );
    } finally {
      setChildPending(false);
    }
  };

  const openChildComposer = () => {
    setChildError("");
    setChildComposerOpen(true);
    queueMicrotask(() => childTitleInput?.focus());
  };

  const closeChildComposer = () => {
    setChildComposerOpen(false);
    setChildError("");
    queueMicrotask(() => addChildButton?.focus());
  };

  return (
    <article
      ref={detailPanel}
      class="detail"
      data-detail-id={props.item.id}
      data-peek={props.peek}
      role={props.wide ? "region" : "dialog"}
      aria-modal={props.wide ? undefined : "true"}
      aria-labelledby="work-detail-title"
      aria-keyshortcuts={props.wide ? "ArrowLeft" : undefined}
      tabIndex={props.wide ? -1 : undefined}
      onKeyDown={(event) => {
        if (!props.wide) trapModalFocus(event);
      }}
    >
      <div class="detail__head">
        <button ref={closeButton} class="detail__close" type="button" onClick={props.onClose}>
          <span class="detail-close-desktop">✕&nbsp; close</span><span class="detail-close-mobile">{props.mobileCloseLabel}</span>
        </button>
        <div class="detail__head-spacer" />
        <Show when={props.peek}><span class="detail__peek">peek · esc closes</span></Show>
      </div>
      <div class="detail__scroll">
        <div class="detail__title-group">
          <button
            class="detail__identifier-copy"
            data-copied={identifierCopied()}
            type="button"
            aria-label={`Copy issue ID ${props.item.identifier}`}
            title={`Copy ${props.item.identifier}`}
            onClick={() => void copyIdentifier()}
          >
            <span>{props.item.identifier}</span>
            <Show
              when={identifierCopied()}
              fallback={
                <svg class="detail__identifier-icon" aria-hidden="true" viewBox="0 0 16 16">
                  <rect x="5.5" y="2.5" width="8" height="9" />
                  <path d="M3.5 5.5h-1v8h7v-1" />
                </svg>
              }
            >
              <span class="detail__identifier-check" aria-hidden="true">✓</span>
            </Show>
          </button>
          <h2 class="detail__title" id="work-detail-title">{props.item.title}</h2>
          <div class="detail__state">
            <span class="detail__state-dot" data-state={props.item.state} />
            <Show
              when={props.item.state === "working" ? props.item.agent : undefined}
              fallback={<span>{stateLine()}</span>}
            >
              <span>Working · </span>
              <AgentIdentity agentName={props.item.agent} agentType={props.item.agentType} />
            </Show>
          </div>
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
                <div class="note">Your agent will see this on its next explicit pull. An active dongo waiter checks with backoff for up to five minutes; a stopped agent will not restart itself.</div>
                <Show when={response().trim() || choice()}>
                  <div class="detail-card" role="note">
                    <strong>Your unsent response draft was kept.</strong>
                    <Show when={choice()}>{(savedChoice) => (
                      <div class="note">Selected option: {savedChoice()}</div>
                    )}</Show>
                    <Show when={response().trim()}>
                      <textarea
                        class="textarea"
                        aria-label="Unsent response draft"
                        value={response()}
                        readOnly
                        rows={3}
                      />
                    </Show>
                  </div>
                </Show>
              </div>
            }>
              <div class="attention-options">
                <For each={attention().options ?? []}>{(option) => (
                  <button class="attention-option" data-selected={choice() === option} type="button" onClick={() => {
                    setChoice(option);
                    persistResponseDraft(responseDraftKey(), option, response());
                  }}>
                    <span class="attention-option__dot" /><span>{option}</span>
                  </button>
                )}</For>
                <textarea
                  class="textarea"
                  data-response-composer
                  aria-keyshortcuts="Meta+Enter Control+Enter"
                  value={response()}
                  onInput={(event) => {
                    const nextResponse = event.currentTarget.value;
                    setResponse(nextResponse);
                    persistResponseDraft(responseDraftKey(), choice(), nextResponse);
                  }}
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
            <Show when={editNotice()}>
              <div class="security-note" role="alert">{editNotice()}</div>
            </Show>
          </div>
        )}</Show>

        <section class="detail-section">
          <div class="detail-section__label">goal</div>
          <MarkdownContent source={props.item.goal} class="detail-section__body" />
        </section>

        <Show when={props.item.canonicalState === "done" || props.item.canonicalState === "cancelled"}>
          <section class="detail-section">
            <div class="detail-section__label">closed outcome</div>
            <div class="detail-card">
              <strong>{closureReasonLabel(props.item.closureReason) ?? (props.item.canonicalState === "done" ? "Completed" : "Closed")}</strong>
              <Show when={props.item.closureNote}><p class="note">{props.item.closureNote}</p></Show>
            </div>
          </section>
        </Show>

        <Show when={props.item.canonicalState !== "done" && props.item.canonicalState !== "cancelled"}>
          <IssueCloseForm
            allowCompleted={props.item.canonicalState === "ready"}
            active={props.item.canonicalState === "working"}
            onConfirm={props.onCloseIssue}
          />
        </Show>

        <Show when={props.item.parentWork}>{(parent) => (
          <section class="detail-section" aria-labelledby="parent-work-heading">
            <div class="detail-section__label" id="parent-work-heading">parent issue</div>
            <button
              class="related-work-row"
              type="button"
              onClick={() => props.onOpenWork(parent().id)}
            >
              <span class="related-work-row__identifier mono">{parent().identifier}</span>
              <span class="related-work-row__title">{parent().title}</span>
              <span class="related-work-row__state" data-state={parent().state}>
                {parent().state}
              </span>
            </button>
          </section>
        )}</Show>

        <Show
          when={
            !props.item.parentWork &&
            ((props.item.canonicalState !== "done" && props.item.canonicalState !== "cancelled") || (props.item.childWork?.length ?? 0) > 0)
          }
        >
          <section class="detail-section" aria-labelledby="child-work-heading">
            <div class="subtask-section__head">
              <div class="detail-section__label" id="child-work-heading">subtasks</div>
              <Show when={(props.item.childWork?.length ?? 0) > 0}>
                <span class="subtask-progress mono">
                  {(props.item.childWork ?? []).filter((child) => child.state === "done").length}
                  /{props.item.childWork?.length ?? 0} done
                </span>
              </Show>
            </div>
            <Show when={(props.item.childWork?.length ?? 0) > 0}>
              <div class="related-work-list">
                <For each={props.item.childWork}>{(child) => (
                  <button
                    class="related-work-row"
                    data-child-work-id={child.id}
                    type="button"
                    onClick={() => props.onOpenWork(child.id)}
                  >
                    <span class="related-work-row__identifier mono">{child.identifier}</span>
                    <span class="related-work-row__title">{child.title}</span>
                    <span class="related-work-row__state" data-state={child.state}>
                      {child.state}
                    </span>
                  </button>
                )}</For>
              </div>
            </Show>
            <Show when={props.item.canonicalState !== "done" && props.item.canonicalState !== "cancelled"}>
              <Show
                when={childComposerOpen()}
                fallback={
                  <button
                    ref={addChildButton}
                    class="button button--quiet subtask-add"
                    type="button"
                    onClick={openChildComposer}
                  >
                    + Add subtask
                  </button>
                }
              >
                <form class="subtask-form" onSubmit={(event) => void createChild(event)}>
                  <label class="subtask-form__field">
                    <span class="subtask-form__label">Title</span>
                    <input
                      ref={childTitleInput}
                      class="input"
                      name="subtask-title"
                      value={childTitle()}
                      maxlength={500}
                      required
                      onInput={(event) => setChildTitle(event.currentTarget.value)}
                    />
                  </label>
                  <label class="subtask-form__field">
                    <span class="subtask-form__label">Goal <span class="note">optional</span></span>
                    <textarea
                      class="textarea"
                      name="subtask-goal"
                      value={childGoal()}
                      maxlength={100_000}
                      rows={3}
                      onInput={(event) => setChildGoal(event.currentTarget.value)}
                    />
                  </label>
                  <Show when={childError()}>
                    <div class="security-note" role="alert">{childError()}</div>
                  </Show>
                  <div class="response-actions">
                    <button
                      class="button button--primary"
                      type="submit"
                      disabled={childPending() || !childTitle().trim()}
                    >
                      {childPending() ? "Adding…" : "Add subtask"}
                    </button>
                    <button
                      class="button button--quiet"
                      type="button"
                      disabled={childPending()}
                      onClick={closeChildComposer}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </Show>
            </Show>
          </section>
        </Show>

        <Show when={props.item.canonicalState !== "done" && props.item.canonicalState !== "cancelled"}><section class="detail-section runner-work-card" aria-labelledby="runner-work-heading">
          <div class="detail-section__label" id="runner-work-heading">local runner</div>
          <Show when={props.runnerJob} fallback={
            <Show when={props.item.state === "ready"} fallback={<p class="note">Local execution can be queued only while work is Ready.</p>}>
              <Show when={props.runnerHarnesses.length > 0} fallback={
                <div class="detail-card">
                  <strong>No local runner is connected.</strong>
                  <p class="note">Set up Codex or Claude Code on a computer you control, then return here to queue this work.</p>
                  <a class="button button--quiet" href={props.runnerSettingsHref}>Set up local runner</a>
                </div>
              }>
                <div class="detail-card">
                  <strong>Run this Ready work with a local agent</strong>
                  <p class="note">{props.runnerOnline ? "A compatible runner is online." : "The runner is offline. dongo will keep the work queued until that computer reconnects; it cannot wake a sleeping or powered-off computer."}</p>
                  <div class="runner-work-actions">
                    <For each={props.runnerHarnesses}>{(harness) => (
                      <button class="button button--primary" type="button" disabled={runnerPending()} onClick={() => void queueRunner(harness)}>
                        <Show when={!runnerPending()} fallback="Queuing…">
                          <span>Run with </span><AgentIdentity agentName={runnerHarnessName(harness)} />
                        </Show>
                      </button>
                    )}</For>
                  </div>
                  <p class="security-note">The runner asks for approval on its computer unless that repository was explicitly installed in automatic mode.</p>
                </div>
              </Show>
            </Show>
          }>{(job) => (
            <div class="detail-card runner-job-status" data-state={job().state}>
              <div class="runner-job-status__head"><strong><AgentIdentity agentName={runnerHarnessName(job().harness)} /></strong><span class="runner-state" data-state={job().state}>{runnerJobLabel(job().state)}</span></div>
              <Show when={job().safeSummary ?? job().safeMessage}><p class="note">{job().safeSummary ?? job().safeMessage}</p></Show>
              <Show when={["queued", "delivered", "awaiting_local_approval", "starting", "running", "blocked"].includes(job().state)}>
                <button class="button button--quiet button--danger" type="button" disabled={runnerPending()} onClick={() => void cancelRunner()}>{runnerPending() ? "Requesting…" : "Cancel local run"}</button>
              </Show>
              <Show when={job().state === "awaiting_local_approval"}><p class="security-note">Approve this exact job on the runner computer with <code>dongo runner approve --job-id {job().id}</code>.</p></Show>
              <Show when={job().state === "queued" && !props.runnerOnline}><p class="security-note">This queue is durable, but no computer is currently waiting. dongo will deliver it after a compatible runner reconnects.</p></Show>
              <Show when={["cancelled", "failed", "expired", "completed"].includes(job().state) && props.item.state === "ready" && props.runnerHarnesses.length > 0}>
                <div class="runner-work-actions">
                  <For each={props.runnerHarnesses}>{(harness) => (
                    <button class="button button--quiet" type="button" disabled={runnerPending()} onClick={() => void queueRunner(harness)}>
                      <Show when={!runnerPending()} fallback="Queuing…">
                        <span>Run again with </span><AgentIdentity agentName={runnerHarnessName(harness)} />
                      </Show>
                    </button>
                  )}</For>
                </div>
              </Show>
            </div>
          )}</Show>
          <Show when={runnerError()}><div class="security-note" role="alert">{runnerError()}</div></Show>
        </section></Show>

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
                    <AttachmentDownloadRow attachment={attachment} onDownload={props.onDownload} loadPreview={props.loadAttachmentPreview} />
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
                <AttachmentDownloadRow attachment={attachment} onDownload={props.onDownload} loadPreview={props.loadAttachmentPreview} />
              )}</For>
            </div>
          </section>
        </Show>

        <Show when={props.item.latest}>
          <section class="detail-section">
            <div class="detail-section__label">latest from <AgentIdentity agentName={actorDisplayIdentity({ type: "agent", name: props.item.agent ?? "Agent" })} agentType={props.item.agentType} /></div>
            <div class="detail-card"><MarkdownContent source={props.item.latest ?? ""} /></div>
            <div class="security-note">{props.item.state === "done" || props.item.state === "cancelled" ? "run finished" : props.item.elapsed ?? "waiting to start"}</div>
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
                  <span class="conversation-entry__who" data-role={entry.role ?? (entry.human ? "human" : "agent")}>
                    <Show
                      when={entry.role !== "system" && !entry.human && entry.role !== "human"}
                      fallback={actorDisplayIdentity({
                        type: entry.role === "system" ? "system" : "human",
                        name: entry.who,
                        agentType: entry.agentType,
                      })}
                    >
                      <AgentIdentity
                        agentName={actorDisplayIdentity({ type: "agent", name: entry.who, agentType: entry.agentType })}
                        agentType={entry.agentType}
                      />
                    </Show>
                  </span>
                  <span class="conversation-entry__role">{entry.role === "system" ? "system" : entry.human || entry.role === "human" ? "human" : "agent"}</span>
                  <span>{entry.when}</span>
                </div>
                <Show when={entry.text}><MarkdownContent source={entry.text} class="conversation-entry__text" /></Show>
                <Show when={entry.attachments?.length}>
                  <div class="conversation-entry__attachments">
                    <For each={entry.attachments}>{(attachment) => (
                      <AttachmentDownloadRow attachment={attachment} onDownload={props.onDownload} loadPreview={props.loadAttachmentPreview} />
                    )}</For>
                  </div>
                </Show>
              </div>
            )}</For>
          </section>
        </Show>

        <CommentComposer
          draftKey={`${props.draftScope}:comment`}
          onSubmit={props.onComment}
          uploadAttachment={props.uploadAttachment}
          discardAttachment={props.discardAttachment}
          announce={props.announce}
        />
      </div>
    </article>
  );
}

type IntakeDetailProps = {
  wide: boolean;
  initialFocus: DetailInitialFocus;
  intake: Intake;
  ideasHref: string;
  work: WorkItem[];
  onClose: () => void;
  onOpenWork: (id: string) => void;
  onDownload: (attachmentId: string) => Promise<void>;
  loadAttachmentPreview: OverviewConnection["loadAttachmentPreview"];
  uploadAttachment?: OverviewConnection["uploadAttachment"];
  discardAttachment?: OverviewConnection["discardAttachment"];
  announce: (message: string) => void;
  onSave: (input: IntakeUpdateInput) => Promise<IntakeUpdateResult>;
  onCloseIssue: (input: IssueClosureInput) => Promise<void>;
};

function IntakeDetail(props: IntakeDetailProps) {
  const linked = () => props.work.filter((item) => props.intake.linkedWorkIds?.includes(item.id));
  const [editorVisible, setEditorVisible] = createSignal(props.intake.editable);
  let editorIntakeId = props.intake.id;
  let closeButton: HTMLButtonElement | undefined;
  let detailPanel: HTMLElement | undefined;

  onMount(() => {
    if (props.wide && props.initialFocus === "detail") {
      detailPanel?.focus({ preventScroll: true });
    } else if (!props.wide) {
      closeButton?.focus();
    }
  });

  createEffect(() => {
    const intakeId = props.intake.id;
    if (intakeId === editorIntakeId) {
      if (props.intake.editable) setEditorVisible(true);
      return;
    }
    editorIntakeId = intakeId;
    setEditorVisible(props.intake.editable);
  });

  return (
    <article
      ref={detailPanel}
      class="detail"
      data-detail-id={props.intake.id}
      role={props.wide ? "region" : "dialog"}
      aria-modal={props.wide ? undefined : "true"}
      aria-labelledby="intake-detail-title"
      aria-keyshortcuts={props.wide ? "ArrowLeft" : undefined}
      tabIndex={props.wide ? -1 : undefined}
      onKeyDown={(event) => {
        if (!props.wide) trapModalFocus(event);
      }}
    >
      <div class="detail__head">
        <button ref={closeButton} class="detail__close" type="button" onClick={props.onClose}>
          <span class="detail-close-desktop">✕&nbsp; close</span><span class="detail-close-mobile">←&nbsp; back</span>
        </button>
        <div class="detail__head-spacer" /><span class="detail__identifier">inbox</span>
      </div>
      <div class="detail__scroll">
        <div class="detail__title-group">
          <h2 class="detail__title" id="intake-detail-title">{props.intake.text}</h2>
          <div class="detail__state">
            <span class="detail__state-dot" data-state={props.intake.status === "processed" ? "done" : props.intake.status === "dismissed" ? "cancelled" : "working"} />
            <span>{props.intake.status === "processed"
              ? `Processed · ${linked().length} work items created`
              : props.intake.status === "dismissed"
                ? `Closed · ${props.intake.closedAt ?? props.intake.age}`
                : props.intake.status === "triaging" ? "Agent triaging" : "Waiting for local agent"}</span>
          </div>
          <Show when={props.intake.sourceIdeaId}>{(ideaId) => (
            <a class="detail__provenance" href={`${props.ideasHref}?filter=promoted&idea=${encodeURIComponent(ideaId())}`}>Promoted from Ideas</a>
          )}</Show>
        </div>
        <section class="detail-section">
          <div class="detail-section__label">submitted</div>
          <div class="detail-card">
            <div class="detail-section__body">You · {props.intake.age}</div>
            <Show when={props.intake.attachments?.length}>
              <div class="detail-attachment-list" style={{ "margin-top": "11px" }}>
                <For each={props.intake.attachments}>{(attachment) => (
                  <AttachmentDownloadRow attachment={attachment} onDownload={props.onDownload} loadPreview={props.loadAttachmentPreview} />
                )}</For>
              </div>
            </Show>
          </div>
        </section>
        <Show when={editorVisible() && props.uploadAttachment && props.discardAttachment}>
          <IntakeEditor
            intake={props.intake}
            onSave={props.onSave}
            uploadAttachment={props.uploadAttachment!}
            discardAttachment={props.discardAttachment!}
            announce={props.announce}
          />
        </Show>
        <Show when={props.intake.status === "dismissed"}>
          <section class="detail-section">
            <div class="detail-section__label">closed outcome</div>
            <div class="detail-card">
              <strong>{closureReasonLabel(props.intake.closureReason) ?? "Closed"}</strong>
              <Show when={props.intake.closureNote}><p class="note">{props.intake.closureNote}</p></Show>
            </div>
          </section>
        </Show>
        <Show when={props.intake.status === "waiting" || props.intake.status === "triaging"}>
          <IssueCloseForm allowCompleted={false} active={props.intake.status === "triaging"} onConfirm={props.onCloseIssue} />
        </Show>
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
    </article>
  );
}

function AttachmentDownloadRow(props: {
  attachment: AttachmentSummary;
  onDownload: (attachmentId: string) => Promise<void>;
  loadPreview: OverviewConnection["loadAttachmentPreview"];
}) {
  const [pending, setPending] = createSignal(false);
  const [previewUrl, setPreviewUrl] = createSignal<string>();
  const [previewState, setPreviewState] = createSignal<"idle" | "loading" | "ready" | "error">("idle");
  let row: HTMLDivElement | undefined;
  let previewObjectUrl: string | undefined;
  let previewAbort: AbortController | undefined;

  const releasePreview = () => {
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = undefined;
    setPreviewUrl(undefined);
  };

  const failPreview = () => {
    previewAbort?.abort();
    releasePreview();
    setPreviewState("error");
  };

  const loadPreview = async () => {
    if (previewState() !== "idle") return;
    setPreviewState("loading");
    previewAbort = new AbortController();
    try {
      const blob = await props.loadPreview(props.attachment, previewAbort.signal);
      if (previewAbort.signal.aborted) return;
      previewObjectUrl = URL.createObjectURL(blob);
      setPreviewUrl(previewObjectUrl);
      setPreviewState("ready");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      failPreview();
    }
  };

  onMount(() => {
    if (!isInlineImagePreviewAvailable(props.attachment)) return;
    if (!("IntersectionObserver" in window)) {
      void loadPreview();
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void loadPreview();
    }, { rootMargin: "160px 0px" });
    if (row) observer.observe(row);
    onCleanup(() => observer.disconnect());
  });

  onCleanup(() => {
    previewAbort?.abort();
    releasePreview();
  });

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
    <div ref={row} class="attachment-row" data-preview={previewState()}>
      <Show
        when={previewUrl()}
        fallback={
          <div class="attachment-row__icon">
            {props.attachment.mimeType.startsWith("image/")
              ? "IMG"
              : props.attachment.mimeType.startsWith("video/")
                ? "VID"
                : "FILE"}
          </div>
        }
      >
        {(source) => (
          <button
            class="attachment-row__image-preview"
            type="button"
            aria-label={`Download image ${props.attachment.filename}`}
            title={`Download ${props.attachment.filename}`}
            disabled={pending()}
            onClick={() => void download()}
          >
            <img
              src={source()}
              alt={props.attachment.filename}
              loading="lazy"
              decoding="async"
              onError={failPreview}
            />
          </button>
        )}
      </Show>
      <div class="attachment-row__copy">
        <div class="attachment-row__name">{props.attachment.filename}</div>
        <div class="attachment-row__state">
          {formatAttachmentBytes(props.attachment.byteSize)} · {previewState() === "ready" ? "secure preview and download" : "secure download"}
        </div>
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
