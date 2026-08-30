import assert from "node:assert/strict";
import test from "node:test";

import { sanitizedChildEnvironment } from "../src/index.ts";

test("browser and credential helper environments do not inherit shell secrets", () => {
  const previousDongoToken = process.env.DONGO_TOKEN;
  const previousAwsSecret = process.env.AWS_SECRET_ACCESS_KEY;
  process.env.DONGO_TOKEN = "dongo-secret";
  process.env.AWS_SECRET_ACCESS_KEY = "cloud-secret";
  try {
    const environment = sanitizedChildEnvironment({ DONGO_BROWSER_URL: "https://dev.dongo.so/device?user_code=ABCD" });
    assert.equal(environment.DONGO_TOKEN, undefined);
    assert.equal(environment.AWS_SECRET_ACCESS_KEY, undefined);
    assert.equal(environment.DONGO_BROWSER_URL, "https://dev.dongo.so/device?user_code=ABCD");
  } finally {
    if (previousDongoToken === undefined) delete process.env.DONGO_TOKEN;
    else process.env.DONGO_TOKEN = previousDongoToken;
    if (previousAwsSecret === undefined) delete process.env.AWS_SECRET_ACCESS_KEY;
    else process.env.AWS_SECRET_ACCESS_KEY = previousAwsSecret;
  }
});
