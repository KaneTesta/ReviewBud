import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  diffDecorationsForRows,
  scrollDiffPaneWithArrowKey,
} from "../src/renderer/src/App";
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

  it("scrolls the diff pane with plain up and down arrow keys", () => {
    const scrollCalls: ScrollToOptions[] = [];
    const scrollContainer = {
      scrollBy: (options: ScrollToOptions) => {
        scrollCalls.push(options);
      },
    };
    let prevented = false;
    let stopped = false;

    const handled = scrollDiffPaneWithArrowKey(
      {
        key: "ArrowDown",
        altKey: false,
        ctrlKey: false,
        defaultPrevented: false,
        metaKey: false,
        shiftKey: false,
        target: null,
        preventDefault: () => {
          prevented = true;
        },
        stopPropagation: () => {
          stopped = true;
        },
      } as KeyboardEvent,
      scrollContainer as never,
      18,
    );

    assert.equal(handled, true);
    assert.equal(prevented, true);
    assert.equal(stopped, true);
    assert.deepEqual(scrollCalls, [{ top: 18, behavior: "auto" }]);
  });

  it("leaves modified arrow shortcuts alone", () => {
    const scrollContainer = {
      scrollBy: () => {
        throw new Error("modified shortcuts should not scroll the diff pane");
      },
    };
    let prevented = false;

    const handled = scrollDiffPaneWithArrowKey(
      {
        key: "ArrowUp",
        altKey: false,
        ctrlKey: true,
        defaultPrevented: false,
        metaKey: false,
        shiftKey: false,
        target: null,
        preventDefault: () => {
          prevented = true;
        },
        stopPropagation: () => {},
      } as KeyboardEvent,
      scrollContainer as never,
      18,
    );

    assert.equal(handled, false);
    assert.equal(prevented, false);
  });
});
