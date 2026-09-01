import type { IntegrationHost, IntegrationResult, IntegrationStepStatus } from "@dongo/cli-core";

function hostLabel(host: IntegrationHost): string {
  if (host === "codex") return "Codex";
  if (host === "claude") return "Claude Code";
  return "generic MCP host";
}

function statusLabel(status: IntegrationStepStatus): string {
  if (status === "complete") return "done";
  if (status === "action_required") return "next";
  if (status === "conditional") return "if required";
  return "after the prior steps";
}

export function renderIntegrationOutput(result: IntegrationResult): string {
  const label = hostLabel(result.host);
  const heading = result.lifecycle.state === "configuration_applied"
    ? `dongo ${label} configuration applied successfully.`
    : `dongo ${label} integration preview ready.`;
  const lines = [heading, result.lifecycle.summary, "", "Setup sequence:"];
  for (const step of result.lifecycle.steps) {
    lines.push(`${step.order}. ${step.title} (${statusLabel(step.status)})`);
    lines.push(`   ${step.instruction}`);
    if (step.command) lines.push(`   Run: ${step.command}`);
  }
  return `${lines.join("\n")}\n`;
}
