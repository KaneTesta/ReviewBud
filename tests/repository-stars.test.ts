import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ReviewStorage } from "../src/main/storage.js";
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

describe("ReviewStorage repository stars", () => {
  it("persists repository stars locally and applies them to repository summaries", async () => {
    const userDataPath = await mkdtemp(path.join(tmpdir(), "review-bud-stars-"));
    try {
      const storage = new ReviewStorage(userDataPath);
      await storage.setRepositoryStar("acme/payments-api", true);

      const reloadedStorage = new ReviewStorage(userDataPath);
      assert.deepEqual(
        (await reloadedStorage.applyRepositoryStars(repositories)).map((repository) => ({
          fullName: repository.fullName,
          isStarred: repository.isStarred,
        })),
        [
          { fullName: "openai/review-bud", isStarred: false },
          { fullName: "acme/payments-api", isStarred: true },
        ],
      );
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });
});
