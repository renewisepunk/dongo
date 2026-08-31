const DEVELOPMENT_ORIGIN = "https://dev.dongo.so";
const PRODUCTION_ORIGIN = "https://dongo.so";
const PRODUCTION_WWW_ORIGIN = "https://www.dongo.so";

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`--${name} requires a value`);
  }
  return value;
}

const developmentProjectRef =
  option("development-project-ref") ?? option("project-ref") ?? process.env.DONGO_PROJECT_REF;
const productionProjectRef =
  option("production-project-ref") ?? process.env.DONGO_PRODUCTION_PROJECT_REF;
if (!developmentProjectRef || !/^[a-z0-9][a-z0-9-]{2,199}$/.test(developmentProjectRef)) {
  console.error("Usage: npm run smoke:boundaries -- --development-project-ref <dev-ref> [--production-project-ref <prod-ref>]");
  process.exit(2);
}
if (productionProjectRef && !/^[a-z0-9][a-z0-9-]{2,199}$/.test(productionProjectRef)) {
  console.error("--production-project-ref must be a valid public project reference");
  process.exit(2);
}

const checks = [];

async function fetchWithTimeout(url, init = {}) {
  return fetch(url, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
}

async function statusCheck(name, url, expectedStatus) {
  try {
    const response = await fetchWithTimeout(url);
    return {
      name,
      ok: response.status === expectedStatus,
      detail: `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      detail: error instanceof Error ? error.name : "request failed",
    };
  }
}

checks.push(
  ...(await Promise.all([
    statusCheck("development web", `${DEVELOPMENT_ORIGIN}/`, 200),
    statusCheck("development auth", `${DEVELOPMENT_ORIGIN}/api/auth/healthz`, 200),
    statusCheck("development agent API", `${DEVELOPMENT_ORIGIN}/api/agent/v1/healthz`, 200),
    statusCheck("development MCP requires auth", `${DEVELOPMENT_ORIGIN}/p/${developmentProjectRef}/mcp`, 401),
    statusCheck("production web", `${PRODUCTION_ORIGIN}/`, 200),
    statusCheck("production auth", `${PRODUCTION_ORIGIN}/api/auth/healthz`, 200),
    statusCheck("production agent API", `${PRODUCTION_ORIGIN}/api/agent/v1/healthz`, 200),
    statusCheck("production notifications", `${PRODUCTION_ORIGIN}/api/notifications/healthz`, 200),
    ...(productionProjectRef
      ? [statusCheck("production MCP requires auth", `${PRODUCTION_ORIGIN}/p/${productionProjectRef}/mcp`, 401)]
      : []),
  ])),
);

try {
  const response = await fetchWithTimeout(`${PRODUCTION_WWW_ORIGIN}/`);
  const location = response.headers.get("location");
  const ok =
    [301, 302, 307, 308].includes(response.status) &&
    location === `${PRODUCTION_ORIGIN}/`;
  checks.push({
    name: "production www redirect",
    ok,
    detail: ok ? `HTTP ${response.status} to production apex` : `HTTP ${response.status}`,
  });
} catch (error) {
  checks.push({
    name: "production www redirect",
    ok: false,
    detail: error instanceof Error ? error.name : "request failed",
  });
}

for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
}

const failures = checks.filter((check) => !check.ok);
console.log(`${checks.length - failures.length}/${checks.length} live boundary checks passed.`);
if (failures.length > 0) process.exitCode = 1;
