import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { resolveTypeScriptSymbolContext } from "../src/main/typescript-intelligence";

describe("resolveTypeScriptSymbolContext", () => {
  it("finds a definition in another file without VS Code APIs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "review-bud-ts-"));
    await mkdir(path.join(root, "src"));
    await writeFile(
      path.join(root, "src", "definition.ts"),
      [
        "export function loadPullRequest(url: string) {",
        "  return { url };",
        "}",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(root, "src", "usage.ts"),
      [
        'import { loadPullRequest } from "./definition";',
        "",
        "export function run() {",
        '  return loadPullRequest("https://github.com/a/b/pull/1");',
        "}",
      ].join("\n"),
      "utf8",
    );

    const context = await resolveTypeScriptSymbolContext(root, {
      owner: "a",
      repo: "b",
      number: 1,
      file: "src/usage.ts",
      line: 4,
      symbol: "loadPullRequest",
    });

    assert.ok(context);
    assert.equal(context.source, "language-service");
    assert.equal(context.file, "src/definition.ts");
    assert.equal(context.title, "loadPullRequest");
    assert.match(context.code, /export function loadPullRequest/);
  });

  it("uses the clicked column when the same symbol appears earlier on the line", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "review-bud-ts-"));
    await mkdir(path.join(root, "src"));
    await writeFile(
      path.join(root, "src", "usage.ts"),
      [
        "const buildLoader = () => undefined;",
        "",
        "export function run() {",
        "  const loadPullRequest = () => undefined; return loadPullRequest();",
        "}",
      ].join("\n"),
      "utf8",
    );

    const context = await resolveTypeScriptSymbolContext(root, {
      owner: "a",
      repo: "b",
      number: 1,
      file: "src/usage.ts",
      line: 4,
      column: 51,
      symbol: "loadPullRequest",
    });

    assert.ok(context);
    assert.equal(context.source, "language-service");
    assert.equal(context.title, "loadPullRequest");
    assert.equal(context.startLine, 4);
    assert.match(context.code, /const loadPullRequest = \(\) => undefined/);
  });
});
