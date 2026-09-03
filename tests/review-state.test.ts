import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adjacentFile,
  completedAllFiles,
  createDraftReview,
  reviewProgress,
  setFileViewed,
  syncFileViewed,
  upsertDraftComment,
} from "../src/shared/review-state";
import type { PullRequestFile } from "../src/shared/types";

const files: PullRequestFile[] = [
  { filename: "src/a.ts", viewed: false, status: "modified", additions: 1, deletions: 0, changes: 1, patch: "" },
  { filename: "src/b.ts", viewed: false, status: "modified", additions: 2, deletions: 1, changes: 3, patch: "" },
  { filename: "src/c.ts", viewed: false, status: "added", additions: 4, deletions: 0, changes: 4, patch: "" },
];

describe("adjacentFile", () => {
  it("moves next and previous through the file list with wrapping", () => {
    assert.equal(adjacentFile(files, "src/a.ts", "next"), "src/b.ts");
    assert.equal(adjacentFile(files, "src/a.ts", "previous"), "src/c.ts");
    assert.equal(adjacentFile(files, "src/c.ts", "next"), "src/a.ts");
  });

  it("falls back to the first or last file when the current file is missing", () => {
    assert.equal(adjacentFile(files, "src/missing.ts", "next"), "src/a.ts");
    assert.equal(adjacentFile(files, "src/missing.ts", "previous"), "src/c.ts");
  });
});

describe("review state helpers", () => {
  it("reports viewed progress from GitHub-backed pull request files", () => {
    assert.deepEqual(
      reviewProgress([
        { ...files[0]!, viewed: true },
        { ...files[1]!, viewed: false },
      ]),
      { viewed: 1, total: 2 },
    );
  });

  it("applies a confirmed viewed value exactly after fresher state arrives", () => {
    const refreshedFiles = files.map((file) => ({ ...file, viewed: true }));

    assert.equal(setFileViewed(refreshedFiles, "src/a.ts", true)[0]?.viewed, true);
    assert.equal(setFileViewed(refreshedFiles, "src/a.ts", false)[0]?.viewed, false);
  });

  it("returns the requested value only after GitHub confirms the viewed state", async () => {
    let confirmRemote: (() => void) | undefined;
    let request: unknown;
    const pendingViewed = syncFileViewed(
      files,
      "PR_kwDOExample",
      "src/a.ts",
      (nextRequest) => {
        request = nextRequest;
        return new Promise<void>((resolve) => {
          confirmRemote = resolve;
        });
      },
    );

    assert.equal(files[0]?.viewed, false);
    assert.deepEqual(request, {
      pullRequestId: "PR_kwDOExample",
      path: "src/a.ts",
      viewed: true,
    });

    confirmRemote?.();
    assert.equal(await pendingViewed, true);
  });

  it("retains GitHub-backed files when GitHub rejects the viewed state", async () => {
    const viewedFiles = files.map((file) => ({ ...file, viewed: true }));

    await assert.rejects(
      syncFileViewed(viewedFiles, "PR_kwDOExample", "src/a.ts", async () => {
        throw new Error("GitHub denied the update");
      }),
      /GitHub denied the update/,
    );
    assert.equal(viewedFiles[0]?.viewed, true);
  });

  it("normalizes draft comment line ranges and trims the body", () => {
    assert.deepEqual(
      upsertDraftComment([], {
        id: "draft-1",
        file: "src/a.ts",
        startLine: 20,
        endLine: 10,
        body: "  Looks odd here.  ",
        now: "2026-05-21T00:00:00.000Z",
      }),
      [
        {
          id: "draft-1",
          file: "src/a.ts",
          startLine: 10,
          endLine: 20,
          body: "Looks odd here.",
          createdAt: "2026-05-21T00:00:00.000Z",
        },
      ],
    );
  });

  it("keeps empty comment drafts out of state", () => {
    assert.deepEqual(
      upsertDraftComment([], {
        file: "src/a.ts",
        startLine: 2,
        endLine: 2,
        body: "   ",
      }),
      [],
    );
  });

  it("creates final review drafts and reports viewed progress", () => {
    assert.deepEqual(createDraftReview("request-changes", "  Needs tests  ", "2026-05-21T00:00:00.000Z"), {
      outcome: "request-changes",
      body: "Needs tests",
      submittedAt: "2026-05-21T00:00:00.000Z",
    });
    assert.deepEqual(
      reviewProgress([
        { ...files[0]!, viewed: true },
        { ...files[1]!, viewed: false },
      ]),
      { viewed: 1, total: 2 },
    );
  });

  it("detects the transition when every file has been viewed", () => {
    assert.equal(
      completedAllFiles({ viewed: 1, total: 2 }, { viewed: 2, total: 2 }),
      true,
    );
    assert.equal(
      completedAllFiles({ viewed: 2, total: 2 }, { viewed: 2, total: 2 }),
      false,
    );
    assert.equal(
      completedAllFiles(null, { viewed: 0, total: 0 }),
      false,
    );
  });
});
