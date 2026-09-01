import { describe, expect, it } from "vitest";

import {
  agentPresenceFeedback,
  nudgeDeliveryFeedback,
  nudgePriorityHelp,
} from "./agent-update-feedback";
import type { AgentUpdatePresence, IntakeNudgeResult } from "./project-data";

function presence(
  state: "waiting" | "recently_active" | "stopped",
  delivery: "bounded_wait" | "next_pull" | "offline",
): AgentUpdatePresence {
  return {
    serverTime: 1,
    installations: [{
      installationId: "installation-1",
      actor: { id: "actor-1", displayName: "Codex" },
      capability: "get_updates",
      state,
      delivery,
    }],
    truth: { stoppedAgentsRestarted: false },
  };
}

function nudge(waitingInstallations: number, stoppedInstallations: number): IntakeNudgeResult {
  return {
    signal: {
      id: "signal-1",
      version: 1,
      kind: "intake_available",
      intakeId: "intake-1",
      priority: "normal",
      createdAt: 1,
    },
    delivery: {
      mechanism: "bounded_pull",
      waitingInstallations,
      recentlyActiveInstallations: 0,
      stoppedInstallations,
      stoppedAgentsRestarted: false,
    },
  };
}

describe("agent update feedback", () => {
  it("promises prompt delivery only for an observed bounded waiter", () => {
    expect(agentPresenceFeedback(presence("waiting", "bounded_wait"))).toMatchObject({
      promptDeliveryAvailable: true,
      title: "An agent is waiting for updates.",
    });
    expect(agentPresenceFeedback(presence("recently_active", "next_pull"))).toMatchObject({
      promptDeliveryAvailable: false,
      title: "No agent is waiting for live updates.",
    });
  });

  it("never implies a stopped agent was restarted", () => {
    expect(agentPresenceFeedback(presence("stopped", "offline")).body).toContain(
      "A stopped agent will not restart.",
    );
    expect(nudgeDeliveryFeedback(nudge(0, 1))).toMatchObject({
      promptDeliveryAvailable: false,
      title: "Notification queued for the next agent pull.",
      body: expect.stringContaining("A stopped agent was not restarted."),
    });
  });

  it("describes important priority without overstating delivery", () => {
    expect(nudgePriorityHelp("important")).toBe(
      "Marks this update important. It does not bypass bounded pull or restart a stopped agent.",
    );
  });
});
