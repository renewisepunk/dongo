import { describe, expect, it } from "vitest";

import {
  callbackHref,
  codeHref,
  destinationAfterSignIn,
  formatUserCode,
  isAuthorizationReturnTo,
  loginHref,
  normalizeEmail,
  normalizeOtp,
  personalOrganizationSlug,
  projectIdentifierPrefix,
  returnToFromSearch,
  safeAuthMessage,
  safeReturnTo,
  signedOAuthQuery,
} from "./auth-flow";

describe("authentication route state", () => {
  it("preserves one same-origin authorization return path", () => {
    const returnTo = "/device?user_code=ABCD-EFGH";
    expect(loginHref(returnTo)).toBe(`/login?returnTo=${encodeURIComponent(returnTo)}`);
    expect(codeHref(returnTo)).toBe(`/auth/code?returnTo=${encodeURIComponent(returnTo)}`);
    expect(callbackHref(returnTo)).toBe(`/auth/callback?returnTo=${encodeURIComponent(returnTo)}`);
    expect(isAuthorizationReturnTo(returnTo)).toBe(true);
  });

  it("rejects external, protocol-relative, and recursive auth redirects", () => {
    expect(safeReturnTo("https://evil.example/device")).toBeUndefined();
    expect(safeReturnTo("//evil.example/device")).toBeUndefined();
    expect(safeReturnTo("/login?returnTo=/login")).toBeUndefined();
    expect(destinationAfterSignIn(undefined, "https://evil.example/")).toBe("/onboarding");
  });

  it("turns a signed OAuth login query into the exact project continuation", () => {
    const search = "?client_id=codex&state=s1&sig=signed&ba_param=client_id&ba_param=state";
    expect(returnToFromSearch(search)).toBe(`/oauth/project?${search.slice(1)}`);
  });

  it("forwards only parameters covered by the OAuth signed-query list", () => {
    const search = "?client_id=codex&state=s1&resource=https%3A%2F%2Fdev.dongo.so%2Fp%2Fp1%2Fmcp&injected=drop&sig=signed&ba_param=client_id&ba_param=state&ba_param=resource";
    const forwarded = new URLSearchParams(signedOAuthQuery(search));
    expect(forwarded.get("client_id")).toBe("codex");
    expect(forwarded.get("resource")).toBe("https://dev.dongo.so/p/p1/mcp");
    expect(forwarded.has("injected")).toBe(false);
    expect(forwarded.get("sig")).toBe("signed");
  });
});

describe("authentication input and errors", () => {
  it("normalizes email, OTP, and the terminal comparison code", () => {
    expect(normalizeEmail("  Rene@Example.COM ")).toBe("rene@example.com");
    expect(normalizeEmail("not-an-email")).toBeUndefined();
    expect(normalizeOtp("a4-k2 qp!")).toBe("A4K2QP");
    expect(formatUserCode("dv9kpqlh")).toBe("DV9K-PQLH");
  });

  it("derives deterministic backend-safe first-project identifiers", () => {
    expect(projectIdentifierPrefix("dongo web")).toBe("DONGOWEB");
    expect(projectIdentifierPrefix("X")).toBe("X1");
    expect(projectIdentifierPrefix("🚀")).toBe("PRJ");
    expect(personalOrganizationSlug({ name: "René Bauer", userId: "user_ABC123" })).toBe("rene-bauer-userabc123");
  });

  it("maps backend failures to bounded human messages", () => {
    expect(safeAuthMessage({ code: "INVALID_OTP", message: "secret response" }, "fallback")).toMatch(/not correct/);
    expect(safeAuthMessage({ status: 429 }, "fallback")).toMatch(/Too many/);
    expect(safeAuthMessage(new Error("secret response"), "fallback")).toBe("fallback");
  });
});
