import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";
import { modules } from "../test.setup";

describe("human identity bootstrap", () => {
  it("uses the verified email when a passwordless user has no display name", async () => {
    const identity = {
      tokenIdentifier: "https://human.example.test|email-otp-user",
      subject: "email-otp-user",
      issuer: "https://human.example.test",
      email: "dongo-user@example.test",
      name: "",
    };
    const root = convexTest(schema, modules);
    const human = root.withIdentity(identity);

    await expect(
      human.mutation(api.domains.identity.index.bootstrapCurrentUser, {}),
    ).resolves.toMatchObject({ created: true });

    const profile = await root.run(async (ctx) =>
      ctx.db
        .query("humanProfiles")
        .withIndex("by_auth_subject", (query) =>
          query.eq("authSubject", identity.tokenIdentifier),
        )
        .unique(),
    );
    expect(profile).toMatchObject({
      email: identity.email,
      name: identity.email,
    });
    const current = await human.query(api.domains.identity.index.current, {});
    expect(current.profile).toEqual({
      _id: profile!._id,
      email: identity.email,
      name: identity.email,
      avatarUrl: undefined,
      createdAt: profile!.createdAt,
      updatedAt: profile!.updatedAt,
    });
    expect(current.profile).not.toHaveProperty("authSubject");
  });
});
