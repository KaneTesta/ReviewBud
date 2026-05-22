import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createReviewBudPullRequestUrl,
  isPullRequestUrl,
  parsePullRequestUrl,
  pullRequestId,
  pullRequestUrlFromReviewBudUrl,
} from "../src/shared/pr-url";

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

describe("isPullRequestUrl", () => {
  it("identifies GitHub pull request URLs", () => {
    assert.equal(isPullRequestUrl("https://github.com/flowstate-zone/frontend-next/pull/1384"), true);
  });

  it("rejects GitHub issue URLs", () => {
    assert.equal(isPullRequestUrl("https://github.com/flowstate-zone/frontend-next/issues/1384"), false);
  });
});

describe("ReviewBud pull request URLs", () => {
  it("creates a deep link for a GitHub pull request URL", () => {
    const pullRequestUrl = "https://github.com/flowstate-zone/frontend-next/pull/1384";

    assert.equal(
      pullRequestUrlFromReviewBudUrl(createReviewBudPullRequestUrl(pullRequestUrl)),
      pullRequestUrl,
    );
  });

  it("rejects deep links without a GitHub pull request URL", () => {
    assert.equal(pullRequestUrlFromReviewBudUrl("reviewbud://review-pr?url=https://github.com/a/b/issues/1"), null);
  });

  it("ignores other protocols", () => {
    assert.equal(pullRequestUrlFromReviewBudUrl("https://github.com/flowstate-zone/frontend-next/pull/1384"), null);
  });
});
