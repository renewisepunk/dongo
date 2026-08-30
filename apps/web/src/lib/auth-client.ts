import { convexClient, crossDomainClient } from "@convex-dev/better-auth/client/plugins";
import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/solid";

import { convexSiteUrl, googleAuthConfigured } from "./auth-config";

export const authClient = createAuthClient({
  baseURL: convexSiteUrl,
  plugins: [convexClient(), crossDomainClient({ storagePrefix: "dongo-human" }), emailOTPClient()],
});

export async function humanSession() {
  const result = await authClient.getSession();
  return result.data ?? null;
}

export async function consumeCrossDomainOneTimeToken(): Promise<void> {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("ott");
  if (!token) return;
  url.searchParams.delete("ott");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  const verified = await authClient.crossDomain.oneTimeToken.verify({ token });
  const session = verified.data?.session;
  if (verified.error || !session) throw verified.error ?? { code: "INVALID_ONE_TIME_TOKEN" };
  const restored = await authClient.getSession({
    fetchOptions: { headers: { authorization: `Bearer ${session.token}` } },
  });
  if (restored.error || !restored.data) throw restored.error ?? { code: "SESSION_RESTORE_FAILED" };
  authClient.updateSession();
}

export async function requestEmailOtp(email: string): Promise<void> {
  const result = await authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" });
  if (result.error) throw result.error;
}

export async function verifyEmailOtp(email: string, otp: string): Promise<void> {
  const result = await authClient.signIn.emailOtp({ email, otp });
  if (result.error) throw result.error;
}

export async function startGoogleSignIn(callbackURL: string): Promise<void> {
  if (!googleAuthConfigured) throw { code: "PROVIDER_NOT_CONFIGURED" };
  const result = await authClient.signIn.social({ provider: "google", callbackURL });
  if (result.error) throw result.error;
}

export async function signOutEverywhere(): Promise<void> {
  const [human] = await Promise.allSettled([
    authClient.signOut(),
    fetch(new URL("/api/auth/sign-out", window.location.origin), {
      method: "POST",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    }),
  ]);
  if (human.status === "rejected" || human.value.error) {
    throw human.status === "rejected" ? human.reason : human.value.error;
  }
}

export async function convexAccessToken(): Promise<string> {
  const result = await authClient.convex.token({ fetchOptions: { throw: false } });
  if (result.error || !result.data?.token) throw result.error ?? { code: "AUTHENTICATION_REQUIRED" };
  return result.data.token;
}
