import { existsSync, readFileSync } from "node:fs";

const failures = [];
const DEVELOPMENT_HOST = "dev.dongo.so";
const PRODUCTION_HOST = "dongo.so";
const DEVELOPMENT_CONVEX = "wandering-camel-662";
const PRODUCTION_CONVEX = "brainy-camel-172";

const workers = [
  ["apps/api/wrangler.jsonc", "dongo-api-dev", "dongo-api-production"],
  ["apps/auth/wrangler.jsonc", "dongo-auth-dev", "dongo-auth-production"],
  ["apps/files/wrangler.jsonc", "dongo-files-dev", "dongo-files-production"],
  ["apps/mcp/wrangler.jsonc", "dongo-mcp", "dongo-mcp-production"],
  ["apps/notifications/wrangler.jsonc", "dongo-notifications-dev", "dongo-notifications-production"],
  ["apps/web/wrangler.jsonc", "dongo-web-dev", "dongo-web-production"],
];

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    failures.push(`${path}: cannot parse configuration (${error instanceof Error ? error.message : "unknown error"})`);
    return undefined;
  }
}

function routePatterns(configuration) {
  return (configuration.routes ?? []).map((route) => route.pattern);
}

function validateRoutes(path, label, configuration, host, allowWww = false) {
  const patterns = routePatterns(configuration);
  if (patterns.length === 0) failures.push(`${path}: ${label} has no routes`);
  for (const pattern of patterns) {
    const valid = pattern === host || pattern.startsWith(`${host}/`) || (allowWww && pattern === `www.${host}`);
    if (!valid) failures.push(`${path}: ${label} route targets ${pattern}`);
  }
}

for (const [path, developmentName, productionName] of workers) {
  if (!existsSync(path)) {
    failures.push(`${path}: Worker config is missing`);
    continue;
  }
  const configuration = readJson(path);
  if (!configuration) continue;
  const production = configuration.env?.production;
  if (configuration.name !== developmentName) failures.push(`${path}: development Worker identity changed`);
  if (production?.name !== productionName) failures.push(`${path}: production Worker identity is missing or changed`);
  validateRoutes(path, "development", configuration, DEVELOPMENT_HOST);
  if (production) validateRoutes(path, "production", production, PRODUCTION_HOST, path === "apps/web/wrangler.jsonc");

  const development = JSON.stringify({ routes: configuration.routes, vars: configuration.vars, services: configuration.services, d1: configuration.d1_databases, r2: configuration.r2_buckets });
  const live = JSON.stringify(production ?? {});
  if (development.includes(`https://${PRODUCTION_HOST}`) || development.includes(PRODUCTION_CONVEX)) {
    failures.push(`${path}: development bindings contain production resources`);
  }
  if (live.includes(`https://${DEVELOPMENT_HOST}`) || live.includes(DEVELOPMENT_CONVEX)) {
    failures.push(`${path}: production bindings contain development resources`);
  }
  if (/CONVEX_(?:SITE_URL|DEPLOYMENT)/u.test(development) && !development.includes(DEVELOPMENT_CONVEX)) {
    failures.push(`${path}: development Convex binding is not ${DEVELOPMENT_CONVEX}`);
  }
  if (/CONVEX_(?:SITE_URL|DEPLOYMENT)/u.test(live) && !live.includes(PRODUCTION_CONVEX)) {
    failures.push(`${path}: production Convex binding is not ${PRODUCTION_CONVEX}`);
  }
}

const auth = readJson("apps/auth/wrangler.jsonc");
if (auth?.env?.production?.d1_databases?.[0]?.database_name !== "dongo-auth") {
  failures.push("apps/auth/wrangler.jsonc: production auth does not bind dongo-auth");
}
const files = readJson("apps/files/wrangler.jsonc");
if (files?.env?.production?.r2_buckets?.[0]?.bucket_name !== "dongo-attachments") {
  failures.push("apps/files/wrangler.jsonc: production files does not bind dongo-attachments");
}
const web = readJson("apps/web/wrangler.jsonc");
if (web?.vars?.VITE_DONGO_GOOGLE_AUTH_CONFIGURED !== "true") {
  failures.push("apps/web/wrangler.jsonc: development Google sign-in is not enabled");
}
if (web?.env?.production?.vars?.VITE_DONGO_GOOGLE_AUTH_CONFIGURED !== "true") {
  failures.push("apps/web/wrangler.jsonc: production Google sign-in is not enabled");
}

const packageJson = readJson("package.json");
if (packageJson?.scripts?.deploy !== "npm run deploy:production") {
  failures.push("package.json: default deploy must run the coherent production release");
}
if (packageJson?.scripts?.["deploy:dev"] !== "node scripts/deploy-dev.mjs") {
  failures.push("package.json: development deploy must use the coherent development-stack runner");
}
if (packageJson?.scripts?.["deploy:production"] !== "node scripts/deploy-production.mjs") {
  failures.push("package.json: production deploy must use the coherent production-stack runner");
}

const devDeploy = readFileSync("scripts/deploy-dev.mjs", "utf8");
const productionDeploy = readFileSync("scripts/deploy-production.mjs", "utf8");
const releaseConvexTarget = readFileSync("scripts/release-convex-target.mjs", "utf8");
const productionWebDeploy = readFileSync("scripts/deploy-production-web.mjs", "utf8");
for (const [path] of workers) {
  if (path !== "apps/web/wrangler.jsonc" && !devDeploy.includes(path)) {
    failures.push(`scripts/deploy-dev.mjs: coherent development deploy omits ${path}`);
  }
  if (path !== "apps/web/wrangler.jsonc" && !productionDeploy.includes(path)) {
    failures.push(`scripts/deploy-production.mjs: coherent production deploy omits ${path}`);
  }
}
if (!devDeploy.includes('"convex", "dev", "--once"')) failures.push("scripts/deploy-dev.mjs: Convex development deploy is missing");
if (!productionDeploy.includes('"convex", "deploy"')) failures.push("scripts/deploy-production.mjs: Convex production deploy is missing");
if (!productionDeploy.includes('"d1", "migrations", "apply"')) failures.push("scripts/deploy-production.mjs: production D1 migration is missing");
if (!devDeploy.includes('requireReleaseConvexTarget({ root, stage: "development" })')) {
  failures.push("scripts/deploy-dev.mjs: exact named Convex target preflight is missing");
}
if (!productionDeploy.includes('requireReleaseConvexTarget({ root, stage: "production" })')) {
  failures.push("scripts/deploy-production.mjs: exact named Convex target preflight is missing");
}
if (!releaseConvexTarget.includes('development: "dev:wandering-camel-662"')) {
  failures.push("scripts/release-convex-target.mjs: named development target changed");
}
if (!releaseConvexTarget.includes('production: "prod:brainy-camel-172"')) {
  failures.push("scripts/release-convex-target.mjs: named production target changed");
}
if (!productionDeploy.includes("scripts/deploy-production-web.mjs")) failures.push("scripts/deploy-production.mjs: production web deploy is missing");
if (!productionWebDeploy.includes('VITE_DONGO_GOOGLE_AUTH_CONFIGURED: "true"')) {
  failures.push("scripts/deploy-production-web.mjs: production Google sign-in is not enabled");
}

if (failures.length > 0) {
  console.error("Environment boundary verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Development and production routes, Workers, Convex deployments, D1, and R2 are isolated across ${workers.length} services.`);
}
