import { A } from "@solidjs/router";
import { createMemo, createSignal, Show } from "solid-js";
import { AuthFrame } from "../components/AuthFrame";
import { RequireHumanSession } from "../components/RequireHumanSession";

type Host = "Codex" | "Claude Code" | "AGENTS.md";

const fallbackProject = {
  name: "Dongo",
  slug: "dongo",
  repositoryUrl: "github.com/renewisepunk/dongo",
};

export default function ConnectRoute() {
  const stored = typeof sessionStorage === "undefined" ? null : sessionStorage.getItem("dongo:project");
  const project = stored ? { ...fallbackProject, ...JSON.parse(stored) } : fallbackProject;
  const [host, setHost] = createSignal<Host>("Codex");
  const [copied, setCopied] = createSignal(false);
  const [connected, setConnected] = createSignal(false);

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

        <div class="connection-card" data-state={connected() ? "connected" : "waiting"}>
          <div class="connection-card__title">
            <Show when={connected()} fallback={<span class="status-spinner" aria-hidden="true" />}>
              <span class="status-dot" aria-hidden="true" />
            </Show>
            <span>{connected() ? "Agent connected" : "Waiting for browser approval"}</span>
          </div>
          <div class="connection-card__body">
            {connected()
              ? `${host()} connected from macbook-rene · just now.`
              : "Approve the link opened by your terminal. This screen updates after local credential storage and the connection check succeed."}
          </div>
          <Show when={connected()}>
            <div class="connection-card__meta">
              <div>repo matched · {project.repositoryUrl || "local repository"}</div>
              <div>adapter · {host().toLowerCase().replace(" ", "-")}</div>
            </div>
          </Show>
        </div>

        <Show when={!connected()}>
          <button class="button button--full" type="button" onClick={() => setConnected(true)}>
            Preview approved state
          </button>
        </Show>
        <A class="button button--primary button--full" href={`/app/rene/${project.slug}`}>
          {connected() ? "Continue to Overview" : "Go to Overview"}
        </A>
        <p class="security-note">credential stored locally · never committed</p>
      </div>
    </AuthFrame></RequireHumanSession>
  );
}
