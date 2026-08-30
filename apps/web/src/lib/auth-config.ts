const DEVELOPMENT_CONVEX_SITE_URL = "https://wandering-camel-662.convex.site";

function configuredUrl(value: string | undefined, fallback: string): string {
  const candidate = value?.trim() || fallback;
  const url = new URL(candidate);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) {
    throw new Error("Dongo authentication URLs must use HTTPS outside localhost.");
  }
  return url.toString().replace(/\/$/, "");
}

export const convexSiteUrl = configuredUrl(
  import.meta.env.VITE_CONVEX_SITE_URL,
  DEVELOPMENT_CONVEX_SITE_URL,
);

export const convexDeploymentUrl = configuredUrl(
  import.meta.env.VITE_CONVEX_URL,
  convexSiteUrl.replace(/\.convex\.site$/, ".convex.cloud"),
);

const publicEnvironment = import.meta.env.VITE_DONGO_ENVIRONMENT || "development";
const googleCapabilityFlag = import.meta.env.VITE_DONGO_GOOGLE_AUTH_CONFIGURED;

export const dongoPublicOrigin = configuredUrl(
  import.meta.env.VITE_DONGO_PUBLIC_ORIGIN,
  "https://dev.dongo.so",
);

export const googleAuthConfigured = googleCapabilityFlag === "true" ||
  (googleCapabilityFlag === undefined && publicEnvironment === "development");

export function authWorkerUrl(pathname: string): string {
  const origin = typeof window === "undefined"
    ? dongoPublicOrigin
    : window.location.origin;
  return new URL(`/api/auth${pathname}`, origin).toString();
}
