import type {
  AgentUpdatePresence,
  IntakeNudgePriority,
  IntakeNudgeResult,
} from "./project-data";

export type AgentUpdateFeedback = {
  promptDeliveryAvailable: boolean;
  title: string;
  body: string;
};

export function agentPresenceFeedback(
  presence: AgentUpdatePresence | undefined,
): AgentUpdateFeedback {
  const waiting = presence?.installations.filter(
    (installation) =>
      installation.state === "waiting" && installation.delivery === "bounded_wait",
  ).length ?? 0;
  if (waiting > 0) {
    return {
      promptDeliveryAvailable: true,
      title: waiting === 1 ? "An agent is waiting for updates." : `${waiting} agents are waiting for updates.`,
      body: "dongo can deliver this promptly through the live bounded wait.",
    };
  }
  const stopped = presence?.installations.some(
    (installation) => installation.state === "stopped" || installation.delivery === "offline",
  ) ?? false;
  return {
    promptDeliveryAvailable: false,
    title: "No agent is waiting for live updates.",
    body: `This Intake will be available on the agent’s next explicit pull.${stopped ? " A stopped agent will not restart." : ""}`,
  };
}

export function nudgeDeliveryFeedback(
  result: IntakeNudgeResult,
): AgentUpdateFeedback {
  if (result.delivery.waitingInstallations > 0) {
    return {
      promptDeliveryAvailable: true,
      title: result.delivery.waitingInstallations === 1
        ? "Notification is ready for a waiting agent."
        : `Notification is ready for ${result.delivery.waitingInstallations} waiting agents.`,
      body: "Their live bounded waits should return it promptly; dongo does not claim it was consumed until they pull it.",
    };
  }
  return {
    promptDeliveryAvailable: false,
    title: "Notification queued for the next agent pull.",
    body: `No live waiter received it.${result.delivery.stoppedInstallations > 0 ? " A stopped agent was not restarted." : ""}`,
  };
}

export function nudgePriorityHelp(priority: IntakeNudgePriority): string {
  return priority === "important"
    ? "Marks this update important. It does not bypass bounded pull or restart a stopped agent."
    : "Adds a normal-priority update for the agent’s bounded wait or next explicit pull.";
}
