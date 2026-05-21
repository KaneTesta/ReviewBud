import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePullRequestUrl, pullRequestId } from "../src/shared/pr-url";

describe("parsePullRequestUrl", () => {
  it("parses a canonical GitHub pull request URL", () => {
    assert.deepEqual(parsePullRequestUrl("https://github.com/openai/codex/pull/42"), {
      owner: "openai",
      repo: "codex",
      number: 42,
    });
  });

  it("allows surrounding whitespace and a trailing slash", () => {
    assert.deepEqual(parsePullRequestUrl(" https://github.com/owner/repo/pull/7/ "), {
      owner: "owner",
      repo: "repo",
      number: 7,
    });
  });

  it("rejects non-GitHub URLs", () => {
    assert.throws(() => parsePullRequestUrl("https://example.com/owner/repo/pull/7"), /GitHub pull request URL/);
  });

  it("rejects issue URLs", () => {
    assert.throws(() => parsePullRequestUrl("https://github.com/owner/repo/issues/7"), /GitHub pull request URL/);
  });
});

describe("pullRequestId", () => {
  it("creates a stable cache key", () => {
    assert.equal(pullRequestId({ owner: "openai", repo: "codex", number: 42 }), "openai_codex_42");
  });
});
