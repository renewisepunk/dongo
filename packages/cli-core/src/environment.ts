import { CliCoreError } from "./errors.ts";

export type DongoEnvironment = "development" | "production" | "custom";

export interface EnvironmentConfig {
  environment: DongoEnvironment;
  productOrigin: string;
  issuer: string;
  apiBaseUrl: string;
  apiResource: string;
  deviceAuthorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint: string;
  cliClientId: string;
}

const ORIGINS = {
  development: "https://dev.dongo.so",
  production: "https://dongo.so",
} as const;

function validateOrigin(input: string): string {
  const origin = new URL(input);
  if (
    origin.protocol !== "https:" &&
    !(origin.protocol === "http:" && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(origin.hostname))
  ) {
    throw new CliCoreError({ code: "validation", message: "dongo origins must use HTTPS except for localhost." });
  }
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") {
    throw new CliCoreError({ code: "validation", message: "The dongo origin must not include credentials, a path, or a query." });
  }
  return origin.origin;
}

export function resolveEnvironment(options: {
  environment?: DongoEnvironment;
  origin?: string;
  clientId?: string;
} = {}): EnvironmentConfig {
  const environment = options.origin ? "custom" : (options.environment ?? "production");
  const rawOrigin = options.origin ?? (environment === "custom" ? undefined : ORIGINS[environment]);
  if (!rawOrigin) throw new CliCoreError({ code: "validation", message: "A custom environment requires --origin." });
  const productOrigin = validateOrigin(rawOrigin);
  const authBase = `${productOrigin}/api/auth`;
  const apiResource = `${productOrigin}/api/agent/v1`;
  return {
    environment,
    productOrigin,
    issuer: authBase,
    apiBaseUrl: apiResource,
    apiResource,
    deviceAuthorizationEndpoint: `${authBase}/device/code`,
    tokenEndpoint: `${authBase}/oauth2/token`,
    revocationEndpoint: `${authBase}/oauth2/revoke`,
    cliClientId: options.clientId ?? "dongo-cli",
  };
}
