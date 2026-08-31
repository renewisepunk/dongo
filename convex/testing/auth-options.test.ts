import { describe, expect, it } from "vitest";
import { accountLinkingPolicy } from "../auth";

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
