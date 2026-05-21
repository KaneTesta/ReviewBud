import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { filterRepositories, repositoryOwners } from "../src/shared/repositories.js";
import type { RepositorySummary } from "../src/shared/types.js";

const repositories: RepositorySummary[] = [
  {
    fullName: "openai/review-bud",
    owner: "openai",
    repo: "review-bud",
    description: "Local pull request review app",
    updatedAt: "2026-05-21T00:00:00Z",
  },
  {
    fullName: "acme/payments-api",
    owner: "acme",
    repo: "payments-api",
    description: "Billing service",
    updatedAt: "2026-05-20T00:00:00Z",
  },
];

describe("filterRepositories", () => {
  it("filters repositories by name or description", () => {
    assert.deepEqual(
      filterRepositories(repositories, "billing").map((repository) => repository.fullName),
      ["acme/payments-api"],
    );
    assert.deepEqual(
      filterRepositories(repositories, "REVIEW").map((repository) => repository.fullName),
      ["openai/review-bud"],
    );
  });

  it("returns all repositories for an empty query", () => {
    assert.deepEqual(filterRepositories(repositories, "   "), repositories);
  });

  it("filters repositories by owner and search query together", () => {
    assert.deepEqual(
      filterRepositories(repositories, "api", "openai").map((repository) => repository.fullName),
      [],
    );
    assert.deepEqual(
      filterRepositories(repositories, "api", "acme").map((repository) => repository.fullName),
      ["acme/payments-api"],
    );
  });
});

describe("repositoryOwners", () => {
  it("returns unique repository owners sorted by name", () => {
    assert.deepEqual(repositoryOwners(repositories), ["acme", "openai"]);
  });
});
