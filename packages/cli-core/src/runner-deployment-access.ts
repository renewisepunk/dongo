import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";

import { CliCoreError } from "./errors.ts";
import { sanitizedChildEnvironment } from "./process-environment.ts";

const PROBE_TIMEOUT_MS = 12_000;
const PROBE_MAX_BYTES = 64 * 1_024;
const RELEASE_ENV_FILES = [".env", ".env.local"] as const;
const RELEASE_ENV_KEYS = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "CONVEX_DEPLOYMENT",
  "CONVEX_DEPLOY_KEY",
  "CONVEX_SITE_URL",
  "CONVEX_URL",
  "NODE_AUTH_TOKEN",
  "NPM_ACCESS_TOKEN",
] as const;
const SECRET_ENV_KEYS = new Set([
  "CLOUDFLARE_API_TOKEN",
  "CONVEX_DEPLOY_KEY",
  "GH_ENTERPRISE_TOKEN",
  "GH_TOKEN",
  "NODE_AUTH_TOKEN",
  "NPM_ACCESS_TOKEN",
]);

export type RunnerDeploymentAccessMode = "disabled" | "repository";
export type RunnerDeploymentCapability = "github" | "convex" | "cloudflare" | "npm";

export interface RunnerDeploymentPolicy {
  mode: RunnerDeploymentAccessMode;
  capabilities: RunnerDeploymentCapability[];
  sources: string[];
}

export interface RunnerDeploymentEnvironment {
  environment: NodeJS.ProcessEnv;
  secretValues: string[];
  cleanup(): Promise<void>;
}

export type RunDeploymentProbe = (options: {
  command: string;
  args: string[];
  cwd: string;
  environment: NodeJS.ProcessEnv;
  environmentPath?: string;
}) => Promise<boolean>;

export async function discoverRunnerDeploymentPolicy(
  repositoryRoot: string,
  mode: RunnerDeploymentAccessMode,
): Promise<RunnerDeploymentPolicy> {
  if (mode === "disabled") return { mode, capabilities: [], sources: [] };
  const capabilities = new Set<RunnerDeploymentCapability>();
  const sources: string[] = [];
  for (const filename of RELEASE_ENV_FILES) {
    if (await safeConfigurationFile(path.join(repositoryRoot, filename), false)) sources.push(filename);
  }
  if (await hasGitHubOrigin(repositoryRoot)) capabilities.add("github");
  if (await isDirectory(path.join(repositoryRoot, "convex"))) capabilities.add("convex");
  if (await hasWranglerConfiguration(repositoryRoot)) capabilities.add("cloudflare");
  if (await hasPublishablePackage(repositoryRoot)) capabilities.add("npm");
  return {
    mode,
    capabilities: [...capabilities].sort(),
    sources,
  };
}

export async function resolveRunnerDeploymentEnvironment(options: {
  trustedRepositoryRoot: string;
  jobRepositoryRoot: string;
  policy: RunnerDeploymentPolicy;
  environmentPath?: string;
  githubEnvironment?: NodeJS.ProcessEnv;
  hostEnvironment?: NodeJS.ProcessEnv;
  runProbe?: RunDeploymentProbe;
}): Promise<RunnerDeploymentEnvironment> {
  if (options.policy.mode === "disabled") {
    return { environment: {}, secretValues: [], cleanup: async () => undefined };
  }
  const currentPolicy = await discoverRunnerDeploymentPolicy(options.trustedRepositoryRoot, "repository");
  if (
    currentPolicy.capabilities.join("\0") !== options.policy.capabilities.join("\0") ||
    currentPolicy.sources.join("\0") !== options.policy.sources.join("\0")
  ) {
    throw deploymentError(
      "deployment_policy_changed",
      "Trusted deployment configuration changed. Run dongo runner configure --deployment-access repository to review and approve the current sources.",
    );
  }
  const fileEnvironment: NodeJS.ProcessEnv = {};
  for (const source of options.policy.sources) {
    if (!RELEASE_ENV_FILES.includes(source as typeof RELEASE_ENV_FILES[number])) {
      throw deploymentError("deployment_policy_invalid", "Trusted deployment configuration contains an unsupported source.");
    }
    const target = path.join(options.trustedRepositoryRoot, source);
    await safeConfigurationFile(target, true);
    let parsed: NodeJS.ProcessEnv;
    try {
      parsed = parseEnv(await readFile(target, "utf8"));
    } catch {
      throw deploymentError("deployment_config_invalid", `Trusted deployment configuration in ${source} is not a valid environment file.`);
    }
    for (const key of RELEASE_ENV_KEYS) {
      if (parsed[key] !== undefined) fileEnvironment[key] = parsed[key];
    }
  }
  const environment: NodeJS.ProcessEnv = { ...fileEnvironment };
  const hostEnvironment = options.hostEnvironment ?? process.env;
  for (const key of RELEASE_ENV_KEYS) {
    if (hostEnvironment[key] !== undefined) environment[key] = hostEnvironment[key];
  }
  Object.assign(environment, options.githubEnvironment ?? {});
  let temporaryDirectory: string | undefined;
  const cleanup = async () => {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  };
  try {
    if (options.policy.capabilities.includes("npm")) {
      const token = environment.NPM_ACCESS_TOKEN ?? environment.NODE_AUTH_TOKEN;
      if (!token) {
        throw deploymentError(
          "deployment_npm_missing",
          "Trusted deployment access is on, but npm publishing credentials are missing from .env in the approved checkout.",
        );
      }
      temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "dongo-runner-npm-"));
      const npmConfig = path.join(temporaryDirectory, "npmrc");
      await writeFile(
        npmConfig,
        "registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=${NPM_ACCESS_TOKEN}\n",
        { encoding: "utf8", mode: 0o600, flag: "wx" },
      );
      environment.NPM_ACCESS_TOKEN = token;
      environment.NPM_CONFIG_USERCONFIG = npmConfig;
    }
    const runProbe = options.runProbe ?? runDeploymentProbe;
    if (options.policy.capabilities.includes("github")) {
      if (!environment.GH_TOKEN && !environment.GH_ENTERPRISE_TOKEN) {
        throw deploymentError(
          "deployment_github_missing",
          "Trusted deployment access is on, but the GitHub CLI has no usable credential for this repository origin.",
        );
      }
      await requireProbe(runProbe, "github", {
        command: "gh",
        args: ["repo", "view", "--json", "nameWithOwner"],
        cwd: options.jobRepositoryRoot,
        environment,
        environmentPath: options.environmentPath,
      });
    }
    if (options.policy.capabilities.includes("convex")) {
      if (!environment.CONVEX_DEPLOYMENT && !environment.CONVEX_DEPLOY_KEY) {
        throw deploymentError(
          "deployment_convex_missing",
          "Trusted deployment access is on, but Convex configuration is missing from .env.local in the approved checkout.",
        );
      }
      await requireProbe(runProbe, "convex", {
        command: providerExecutable(options.trustedRepositoryRoot, "convex"),
        args: ["env", "list"],
        cwd: options.jobRepositoryRoot,
        environment,
        environmentPath: options.environmentPath,
      });
    }
    if (options.policy.capabilities.includes("cloudflare")) {
      await requireProbe(runProbe, "cloudflare", {
        command: providerExecutable(options.trustedRepositoryRoot, "wrangler"),
        args: ["whoami"],
        cwd: options.jobRepositoryRoot,
        environment,
        environmentPath: options.environmentPath,
      });
    }
    if (options.policy.capabilities.includes("npm")) {
      await requireProbe(runProbe, "npm", {
        command: process.platform === "win32" ? "npm.cmd" : "npm",
        args: ["whoami", "--registry", "https://registry.npmjs.org/"],
        cwd: options.jobRepositoryRoot,
        environment,
        environmentPath: options.environmentPath,
      });
    }
    const secretValues = Object.entries(environment)
      .filter(([key, value]) => SECRET_ENV_KEYS.has(key) && typeof value === "string" && value.length >= 4)
      .map(([, value]) => value as string);
    return { environment, secretValues, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export function redactRunnerSecrets(value: string, secretValues: string[]): string {
  let redacted = value;
  for (const secret of [...new Set(secretValues)].sort((left, right) => right.length - left.length)) {
    redacted = redacted.replaceAll(secret, "[redacted]");
  }
  return redacted;
}

async function requireProbe(
  runProbe: RunDeploymentProbe,
  capability: RunnerDeploymentCapability,
  options: Parameters<RunDeploymentProbe>[0],
): Promise<void> {
  if (await runProbe(options).catch(() => false)) return;
  throw deploymentError(
    `deployment_${capability}_unavailable`,
    `Trusted ${capability === "npm" ? "npm" : capability === "github" ? "GitHub" : capability === "cloudflare" ? "Cloudflare" : "Convex"} deployment access is missing or expired on this computer. Refresh that provider's existing login, then retry the queued work.`,
  );
}

async function runDeploymentProbe(options: Parameters<RunDeploymentProbe>[0]): Promise<boolean> {
  return await new Promise((resolve) => {
    execFile(options.command, options.args, {
      cwd: options.cwd,
      env: sanitizedChildEnvironment({
        ...(options.environmentPath ? { PATH: options.environmentPath } : {}),
        ...options.environment,
      }),
      encoding: "utf8",
      maxBuffer: PROBE_MAX_BYTES,
      timeout: PROBE_TIMEOUT_MS,
      windowsHide: true,
    }, (error) => resolve(!error));
  });
}

function providerExecutable(repositoryRoot: string, name: string): string {
  return path.join(repositoryRoot, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name);
}

async function safeConfigurationFile(target: string, required: boolean): Promise<boolean> {
  try {
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || (typeof process.getuid === "function" && info.uid !== process.getuid()) || (info.mode & 0o022) !== 0) {
      throw deploymentError("deployment_config_unsafe", "Trusted deployment configuration must be an owner-controlled regular file.");
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && !required) return false;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw deploymentError("deployment_config_missing", "Approved deployment configuration is missing from the trusted checkout.");
    }
    throw error;
  }
}

async function hasGitHubOrigin(repositoryRoot: string): Promise<boolean> {
  try {
    const remote = await new Promise<string>((resolve, reject) => {
      execFile("git", ["remote", "get-url", "origin"], {
        cwd: repositoryRoot,
        env: sanitizedChildEnvironment(),
        encoding: "utf8",
        maxBuffer: 8 * 1_024,
        timeout: 5_000,
      }, (error, stdout) => error ? reject(error) : resolve(stdout));
    });
    return /(?:^|[@/:])github\.com(?=[:/]|$)/iu.test(remote.trim());
  } catch {
    return false;
  }
}

async function hasWranglerConfiguration(repositoryRoot: string): Promise<boolean> {
  if (await exists(path.join(repositoryRoot, "wrangler.jsonc")) || await exists(path.join(repositoryRoot, "wrangler.toml"))) return true;
  const apps = await readdir(path.join(repositoryRoot, "apps"), { withFileTypes: true }).catch(() => []);
  for (const entry of apps) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    if (await exists(path.join(repositoryRoot, "apps", entry.name, "wrangler.jsonc")) || await exists(path.join(repositoryRoot, "apps", entry.name, "wrangler.toml"))) return true;
  }
  return false;
}

async function hasPublishablePackage(repositoryRoot: string): Promise<boolean> {
  const paths = [path.join(repositoryRoot, "package.json")];
  const apps = await readdir(path.join(repositoryRoot, "apps"), { withFileTypes: true }).catch(() => []);
  for (const entry of apps) if (entry.isDirectory() && !entry.isSymbolicLink()) paths.push(path.join(repositoryRoot, "apps", entry.name, "package.json"));
  for (const target of paths) {
    try {
      const manifest = JSON.parse(await readFile(target, "utf8")) as { private?: boolean; publishConfig?: unknown };
      if (manifest.private !== true && manifest.publishConfig && typeof manifest.publishConfig === "object") return true;
    } catch {
      // Missing or malformed package metadata is not an approved publishing capability.
    }
  }
  return false;
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    const info = await lstat(target);
    return info.isDirectory() && !info.isSymbolicLink();
  } catch {
    return false;
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function deploymentError(code: string, message: string): CliCoreError {
  return new CliCoreError({ code, message, exitCode: 6 });
}
