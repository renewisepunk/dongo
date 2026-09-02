import { Match, Switch } from "solid-js";
import { agentIconKey } from "../lib/agent-icon";

// Original geometric stand-ins, not vendor logo artwork. Replacing these with
// official brand assets from each vendor's own brand page is a single-file
// change and should follow that vendor's brand guidelines.

export type AgentIconProps = {
  agentName?: string;
  class?: string;
};

// Decorative: the agent name is always rendered next to it, so the mark adds
// no screen-reader output of its own.
export function AgentIcon(props: AgentIconProps) {
  const key = () => agentIconKey(props.agentName);
  return (
    <span
      class={`agent-icon agent-icon--${key()}${props.class ? ` ${props.class}` : ""}`}
      data-agent-icon={key()}
      aria-hidden="true"
    >
      <Switch>
        <Match when={key() === "claude"}>
          <svg viewBox="0 0 16 16" width="16" height="16">
            <g stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
              <line x1="8" y1="2.4" x2="8" y2="13.6" />
              <line x1="2.4" y1="8" x2="13.6" y2="8" />
              <line x1="4.05" y1="4.05" x2="11.95" y2="11.95" />
              <line x1="11.95" y1="4.05" x2="4.05" y2="11.95" />
            </g>
          </svg>
        </Match>
        <Match when={key() === "codex"}>
          <svg viewBox="0 0 16 16" width="16" height="16">
            <g fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="6.2" cy="8" r="3.7" />
              <circle cx="9.8" cy="8" r="3.7" />
            </g>
          </svg>
        </Match>
        <Match when={key() === "generic"}>
          <svg viewBox="0 0 16 16" width="16" height="16">
            <circle cx="8" cy="8" r="3.4" fill="none" stroke="currentColor" stroke-width="1.6" />
          </svg>
        </Match>
      </Switch>
    </span>
  );
}
