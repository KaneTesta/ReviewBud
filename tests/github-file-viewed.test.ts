import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFileViewedMutation } from "../src/main/github.js";

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
