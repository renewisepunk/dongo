import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicRegistry = "https://registry.npmjs.org/";
const execFileAsync = promisify(execFile);
const archiveArgumentIndex = process.argv.indexOf("--archive");
const suppliedArchivePath = archiveArgumentIndex >= 0
  ? process.argv[archiveArgumentIndex + 1]
  : undefined;

if (archiveArgumentIndex >= 0 && !suppliedArchivePath) {
  throw new Error("--archive requires a package archive path.");
}

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

async function runAsync(command, args, { cwd = repositoryRoot, env = process.env } = {}) {
  return await execFileAsync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 20_000,
    maxBuffer: 2 * 1_024 * 1_024,
  });
}

async function regularFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await regularFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function readArchiveEntry(archivePath, entry) {
  return execFileSync("tar", ["-xOf", archivePath, entry], {
    cwd: repositoryRoot,
    env: process.env,
    encoding: null,
    maxBuffer: 16 * 1_024 * 1_024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "dongo-cli-package-"));
let mockServer;

try {
  const packageDirectory = join(temporaryRoot, "package");
  const installPrefix = join(temporaryRoot, "install");
  const configDirectory = join(temporaryRoot, "config");
  const cleanRepository = join(temporaryRoot, "repository");
  const helperDirectory = join(temporaryRoot, "helpers");
  const helperLog = join(temporaryRoot, "helper-invocations.log");
  const fetchPreloader = join(temporaryRoot, "production-fetch-preloader.mjs");

  await Promise.all([
    mkdir(packageDirectory),
    mkdir(installPrefix),
    mkdir(configDirectory, { mode: 0o700 }),
    mkdir(cleanRepository),
    mkdir(helperDirectory),
  ]);
  await chmod(configDirectory, 0o700);

  let archivePath;
  if (suppliedArchivePath) {
    archivePath = resolve(repositoryRoot, suppliedArchivePath);
    await access(archivePath, constants.R_OK);
  } else {
    run("npm", ["pack", "--workspace", "@wisepunk/dongo", "--pack-destination", packageDirectory]);
    const archives = (await readdir(packageDirectory)).filter((name) => name.endsWith(".tgz"));
    invariant(archives.length === 1, "CLI packaging must create exactly one archive.");
    archivePath = join(packageDirectory, archives[0]);
  }
  const archiveName = archivePath.split(/[\\/]/u).at(-1);
  invariant(archiveName?.endsWith(".tgz"), "CLI package archive must use the .tgz extension.");
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
  const bundledCli = readArchiveEntry(archivePath, "package/dist/dongo.js").toString("utf8");
  invariant(
    !/\/usr\/bin\/(?:security|swift)|find-generic-password|add-generic-password|secret-tool|DONGO_KEYCHAIN/u.test(bundledCli),
    "Packaged CLI contains a forbidden credential-helper integration.",
  );

  run("npm", [
    "install",
    "--global",
    "--prefix",
    installPrefix,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    archivePath,
    "--registry",
    publicRegistry,
    `--@wisepunk:registry=${publicRegistry}`,
  ]);
  const binaryPath = join(installPrefix, "bin", "dongo");
  await access(binaryPath, constants.X_OK);

  run("git", ["init", "--quiet"], { cwd: cleanRepository });
  run("git", ["remote", "add", "origin", "https://github.com/renewisepunk/dongo"], {
    cwd: cleanRepository,
  });
  const canonicalCleanRepository = await realpath(cleanRepository);

  const isolatedEnvironment = { ...process.env, DONGO_CONFIG_DIR: configDirectory };
  delete isolatedEnvironment.DONGO_TOKEN;

  for (const helper of ["security", "secret-tool", "swift", "xcode-select", "xcrun"]) {
    const helperPath = join(helperDirectory, helper);
    await writeFile(
      helperPath,
      "#!/bin/sh\nprintf '%s\\n' \"$0\" >> \"$DONGO_HELPER_LOG\"\nexit 97\n",
      { mode: 0o700 },
    );
    await chmod(helperPath, 0o700);
  }
  isolatedEnvironment.PATH = `${helperDirectory}:${isolatedEnvironment.PATH ?? ""}`;
  isolatedEnvironment.DONGO_HELPER_LOG = helperLog;

  const packageManifest = JSON.parse(await readFile(join(repositoryRoot, "apps", "cli", "package.json"), "utf8"));
  const expectedVersion = packageManifest.version;
  invariant(typeof expectedVersion === "string", "CLI package manifest is missing its version.");
  const versionParts = expectedVersion.split(".").map(Number);
  invariant(
    versionParts.length === 3 && versionParts.every(Number.isSafeInteger),
    "CLI package version must be a stable numeric semantic version.",
  );
  const updateTestVersion = `${versionParts[0]}.${versionParts[1]}.${versionParts[2] + 1}`;
  const version = run(binaryPath, ["--version"], {
    cwd: cleanRepository,
    env: isolatedEnvironment,
  }).trim();
  invariant(version === `dongo ${expectedVersion}`, `Unexpected packaged CLI version: ${version}`);

  const help = run(binaryPath, ["--help"], {
    cwd: cleanRepository,
    env: isolatedEnvironment,
  });
  invariant(help.includes("dongo connect"), "Packaged CLI help is missing connect.");
  invariant(
    help.includes("dongo integrate codex|claude|generic"),
    "Packaged CLI help is missing agent integrations.",
  );
  invariant(
    !/--environment|--origin|dev\.dongo\.so/u.test(help),
    "Packaged CLI help exposes an internal environment control.",
  );
  for (const args of [
    ["connect", "--environment", "development", "--json"],
    ["connect", "--origin", "https://dev.dongo.so", "--json"],
    ["ci", "setup", "--environment", "production", "--json"],
  ]) {
    let rejected;
    try {
      await runAsync(binaryPath, args, { cwd: cleanRepository, env: isolatedEnvironment });
    } catch (error) {
      rejected = error;
    }
    invariant(rejected?.code === 2, `Packaged CLI accepted internal option ${args[1]}.`);
    const result = JSON.parse(rejected.stdout);
    invariant(result.error?.code === "validation", `Packaged CLI returned the wrong error for ${args[1]}.`);
  }

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

  const repositoryMarker = join(cleanRepository, ".agent-work", "project.json");
  await access(repositoryMarker).then(
    () => invariant(false, "Unauthenticated CLI wrote a repository marker."),
    (error) => invariant(error?.code === "ENOENT", "Could not verify repository marker absence."),
  );

  const now = Date.now();
  const project = {
    id: "project_package_verification",
    publicRef: "package-verification",
    organizationId: "organization_package_verification",
    organizationSlug: "package-verification",
    name: "dongo package verification",
    slug: "dongo-package-verification",
    identifierPrefix: "PKG",
    repositoryUrl: "https://github.com/renewisepunk/dongo",
    executionMode: "manual",
  };
  const installation = {
    id: "installation_package_verification",
    kind: "installation",
    displayName: "dongo CLI",
    agentType: "cli",
  };
  const session = {
    project,
    installation,
    overview: {
      project,
      needsYou: [],
      working: [],
      ready: [],
      inbox: [],
      recentlyDone: [],
      serverTime: now,
    },
    newlyResolvedAttention: [],
    instructions: {
      executionMode: "manual",
      maxNewWorkItemsPerSession: 1,
      wakeUpSemantics: "next_pull",
    },
  };
  let origin;
  const jsonResponse = (response, status, body, requestId) => {
    response.writeHead(status, {
      "content-type": "application/json",
      ...(requestId ? { "x-request-id": requestId } : {}),
    });
    response.end(JSON.stringify(body));
  };
  mockServer = createServer((request, response) => {
    request.resume();
    const url = new URL(request.url ?? "/", origin);
    if (request.method === "POST" && url.pathname === "/api/auth/device/code") {
      jsonResponse(response, 200, {
        device_code: "package-device-secret",
        user_code: "PKG1-TEST",
        verification_uri: "https://dongo.so/device",
        verification_uri_complete: "https://dongo.so/device?user_code=PKG1-TEST",
        expires_in: 60,
        interval: 0.01,
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/auth/oauth2/token") {
      jsonResponse(response, 200, {
        access_token: "package-access-secret",
        refresh_token: "package-refresh-secret",
        token_type: "Bearer",
        expires_in: 3_600,
        scope: "dongo:work:read dongo:work:write dongo:attachments:read offline_access",
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/agent/v1/session_start") {
      jsonResponse(response, 200, {
        ok: true,
        data: session,
        requestId: "package-session-request",
        apiVersion: "v1",
      }, "package-session-request");
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/auth/oauth2/revoke") {
      response.writeHead(200);
      response.end();
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolveListen, rejectListen) => {
    mockServer.once("error", rejectListen);
    mockServer.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = mockServer.address();
  invariant(address && typeof address === "object", "Mock authorization server did not bind.");
  origin = `http://127.0.0.1:${address.port}`;

  await writeFile(fetchPreloader, `
const nativeFetch = globalThis.fetch;
const testOrigin = process.env.DONGO_PACKAGE_TEST_ORIGIN;
if (!testOrigin) throw new Error("DONGO_PACKAGE_TEST_ORIGIN is required");
globalThis.fetch = (input, init) => {
  const source = input instanceof Request ? input.url : String(input);
  const url = new URL(source);
  if (url.href === "https://registry.npmjs.org/@wisepunk%2Fdongo/latest") {
    const version = process.env.DONGO_PACKAGE_TEST_LATEST_VERSION ?? ${JSON.stringify(expectedVersion)};
    return Promise.resolve(new Response(JSON.stringify({ version }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
  }
  if (url.origin !== "https://dongo.so") return nativeFetch(input, init);
  const rewritten = new URL(url.pathname + url.search, testOrigin);
  return input instanceof Request
    ? nativeFetch(new Request(rewritten, input), init)
    : nativeFetch(rewritten, init);
};
`, { mode: 0o600 });
  const productionInterceptEnvironment = {
    ...isolatedEnvironment,
    DONGO_PACKAGE_TEST_ORIGIN: origin,
    DONGO_PACKAGE_TEST_LATEST_VERSION: updateTestVersion,
    NODE_OPTIONS: `${isolatedEnvironment.NODE_OPTIONS ? `${isolatedEnvironment.NODE_OPTIONS} ` : ""}--import=${fetchPreloader}`,
  };

  const connect = await runAsync(binaryPath, [
    "connect",
    "--project-name",
    "dongo package verification",
    "--repository-url",
    "https://github.com/renewisepunk/dongo",
    "--execution-mode",
    "manual",
    "--no-browser",
    "--json",
  ], { cwd: cleanRepository, env: productionInterceptEnvironment });
  const connected = JSON.parse(connect.stdout);
  invariant(connected.ok === true, "Installed CLI did not complete local device authorization.");
  invariant(connected.update?.latestVersion === updateTestVersion, "Installed CLI did not report the newer release.");
  invariant(connected.update?.consentRequired === true, "Installed CLI update did not require user consent.");
  invariant(
    connected.update?.installCommand === `npm install --global @wisepunk/dongo@${updateTestVersion}`,
    "Installed CLI update command was not pinned to the validated version.",
  );
  invariant(
    connected.data?.credentialStore === "local-user-file",
    "Installed CLI did not report its local credential storage class.",
  );
  invariant(
    !/package-(?:access|refresh|device)-secret/u.test(connect.stdout + connect.stderr),
    "Installed CLI exposed secret authorization material in terminal output.",
  );
  invariant(
    !/PKG1-TEST|user_code/u.test(connect.stdout),
    "Installed CLI exposed the human verification prompt in JSON stdout.",
  );
  invariant(
    /PKG1-TEST/u.test(connect.stderr),
    "Installed CLI did not show the non-secret comparison code on stderr.",
  );

  const authenticated = JSON.parse((await runAsync(binaryPath, ["auth", "status", "--json"], {
    cwd: cleanRepository,
    env: productionInterceptEnvironment,
  })).stdout);
  invariant(authenticated.data?.authenticated === true, "Installed CLI did not persist authentication.");
  const doctor = JSON.parse((await runAsync(binaryPath, ["doctor", "--json"], {
    cwd: cleanRepository,
    env: productionInterceptEnvironment,
  })).stdout);
  invariant(doctor.data?.ok === true, "Installed CLI doctor failed after connection.");
  const repeatedSession = JSON.parse((await runAsync(binaryPath, ["session-start", "--json"], {
    cwd: cleanRepository,
    env: productionInterceptEnvironment,
  })).stdout);
  invariant(repeatedSession.ok === true, "Installed CLI follow-up session failed.");

  const credentialFiles = await regularFiles(configDirectory);
  invariant(credentialFiles.length === 1, "Installed CLI must persist exactly one credential file.");
  invariant(
    ((await stat(credentialFiles[0])).mode & 0o777) === 0o600,
    "Installed CLI credential file is not mode 600.",
  );
  invariant(
    !/package-(?:access|refresh|device)-secret|PKG1-TEST/u.test(await readFile(repositoryMarker, "utf8")),
    "Repository marker contains authorization material.",
  );
  const helperInvocations = await readFile(helperLog, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return "";
    throw error;
  });
  invariant(helperInvocations === "", "Installed CLI invoked a forbidden credential helper.");

  const logout = JSON.parse((await runAsync(binaryPath, ["auth", "logout", "--json"], {
    cwd: cleanRepository,
    env: productionInterceptEnvironment,
  })).stdout);
  invariant(logout.data?.revoked === true, "Installed CLI logout did not revoke first.");
  invariant((await regularFiles(configDirectory)).length === 0, "Installed CLI logout retained a credential.");
  const loggedOut = JSON.parse((await runAsync(binaryPath, ["auth", "status", "--json"], {
    cwd: cleanRepository,
    env: productionInterceptEnvironment,
  })).stdout);
  invariant(loggedOut.data?.authenticated === false, "Installed CLI remained authenticated after logout.");

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
    `CLI package payload changed without an explicit provenance update (expected ${expectedPayloadDigest}, received ${payloadDigest}).`,
  );
  process.stdout.write(`${JSON.stringify({
    ok: true,
    archive: archiveName,
    sha256: digest,
    payloadSha256: payloadDigest,
    entries: archiveEntries.length,
    version,
    configMode: configMode.toString(8),
    authenticated: false,
    marker: "absent",
    lifecycle: "connect-status-doctor-session-logout",
    credentialMode: "600",
    credentialHelper: "not-invoked",
  })}\n`);
} finally {
  if (mockServer) await new Promise((resolveClose) => mockServer.close(resolveClose));
  await rm(temporaryRoot, { recursive: true, force: true });
}
