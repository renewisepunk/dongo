import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
} from "@modelcontextprotocol/server";
import type { DongoInstallationPrincipal } from "./types.js";

const INTERNAL_PRINCIPAL_KEY = "dongo.internal.principal";
const INTERNAL_REQUEST_ID_KEY = "dongo.internal.requestId";

const REQUIRED_CLAIMS = [
  "issuer",
  "grantId",
  "installationId",
  "installationActorId",
  "organizationId",
  "projectId",
  "projectRef",
] as const;

export interface DongoAuthValidationOptions {
  readonly expectedIssuer: string;
  readonly expectedResource: URL;
  readonly projectRef: string;
}

function invalidToken(): never {
  throw new OAuthError(
    OAuthErrorCode.InvalidToken,
    "The access token is not valid for this Dongo resource",
  );
}

function canonicalResource(value: URL): string {
  if (value.hash !== "" || value.search !== "") {
    invalidToken();
  }
  return value.href;
}

function readRequiredString(
  extra: Record<string, unknown>,
  key: (typeof REQUIRED_CLAIMS)[number],
): string {
  const value = extra[key];
  if (typeof value !== "string" || value.length === 0) {
    invalidToken();
  }
  return value;
}

/**
 * Rechecks the authorization-provider result at the resource boundary. The
 * injected verifier remains responsible for signature/introspection, expiry,
 * grant revocation, and client state; this function pins the issuer, exact
 * resource, and project-derived installation identity used downstream.
 */
export function validateDongoAuthInfo(
  authInfo: AuthInfo,
  options: DongoAuthValidationOptions,
): DongoInstallationPrincipal {
  if (
    authInfo.resource === undefined ||
    canonicalResource(authInfo.resource) !==
      canonicalResource(options.expectedResource)
  ) {
    invalidToken();
  }

  if (
    typeof authInfo.clientId !== "string" ||
    authInfo.clientId.length === 0 ||
    Array.isArray(authInfo.scopes) === false
  ) {
    invalidToken();
  }

  const extra = authInfo.extra;
  if (extra === undefined) {
    invalidToken();
  }
  for (const claim of REQUIRED_CLAIMS) {
    readRequiredString(extra, claim);
  }

  if (
    readRequiredString(extra, "issuer") !== options.expectedIssuer ||
    readRequiredString(extra, "projectRef") !== options.projectRef
  ) {
    invalidToken();
  }

  return Object.freeze({
    clientId: authInfo.clientId,
    grantId: readRequiredString(extra, "grantId"),
    installationId: readRequiredString(extra, "installationId"),
    installationActorId: readRequiredString(extra, "installationActorId"),
    organizationId: readRequiredString(extra, "organizationId"),
    projectId: readRequiredString(extra, "projectId"),
    projectRef: readRequiredString(extra, "projectRef"),
    issuer: readRequiredString(extra, "issuer"),
    resource: canonicalResource(authInfo.resource),
    scopes: Object.freeze([...authInfo.scopes]),
  });
}

/** Adds server-owned request context without mutating verifier-owned data. */
export function attachDongoRequestContext(
  authInfo: AuthInfo,
  principal: DongoInstallationPrincipal,
  requestId: string,
): AuthInfo {
  return {
    ...authInfo,
    scopes: [...authInfo.scopes],
    extra: {
      ...authInfo.extra,
      [INTERNAL_PRINCIPAL_KEY]: principal,
      [INTERNAL_REQUEST_ID_KEY]: requestId,
    },
  };
}

export function getDongoRequestContext(authInfo: AuthInfo | undefined): {
  principal: DongoInstallationPrincipal;
  requestId: string;
} {
  const principal = authInfo?.extra?.[INTERNAL_PRINCIPAL_KEY];
  const requestId = authInfo?.extra?.[INTERNAL_REQUEST_ID_KEY];
  if (
    principal === null ||
    typeof principal !== "object" ||
    typeof requestId !== "string" ||
    requestId.length === 0
  ) {
    throw new Error("Validated Dongo request context is missing");
  }

  return {
    principal: principal as DongoInstallationPrincipal,
    requestId,
  };
}

export function hasRequiredScopes(
  scopes: readonly string[],
  requiredScopes: readonly string[],
): boolean {
  const available = new Set(scopes);
  return requiredScopes.every((scope) => available.has(scope));
}
