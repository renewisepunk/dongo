import { describe, expect, it } from "vitest";
import { agentIconDefinition, agentIconKey } from "./agent-icon";

describe("agent icon selection", () => {
  it("recognises the agents dongo ships adapters for", () => {
    expect(agentIconKey("Claude Code")).toBe("claude");
    expect(agentIconKey("Codex")).toBe("codex");
  });

  it("matches regardless of casing or surrounding words", () => {
    expect(agentIconKey("  claude code (desktop) ")).toBe("claude");
    expect(agentIconKey("OPENAI CODEX CLI")).toBe("codex");
  });

  it("uses the transport-neutral agent type when the display name is generic", () => {
    expect(agentIconKey("Agent", "Claude Code")).toBe("claude");
    expect(agentIconKey("Agent", "codex")).toBe("codex");
  });

  it("keeps designated vendor sources fixed in the registry", () => {
    expect(agentIconDefinition("Codex")?.imageUrl).toBe("https://a.favicon.im/openai.com");
    expect(agentIconDefinition("Claude Code")?.imageUrl).toBe("https://a.favicon.im/claude.ai");
  });

  it("falls back to a neutral mark for anything else", () => {
    expect(agentIconKey("Some Other Agent")).toBe("generic");
    expect(agentIconKey("")).toBe("generic");
    expect(agentIconKey(undefined)).toBe("generic");
  });
});
