export const AUTH_EMAIL_KEY = "dongo:auth-email";
export const LAST_APP_ROUTE_KEY = "dongo:last-app-route";

const AUTHORIZATION_ROUTES = ["/device", "/oauth/project", "/oauth/consent"] as const;

export function safeReturnTo(value: string | null | undefined): string | undefined {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return undefined;
  let url: URL;
  try {
    url = new URL(value, "https://dongo.invalid");
  } catch {
    return undefined;
  }
  if (url.origin !== "https://dongo.invalid" || url.username || url.password) return undefined;
  const allowed =
    AUTHORIZATION_ROUTES.some((route) => url.pathname === route) ||
    url.pathname === "/onboarding" ||
    url.pathname === "/connect" ||
    url.pathname.startsWith("/app/");
  return allowed ? `${url.pathname}${url.search}${url.hash}` : undefined;
}

export function returnToFromSearch(search: string): string | undefined {
  const parameters = new URLSearchParams(search);
  const explicit = safeReturnTo(parameters.get("returnTo"));
  if (explicit) return explicit;
  if (parameters.has("sig") && parameters.has("ba_param")) {
    return safeReturnTo(`/oauth/project?${parameters.toString()}`);
  }
  return undefined;
}

export function isAuthorizationReturnTo(value: string | undefined): boolean {
  if (!value) return false;
  const pathname = new URL(value, "https://dongo.invalid").pathname;
  return AUTHORIZATION_ROUTES.some((route) => pathname === route);
}

export function loginHref(returnTo?: string): string {
  const safe = safeReturnTo(returnTo);
  return safe ? `/login?returnTo=${encodeURIComponent(safe)}` : "/login";
}

export function codeHref(returnTo?: string): string {
  const safe = safeReturnTo(returnTo);
  return safe ? `/auth/code?returnTo=${encodeURIComponent(safe)}` : "/auth/code";
}

export function callbackHref(returnTo?: string): string {
  const safe = safeReturnTo(returnTo);
  return safe ? `/auth/callback?returnTo=${encodeURIComponent(safe)}` : "/auth/callback";
}

export function destinationAfterSignIn(returnTo?: string, lastAppRoute?: string | null): string {
  return safeReturnTo(returnTo) || safeReturnTo(lastAppRoute) || "/onboarding";
}

export function normalizeEmail(value: string): string | undefined {
  const normalized = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : undefined;
}

export function normalizeOtp(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

export function normalizeUserCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

export function formatUserCode(value: string): string {
  const code = normalizeUserCode(value);
  return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

export function projectIdentifierPrefix(value: string): string {
  const lettersAndNumbers = value.normalize("NFKD").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const prefix = lettersAndNumbers.slice(0, 8);
  if (/^[A-Z][A-Z0-9]{1,7}$/.test(prefix)) return prefix;
  if (/^[A-Z]$/.test(prefix)) return `${prefix}1`;
  return "PRJ";
}

export function personalOrganizationSlug(input: { name?: string; email?: string; userId: string }): string {
  const source = input.name?.trim() || input.email?.split("@")[0] || "workspace";
  const base = source
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "workspace";
  const suffix = input.userId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(-10) || "personal";
  return `${base}-${suffix}`.slice(0, 80).replace(/-+$/g, "");
}

export function signedOAuthQuery(search: string): string | undefined {
  const parameters = new URLSearchParams(search);
  if (!parameters.has("sig")) return undefined;
  const signedNames = new Set(parameters.getAll("ba_param"));
  if (signedNames.size === 0) return undefined;
  const result = new URLSearchParams();
  for (const [key, value] of parameters.entries()) {
    if (key === "sig" || key === "ba_param" || signedNames.has(key)) result.append(key, value);
  }
  return result.toString();
}

export function safeAuthMessage(error: unknown, fallback: string): string {
  const candidate = error as { code?: unknown; status?: unknown } | undefined;
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  const status = typeof candidate?.status === "number" ? candidate.status : 0;
  if (status === 429 || code.includes("RATE_LIMIT")) return "Too many attempts. Wait a moment, then try again.";
  if (code === "INVALID_OTP") return "That code is not correct. Check the email and try again.";
  if (code === "OTP_EXPIRED") return "That code has expired. Request a new code.";
  if (code === "TOO_MANY_ATTEMPTS") return "Too many incorrect codes. Request a new code before trying again.";
  if (status >= 500) return "Authentication is temporarily unavailable. Try again shortly.";
  return fallback;
}
