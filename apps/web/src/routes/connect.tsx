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

export default function ConnectRoute() {
  const [host, setHost] = createSignal<Host>("Codex");
  const [copied, setCopied] = createSignal(false);
  const [project, setProject] = createSignal<ProjectInfo>();
  const [installations, setInstallations] = createSignal<ProjectInstallation[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  let connection: ProjectDataConnection | undefined;
  let unsubscribe: (() => void) | undefined;
  let disposed = false;

  const activeInstallation = createMemo(() => installations().find(
    (installation) =>
      installation.status === "active" &&
      (installation.kind === "cli" || installation.kind === "mcp"),
  ));

  onMount(() => {
    void ProjectDataConnection.connectFirst(preferredProjectId())
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
    unsubscribe?.();
    void connection?.close();
  });

  const instruction = createMemo(() => {
    if (host() === "AGENTS.md") {
      return "Read AGENTS.md, install the Dongo adapter in this repository, then run dongo connect.";
    }
    return `Install Dongo in this repository and run dongo connect. Configure the ${host()} MCP connection when prompted.`;
  });

  const copyInstruction = async () => {
    await navigator.clipboard.writeText(instruction());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <RequireHumanSession><AuthFrame>
      <div class="auth-stack" style={{ gap: "22px" }}>
        <div class="title-group">
          <div class="eyebrow eyebrow--green">Project created</div>
          <h1 class="auth-title">Connect a coding agent</h1>
          <p class="auth-lede">Open your repository with your coding agent and tell it to install Dongo.</p>
        </div>

        <div class="host-tabs" role="tablist" aria-label="Coding agent host">
          {(["Codex", "Claude Code", "AGENTS.md"] as const).map((item) => (
            <button
              class="host-tab"
              type="button"
              role="tab"
              aria-selected={host() === item}
              data-selected={host() === item}
              onClick={() => setHost(item)}
            >
              {item}
            </button>
          ))}
        </div>

        <div class="instruction">
          <div class="instruction__head">
            <span class="instruction__label">say this to {host()}</span>
            <button class="copy-button" type="button" onClick={copyInstruction}>
              {copied() ? "copied" : "copy"}
            </button>
          </div>
          <div class="instruction__body">{instruction()}</div>
        </div>

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
