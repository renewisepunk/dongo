import { randomBytes } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const executable = (name) => process.platform === "win32" ? `${name}.cmd` : name;
const apply = process.argv.includes("--apply");
const resendApiKey = process.env.DONGO_RESEND_API_KEY;

if (!apply) {
  console.log("Production preparation is inert without --apply.");
  console.log("It creates route-free production Workers with isolated secrets, then configures the empty production Convex deployment.");
  process.exit(0);
}
if (!resendApiKey || !/^re_[A-Za-z0-9_-]{13,}$/u.test(resendApiKey)) {
  console.error("DONGO_RESEND_API_KEY must contain the authorized production Resend API key.");
  process.exit(2);
}

function run(command, args, options = {}) {
  const result = spawnSync(executable(command), args, {
    cwd: root,
    encoding: options.capture ? "utf8" : undefined,
    input: options.input,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"],
    env: process.env,
  });
  if (result.error || result.status !== 0) {
    if (options.capture && result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
  return options.capture ? result.stdout : "";
}

const existing = run("npx", ["convex", "env", "list", "--prod", "--names-only"], { capture: true })
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter((line) => /^[A-Z][A-Z0-9_]*$/u.test(line));
if (existing.length > 0) {
  console.error("Production Convex environment is already configured; refusing an implicit secret rotation.");
  console.error("Use the documented targeted rotation procedure instead.");
  process.exit(2);
}

const secret = () => randomBytes(48).toString("base64url");
const values = {
  attachmentSigning: secret(),
  authOAuth: secret(),
  convexBetterAuth: secret(),
  gateway: secret(),
  humanAssertion: secret(),
  notificationDispatch: secret(),
  apiResourceClient: secret(),
  mcpResourceClient: secret(),
};

const temp = mkdtempSync(join(tmpdir(), "dongo-production-bootstrap-"));
chmodSync(temp, 0o700);

function writeSecretFile(name, contents) {
  const path = join(temp, name);
  writeFileSync(path, JSON.stringify(contents), { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

function parseJsonc(source) {
  let output = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (current === "\n") {
        lineComment = false;
        output += current;
      }
      continue;
    }
    if (blockComment) {
      if (current === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (inString) {
      output += current;
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === '"') inString = false;
      continue;
    }
    if (current === '"') {
      inString = true;
      output += current;
    } else if (current === "/" && next === "/") {
      lineComment = true;
      index += 1;
    } else if (current === "/" && next === "*") {
      blockComment = true;
      index += 1;
    } else {
      output += current;
    }
  }
  return JSON.parse(output);
}

function writeBootstrapConfig(label, config) {
  const absoluteConfig = resolve(root, config);
  const configDirectory = dirname(absoluteConfig);
  const base = parseJsonc(readFileSync(absoluteConfig, "utf8"));
  const production = base.env?.production;
  if (!production?.name) throw new Error(`${config} has no production environment`);
  const merged = {
    ...base,
    ...production,
    main: resolve(configDirectory, base.main),
    routes: [],
    workers_dev: false,
  };
  delete merged.env;
  if (merged.d1_databases) {
    merged.d1_databases = merged.d1_databases.map((database) => ({
      ...database,
      ...(database.migrations_dir
        ? { migrations_dir: resolve(configDirectory, database.migrations_dir) }
        : {}),
    }));
  }
  const path = join(temp, `${label}.wrangler.json`);
  writeFileSync(path, JSON.stringify(merged), { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

function uploadVersion(label, config, secrets) {
  console.log(`Preparing route-free ${label} Worker…`);
  const secretFile = writeSecretFile(`${label}.json`, secrets);
  const bootstrapConfig = writeBootstrapConfig(label, config);
  run("npx", [
    "wrangler",
    "deploy",
    "--config",
    bootstrapConfig,
    "--secrets-file",
    secretFile,
    "--message",
    "dongo production bootstrap; no triggers",
  ]);
}

try {
  uploadVersion("auth", "apps/auth/wrangler.jsonc", {
    BETTER_AUTH_SECRET: values.authOAuth,
    HUMAN_ASSERTION_SECRET: values.humanAssertion,
    DONGO_INTERNAL_GATEWAY_SECRET: values.gateway,
    BETTER_AUTH_RESOURCE_CLIENT_SECRET: values.mcpResourceClient,
    DONGO_API_RESOURCE_CLIENT_SECRET: values.apiResourceClient,
  });
  uploadVersion("api", "apps/api/wrangler.jsonc", {
    BETTER_AUTH_RESOURCE_CLIENT_SECRET: values.apiResourceClient,
    DONGO_INTERNAL_GATEWAY_SECRET: values.gateway,
  });
  uploadVersion("mcp", "apps/mcp/wrangler.jsonc", {
    BETTER_AUTH_RESOURCE_CLIENT_SECRET: values.mcpResourceClient,
    DONGO_INTERNAL_GATEWAY_SECRET: values.gateway,
  });
  uploadVersion("files", "apps/files/wrangler.jsonc", {
    DONGO_ATTACHMENT_URL_SIGNING_SECRET: values.attachmentSigning,
    DONGO_INTERNAL_GATEWAY_SECRET: values.gateway,
  });
  uploadVersion("notifications", "apps/notifications/wrangler.jsonc", {
    DONGO_NOTIFICATION_DISPATCH_SECRET: values.notificationDispatch,
    DONGO_RESEND_CONFIG: JSON.stringify({ apiKey: resendApiKey }),
  });

  const convexEnvironment = [
    ["SITE_URL", "https://dongo.so"],
    ["BETTER_AUTH_SECRET", values.convexBetterAuth],
    ["DONGO_ATTACHMENT_UPLOAD_BASE_URL", "https://dongo.so/api/files"],
    ["DONGO_ATTACHMENT_DOWNLOAD_BASE_URL", "https://dongo.so/api/files"],
    ["DONGO_ATTACHMENT_URL_SIGNING_SECRET", values.attachmentSigning],
    ["DONGO_AUTH_INTERNAL_URL", "https://dongo.so/api/auth/internal/resources"],
    ["DONGO_AUTH_ISSUER", "https://dongo.so/api/auth"],
    ["DONGO_HUMAN_ASSERTION_ISSUER", "https://brainy-camel-172.convex.site"],
    ["DONGO_HUMAN_ASSERTION_SECRET", values.humanAssertion],
    ["DONGO_INTERNAL_GATEWAY_SECRET", values.gateway],
    ["DONGO_NOTIFICATION_DELIVERY_URL", "https://dongo.so/api/notifications/v1/deliver"],
    ["DONGO_NOTIFICATION_DISPATCH_SECRET", values.notificationDispatch],
    ["DONGO_OTP_EMAIL_URL", "https://dongo.so/api/auth/internal/email/otp"],
  ];
  const envPath = join(temp, "convex.env");
  writeFileSync(
    envPath,
    `${convexEnvironment.map(([name, value]) => `${name}=${value}`).join("\n")}\n`,
    { mode: 0o600 },
  );
  chmodSync(envPath, 0o600);
  run("npx", ["convex", "env", "set", "--prod", "--from-file", envPath]);
  console.log("Production is prepared with route-free Workers and an isolated Convex environment.");
  console.log("No production routes or traffic were activated by this command.");
} finally {
  for (const name of [
    "auth.json",
    "api.json",
    "mcp.json",
    "files.json",
    "notifications.json",
    "auth.wrangler.json",
    "api.wrangler.json",
    "mcp.wrangler.json",
    "files.wrangler.json",
    "notifications.wrangler.json",
    "convex.env",
  ]) {
    const path = join(temp, name);
    try {
      if (readFileSync(path).length > 0) writeFileSync(path, "", { mode: 0o600 });
    } catch {}
  }
  rmSync(temp, { recursive: true, force: true });
}
