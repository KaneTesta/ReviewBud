import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { resolveSourceSnapshotFile } from "../src/main/source-snapshot";

describe("source snapshot paths", () => {
  it("resolves repository-relative files inside the snapshot", () => {
    const snapshotPath = path.join(path.sep, "tmp", "review-bud-snapshot");

    assert.equal(
      resolveSourceSnapshotFile(snapshotPath, "src/helpers/example.ts"),
      path.join(snapshotPath, "src", "helpers", "example.ts"),
    );
  });

  it("rejects paths that escape the source snapshot", () => {
    const snapshotPath = path.join(path.sep, "tmp", "review-bud-snapshot");

    assert.throws(
      () => resolveSourceSnapshotFile(snapshotPath, "../../credentials.json"),
      /outside the source snapshot/i,
    );
    assert.throws(
      () => resolveSourceSnapshotFile(snapshotPath, path.join(path.sep, "etc", "hosts")),
      /outside the source snapshot/i,
    );
  });
});
