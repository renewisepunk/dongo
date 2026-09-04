import { AgentIcon } from "./AgentIcon";

export type AgentIdentityProps = {
  agentName?: string;
  agentType?: string;
  class?: string;
  label?: string;
  labelClass?: string;
};

// The icon is decorative because the adjacent visible label provides the
// accessible identity exactly once.
export function AgentIdentity(props: AgentIdentityProps) {
  const label = () => props.label?.trim() || props.agentName?.trim() || "Agent";
  return (
    <span class={`agent-identity${props.class ? ` ${props.class}` : ""}`}>
      <AgentIcon agentName={props.agentName} agentType={props.agentType} />
      <span class={props.labelClass}>{label()}</span>
    </span>
  );
}
