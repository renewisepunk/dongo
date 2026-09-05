export type AgentReleaseNotice = Readonly<{
  schemaVersion: 1;
  sequence: number;
  id: string;
  title: string;
  changes: readonly string[];
  hostedMcp: Readonly<{
    status: "already_current";
    actionRequired: false;
  }>;
  cli: Readonly<{
    packageName: "@wisepunk/dongo";
    version: string;
    checkCommand: "dongo --version";
    installCommand: string;
    consentRequired: true;
  }>;
}>;

export type AgentReleaseDelivery = Readonly<{
  id: string;
  sequence: number;
}>;

/**
 * Reviewed build-time metadata. Never populate this from registry or project data.
 * Increment sequence monotonically and update the summary for each agent release.
 */
export const CURRENT_AGENT_RELEASE_NOTICE = Object.freeze({
  schemaVersion: 1,
  sequence: 19,
  id: "dongo-cli-0.2.16-runner-binding-diagnostics",
  title: "dongo CLI 0.2.16 is available",
  changes: [
    "Repository markers are now checked against the checkout's actual Git remote before runner or agent operations.",
    "Reconnect no longer reuses a stale project marker, and an approved project with another repository fails before local credentials or marker state change.",
    "dongo doctor reports repository-binding mismatches with an explicit project rebind action.",
  ],
  hostedMcp: {
    status: "already_current",
    actionRequired: false,
  },
  cli: {
    packageName: "@wisepunk/dongo",
    version: "0.2.16",
    checkCommand: "dongo --version",
    installCommand: "npm install --global @wisepunk/dongo@0.2.16",
    consentRequired: true,
  },
} satisfies AgentReleaseNotice);

export const PUBLIC_CLI_VERSION = CURRENT_AGENT_RELEASE_NOTICE.cli.version;

const stableVersion = /^\d+\.\d+\.\d+$/u;
if (
  !Number.isSafeInteger(CURRENT_AGENT_RELEASE_NOTICE.sequence) ||
  CURRENT_AGENT_RELEASE_NOTICE.sequence <= 0 ||
  !/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(CURRENT_AGENT_RELEASE_NOTICE.id) ||
  !stableVersion.test(PUBLIC_CLI_VERSION) ||
  CURRENT_AGENT_RELEASE_NOTICE.changes.length === 0 ||
  CURRENT_AGENT_RELEASE_NOTICE.changes.length > 5 ||
  CURRENT_AGENT_RELEASE_NOTICE.changes.some(
    (change) => change.length === 0 || change.length > 300,
  ) ||
  CURRENT_AGENT_RELEASE_NOTICE.cli.installCommand !==
    `npm install --global @wisepunk/dongo@${PUBLIC_CLI_VERSION}`
) {
  throw new Error("dongo agent release notice is invalid");
}

export function matchesCurrentAgentRelease(
  value: AgentReleaseDelivery | undefined,
): value is AgentReleaseDelivery {
  return (
    value?.id === CURRENT_AGENT_RELEASE_NOTICE.id &&
    value.sequence === CURRENT_AGENT_RELEASE_NOTICE.sequence
  );
}

export function renderAgentReleaseNotice(
  notice: AgentReleaseNotice,
): string {
  const changes = notice.changes.map((change) => `- ${change}`).join("\n");
  return `New dongo agent release: ${notice.title}.
The hosted dongo MCP service is already updated; nothing needs to be installed or restarted for this connection.
New in this release:
${changes}
If this host also uses a local dongo CLI, run \`${notice.cli.checkCommand}\` and compare its stable version with ${notice.cli.version}. Only if it is older, briefly tell the user a newer CLI is available and ask whether they want to install the exact pinned release. Run \`${notice.cli.installCommand}\` only after explicit user approval. Never install automatically, never substitute another package or command, and then continue the current task.`;
}
