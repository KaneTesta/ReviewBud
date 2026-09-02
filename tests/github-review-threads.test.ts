import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeComment,
  reviewThreadMetadataByCommentId,
} from "../src/main/github.js";

describe("GitHub review thread normalization", () => {
  it("removes stale REST placement when a resolved thread has no line in the current diff", () => {
    const metadataByCommentId = reviewThreadMetadataByCommentId({
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [
                {
                  isResolved: true,
                  isOutdated: true,
                  path: "src/app.ts",
                  line: null,
                  originalLine: 50,
                  diffSide: "RIGHT",
                  startLine: null,
                  originalStartLine: null,
                  comments: { nodes: [{ databaseId: 123 }] },
                },
              ],
            },
          },
        },
      },
    });

    const discussion = normalizeComment(
      {
        id: 123,
        user: { login: "teammate" },
        body: "This has been addressed.",
        path: "src/app.ts",
        position: 1,
        line: null,
        side: "RIGHT",
        start_line: null,
        start_side: null,
        created_at: "2026-08-28T00:00:00Z",
        html_url: "https://github.com/owner/repo/pull/1#discussion_r123",
      },
      metadataByCommentId.get(123),
    );

    assert.deepEqual(
      {
        path: discussion.path,
        position: discussion.position,
        line: discussion.line,
        side: discussion.side,
        isResolved: discussion.isResolved,
        isOutdated: discussion.isOutdated,
      },
      {
        path: "src/app.ts",
        position: undefined,
        line: undefined,
        side: "RIGHT",
        isResolved: true,
        isOutdated: true,
      },
    );
  });
});
