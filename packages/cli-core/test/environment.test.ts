import assert from "node:assert/strict";
import test from "node:test";

import { CliCoreError, resolveEnvironment } from "../src/index.ts";

test("fixed and localhost environments resolve one issuer and API audience", () => {
  const production = resolveEnvironment();
  assert.equal(production.environment, "production");
  assert.equal(production.productOrigin, "https://dongo.so");
  assert.equal(production.issuer, "https://dongo.so/api/auth");
  assert.equal(production.apiResource, "https://dongo.so/api/agent/v1");

  const development = resolveEnvironment({ environment: "development" });
  assert.equal(development.productOrigin, "https://dev.dongo.so");
  assert.equal(development.issuer, "https://dev.dongo.so/api/auth");
  assert.equal(development.apiResource, "https://dev.dongo.so/api/agent/v1");

  const local = resolveEnvironment({ origin: "http://[::1]:8787" });
  assert.equal(local.environment, "custom");
  assert.equal(local.productOrigin, "http://[::1]:8787");
});

test("custom origins reject credentials, paths, and insecure remote HTTP", () => {
  for (const origin of ["https://user:secret@example.com", "https://example.com/path", "http://example.com"]) {
    assert.throws(
      () => resolveEnvironment({ origin }),
      (error: unknown) => error instanceof CliCoreError && error.code === "validation",
    );
  }
});
