export interface CliUpdateAdvisory {
  available: true;
  package: "@wisepunk/dongo";
  currentVersion: string;
  latestVersion: string;
  consentRequired: true;
  prompt: string;
  installCommand: string;
}

const latestPackageUrl = "https://registry.npmjs.org/@wisepunk%2Fdongo/latest";

function parseStableVersion(version: string): [number, number, number] | undefined {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(version);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isNewerVersion(candidate: string, current: string): boolean {
  const candidateParts = parseStableVersion(candidate);
  const currentParts = parseStableVersion(current);
  if (!candidateParts || !currentParts) return false;
  for (let index = 0; index < candidateParts.length; index += 1) {
    if (candidateParts[index] !== currentParts[index]) {
      return candidateParts[index] > currentParts[index];
    }
  }
  return false;
}

export async function checkForCliUpdate(
  currentVersion: string,
  options: {
    fetch?: typeof globalThis.fetch;
    timeoutMilliseconds?: number;
  } = {},
): Promise<CliUpdateAdvisory | undefined> {
  const fetchLatest = options.fetch ?? globalThis.fetch;
  const timeoutMilliseconds = options.timeoutMilliseconds ?? 1_200;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMilliseconds);
  try {
    const response = await fetchLatest(latestPackageUrl, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    const body = await response.json() as { version?: unknown };
    if (typeof body.version !== "string" || !isNewerVersion(body.version, currentVersion)) {
      return undefined;
    }
    const latestVersion = body.version;
    return {
      available: true,
      package: "@wisepunk/dongo",
      currentVersion,
      latestVersion,
      consentRequired: true,
      prompt: "A newer dongo CLI is available. Ask the user whether they want to install it before running the command.",
      installCommand: `npm install --global @wisepunk/dongo@${latestVersion}`,
    };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}
