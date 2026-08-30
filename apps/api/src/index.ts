import { ApiConvexOperationExecutor } from "./convex-executor.ts";
import {
  createDongoApiGateway,
  createUnavailableDongoApiWorker,
  type DongoApiWorker,
} from "./gateway.ts";
import { ApiIntrospectionTokenVerifier } from "./introspection.ts";
import type { ApiRateLimiter } from "./types.ts";

interface DongoApiEnv extends Env {
  readonly BETTER_AUTH_RESOURCE_CLIENT_SECRET?: string;
  readonly DONGO_INTERNAL_GATEWAY_SECRET?: string;
  readonly DONGO_INTERNAL_GATEWAY_KEY_ID?: string;
}

const workerCache = new WeakMap<object, DongoApiWorker>();

function requiredBinding(
  env: DongoApiEnv,
  name:
    | "ALLOWED_HOSTNAMES"
    | "API_RESOURCE"
    | "AUTHORIZATION_SERVER_ISSUER"
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

function commaSeparated(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

class CloudflareApiRateLimiter implements ApiRateLimiter {
  constructor(private readonly binding: RateLimit) {}

  async check(input: { readonly projectRef: string; readonly clientId: string }) {
    const result = await this.binding.limit({
      key: `${input.projectRef}:${input.clientId}`,
    });
    return result.success
      ? { allowed: true as const }
      : { allowed: false as const, retryAfterSeconds: 60 };
  }
}

function configuredWorker(env: DongoApiEnv): DongoApiWorker {
  const resource = new URL(requiredBinding(env, "API_RESOURCE"));
  const expectedResource = "https://dev.dongo.so/api/agent/v1";
  if (resource.toString() !== expectedResource) {
    throw new Error("API_RESOURCE does not match the pinned development audience");
  }
  const rateLimitBinding = env.API_RATE_LIMITER;
  if (rateLimitBinding === undefined) {
    throw new Error("Required Worker binding API_RATE_LIMITER is absent");
  }
  const issuer = requiredBinding(env, "AUTHORIZATION_SERVER_ISSUER");
  return createDongoApiGateway({
    resource,
    allowedHostnames: commaSeparated(requiredBinding(env, "ALLOWED_HOSTNAMES")),
    tokenVerifier: new ApiIntrospectionTokenVerifier({
      introspectionUrl: new URL(
        requiredBinding(env, "BETTER_AUTH_INTROSPECTION_URL"),
      ),
      issuer,
      resource,
      resourceClientId: requiredBinding(env, "BETTER_AUTH_RESOURCE_CLIENT_ID"),
      resourceClientSecret: requiredBinding(
        env,
        "BETTER_AUTH_RESOURCE_CLIENT_SECRET",
      ),
    }),
    operationExecutor: new ApiConvexOperationExecutor({
      convexSiteUrl: new URL(requiredBinding(env, "CONVEX_SITE_URL")),
      resource,
      secret: requiredBinding(env, "DONGO_INTERNAL_GATEWAY_SECRET"),
      keyId: env.DONGO_INTERNAL_GATEWAY_KEY_ID ?? "v1",
    }),
    rateLimiter: new CloudflareApiRateLimiter(rateLimitBinding),
  });
}

export function createDongoApiWorkerFromEnv(env: DongoApiEnv): DongoApiWorker {
  try {
    return configuredWorker(env);
  } catch {
    return createUnavailableDongoApiWorker(env.API_RESOURCE);
  }
}

export default {
  async fetch(request: Request, env: DongoApiEnv): Promise<Response> {
    let worker = workerCache.get(env);
    if (worker === undefined) {
      worker = createDongoApiWorkerFromEnv(env);
      workerCache.set(env, worker);
    }
    return worker.fetch(request);
  },
} satisfies ExportedHandler<DongoApiEnv>;

export { ApiConvexOperationExecutor } from "./convex-executor.ts";
export {
  createDongoApiGateway,
  createUnavailableDongoApiWorker,
} from "./gateway.ts";
export { ApiIntrospectionTokenVerifier } from "./introspection.ts";
export type * from "./types.ts";
