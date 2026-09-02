import { describe, expect, it } from "vitest";
import { agentIconKey } from "./agent-icon";

describe("agent icon selection", () => {
  it("recognises the agents dongo ships adapters for", () => {
    expect(agentIconKey("Claude Code")).toBe("claude");
    expect(agentIconKey("Codex")).toBe("codex");
  });

  it("matches regardless of casing or surrounding words", () => {
    expect(agentIconKey("  claude code (desktop) ")).toBe("claude");
    expect(agentIconKey("OPENAI CODEX CLI")).toBe("codex");
  });

  it("falls back to a neutral mark for anything else", () => {
    expect(agentIconKey("Some Other Agent")).toBe("generic");
    expect(agentIconKey("")).toBe("generic");
    expect(agentIconKey(undefined)).toBe("generic");
  });
});
