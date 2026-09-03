import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { ReviewStorage } from "../src/main/storage.js";
import type { CachedPullRequest } from "../src/shared/types.js";

const pullRequest: CachedPullRequest = {
  summary: {
    id: "octo-app-42",
    nodeId: "PR_kwDOExample",
    owner: "octo",
    repo: "app",
    number: 42,
    url: "https://github.com/octo/app/pull/42",
    title: "Improve review publishing",
    state: "open",
    author: "octocat",
    body: "Description",
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-02T00:00:00Z",
    baseRef: "main",
    headRef: "review-publishing",
    headRepoFullName: "octo/app",
    headSha: "abc123",
    additions: 2,
    deletions: 1,
    changedFiles: 1,
    mergeable: "MERGEABLE",
    reviewDecision: null,
  },
  files: [
    {
      filename: "src/app.ts",
      status: "modified",
      additions: 2,
      deletions: 1,
      changes: 3,
      patch: "@@ -1 +1 @@",
    },
  ],
  discussions: [],
  diff: "diff --git a/src/app.ts b/src/app.ts",
  loadedAt: "2026-09-02T00:00:00Z",
};

describe("review submission storage", () => {
  it("preserves notes and clears submitted drafts after a successful refresh", async () => {
    const userDataPath = await mkdtemp(path.join(tmpdir(), "review-bud-submit-"));
    try {
      const storage = new ReviewStorage(userDataPath);
      const workspace = await storage.savePullRequest(pullRequest);
      await storage.saveReviewState(workspace.pullRequest.summary.id, {
        notes: [{ file: "src/app.ts", status: "done", note: "Checked" }],
        draftComments: [
          {
            id: "draft-1",
            file: "src/app.ts",
            startLine: 1,
            endLine: 1,
            body: "Publish me",
            createdAt: "2026-09-02T00:00:00Z",
          },
        ],
        draftReview: {
          outcome: "approve",
          body: "Ready",
          submittedAt: "2026-09-02T00:00:00Z",
        },
      });

      const cleared = await storage.clearSubmittedReview(workspace.pullRequest.summary.id);
      assert.deepEqual(cleared.notes, [
        { file: "src/app.ts", status: "done", note: "Checked" },
      ]);
      assert.deepEqual(cleared.draftComments, []);
      assert.equal(cleared.draftReview, null);

      const refreshed = await storage.saveSubmittedPullRequest({
        ...pullRequest,
        loadedAt: "2026-09-02T00:01:00Z",
      });

      assert.deepEqual(refreshed.notes, [
        { file: "src/app.ts", status: "done", note: "Checked" },
      ]);
      assert.deepEqual(refreshed.draftComments, []);
      assert.equal(refreshed.draftReview, null);
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });
});
