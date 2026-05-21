import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isClosedPullRequest, pullRequestListRowClassName } from "../src/renderer/src/App.js";

describe("pull request list rendering", () => {
  it("marks closed pull requests for closed styling", () => {
    assert.equal(isClosedPullRequest({ state: "closed" }), true);
    assert.equal(pullRequestListRowClassName({ state: "closed" }), "selection-row pr-row pr-row-closed");
  });

  it("preserves the default row styling for open pull requests", () => {
    assert.equal(isClosedPullRequest({ state: "open" }), false);
    assert.equal(pullRequestListRowClassName({ state: "open" }), "selection-row pr-row");
  });
});
