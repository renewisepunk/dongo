import { A } from "@solidjs/router";
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { AuthFrame } from "../components/AuthFrame";
import { RequireHumanSession } from "../components/RequireHumanSession";
import {
  ProjectDataConnection,
  type ProjectInfo,
  type ProjectInstallation,
} from "../lib/project-data";

type Host = "Codex" | "Claude Code" | "AGENTS.md";
const HOSTS: readonly Host[] = ["Codex", "Claude Code", "AGENTS.md"];

type ConnectRouteConnection = {
  project: ProjectInfo;
  subscribeInstallations: (
    onUpdate: (installations: ProjectInstallation[]) => void,
    onError: (error: Error) => void,
  ) => () => void;
  close: () => Promise<void>;
};

export type ConnectRouteDependencies = {
  connectFirst: (preferredProjectId?: string) => Promise<ConnectRouteConnection>;
  humanSession: () => Promise<unknown | null>;
  bootstrapHumanIdentity: () => Promise<unknown>;
  writeClipboard: (text: string) => Promise<void>;
};

export type ConnectRouteProps = {
  dependencies?: Partial<ConnectRouteDependencies>;
};

function hostId(host: Host): string {
  return host.toLowerCase().replace(/[^a-z]+/gu, "-").replace(/^-|-$/gu, "");
}

function preferredProjectId(): string | undefined {
  if (typeof sessionStorage === "undefined") return undefined;
  try {
    const stored = JSON.parse(sessionStorage.getItem("dongo:project") || "null") as
      | { projectId?: unknown }
      | null;
    return typeof stored?.projectId === "string" ? stored.projectId : undefined;
  } catch {
    return undefined;
  }
}

export default function ConnectRoute(props: ConnectRouteProps = {}) {
  const [host, setHost] = createSignal<Host>("Codex");
  const [copied, setCopied] = createSignal(false);
  const [copyError, setCopyError] = createSignal("");
  const [project, setProject] = createSignal<ProjectInfo>();
  const [installations, setInstallations] = createSignal<ProjectInstallation[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  let connection: ConnectRouteConnection | undefined;
  let unsubscribe: (() => void) | undefined;
  let hostTabs: HTMLDivElement | undefined;
  let copyTimer: number | undefined;
  let disposed = false;
  const connectFirst = props.dependencies?.connectFirst ?? ProjectDataConnection.connectFirst;
  const writeClipboard = props.dependencies?.writeClipboard ?? (
    (text: string) => navigator.clipboard.writeText(text)
  );

  const activeInstallation = createMemo(() => installations().find(
    (installation) =>
      installation.status === "active" &&
      (installation.kind === "cli" || installation.kind === "mcp"),
  ));

  onMount(() => {
    void connectFirst(preferredProjectId())
      .then((connected) => {
        if (disposed) {
          void connected.close();
          return;
        }
        connection = connected;
        setProject(connected.project);
        unsubscribe = connected.subscribeInstallations(
          (next) => {
            setInstallations(next);
            setLoading(false);
            setError("");
          },
          () => {
            setError("Agent connection status is temporarily unavailable.");
            setLoading(false);
          },
        );
      })
      .catch(() => {
        setError("Create a project before connecting an agent.");
        setLoading(false);
      });
  });

  onCleanup(() => {
    disposed = true;
    if (copyTimer !== undefined) window.clearTimeout(copyTimer);
    unsubscribe?.();
    void connection?.close();
  });

  const instruction = createMemo(() => {
    if (host() === "AGENTS.md") {
      return "Read AGENTS.md, install the dongo adapter in this repository, then run dongo connect.";
    }
    return `Install dongo in this repository and run dongo connect. Configure the ${host()} MCP connection when prompted.`;
  });

  const copyInstruction = async () => {
    setCopyError("");
    try {
      await writeClipboard(instruction());
      setCopied(true);
      if (copyTimer !== undefined) window.clearTimeout(copyTimer);
      copyTimer = window.setTimeout(() => {
        setCopied(false);
        copyTimer = undefined;
      }, 1600);
    } catch {
      setCopied(false);
      setCopyError("Clipboard access was unavailable. Select and copy the instruction manually.");
    }
  };

  const moveHostTab = (event: KeyboardEvent, current: Host) => {
    const currentIndex = HOSTS.indexOf(current);
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % HOSTS.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + HOSTS.length) % HOSTS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = HOSTS.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    setHost(HOSTS[nextIndex]!);
    queueMicrotask(() => {
      hostTabs
        ?.querySelector<HTMLButtonElement>(`[data-host-index="${nextIndex}"]`)
        ?.focus();
    });
  };

  return (
    <RequireHumanSession dependencies={props.dependencies}><AuthFrame>
      <div class="auth-stack" style={{ gap: "22px" }}>
        <div class="title-group">
          <div class="eyebrow eyebrow--green">Project created</div>
          <h1 class="auth-title">Connect a coding agent</h1>
          <p class="auth-lede">Open your repository with your coding agent and tell it to install dongo.</p>
        </div>

        <div ref={hostTabs} class="host-tabs" role="tablist" aria-label="Coding agent host">
          {HOSTS.map((item, index) => (
            <button
              id={`host-tab-${hostId(item)}`}
              class="host-tab"
              type="button"
              role="tab"
              aria-selected={host() === item}
              aria-controls="host-instructions"
              tabindex={host() === item ? 0 : -1}
              data-selected={host() === item}
              data-host-index={index}
              onClick={() => setHost(item)}
              onKeyDown={(event) => moveHostTab(event, item)}
            >
              {item}
            </button>
          ))}
        </div>

        <div
          class="instruction"
          id="host-instructions"
          role="tabpanel"
          aria-labelledby={`host-tab-${hostId(host())}`}
        >
          <div class="instruction__head">
            <span class="instruction__label">say this to {host()}</span>
            <button class="copy-button" type="button" onClick={copyInstruction}>
              {copied() ? "copied" : "copy"}
            </button>
          </div>
          <div class="instruction__body">{instruction()}</div>
        </div>
        <Show when={copyError()}><div class="error" role="alert">{copyError()}</div></Show>

        <div class="authorization-card">
          <div class="instruction__label">browser authorization</div>
          <div class="connection-card__body">
            `dongo connect` opens one approval link. The code lets you compare terminal and browser; there is normally nothing to copy or enter.
          </div>
        </div>

        <div class="connection-card" data-state={activeInstallation() ? "connected" : "waiting"}>
          <div class="connection-card__title">
            <Show when={activeInstallation()} fallback={<span class="status-spinner" aria-hidden="true" />}>
              <span class="status-dot" aria-hidden="true" />
            </Show>
            <span>{loading() ? "Checking agent access" : activeInstallation() ? "Agent connected" : "Waiting for browser approval"}</span>
          </div>
          <div class="connection-card__body">
            {activeInstallation()
              ? `${activeInstallation()!.label}${activeInstallation()!.machineLabel ? ` · ${activeInstallation()!.machineLabel}` : ""}.`
              : "Approve the link opened by your terminal. This screen updates after local credential storage and the connection check succeed."}
          </div>
          <Show when={activeInstallation()}>
            <div class="connection-card__meta">
              <div>project · {project()?.name}</div>
              <div>grant · {activeInstallation()!.kind} · {activeInstallation()!.status}</div>
            </div>
          </Show>
        </div>

        <Show when={error()}><div class="error" role="alert">{error()}</div></Show>
        <Show when={project()}>{(loaded) => (
          <A class="button button--primary button--full" href={`/app/${loaded().organizationSlug}/${loaded().slug}`}>
            {activeInstallation() ? "Continue to Overview" : "Go to Overview"}
          </A>
        )}</Show>
        <p class="security-note">credential stored locally · never committed</p>
      </div>
    </AuthFrame></RequireHumanSession>
  );
}
