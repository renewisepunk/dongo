import {
  BetterAuthIntrospectionTokenVerifier,
  ConvexHmacOperationExecutor,
  createCanonicalDongoToolCatalog,
  createDongoMcpGateway,
  createUnavailableDongoMcpWorker,
  type DongoLogger,
  type DongoMcpWorker,
  type DongoRateLimiter,
  type DongoReadinessProbe,
  type RateLimitInput,
} from "@dongo/mcp";
import type { OAuthMetadata } from "@modelcontextprotocol/server";

interface DongoWorkerEnv extends Env {
  readonly DONGO_INTERNAL_GATEWAY_KEY_ID?: string;
}

const workerCache = new WeakMap<object, DongoMcpWorker>();

function commaSeparated(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function requiredBinding(
  env: DongoWorkerEnv,
  name:
    | "AUTHORIZATION_SERVER_ISSUER"
    | "AUTHORIZATION_SERVER_METADATA_JSON"
    | "BETTER_AUTH_INTROSPECTION_URL"
    | "BETTER_AUTH_RESOURCE_CLIENT_ID"
    | "BETTER_AUTH_RESOURCE_CLIENT_SECRET"
    | "CONVEX_SITE_URL"
    | "DONGO_INTERNAL_GATEWAY_SECRET",
): string {
  const value = env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Required Worker binding ${name} is absent`);
  }
  return value;
}

function authorizationMetadata(env: DongoWorkerEnv): OAuthMetadata {
  let value: unknown;
  try {
    value = JSON.parse(requiredBinding(env, "AUTHORIZATION_SERVER_METADATA_JSON"));
  } catch {
    throw new Error("AUTHORIZATION_SERVER_METADATA_JSON is invalid");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AUTHORIZATION_SERVER_METADATA_JSON is invalid");
  }
  const metadata = value as OAuthMetadata & Record<string, unknown>;
  const issuer = requiredBinding(env, "AUTHORIZATION_SERVER_ISSUER");
  if (metadata.issuer !== issuer) {
    throw new Error("Authorization metadata issuer does not match its pinned issuer");
  }
  for (const key of [
    "issuer",
    "authorization_endpoint",
    "token_endpoint",
    "registration_endpoint",
    "revocation_endpoint",
    "introspection_endpoint",
    "jwks_uri",
  ]) {
    const endpoint = metadata[key];
    if (endpoint === undefined) {
      continue;
    }
    if (typeof endpoint !== "string") {
      throw new Error(`Authorization metadata ${key} is invalid`);
    }
    const url = new URL(endpoint);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== ""
    ) {
      throw new Error(`Authorization metadata ${key} is not a safe HTTPS URL`);
    }
  }
  for (const key of [
    "authorization_endpoint",
    "token_endpoint",
    "introspection_endpoint",
  ]) {
    if (typeof metadata[key] !== "string") {
      throw new Error(`Authorization metadata is missing ${key}`);
    }
  }
  const hasValues = (key: string, required: readonly string[]): boolean => {
    const values = metadata[key];
    return (
      Array.isArray(values) &&
      required.every((requiredValue) => values.includes(requiredValue))
    );
  };
  if (
    hasValues("response_types_supported", ["code"]) === false ||
    hasValues("grant_types_supported", ["authorization_code", "refresh_token"]) === false ||
    hasValues("code_challenge_methods_supported", ["S256"]) === false ||
    hasValues("scopes_supported", [
      "dongo:work:read",
      "dongo:work:write",
      "dongo:attachments:read",
    ]) === false
  ) {
    throw new Error("Authorization metadata lacks required dongo OAuth capabilities");
  }
  if (
    typeof metadata.registration_endpoint !== "string" &&
    metadata.client_id_metadata_document_supported !== true
  ) {
    throw new Error("Authorization metadata supports neither DCR nor CIMD");
  }
  const configuredIntrospection = requiredBinding(
    env,
    "BETTER_AUTH_INTROSPECTION_URL",
  );
  if (
    metadata.introspection_endpoint !== undefined &&
    metadata.introspection_endpoint !== configuredIntrospection
  ) {
    throw new Error("Pinned introspection endpoint does not match OAuth metadata");
  }
  return metadata;
}

class CloudflareMcpRateLimiter implements DongoRateLimiter {
  constructor(private readonly binding: RateLimit) {}

  async check(input: RateLimitInput) {
    const outcome = await this.binding.limit({
      key: `${input.projectRef}:${input.clientId ?? "unknown"}`,
    });
    return outcome.success
      ? { allowed: true as const }
      : { allowed: false as const, retryAfterSeconds: 60 };
  }
}

const configuredReadiness: DongoReadinessProbe = Object.freeze({
  async isReady() {
    return true;
  },
});

const workerLogger: DongoLogger = Object.freeze({
  info(event: Readonly<Record<string, unknown>>) {
    console.info(JSON.stringify(event));
  },
  error(event: Readonly<Record<string, unknown>>) {
    console.error(JSON.stringify(event));
  },
});

function configuredWorker(env: DongoWorkerEnv): DongoMcpWorker {
  const publicOrigin = new URL(env.PUBLIC_ORIGIN);
  const metadata = authorizationMetadata(env);
  const rateLimitBinding = env.MCP_RATE_LIMITER;
  if (rateLimitBinding === undefined) {
    throw new Error("Required Worker binding MCP_RATE_LIMITER is absent");
  }
  if (env.AUTH_SERVICE === undefined) {
    throw new Error("Required Worker binding AUTH_SERVICE is absent");
  }

  return createDongoMcpGateway({
    publicOrigin,
    authorizationServerMetadata: metadata,
    ...(env.SERVICE_DOCUMENTATION_URL === undefined
      ? {}
      : { serviceDocumentationUrl: new URL(env.SERVICE_DOCUMENTATION_URL) }),
    allowedHostnames: commaSeparated(env.ALLOWED_HOSTNAMES),
    allowedOrigins: commaSeparated(env.ALLOWED_ORIGIN_HOSTNAMES),
    catalog: createCanonicalDongoToolCatalog(),
    tokenVerifier: new BetterAuthIntrospectionTokenVerifier({
      introspectionUrl: new URL(
        requiredBinding(env, "BETTER_AUTH_INTROSPECTION_URL"),
      ),
      issuer: requiredBinding(env, "AUTHORIZATION_SERVER_ISSUER"),
      resourceClientId: requiredBinding(env, "BETTER_AUTH_RESOURCE_CLIENT_ID"),
      resourceClientSecret: requiredBinding(
        env,
        "BETTER_AUTH_RESOURCE_CLIENT_SECRET",
      ),
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        try {
          return await env.AUTH_SERVICE.fetch(new Request(input, init));
        } catch (error) {
          console.error(
            JSON.stringify({
              event: "auth_service_binding_failure",
              errorName: error instanceof Error ? error.name : "unknown",
            }),
          );
          throw error;
        }
      }) as typeof fetch,
    }),
    operationExecutor: new ConvexHmacOperationExecutor({
      convexSiteUrl: new URL(requiredBinding(env, "CONVEX_SITE_URL")),
      secret: requiredBinding(env, "DONGO_INTERNAL_GATEWAY_SECRET"),
      keyId: env.DONGO_INTERNAL_GATEWAY_KEY_ID ?? "v1",
    }),
    rateLimiter: new CloudflareMcpRateLimiter(rateLimitBinding),
    readiness: configuredReadiness,
    logger: workerLogger,
  });
}

function unavailableWorker(env: DongoWorkerEnv): DongoMcpWorker {
  let publicOrigin: URL;
  try {
    publicOrigin = new URL(env.PUBLIC_ORIGIN);
  } catch {
    publicOrigin = new URL("https://invalid.dongo.invalid/");
  }
  const allowedHostnames = commaSeparated(env.ALLOWED_HOSTNAMES);
  return createUnavailableDongoMcpWorker({
    publicOrigin,
    allowedHostnames:
      allowedHostnames.length === 0 ? [publicOrigin.hostname] : allowedHostnames,
    allowedOrigins: commaSeparated(env.ALLOWED_ORIGIN_HOSTNAMES),
  });
}

/** Creates a live gateway only when every required adapter binding validates. */
export function createDongoMcpWorkerFromEnv(env: DongoWorkerEnv): DongoMcpWorker {
  try {
    return configuredWorker(env);
  } catch {
    // Configuration failures are intentionally non-specific and never include
    // secret values. Liveness remains available; readiness and MCP fail closed.
    return unavailableWorker(env);
  }
}

export default {
  async fetch(request: Request, env: DongoWorkerEnv): Promise<Response> {
    let worker = workerCache.get(env);
    if (worker === undefined) {
      worker = createDongoMcpWorkerFromEnv(env);
      workerCache.set(env, worker);
    }
    return worker.fetch(request);
  },
} satisfies ExportedHandler<DongoWorkerEnv>;

export { createDongoMcpGateway } from "@dongo/mcp";
