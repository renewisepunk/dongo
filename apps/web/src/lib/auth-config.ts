function configuredUrl(value: string | undefined, variable: string): string {
  const candidate = value?.trim();
  if (!candidate) throw new Error(`${variable} is required.`);
  const url = new URL(candidate);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) {
    throw new Error("dongo authentication URLs must use HTTPS outside localhost.");
  }
  return url.toString().replace(/\/$/, "");
}

export const convexSiteUrl = configuredUrl(
  import.meta.env.VITE_CONVEX_SITE_URL,
  "VITE_CONVEX_SITE_URL",
);

export const convexDeploymentUrl = configuredUrl(
  import.meta.env.VITE_CONVEX_URL,
  "VITE_CONVEX_URL",
);

const publicEnvironment = import.meta.env.VITE_DONGO_ENVIRONMENT;
if (publicEnvironment !== "development" && publicEnvironment !== "production") {
  throw new Error("VITE_DONGO_ENVIRONMENT must be development or production.");
}
const googleCapabilityFlag = import.meta.env.VITE_DONGO_GOOGLE_AUTH_CONFIGURED;

export const dongoPublicOrigin = configuredUrl(
  import.meta.env.VITE_DONGO_PUBLIC_ORIGIN,
  "VITE_DONGO_PUBLIC_ORIGIN",
);

export const googleAuthConfigured = googleCapabilityFlag === "true" ||
  (googleCapabilityFlag === undefined && publicEnvironment === "development");

export function authWorkerUrl(pathname: string): string {
  const origin = typeof window === "undefined"
    ? dongoPublicOrigin
    : window.location.origin;
  return new URL(`/api/auth${pathname}`, origin).toString();
}
