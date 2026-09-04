export type AgentIconKey = "claude" | "codex" | "generic";

export type AgentIconDefinition = {
  key: Exclude<AgentIconKey, "generic">;
  imageUrl: string;
  matches: readonly string[];
};

export type AgentIdentityInput = {
  agentName?: string;
  agentType?: string;
};

// This registry is the only place that maps product identities to vendor
// artwork. Fixed HTTPS sources prevent actor-controlled names from becoming
// image URLs; the component adds no-referrer loading and a neutral fallback.
export const AGENT_ICON_REGISTRY: readonly AgentIconDefinition[] = [
  {
    key: "claude",
    imageUrl: "https://a.favicon.im/claude.ai",
    matches: ["claude", "anthropic"],
  },
  {
    key: "codex",
    imageUrl: "https://a.favicon.im/openai.com",
    matches: ["codex", "openai"],
  },
] as const;

function normalizedIdentity(input: AgentIdentityInput): string {
  return [input.agentName, input.agentType]
    .map((value) => value?.trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
}

export function agentIconDefinition(
  agentName: string | undefined,
  agentType?: string,
): AgentIconDefinition | undefined {
  const identity = normalizedIdentity({ agentName, agentType });
  if (!identity) return undefined;
  return AGENT_ICON_REGISTRY.find((definition) =>
    definition.matches.some((match) => identity.includes(match))
  );
}

export function agentIconKey(
  agentName: string | undefined,
  agentType?: string,
): AgentIconKey {
  return agentIconDefinition(agentName, agentType)?.key ?? "generic";
}
