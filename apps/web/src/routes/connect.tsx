import { A } from "@solidjs/router";
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { AuthFrame } from "../components/AuthFrame";
import { AgentIdentity } from "../components/AgentIdentity";
import { AgentIcon } from "../components/AgentIcon";
import { RequireHumanSession } from "../components/RequireHumanSession";
import {
  ProjectDataConnection,
  type ProjectInfo,
  type ProjectInstallation,
} from "../lib/project-data";

type Host = "Codex" | "Claude Code" | "AGENTS.md";
const HOSTS: readonly Host[] = ["Codex", "Claude Code", "AGENTS.md"];

function matchesHost(installation: ProjectInstallation, host: Host): boolean {
  if (host === "AGENTS.md") return installation.kind === "cli";
  if (installation.kind !== "mcp") return false;
  const identity = `${installation.label} ${installation.clientId}`.toLowerCase();
  return host === "Claude Code" ? identity.includes("claude") : identity.includes("codex");
}

function statusPriority(status: ProjectInstallation["status"]): number {
  if (status === "active") return 0;
  if (status === "needs_reauth") return 1;
  if (status === "pending") return 2;
  return 3;
}

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

  const cliInstallation = createMemo(() => installations().find(
    (installation) => installation.kind === "cli" && installation.status === "active",
  ));
  const hostInstallation = createMemo(() => installations()
    .filter((installation) => matchesHost(installation, host()))
    .sort((left, right) => statusPriority(left.status) - statusPriority(right.status))[0]);
  const verifiedInstallation = createMemo(() => {
    const installation = hostInstallation();
    return installation?.status === "active" && installation.lastUsedAt !== undefined
      ? installation
      : undefined;
  });

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
            setError("Connection status is unavailable. Verify from the current agent session, or refresh this page to retry.");
            setLoading(false);
          },
        );
      })
      .catch(() => {
        setError("No project is available. Create or select a project, then return to connect this agent.");
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
      return "Read AGENTS.md and set up dongo for this repository in this current agent session. Apply the repository configuration, complete browser approval only if required, restart only when necessary, and verify the connection before doing work.";
    }
    if (host() === "Codex") {
      return "Set up dongo for this repository in this current Codex session. If the CLI is not connected, run dongo connect --agent-host codex so one browser action explicitly approves both clients. Then apply the project-scoped configuration, complete Codex login, restart only if necessary, and verify with dongo_session_start. Keep using this repository session.";
    }
    return `Set up dongo for this repository in this current ${host()} session. In order: 1) apply the project-scoped configuration; 2) approve the project-scoped server only if required; 3) complete login only if required; 4) restart ${host()} only when necessary; 5) verify the connection with dongo_session_start. Keep using this repository session.`;
  });

  const connectionTitle = createMemo(() => {
    if (loading()) return "Checking agent access";
    const installation = hostInstallation();
    if (installation?.status === "active" && installation.lastUsedAt !== undefined) return `${host()} connection verified`;
    if (installation?.status === "active") return `${host()} verification required`;
    if (installation?.status === "needs_reauth") return `${host()} needs login`;
    if (installation?.status === "pending") return "Waiting for project approval";
    if (installation?.status === "revoked") return `${host()} access was revoked`;
    if (cliInstallation() && host() !== "AGENTS.md") return `${host()} setup not verified`;
    return "Waiting for setup";
  });

  const connectionBody = createMemo(() => {
    const installation = hostInstallation();
    if (installation?.status === "active" && installation.lastUsedAt !== undefined) {
      return `${host()} can reach this dongo project and passed verification.`;
    }
    if (installation?.status === "active") {
      return `Access is approved. Complete step 5 from ${host()} to verify the connection.`;
    }
    if (installation?.status === "needs_reauth") {
      return `Complete step 3 to sign ${host()} in again, then verify the connection.`;
    }
    if (installation?.status === "pending") {
      return `Approve the project-scoped server if prompted, then continue with login and verification.`;
    }
    if (installation?.status === "revoked") {
      return `Apply the configuration again, complete a fresh login, and verify. The previous access can no longer be used.`;
    }
    if (cliInstallation() && host() !== "AGENTS.md") {
      return `The dongo CLI is ready, but no live ${host()} MCP connection has passed verification. Continue from step 1 below.`;
    }
    return "Start with step 1 below. This page updates when the selected connection passes verification.";
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
        <Show
          when={verifiedInstallation()}
          fallback={
            <div class="title-group">
              <div class="eyebrow eyebrow--green">Project created</div>
              <h1 class="auth-title">Connect a coding agent</h1>
              <p class="auth-lede">Use the agent session already open in this repository. There is no need to reopen it.</p>
            </div>
          }
        >
          <div class="title-group">
            <div class="eyebrow eyebrow--green">Setup complete</div>
            <h1 class="auth-title">dongo is ready for {project()?.name || "this project"}</h1>
            <p class="auth-lede">The selected agent connection passed its check. You can start tracking work now.</p>
          </div>
        </Show>

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
              <Show when={item !== "AGENTS.md"} fallback={item}>
                <AgentIdentity agentName={item} />
              </Show>
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
          <div class="instruction__label">setup sequence</div>
          <p class="connection-card__body">The CLI connection is required. MCP is optional. Codex can share the explicit browser approval, but every host keeps its own credential.</p>
          <ol class="connection-card__body" aria-label="Setup sequence">
            <li>Apply the configuration.</li>
            <li>Approve the project-scoped server only if required.</li>
            <li>Complete login only if required.</li>
            <li>Restart only when necessary.</li>
            <li>Verify the connection.</li>
          </ol>
        </div>

        <div class="connection-card" data-state={verifiedInstallation() ? "connected" : "waiting"}>
          <div class="connection-card__title">
            <Show when={verifiedInstallation()} fallback={<span class="status-spinner" aria-hidden="true" />}>
              <span class="status-dot" aria-hidden="true" />
            </Show>
            <Show when={host() !== "AGENTS.md"}><AgentIcon agentName={host()} /></Show>
            <span>{connectionTitle()}</span>
          </div>
          <div class="connection-card__body">{connectionBody()}</div>
        </div>

        <Show when={error()}><div class="error" role="alert">{error()}</div></Show>
        <Show when={project()}>{(loaded) => (
          <Show
            when={verifiedInstallation()}
            fallback={
              <A class="button button--quiet" href={`/app/${loaded().organizationSlug}/${loaded().slug}`}>
                Skip agent setup for now
              </A>
            }
          >
            <div class="onboarding-next-step">
              <div class="instruction__label">Suggested next step</div>
              <p>Open Overview and add the first piece of work you want your agent to track.</p>
              <A class="button button--primary button--full" href={`/app/${loaded().organizationSlug}/${loaded().slug}`}>
                Open dongo Overview
              </A>
            </div>
          </Show>
        )}</Show>
        <p class="security-note">credential stored locally · never committed</p>
      </div>
    </AuthFrame></RequireHumanSession>
  );
}
