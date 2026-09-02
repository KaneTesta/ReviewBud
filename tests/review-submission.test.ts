import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildGitHubReviewPayload } from "../src/shared/review-submission.js";

describe("review submission", () => {
  it("maps an approval and a single-line draft to GitHub's review payload", () => {
    assert.deepEqual(
      buildGitHubReviewPayload({
        owner: "octo",
        repo: "app",
        number: 42,
        headSha: "abc123",
        outcome: "approve",
        body: "Looks good.",
        comments: [
          {
            id: "draft-1",
            file: "src/app.ts",
            startLine: 12,
            endLine: 12,
            body: "Nice cleanup.",
            createdAt: "2026-09-02T00:00:00.000Z",
          },
        ],
      }),
      {
        commit_id: "abc123",
        event: "APPROVE",
        body: "Looks good.",
        comments: [
          {
            path: "src/app.ts",
            line: 12,
            side: "RIGHT",
            body: "Nice cleanup.",
          },
        ],
      },
    );
  });

  it("maps request changes and a multi-line draft range", () => {
    const payload = buildGitHubReviewPayload({
      owner: "octo",
      repo: "app",
      number: 42,
      headSha: "abc123",
      outcome: "request-changes",
      body: "  Please address this.  ",
      comments: [
        {
          id: "draft-2",
          file: "src/app.ts",
          startLine: 20,
          endLine: 24,
          body: "  Could this be extracted?  ",
          createdAt: "2026-09-02T00:00:00.000Z",
        },
      ],
    });

    assert.equal(payload.event, "REQUEST_CHANGES");
    assert.equal(payload.body, "Please address this.");
    assert.deepEqual(payload.comments[0], {
      path: "src/app.ts",
      start_line: 20,
      start_side: "RIGHT",
      line: 24,
      side: "RIGHT",
      body: "Could this be extracted?",
    });
  });

  it("rejects blank inline draft bodies before contacting GitHub", () => {
    assert.throws(
      () =>
        buildGitHubReviewPayload({
          owner: "octo",
          repo: "app",
          number: 42,
          headSha: "abc123",
          outcome: "comment",
          body: "Summary",
          comments: [
            {
              id: "draft-3",
              file: "src/app.ts",
              startLine: 4,
              endLine: 4,
              body: "   ",
              createdAt: "2026-09-02T00:00:00.000Z",
            },
          ],
        }),
      /Draft comment body is required/,
    );
  });

  it("requires an overall body for comment and request-changes reviews", () => {
    for (const outcome of ["comment", "request-changes"] as const) {
      assert.throws(
        () =>
          buildGitHubReviewPayload({
            owner: "octo",
            repo: "app",
            number: 42,
            headSha: "abc123",
            outcome,
            body: "",
            comments: [],
          }),
        /Review body is required/,
      );
    }
  });

  it("rejects invalid line coordinates at the process boundary", () => {
    assert.throws(
      () =>
        buildGitHubReviewPayload({
          owner: "octo",
          repo: "app",
          number: 42,
          headSha: "abc123",
          outcome: "approve",
          body: "",
          comments: [
            {
              id: "draft-4",
              file: "src/app.ts",
              startLine: 0,
              endLine: 1,
              body: "Invalid range",
              createdAt: "2026-09-02T00:00:00.000Z",
            },
          ],
        }),
      /positive integers/,
    );
  });
});
