const PRODUCTION_ORIGIN = "https://dongo.so";
const DEVELOPMENT_ORIGIN = "https://dev.dongo.so";

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value`);
  return value;
}

const projectRef = option("project-ref") ?? process.env.DONGO_PROJECT_REF;
if (projectRef && !/^[a-z0-9][a-z0-9-]{2,199}$/.test(projectRef)) {
  console.error("--project-ref must be a valid public project reference");
  process.exit(2);
}

const checks = [];

async function request(url, init = {}) {
  return fetch(url, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
}

async function statusCheck(name, url, expectedStatus = 200) {
  try {
    const response = await request(url);
    return { name, ok: response.status === expectedStatus, detail: `HTTP ${response.status}` };
  } catch (error) {
    return { name, ok: false, detail: error instanceof Error ? error.name : "request failed" };
  }
}

checks.push(...await Promise.all([
  statusCheck("production web", `${PRODUCTION_ORIGIN}/`),
  statusCheck("public get started", `${PRODUCTION_ORIGIN}/get-started`),
  statusCheck("public help", `${PRODUCTION_ORIGIN}/help`),
  statusCheck("auth health", `${PRODUCTION_ORIGIN}/api/auth/healthz`),
  statusCheck("auth readiness", `${PRODUCTION_ORIGIN}/api/auth/readyz`),
  statusCheck("agent API health", `${PRODUCTION_ORIGIN}/api/agent/v1/healthz`),
  statusCheck("agent API readiness", `${PRODUCTION_ORIGIN}/api/agent/v1/readyz`),
  statusCheck("MCP health", `${PRODUCTION_ORIGIN}/api/mcp/healthz`),
  statusCheck("MCP readiness", `${PRODUCTION_ORIGIN}/api/mcp/readyz`),
  statusCheck("files health", `${PRODUCTION_ORIGIN}/api/files/healthz`),
  statusCheck("files readiness", `${PRODUCTION_ORIGIN}/api/files/readyz`),
  statusCheck("notifications health", `${PRODUCTION_ORIGIN}/api/notifications/healthz`),
  statusCheck("notifications readiness", `${PRODUCTION_ORIGIN}/api/notifications/readyz`),
  statusCheck("development remains available", `${DEVELOPMENT_ORIGIN}/`),
]));

try {
  const response = await request(`${PRODUCTION_ORIGIN}/.well-known/oauth-authorization-server/api/auth`);
  const metadata = await response.json();
  const ok = response.status === 200
    && metadata.issuer === `${PRODUCTION_ORIGIN}/api/auth`
    && metadata.device_authorization_endpoint === `${PRODUCTION_ORIGIN}/api/auth/device/code`
    && metadata.token_endpoint === `${PRODUCTION_ORIGIN}/api/auth/oauth2/token`
    && metadata.revocation_endpoint === `${PRODUCTION_ORIGIN}/api/auth/oauth2/revoke`
    && metadata.code_challenge_methods_supported?.includes("S256")
    && !JSON.stringify(metadata).includes(DEVELOPMENT_ORIGIN);
  checks.push({ name: "authorization metadata", ok, detail: ok ? "exact production endpoints" : "metadata mismatch" });
} catch (error) {
  checks.push({ name: "authorization metadata", ok: false, detail: error instanceof Error ? error.name : "request failed" });
}

try {
  const response = await request("https://www.dongo.so/help?smoke=1");
  const ok = response.status === 308 && response.headers.get("location") === `${PRODUCTION_ORIGIN}/help?smoke=1`;
  checks.push({ name: "www canonical redirect", ok, detail: ok ? "HTTP 308 preserving path and query" : `HTTP ${response.status}` });
} catch (error) {
  checks.push({ name: "www canonical redirect", ok: false, detail: error instanceof Error ? error.name : "request failed" });
}

if (projectRef) {
  const resource = `${PRODUCTION_ORIGIN}/p/${projectRef}/mcp`;
  const metadataUrl = `${PRODUCTION_ORIGIN}/.well-known/oauth-protected-resource/p/${projectRef}/mcp`;
  try {
    const response = await request(metadataUrl);
    const metadata = await response.json();
    const ok = response.status === 200
      && metadata.resource === resource
      && metadata.authorization_servers?.length === 1
      && metadata.authorization_servers[0] === `${PRODUCTION_ORIGIN}/api/auth`
      && !JSON.stringify(metadata).includes(DEVELOPMENT_ORIGIN);
    checks.push({ name: "protected resource metadata", ok, detail: ok ? "exact production resource" : "metadata mismatch" });
  } catch (error) {
    checks.push({ name: "protected resource metadata", ok: false, detail: error instanceof Error ? error.name : "request failed" });
  }
  checks.push(await statusCheck("production MCP requires auth", resource, 401));
}

for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
const failures = checks.filter((check) => !check.ok);
console.log(`${checks.length - failures.length}/${checks.length} production smoke checks passed.`);
if (failures.length > 0) process.exitCode = 1;
