import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFileViewedMutation,
  normalizePullRequestFiles,
} from "../src/main/github.js";

describe("GitHub file viewed mutations", () => {
  it("builds a markFileAsViewed mutation for a viewed file", () => {
    const mutation = buildFileViewedMutation({
      pullRequestId: "PR_kwDOExample",
      path: "src/components/review pane.tsx",
      viewed: true,
    });

    assert.match(mutation.query, /markFileAsViewed/);
    assert.doesNotMatch(mutation.query, /unmarkFileAsViewed/);
    assert.deepEqual(mutation.variables, {
      pullRequestId: "PR_kwDOExample",
      path: "src/components/review pane.tsx",
    });
  });

  it("builds an unmarkFileAsViewed mutation for an unviewed file", () => {
    const mutation = buildFileViewedMutation({
      pullRequestId: "PR_kwDOExample",
      path: "src/app.ts",
      viewed: false,
    });

    assert.match(mutation.query, /unmarkFileAsViewed/);
    assert.doesNotMatch(mutation.query, /\bmarkFileAsViewed/);
    assert.deepEqual(mutation.variables, {
      pullRequestId: "PR_kwDOExample",
      path: "src/app.ts",
    });
  });
});

describe("GitHub file viewed state loading", () => {
  it("merges every viewed-state page into REST files by exact path", () => {
    const files = normalizePullRequestFiles(
      [
        { filename: "src/viewed.ts", status: "modified", additions: 1, deletions: 0, changes: 1 },
        { filename: "src/dismissed.ts", status: "modified", additions: 1, deletions: 0, changes: 1 },
        { filename: "src/unviewed.ts", status: "modified", additions: 1, deletions: 0, changes: 1 },
        { filename: "src/unmatched.ts", status: "modified", additions: 1, deletions: 0, changes: 1 },
      ],
      [
        {
          data: {
            repository: {
              pullRequest: {
                files: {
                  nodes: [
                    { path: "src/viewed.ts", viewerViewedState: "VIEWED" },
                    { path: "src/dismissed.ts", viewerViewedState: "DISMISSED" },
                  ],
                },
              },
            },
          },
        },
        {
          data: {
            repository: {
              pullRequest: {
                files: {
                  nodes: [
                    { path: "src/unviewed.ts", viewerViewedState: "UNVIEWED" },
                  ],
                },
              },
            },
          },
        },
      ],
    );

    assert.deepEqual(
      files.map(({ filename, viewed }) => ({ filename, viewed })),
      [
        { filename: "src/viewed.ts", viewed: true },
        { filename: "src/dismissed.ts", viewed: false },
        { filename: "src/unviewed.ts", viewed: false },
        { filename: "src/unmatched.ts", viewed: false },
      ],
    );
  });

  it("rejects GraphQL errors instead of treating every file as unviewed", () => {
    assert.throws(
      () =>
        normalizePullRequestFiles(
          [
            { filename: "src/app.ts", status: "modified", additions: 1, deletions: 0, changes: 1 },
          ],
          [{ errors: [{ message: "Viewed state is unavailable" }] }],
        ),
      /Viewed state is unavailable/,
    );
  });
});
