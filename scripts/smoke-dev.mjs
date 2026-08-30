const DEVELOPMENT_ORIGIN = "https://dev.dongo.so";

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`--${name} requires a value`);
  }
  return value;
}

const projectRef = option("project-ref") ?? process.env.DONGO_PROJECT_REF;
if (!projectRef || !/^[a-z0-9][a-z0-9-]{2,199}$/.test(projectRef)) {
  console.error("Usage: npm run smoke:dev -- --project-ref <public-project-ref>");
  process.exit(2);
}

const resource = `${DEVELOPMENT_ORIGIN}/p/${projectRef}/mcp`;
const metadataUrl = `${DEVELOPMENT_ORIGIN}/.well-known/oauth-protected-resource/p/${projectRef}/mcp`;
const checks = [];

async function fetchWithTimeout(url, init = {}) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(10_000), redirect: "error" });
}

async function statusCheck(name, pathname, expectedStatus = 200) {
  try {
    const response = await fetchWithTimeout(`${DEVELOPMENT_ORIGIN}${pathname}`);
    return { name, ok: response.status === expectedStatus, detail: `HTTP ${response.status}` };
  } catch (error) {
    return {
      name,
      ok: false,
      detail: error instanceof Error ? error.name : "request failed",
    };
  }
}

checks.push(
  ...(await Promise.all(
    [
      ["web", "/"],
      ["auth health", "/api/auth/healthz"],
      ["auth readiness", "/api/auth/readyz"],
      ["agent API health", "/api/agent/v1/healthz"],
      ["agent API readiness", "/api/agent/v1/readyz"],
      ["MCP health", "/api/mcp/healthz"],
      ["MCP readiness", "/api/mcp/readyz"],
      ["files health", "/api/files/healthz"],
      ["files readiness", "/api/files/readyz"],
      ["notifications health", "/api/notifications/healthz"],
      ["notifications readiness", "/api/notifications/readyz"],
    ].map(([name, pathname]) => statusCheck(name, pathname)),
  )),
);

try {
  const response = await fetchWithTimeout(
    `${DEVELOPMENT_ORIGIN}/.well-known/oauth-authorization-server/api/auth`,
  );
  const metadata = await response.json();
  const ok =
    response.status === 200 &&
    metadata.issuer === `${DEVELOPMENT_ORIGIN}/api/auth` &&
    metadata.device_authorization_endpoint === `${DEVELOPMENT_ORIGIN}/api/auth/device/code` &&
    metadata.token_endpoint === `${DEVELOPMENT_ORIGIN}/api/auth/oauth2/token` &&
    metadata.revocation_endpoint === `${DEVELOPMENT_ORIGIN}/api/auth/oauth2/revoke` &&
    metadata.code_challenge_methods_supported?.includes("S256");
  checks.push({ name: "authorization-server metadata", ok, detail: ok ? "exact issuer and endpoints" : "metadata mismatch" });
} catch (error) {
  checks.push({
    name: "authorization-server metadata",
    ok: false,
    detail: error instanceof Error ? error.name : "request failed",
  });
}

try {
  const response = await fetchWithTimeout(metadataUrl);
  const metadata = await response.json();
  const ok =
    response.status === 200 &&
    metadata.resource === resource &&
    Array.isArray(metadata.authorization_servers) &&
    metadata.authorization_servers.length === 1 &&
    metadata.authorization_servers[0] === `${DEVELOPMENT_ORIGIN}/api/auth` &&
    ["dongo:work:read", "dongo:work:write", "dongo:attachments:read"].every((scope) =>
      metadata.scopes_supported?.includes(scope),
    );
  checks.push({ name: "protected-resource metadata", ok, detail: ok ? "exact project resource" : "metadata mismatch" });
} catch (error) {
  checks.push({
    name: "protected-resource metadata",
    ok: false,
    detail: error instanceof Error ? error.name : "request failed",
  });
}

try {
  const response = await fetchWithTimeout(resource, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  });
  const challenge = response.headers.get("www-authenticate") ?? "";
  const ok =
    response.status === 401 &&
    challenge.includes('error="invalid_token"') &&
    challenge.includes(`resource_metadata="${metadataUrl}"`);
  checks.push({ name: "unauthenticated MCP challenge", ok, detail: ok ? "RFC 9728 discovery challenge" : `HTTP ${response.status}` });
} catch (error) {
  checks.push({
    name: "unauthenticated MCP challenge",
    ok: false,
    detail: error instanceof Error ? error.name : "request failed",
  });
}

for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
}

const failures = checks.filter((check) => !check.ok);
console.log(`${checks.length - failures.length}/${checks.length} development smoke checks passed.`);
if (failures.length > 0) process.exitCode = 1;
