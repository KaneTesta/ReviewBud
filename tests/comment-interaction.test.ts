import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applySplitPanePercent,
  commentGroupsByPosition,
  createDiffDecorationUpdater,
  diffDecorationsForRows,
  isPrDescriptionShortcut,
  scrollDiffPaneWithArrowKey,
} from "../src/renderer/src/App";
import type { DiffRow, DraftReviewComment, PullRequestDiscussion } from "../src/shared/types";

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
  it("updates the selected comment lines without recreating the editor", () => {
    const rows: DiffRow[] = [
      {
        kind: "added",
        text: "+const answer = 42;",
        newLine: 10,
        diffPosition: 1,
      },
    ];
    const decorationUpdates: Array<
      ReadonlyArray<{ options: { className?: string | null } }>
    > = [];
    const updater = createDiffDecorationUpdater(
      {
        set: (decorations) => {
          decorationUpdates.push(decorations);
          return [];
        },
      },
      monaco as never,
      rows,
      [],
      [],
      null,
    );

    updater.setCommentSelection({
      file: "src/example.ts",
      startLine: 10,
      endLine: 10,
    });

    assert.equal(decorationUpdates.length, 1);
    assert.match(
      String(decorationUpdates[0]?.[0]?.options.className),
      /\bdiff-monaco-line-selected-comment\b/,
    );
  });

  it("applies split resizing directly without requiring a React render", () => {
    const styleUpdates: Array<[string, string]> = [];
    const ariaUpdates: Array<[string, string]> = [];
    const container = {
      style: {
        setProperty: (name: string, value: string) => {
          styleUpdates.push([name, value]);
        },
      },
    };
    const separator = {
      setAttribute: (name: string, value: string) => {
        ariaUpdates.push([name, value]);
      },
    };

    const percent = applySplitPanePercent(
      container as HTMLDivElement,
      separator as HTMLButtonElement,
      63.25,
    );

    assert.equal(percent, 63.25);
    assert.deepEqual(styleUpdates, [["--context-pane-width", "63.25%"]]);
    assert.deepEqual(ariaUpdates, [["aria-valuenow", "63.25"]]);
  });

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

  it("recognizes the PR description shortcut with Cmd or Ctrl plus ArrowUp", () => {
    assert.equal(
      isPrDescriptionShortcut({
        key: "ArrowUp",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        target: null,
      }),
      true,
    );
    assert.equal(
      isPrDescriptionShortcut({
        key: "ArrowUp",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        target: null,
      }),
      true,
    );
  });

  it("ignores PR description shortcut lookalikes with missing or extra modifiers", () => {
    assert.equal(
      isPrDescriptionShortcut({
        key: "ArrowUp",
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        target: null,
      }),
      false,
    );
    assert.equal(
      isPrDescriptionShortcut({
        key: "ArrowUp",
        ctrlKey: false,
        metaKey: true,
        shiftKey: true,
        target: null,
      }),
      false,
    );
  });

  it("groups draft comments at their inline diff positions", () => {
    const rows: DiffRow[] = [
      { kind: "added", text: "+line 10", newLine: 10, diffPosition: 1 },
      { kind: "added", text: "+line 11", newLine: 11, diffPosition: 2 },
      { kind: "added", text: "+line 12", newLine: 12, diffPosition: 3 },
    ];
    const discussion: PullRequestDiscussion = {
      id: "comment-1",
      author: "reviewer",
      body: "Published comment",
      path: "src/example.ts",
      line: 12,
      side: "RIGHT",
      createdAt: "2026-09-02T00:00:00.000Z",
      url: "https://example.com/comment-1",
      kind: "comment",
    };
    const drafts: DraftReviewComment[] = [
      {
        id: "draft-single",
        file: "src/example.ts",
        startLine: 10,
        endLine: 10,
        body: "Single-line draft",
        createdAt: "2026-09-02T00:00:00.000Z",
      },
      {
        id: "draft-range",
        file: "src/example.ts",
        startLine: 11,
        endLine: 12,
        body: "Range draft",
        createdAt: "2026-09-02T00:00:00.000Z",
      },
      {
        id: "draft-hidden",
        file: "src/example.ts",
        startLine: 99,
        endLine: 99,
        body: "Unavailable line",
        createdAt: "2026-09-02T00:00:00.000Z",
      },
    ];

    assert.deepEqual(commentGroupsByPosition([discussion], drafts, rows), [
      { position: 1, discussions: [], draftComments: [drafts[0]] },
      {
        position: 3,
        discussions: [discussion],
        draftComments: [drafts[1]],
      },
    ]);
  });
});
