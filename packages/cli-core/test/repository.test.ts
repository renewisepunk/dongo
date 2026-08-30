import assert from "node:assert/strict";
import test from "node:test";

import { normalizeRepositoryUrl } from "../src/repository.ts";

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
