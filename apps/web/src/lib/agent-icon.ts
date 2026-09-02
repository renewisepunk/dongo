export type AgentIconKey = "claude" | "codex" | "generic";

// Which mark represents an agent. Kept separate from the component so it is
// unit-tested directly, matching how the rest of the app splits logic from UI.
export function agentIconKey(agentName: string | undefined): AgentIconKey {
  const name = (agentName ?? "").trim().toLowerCase();
  if (name === "") return "generic";
  if (name.includes("claude")) return "claude";
  if (name.includes("codex")) return "codex";
  return "generic";
}
