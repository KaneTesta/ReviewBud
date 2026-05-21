import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diffDecorationsForRows } from "../src/renderer/src/App";
import type { DiffRow } from "../src/shared/types";

const monaco = {
  Range: class Range {
    constructor(
      public startLineNumber: number,
      public startColumn: number,
      public endLineNumber: number,
      public endColumn: number,
    ) {}
  },
};

describe("comment interactions", () => {
  it("marks changed lines as commentable without requiring a comment mode toggle", () => {
    const rows: DiffRow[] = [
      {
        kind: "added",
        text: "+const answer = 42;",
        newLine: 10,
        diffPosition: 1,
      },
    ];

    const decorations = diffDecorationsForRows(
      monaco as never,
      rows,
      [],
      [],
      false,
      null,
      null,
    );

    assert.match(
      String(decorations[0]?.options.className),
      /\bdiff-monaco-line-commentable\b/,
    );
  });
});
