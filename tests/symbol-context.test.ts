import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDiffRows,
  collapsedDiffRowKey,
  displayDiffLine,
  expandCollapsedDiffRows,
  extractSymbolContext,
  tokenizeCodeLine,
} from "../src/shared/symbol-context";

describe("buildDiffRows", () => {
  it("maps unified diff lines to new file line numbers", () => {
    const rows = buildDiffRows(["@@ -10,3 +20,4 @@", " context", "-oldCall()", "+newCall()", " nextLine()"].join("\n"));

    assert.deepEqual(
      rows.map((row) => ({ text: row.text, kind: row.kind, oldLine: row.oldLine, newLine: row.newLine })),
      [
        { text: "@@ -10,3 +20,4 @@", kind: "hunk", oldLine: undefined, newLine: undefined },
        { text: " context", kind: "context", oldLine: 10, newLine: 20 },
        { text: "-oldCall()", kind: "removed", oldLine: 11, newLine: undefined },
        { text: "+newCall()", kind: "added", oldLine: undefined, newLine: 21 },
        { text: " nextLine()", kind: "context", oldLine: 12, newLine: 22 },
      ],
    );
  });

  it("marks gaps between hunks as collapsed unchanged lines", () => {
    const rows = buildDiffRows(
      [
        "@@ -10,2 +10,2 @@",
        " first",
        "-oldCall()",
        "+newCall()",
        "@@ -20,2 +20,2 @@",
        " second",
      ].join("\n"),
    );

    assert.deepEqual(
      rows.map((row) => ({
        text: row.text,
        kind: row.kind,
        oldLine: row.oldLine,
        newLine: row.newLine,
        collapsedLines: row.collapsedLines,
        collapsedOldStart: row.collapsedOldStart,
        collapsedNewStart: row.collapsedNewStart,
      })),
      [
        { text: "@@ -10,2 +10,2 @@", kind: "hunk", oldLine: undefined, newLine: undefined, collapsedLines: undefined, collapsedOldStart: undefined, collapsedNewStart: undefined },
        { text: " first", kind: "context", oldLine: 10, newLine: 10, collapsedLines: undefined, collapsedOldStart: undefined, collapsedNewStart: undefined },
        { text: "-oldCall()", kind: "removed", oldLine: 11, newLine: undefined, collapsedLines: undefined, collapsedOldStart: undefined, collapsedNewStart: undefined },
        { text: "+newCall()", kind: "added", oldLine: undefined, newLine: 11, collapsedLines: undefined, collapsedOldStart: undefined, collapsedNewStart: undefined },
        { text: "@@ -20,2 +20,2 @@", kind: "hunk", oldLine: undefined, newLine: undefined, collapsedLines: 8, collapsedOldStart: 12, collapsedNewStart: 12 },
        { text: " second", kind: "context", oldLine: 20, newLine: 20, collapsedLines: undefined, collapsedOldStart: undefined, collapsedNewStart: undefined },
      ],
    );
  });
});

describe("expandCollapsedDiffRows", () => {
  it("inserts source-backed context rows when a collapsed hunk is expanded", () => {
    const rows = buildDiffRows(
      [
        "@@ -10,2 +10,2 @@",
        " first",
        "-oldCall()",
        "+newCall()",
        "@@ -14,1 +14,1 @@",
        " second",
      ].join("\n"),
    );
    const key = collapsedDiffRowKey(rows[4]);
    assert.ok(key);

    const source = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n");
    const expanded = expandCollapsedDiffRows(rows, source, new Set([key]));

    assert.deepEqual(
      expanded.slice(4, 7).map((row) => ({ text: row.text, kind: row.kind, oldLine: row.oldLine, newLine: row.newLine })),
      [
        { text: "@@ -14,1 +14,1 @@", kind: "hunk", oldLine: undefined, newLine: undefined },
        { text: " line 12", kind: "context", oldLine: 12, newLine: 12 },
        { text: " line 13", kind: "context", oldLine: 13, newLine: 13 },
      ],
    );
  });
});

describe("displayDiffLine", () => {
  it("hides unified diff range metadata from hunk headers", () => {
    assert.equal(displayDiffLine({ text: "@@ -173,6 +173,7 @@ function renderDiff()", kind: "hunk" }), "function renderDiff()");
    assert.equal(displayDiffLine({ text: "@@ -10,3 +20,4 @@", kind: "hunk" }), "");
  });

  it("labels collapsed unchanged lines between hunks", () => {
    assert.equal(
      displayDiffLine({ text: "@@ -20,2 +20,2 @@", kind: "hunk", collapsedLines: 8 }),
      "8 unchanged lines - click to expand",
    );
  });

  it("removes diff markers from changed code lines", () => {
    assert.equal(displayDiffLine({ text: "+const value = 1;", kind: "added", newLine: 20 }), "const value = 1;");
    assert.equal(displayDiffLine({ text: "-const value = 0;", kind: "removed", oldLine: 10 }), "const value = 0;");
  });
});

describe("tokenizeCodeLine", () => {
  it("preserves text while marking identifiers", () => {
    const tokens = tokenizeCodeLine("+export function loadPullRequest(url: string) {");

    assert.equal(tokens.map((token) => token.text).join(""), "+export function loadPullRequest(url: string) {");
    assert.deepEqual(
      tokens.filter((token) => token.kind === "identifier").map((token) => token.text),
      ["export", "function", "loadPullRequest", "url", "string"],
    );
    assert.equal(tokens.find((token) => token.text === "loadPullRequest")?.startIndex, 17);
  });
});

describe("extractSymbolContext", () => {
  it("returns the surrounding function for a clicked symbol", () => {
    const source = [
      "const value = 1;",
      "",
      "export function loadPullRequest(url: string) {",
      "  const parsed = parse(url);",
      "  return parsed;",
      "}",
      "",
      "export function other() {",
      "  return value;",
      "}",
    ].join("\n");

    const context = extractSymbolContext(source, {
      file: "src/main.ts",
      symbol: "parsed",
      line: 4,
    });

    assert.equal(context.title, "loadPullRequest");
    assert.equal(context.startLine, 3);
    assert.equal(context.endLine, 6);
    assert.match(context.code, /export function loadPullRequest/);
    assert.doesNotMatch(context.code, /export function other/);
  });

  it("falls back to a small window when no function boundary is obvious", () => {
    const source = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join("\n");
    const context = extractSymbolContext(source, {
      file: "README.md",
      symbol: "line",
      line: 15,
    });

    assert.equal(context.startLine, 7);
    assert.equal(context.endLine, 23);
  });

  it("returns a full Python async function body", () => {
    const source = [
      "async def load_from_cache(",
      "    *,",
      "    redis_client,",
      "):",
      "    cached = await safe_get(redis_client)",
      "    if not cached:",
      "        return None",
      "    return cached",
      "",
      "",
      "async def other():",
      "    return None",
    ].join("\n");

    const context = extractSymbolContext(source, {
      file: "app/cache.py",
      symbol: "load_from_cache",
      line: 1,
    });

    assert.equal(context.title, "load_from_cache");
    assert.equal(context.startLine, 1);
    assert.equal(context.endLine, 10);
    assert.match(context.code, /return cached/);
    assert.doesNotMatch(context.code, /async def other/);
  });
});
