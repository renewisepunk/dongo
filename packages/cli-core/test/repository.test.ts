import assert from "node:assert/strict";
import test from "node:test";

import { normalizeRepositoryUrl, suggestedProjectName } from "../src/repository.ts";

test("keeps the dongo brand lowercase when proposing a project name", () => {
  assert.equal(suggestedProjectName("/workspace/dongo"), "dongo");
  assert.equal(suggestedProjectName(`/workspace/${["Don", "go"].join("")}`), "dongo");
  assert.equal(suggestedProjectName("/workspace/example-project"), "Example project");
});

test("normalizes HTTPS, SCP-style, and SSH Git origins without inventing hosts", () => {
  assert.equal(
    normalizeRepositoryUrl("https://github.com/renewisepunk/dongo.git"),
    "https://github.com/renewisepunk/dongo",
  );
  assert.equal(
    normalizeRepositoryUrl("git@github.com:renewisepunk/dongo.git"),
    "https://github.com/renewisepunk/dongo",
  );
  assert.equal(
    normalizeRepositoryUrl("ssh://git@github.com/renewisepunk/dongo.git"),
    "https://github.com/renewisepunk/dongo",
  );
});

test("omits credential-bearing or malformed repository origins", () => {
  assert.equal(normalizeRepositoryUrl("https://token@example.com/owner/repo"), undefined);
  assert.equal(normalizeRepositoryUrl("https://example.com/owner/repo?token=secret"), undefined);
  assert.equal(normalizeRepositoryUrl("not a repository"), undefined);
});
