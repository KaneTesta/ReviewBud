import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  discussionAffectsDiffRow,
  discussionAffectsDiffPosition,
  discussionStateLabels,
  discussionsForFile,
  shouldCollapseDiscussion,
} from "../src/shared/discussions";
import type { PullRequestDiscussion } from "../src/shared/types";

describe("discussionsForFile", () => {
  it("does not attach pull-request-level reviews to every changed file", () => {
    const discussions: PullRequestDiscussion[] = [
      {
        id: "review-1",
        author: "copilot-pull-request-reviewer[bot]",
        body: "Pull request overview",
        createdAt: "2026-05-21T00:00:00Z",
        url: "https://github.com/owner/repo/pull/1#pullrequestreview-1",
        kind: "review",
      },
      {
        id: "comment-1",
        author: "teammate",
        body: "Please check this line.",
        path: "src/app.ts",
        position: 3,
        createdAt: "2026-05-21T00:01:00Z",
        url: "https://github.com/owner/repo/pull/1#discussion_r1",
        kind: "comment",
      },
    ];

    assert.deepEqual(
      discussionsForFile(discussions, "src/app.ts").map((discussion) => discussion.id),
      ["comment-1"],
    );
  });

  it("identifies resolved and outdated discussions as collapsed by default", () => {
    const activeDiscussion: PullRequestDiscussion = {
      id: "comment-1",
      author: "teammate",
      body: "Please check this line.",
      path: "src/app.ts",
      position: 3,
      createdAt: "2026-05-21T00:01:00Z",
      url: "https://github.com/owner/repo/pull/1#discussion_r1",
      kind: "comment",
    };

    assert.equal(shouldCollapseDiscussion(activeDiscussion), false);
    assert.equal(shouldCollapseDiscussion({ ...activeDiscussion, isResolved: true }), true);
    assert.equal(shouldCollapseDiscussion({ ...activeDiscussion, isOutdated: true }), true);
  });

  it("returns chip labels for resolved and outdated discussions", () => {
    assert.deepEqual(
      discussionStateLabels({
        id: "comment-1",
        author: "teammate",
        body: "Please check this line.",
        path: "src/app.ts",
        position: 3,
        createdAt: "2026-05-21T00:01:00Z",
        url: "https://github.com/owner/repo/pull/1#discussion_r1",
        kind: "comment",
        isResolved: true,
        isOutdated: true,
      }),
      ["Resolved", "Outdated"],
    );
  });

  it("matches comments to their affected diff position", () => {
    const discussion: PullRequestDiscussion = {
      id: "comment-1",
      author: "teammate",
      body: "Please check this line.",
      path: "src/app.ts",
      position: 3,
      createdAt: "2026-05-21T00:01:00Z",
      url: "https://github.com/owner/repo/pull/1#discussion_r1",
      kind: "comment",
    };

    assert.equal(discussionAffectsDiffPosition(discussion, 3), true);
    assert.equal(discussionAffectsDiffPosition(discussion, 4), false);
  });

  it("prefers GitHub right-side line numbers over ambiguous diff positions", () => {
    const discussion: PullRequestDiscussion = {
      id: "comment-1",
      author: "teammate",
      body: "This belongs on the changed code line.",
      path: "src/app.ts",
      position: 1,
      line: 42,
      side: "RIGHT",
      createdAt: "2026-05-21T00:01:00Z",
      url: "https://github.com/owner/repo/pull/1#discussion_r1",
      kind: "comment",
    };

    assert.equal(
      discussionAffectsDiffRow(discussion, {
        text: "@@ -1,1 +40,3 @@",
        kind: "hunk",
        diffPosition: 1,
      }),
      false,
    );
    assert.equal(
      discussionAffectsDiffRow(discussion, {
        text: "+const value = 1;",
        kind: "added",
        diffPosition: 5,
        newLine: 42,
      }),
      true,
    );
  });

  it("matches GitHub left-side comments to removed lines", () => {
    const discussion: PullRequestDiscussion = {
      id: "comment-1",
      author: "teammate",
      body: "This belongs on the removed code line.",
      path: "src/app.ts",
      line: 10,
      side: "LEFT",
      createdAt: "2026-05-21T00:01:00Z",
      url: "https://github.com/owner/repo/pull/1#discussion_r1",
      kind: "comment",
    };

    assert.equal(
      discussionAffectsDiffRow(discussion, {
        text: "-const value = 0;",
        kind: "removed",
        oldLine: 10,
      }),
      true,
    );
    assert.equal(
      discussionAffectsDiffRow(discussion, {
        text: "+const value = 1;",
        kind: "added",
        newLine: 10,
      }),
      false,
    );
  });
});
