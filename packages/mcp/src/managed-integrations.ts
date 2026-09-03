import { DONGO_MCP_INSTRUCTIONS } from "./instructions.ts";
export { DONGO_COMPLETION_INSTRUCTIONS } from "./instructions.ts";

const PROJECT_REF = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;
const SHORT_REF = /^[A-Za-z0-9][A-Za-z0-9_-]{1,31}$/;

export interface DongoManagedIntegrationBundle {
  readonly integrationVersion: "0.1.13";
  readonly serverName: string;
  readonly endpoint: string;
  readonly managedInstructionBlock: string;
  readonly codexConfigToml: string;
  readonly claudeProjectConfig: string;
  readonly genericMcpConfig: string;
}

function managedInstructionBlock(): string {
  return `<!-- dongo-managed:v1:start -->\n${DONGO_MCP_INSTRUCTIONS}\n<!-- dongo-managed:v1:end -->\n`;
}

/**
 * Renders non-secret host assets from one canonical input. Installers own the
 * merge and trust prompt; this function never writes files or shells out.
 */
export function renderDongoManagedIntegrationBundle(input: {
  readonly origin: URL;
  readonly publicProjectRef: string;
  readonly shortProjectRef: string;
}): DongoManagedIntegrationBundle {
  if (
    input.origin.protocol !== "https:" ||
    input.origin.pathname !== "/" ||
    input.origin.search !== "" ||
    input.origin.hash !== ""
  ) {
    throw new Error("dongo host integration origin must be an HTTPS origin");
  }
  if (PROJECT_REF.test(input.publicProjectRef) === false) {
    throw new Error("Invalid dongo public project reference");
  }
  if (SHORT_REF.test(input.shortProjectRef) === false) {
    throw new Error("Invalid dongo short project reference");
  }

  const serverName = `dongo-${input.shortProjectRef}`;
  const endpoint = new URL(
    `/p/${input.publicProjectRef}/mcp`,
    input.origin,
  ).href;
  const claudeProjectConfig = `${JSON.stringify(
    {
      mcpServers: {
        [serverName]: { type: "http", url: endpoint },
      },
    },
    null,
    2,
  )}\n`;
  const genericMcpConfig = `${JSON.stringify(
    {
      mcpServers: {
        [serverName]: { type: "streamable-http", url: endpoint },
      },
    },
    null,
    2,
  )}\n`;

  return Object.freeze({
    integrationVersion: "0.1.13",
    serverName,
    endpoint,
    managedInstructionBlock: managedInstructionBlock(),
    codexConfigToml: `[mcp_servers.${serverName}]\nurl = "${endpoint}"\noauth.client_id = "dongo-codex"\noauth.callback_url = "http://127.0.0.1/callback"\n`,
    claudeProjectConfig,
    genericMcpConfig,
  });
}
