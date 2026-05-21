import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adjacentFile,
  createDraftReview,
  reviewProgress,
  toggleFileViewed,
  upsertDraftComment,
} from "../src/shared/review-state";
import type { PullRequestFile, ReviewNote } from "../src/shared/types";

const files: PullRequestFile[] = [
  { filename: "src/a.ts", status: "modified", additions: 1, deletions: 0, changes: 1, patch: "" },
  { filename: "src/b.ts", status: "modified", additions: 2, deletions: 1, changes: 3, patch: "" },
  { filename: "src/c.ts", status: "added", additions: 4, deletions: 0, changes: 4, patch: "" },
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
  it("toggles the active file viewed state without changing other notes", () => {
    const notes: ReviewNote[] = [
      { file: "src/a.ts", status: "unread", note: "" },
      { file: "src/b.ts", status: "question", note: "Check this" },
    ];

    assert.deepEqual(toggleFileViewed(notes, "src/a.ts"), [
      { file: "src/a.ts", status: "done", note: "" },
      { file: "src/b.ts", status: "question", note: "Check this" },
    ]);

    assert.deepEqual(toggleFileViewed(notes, "src/b.ts"), [
      { file: "src/a.ts", status: "unread", note: "" },
      { file: "src/b.ts", status: "done", note: "Check this" },
    ]);
  });

  it("reverts a viewed file to unread when toggled again", () => {
    const notes: ReviewNote[] = [
      { file: "src/a.ts", status: "done", note: "" },
      { file: "src/b.ts", status: "unread", note: "" },
    ];

    assert.deepEqual(toggleFileViewed(notes, "src/a.ts"), [
      { file: "src/a.ts", status: "unread", note: "" },
      { file: "src/b.ts", status: "unread", note: "" },
    ]);
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
        { file: "src/a.ts", status: "done", note: "" },
        { file: "src/b.ts", status: "unread", note: "" },
      ]),
      { viewed: 1, total: 2 },
    );
  });
});
