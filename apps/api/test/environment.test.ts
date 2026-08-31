import { describe, expect, it } from "vitest";
import { validateApiBoundary } from "../src/index.ts";

const boundary = (origin: string) => ({
  resource: `${origin}/api/agent/v1`,
  allowedHostnames: new URL(origin).hostname,
  issuer: `${origin}/api/auth`,
  introspectionUrl: `${origin}/api/auth/oauth2/introspect`,
});

describe("API environment boundary", () => {
  it.each(["https://dev.dongo.so", "https://dongo.so"])(
    "accepts the strictly pinned %s deployment",
    (origin) => {
      const result = validateApiBoundary(boundary(origin));
      expect(result.resource.toString()).toBe(`${origin}/api/agent/v1`);
      expect(result.issuer).toBe(`${origin}/api/auth`);
      expect(result.introspectionUrl.toString()).toBe(
        `${origin}/api/auth/oauth2/introspect`,
      );
    },
  );

  it.each([
    { ...boundary("https://dongo.so"), resource: "http://dongo.so/api/agent/v1" },
    { ...boundary("https://dongo.so"), resource: "https://evil.example/api/agent/v1" },
    { ...boundary("https://dongo.so"), resource: "https://dongo.so/api/agent/v1/extra" },
    { ...boundary("https://dongo.so"), issuer: "https://dev.dongo.so/api/auth" },
    {
      ...boundary("https://dongo.so"),
      introspectionUrl: "https://dev.dongo.so/api/auth/oauth2/introspect",
    },
    {
      ...boundary("https://dongo.so"),
      introspectionUrl: "https://dongo.so/api/auth/oauth2/token",
    },
  ])("rejects a boundary mismatch %#", (input) => {
    expect(() => validateApiBoundary(input)).toThrow(/configured API boundary/);
  });
});
