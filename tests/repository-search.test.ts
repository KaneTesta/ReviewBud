import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRepositorySearchQuery } from "../src/main/github.js";

describe("buildRepositorySearchQuery", () => {
  it("builds a GitHub repository search query from text and owner", () => {
    assert.equal(
      buildRepositorySearchQuery("review bud", "openai"),
      "review bud fork:true user:openai",
    );
  });

  it("searches all repositories for an owner when no text query is provided", () => {
    assert.equal(buildRepositorySearchQuery(" ", "acme"), "stars:>=0 fork:true user:acme");
  });
});
