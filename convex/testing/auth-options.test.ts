import { describe, expect, it } from "vitest";
import {
  accountLinkingPolicy,
  developmentSignupAllowed,
  developmentSignupAllowlist,
} from "../auth";

describe("human account linking policy", () => {
  it("links only matching verified OTP and social identities", () => {
    expect(accountLinkingPolicy).toEqual({
      enabled: true,
      disableImplicitLinking: false,
      requireLocalEmailVerified: true,
      trustedProviders: [],
      allowDifferentEmails: false,
      updateUserInfoOnLink: false,
    });
  });
});

describe("development signup allowlist", () => {
  it("allows only normalized configured emails on dev.dongo.so", () => {
    expect(developmentSignupAllowed(
      " RENE@WISEPUNK.COM ",
      "https://dev.dongo.so",
      undefined,
    )).toBe(true);
    expect(developmentSignupAllowed(
      "someone@example.test",
      "https://dev.dongo.so",
      undefined,
    )).toBe(false);
    expect(developmentSignupAllowed(
      "pilot@example.test",
      "https://dev.dongo.so",
      "rene@wisepunk.com, PILOT@example.test",
    )).toBe(true);
  });

  it("does not apply the development allowlist to production", () => {
    expect(developmentSignupAllowed(
      "someone@example.test",
      "https://dongo.so",
      "rene@wisepunk.com",
    )).toBe(true);
  });

  it("fails closed when configured development entries are invalid", () => {
    expect(() => developmentSignupAllowlist("not-an-email")).toThrow(
      "DONGO_DEV_SIGNUP_ALLOWLIST contains an invalid email",
    );
  });
});
