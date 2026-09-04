import { createMemo, createSignal, Show } from "solid-js";
import { agentIconDefinition, agentIconKey } from "../lib/agent-icon";

export type AgentIconProps = {
  agentName?: string;
  agentType?: string;
  class?: string;
};

export function AgentIcon(props: AgentIconProps) {
  const definition = createMemo(() => agentIconDefinition(props.agentName, props.agentType));
  const key = createMemo(() => agentIconKey(props.agentName, props.agentType));
  const [failedImageUrl, setFailedImageUrl] = createSignal<string>();
  const imageUrl = createMemo(() => {
    const source = definition()?.imageUrl;
    return source && source !== failedImageUrl() ? source : undefined;
  });

  return (
    <span
      class={`agent-icon agent-icon--${key()}${props.class ? ` ${props.class}` : ""}`}
      data-agent-icon={key()}
      data-agent-icon-state={imageUrl() ? "vendor" : "fallback"}
      aria-hidden="true"
    >
      <Show
        when={imageUrl()}
        fallback={
          <svg viewBox="0 0 16 16">
            <circle cx="8" cy="8" r="3.4" fill="none" stroke="currentColor" stroke-width="1.6" />
            <path d="M3.8 13c.9-1.5 2.3-2.3 4.2-2.3s3.3.8 4.2 2.3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
        }
      >
        {(source) => (
          <img
            src={source()}
            alt=""
            loading="lazy"
            decoding="async"
            referrerpolicy="no-referrer"
            onError={() => setFailedImageUrl(source())}
          />
        )}
      </Show>
    </span>
  );
}
