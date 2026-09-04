import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageManifestPath = join(repositoryRoot, "apps", "cli", "package.json");
const packageName = "@wisepunk/dongo";
const publicRegistry = "https://registry.npmjs.org/";
const publicRegistryArguments = [
  "--registry",
  publicRegistry,
  `--@wisepunk:registry=${publicRegistry}`,
];
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    maxBuffer: 8 * 1_024 * 1_024,
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(options.errorMessage ?? `${command} ${args.join(" ")} failed.`);
    error.status = result.status;
    error.stdout = result.stdout ?? "";
    error.stderr = result.stderr ?? "";
    throw error;
  }
  return result.stdout ?? "";
}

function runPublicNpm(args, options = {}) {
  const environment = { ...(options.env ?? process.env) };
  for (const key of Object.keys(environment)) {
    const normalized = key.toLowerCase();
    if (normalized === "npm_config_registry" || normalized.includes("wisepunk") && normalized.includes("registry")) {
      delete environment[key];
    }
  }
  return run(npmCommand, [...args, ...publicRegistryArguments], { ...options, env: environment });
}

function parseStableVersion(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(version);
  invariant(match, `CLI version must be a stable numeric semantic version, received ${version}.`);
  return match.slice(1).map(Number);
}

export function compareStableVersions(left, right) {
  const leftParts = parseStableVersion(left);
  const rightParts = parseStableVersion(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

export function classifyRelease({ localVersion, latestVersion, exactVersionPublished, localPayload, publishedPayload }) {
  parseStableVersion(localVersion);
  if (exactVersionPublished) {
    invariant(
      localPayload === publishedPayload,
      `${packageName}@${localVersion} already exists with a different immutable payload; bump the CLI version.`,
    );
    return { action: "skip", reason: "published payload already matches" };
  }
  if (latestVersion) {
    invariant(
      compareStableVersions(localVersion, latestVersion) > 0,
      `CLI version ${localVersion} must be newer than published ${latestVersion}.`,
    );
  }
  return { action: "publish", reason: "new verified CLI version" };
}

function listArchiveEntries(archivePath) {
  return run("tar", ["-tf", archivePath]).trim().split("\n").filter(Boolean).sort();
}

function readArchiveEntry(archivePath, entry) {
  const result = spawnSync("tar", ["-xOf", archivePath, entry], {
    cwd: repositoryRoot,
    encoding: null,
    maxBuffer: 16 * 1_024 * 1_024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  invariant(result.status === 0, `Could not read ${entry} from ${archivePath}.`);
  return result.stdout;
}

function payloadDigest(archivePath) {
  const hasher = createHash("sha256");
  for (const entry of listArchiveEntries(archivePath)) {
    const contents = readArchiveEntry(archivePath, entry);
    hasher.update(Buffer.from(`${entry}\0${contents.byteLength}\0`, "utf8"));
    hasher.update(contents);
  }
  return hasher.digest("hex");
}

function pack(specification, destination) {
  if (specification === packageName) {
    run(npmCommand, ["pack", "--workspace", packageName, "--pack-destination", destination, "--json"]);
  } else {
    runPublicNpm(["pack", specification, "--pack-destination", destination, "--json"]);
  }
  const archives = readdirSync(destination).filter((entry) => entry.endsWith(".tgz"));
  invariant(archives.length === 1, `Expected one package archive for ${specification}.`);
  return join(destination, archives[0]);
}

function registryVersions() {
  const output = runPublicNpm(["view", packageName, "versions", "--json"], {
    errorMessage: `Could not read published ${packageName} versions.`,
  });
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function newestStableVersion(versions) {
  return versions
    .filter((version) => /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version))
    .sort(compareStableVersions)
    .at(-1);
}

function verifyLocalArchive(archivePath) {
  let output;
  try {
    output = run(process.execPath, ["scripts/verify-cli-package.mjs", "--archive", archivePath]);
  } catch (error) {
    const detail = error instanceof Error && "stderr" in error && typeof error.stderr === "string"
      ? error.stderr.trim()
      : "";
    throw new Error(`CLI archive verification failed${detail ? `: ${detail}` : "."}`);
  }
  const lines = output.trim().split("\n").filter(Boolean);
  const result = JSON.parse(lines.at(-1));
  invariant(result.ok === true, "CLI archive verification did not report success.");
  return result;
}

function inspectRelease(temporaryRoot) {
  const manifest = JSON.parse(readFileSync(packageManifestPath, "utf8"));
  const localVersion = manifest.version;
  invariant(manifest.name === packageName, `Expected CLI package name ${packageName}.`);
  parseStableVersion(localVersion);

  const localDirectory = join(temporaryRoot, "local");
  mkdirSync(localDirectory);
  const localArchive = pack(packageName, localDirectory);
  const verification = verifyLocalArchive(localArchive);
  const localPayload = payloadDigest(localArchive);
  invariant(localPayload === verification.payloadSha256, "CLI verification and release payload digests differ.");

  const versions = registryVersions();
  const latestVersion = newestStableVersion(versions);
  const exactVersionPublished = versions.includes(localVersion);
  let publishedPayload;
  let publishedArchive;
  if (exactVersionPublished) {
    const publishedDirectory = join(temporaryRoot, "published");
    mkdirSync(publishedDirectory);
    publishedArchive = pack(`${packageName}@${localVersion}`, publishedDirectory);
    publishedPayload = payloadDigest(publishedArchive);
  }
  const decision = classifyRelease({
    localVersion,
    latestVersion,
    exactVersionPublished,
    localPayload,
    publishedPayload,
  });
  return { ...decision, localVersion, latestVersion, localArchive, localPayload, publishedArchive, verification };
}

function requirePublishAuthorization() {
  const username = JSON.parse(runPublicNpm(["whoami", "--json"], {
    errorMessage: "npm publishing authorization is required before production changes. Run npm login for an account allowed to publish @wisepunk/dongo.",
  }));
  const collaborators = JSON.parse(runPublicNpm(
    ["access", "list", "collaborators", packageName, "--json"],
    { errorMessage: `Could not verify ${username}'s publish access to ${packageName}.` },
  ));
  invariant(
    collaborators?.[username] === "read-write" || collaborators?.[username] === "write",
    `${username} does not have read-write publish access to ${packageName}.`,
  );
}

function archiveIntegrity(archivePath) {
  return `sha512-${createHash("sha512").update(readFileSync(archivePath)).digest("base64")}`;
}

async function waitForIntegrity(version, expectedIntegrity) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const integrity = JSON.parse(runPublicNpm([
        "view",
        `${packageName}@${version}`,
        "dist.integrity",
        "--json",
      ]));
      if (integrity === expectedIntegrity) return integrity;
    } catch {
      // npm registry propagation is eventually consistent immediately after publish.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_500));
  }
  throw new Error(`Published ${packageName}@${version} did not converge to the verified archive integrity.`);
}

function verifyRegistryInstall(temporaryRoot, version) {
  const prefix = join(temporaryRoot, "registry-install");
  const configDirectory = join(temporaryRoot, "registry-config");
  const repository = join(temporaryRoot, "registry-repository");
  mkdirSync(prefix);
  mkdirSync(configDirectory, { mode: 0o700 });
  mkdirSync(repository);
  chmodSync(configDirectory, 0o700);
  runPublicNpm([
    "install",
    "--global",
    "--prefix",
    prefix,
    "--ignore-scripts",
    `${packageName}@${version}`,
  ]);
  const binary = join(prefix, "bin", process.platform === "win32" ? "dongo.cmd" : "dongo");
  const environment = { ...process.env, DONGO_CONFIG_DIR: configDirectory };
  delete environment.DONGO_TOKEN;
  run("git", ["init", "--quiet"], { cwd: repository, env: environment });
  const reportedVersion = run(binary, ["--version"], { cwd: repository, env: environment }).trim();
  invariant(reportedVersion === `dongo ${version}`, `Registry install reported ${reportedVersion}.`);
  const help = run(binary, ["--help"], { cwd: repository, env: environment });
  for (const command of ["dongo updates wait", "dongo runner install", "dongo work create"]) {
    invariant(help.includes(command), `Registry install help is missing ${command}.`);
  }
  const authStatus = JSON.parse(run(binary, ["auth", "status", "--json"], {
    cwd: repository,
    env: environment,
  }));
  invariant(authStatus.ok === true && authStatus.data?.authenticated === false, "Registry install auth status was not clean.");
}

async function verifyPublishedRelease(temporaryRoot, release) {
  invariant(release.publishedArchive, `Published ${packageName}@${release.localVersion} archive was not captured.`);
  const expectedIntegrity = archiveIntegrity(release.publishedArchive);
  const integrity = await waitForIntegrity(release.localVersion, expectedIntegrity);
  verifyRegistryInstall(temporaryRoot, release.localVersion);
  return integrity;
}

async function main() {
  const mode = process.argv[2];
  invariant(["--plan", "--preflight", "--publish"].includes(mode), "Use --plan, --preflight, or --publish.");
  const temporaryRoot = mkdtempSync(join(tmpdir(), "dongo-cli-release-"));
  try {
    const release = inspectRelease(temporaryRoot);
    if (release.action === "publish" && mode !== "--plan") requirePublishAuthorization();
    if (mode === "--publish" && release.action === "publish") {
      const expectedIntegrity = archiveIntegrity(release.localArchive);
      runPublicNpm([
        "publish",
        release.localArchive,
        "--access",
        "public",
      ], { inherit: true });
      const integrity = await waitForIntegrity(release.localVersion, expectedIntegrity);
      verifyRegistryInstall(temporaryRoot, release.localVersion);
      process.stdout.write(`${JSON.stringify({
        ok: true,
        action: "published",
        package: packageName,
        version: release.localVersion,
        integrity,
        payloadSha256: release.localPayload,
      })}\n`);
      return;
    }
    if (release.action === "skip" && mode !== "--plan") {
      const integrity = await verifyPublishedRelease(temporaryRoot, release);
      process.stdout.write(`${JSON.stringify({
        ok: true,
        action: "verified",
        reason: release.reason,
        package: packageName,
        version: release.localVersion,
        integrity,
        payloadSha256: release.localPayload,
      })}\n`);
      return;
    }
    process.stdout.write(`${JSON.stringify({
      ok: true,
      action: release.action,
      reason: release.reason,
      package: packageName,
      version: release.localVersion,
      latestVersion: release.latestVersion,
      payloadSha256: release.localPayload,
      authorizationRequired: release.action === "publish",
    })}\n`);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(error.status ?? 1);
  });
}
