import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, mkdtemp, mkdir, readFile, readdir, realpath, rm, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args, { cwd = repositoryRoot, env = process.env } = {}) {
  return execFileSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function readArchiveEntry(archivePath, entry) {
  return execFileSync("tar", ["-xOf", archivePath, entry], {
    cwd: repositoryRoot,
    env: process.env,
    encoding: null,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "dongo-cli-package-"));

try {
  const packageDirectory = join(temporaryRoot, "package");
  const installPrefix = join(temporaryRoot, "install");
  const configDirectory = join(temporaryRoot, "config");
  const cleanRepository = join(temporaryRoot, "repository");

  await Promise.all([
    mkdir(packageDirectory),
    mkdir(installPrefix),
    mkdir(configDirectory, { mode: 0o700 }),
    mkdir(cleanRepository),
  ]);
  await chmod(configDirectory, 0o700);

  run("npm", ["pack", "--workspace", "@dongo/cli", "--pack-destination", packageDirectory]);
  const archives = (await readdir(packageDirectory)).filter((name) => name.endsWith(".tgz"));
  invariant(archives.length === 1, "CLI packaging must create exactly one archive.");

  const archivePath = join(packageDirectory, archives[0]);
  const archiveEntries = run("tar", ["-tf", archivePath]).trim().split("\n").filter(Boolean);
  const requiredEntries = ["package/package.json", "package/README.md", "package/dist/dongo.js"];
  for (const entry of requiredEntries) {
    invariant(archiveEntries.includes(entry), `CLI package is missing ${entry}.`);
  }
  for (const entry of archiveEntries) {
    invariant(entry.startsWith("package/"), `CLI package contains an unsafe archive path: ${entry}`);
    invariant(!entry.includes("../"), `CLI package contains path traversal: ${entry}`);
    invariant(!entry.includes("/node_modules/"), `CLI package contains node_modules: ${entry}`);
    invariant(!entry.includes("/.env"), `CLI package contains an environment file: ${entry}`);
    invariant(!entry.includes("/src/"), `CLI package unexpectedly contains source files: ${entry}`);
  }

  run("npm", ["install", "--global", "--prefix", installPrefix, "--ignore-scripts", archivePath]);
  const binaryPath = join(installPrefix, "bin", "dongo");
  await access(binaryPath, constants.X_OK);

  run("git", ["init", "--quiet"], { cwd: cleanRepository });
  run("git", ["remote", "add", "origin", "https://github.com/renewisepunk/dongo"], {
    cwd: cleanRepository,
  });
  const canonicalCleanRepository = await realpath(cleanRepository);

  const isolatedEnvironment = { ...process.env, DONGO_CONFIG_DIR: configDirectory };
  delete isolatedEnvironment.DONGO_TOKEN;

  const version = run(binaryPath, ["--version"], {
    cwd: cleanRepository,
    env: isolatedEnvironment,
  }).trim();
  invariant(version === "dongo 0.1.0", `Unexpected packaged CLI version: ${version}`);

  const help = run(binaryPath, ["--help"], {
    cwd: cleanRepository,
    env: isolatedEnvironment,
  });
  invariant(help.includes("dongo connect"), "Packaged CLI help is missing connect.");
  invariant(
    help.includes("dongo integrate codex|claude|generic"),
    "Packaged CLI help is missing agent integrations.",
  );

  const authStatus = JSON.parse(run(binaryPath, ["auth", "status", "--json"], {
    cwd: cleanRepository,
    env: isolatedEnvironment,
  }));
  invariant(authStatus.ok === true, "Packaged CLI auth status did not succeed.");
  invariant(authStatus.data?.authenticated === false, "Clean packaged CLI unexpectedly authenticated.");
  const reportedRepositoryRoot = authStatus.data?.repositoryRoot;
  invariant(typeof reportedRepositoryRoot === "string", "Packaged CLI did not report its repository.");
  invariant(
    await realpath(reportedRepositoryRoot) === canonicalCleanRepository,
    "Packaged CLI resolved the wrong repository.",
  );
  invariant(authStatus.data?.marker == null, "Clean packaged CLI unexpectedly found a project marker.");
  invariant(authStatus.data?.credential == null, "Clean packaged CLI unexpectedly found a credential.");

  const configMode = (await stat(configDirectory)).mode & 0o777;
  invariant(configMode === 0o700, `CLI config directory mode is ${configMode.toString(8)}, expected 700.`);
  invariant((await readdir(configDirectory)).length === 0, "Unauthenticated CLI wrote into its config directory.");

  const repositoryMarker = join(cleanRepository, ".dongo", "project.json");
  await access(repositoryMarker).then(
    () => invariant(false, "Unauthenticated CLI wrote a repository marker."),
    (error) => invariant(error?.code === "ENOENT", "Could not verify repository marker absence."),
  );

  const digest = createHash("sha256").update(await readFile(archivePath)).digest("hex");
  const payloadHasher = createHash("sha256");
  for (const entry of [...archiveEntries].sort()) {
    const contents = readArchiveEntry(archivePath, entry);
    payloadHasher.update(Buffer.from(`${entry}\0${contents.byteLength}\0`, "utf8"));
    payloadHasher.update(contents);
  }
  const payloadDigest = payloadHasher.digest("hex");
  const expectedPayloadDigest = (
    await readFile(join(repositoryRoot, "apps", "cli", "package-payload.sha256"), "utf8")
  ).trim();
  invariant(
    /^[a-f0-9]{64}$/u.test(expectedPayloadDigest),
    "Pinned CLI payload digest must be a lowercase SHA-256 value.",
  );
  invariant(
    payloadDigest === expectedPayloadDigest,
    "CLI package payload changed without an explicit provenance update.",
  );
  process.stdout.write(`${JSON.stringify({
    ok: true,
    archive: archives[0],
    sha256: digest,
    payloadSha256: payloadDigest,
    entries: archiveEntries.length,
    version,
    configMode: configMode.toString(8),
    authenticated: false,
    marker: "absent",
  })}\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
