import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSnippetExplanationPrompt,
  extractNearbySource,
  extractSnippetFromDiffRows,
} from "../src/shared/snippet-explanation";
import { normalizeCodexExplanationError } from "../src/main/codex";
import type { DiffRow, SnippetExplanationRequest } from "../src/shared/types";

describe("snippet explanations", () => {
  it("extracts visible new-side code from a normalized selected range", () => {
    const rows: DiffRow[] = [
      { kind: "context", text: " const before = true;", oldLine: 8, newLine: 8 },
      { kind: "removed", text: "-const removed = true;", oldLine: 9 },
      { kind: "added", text: "+const first = 1;", newLine: 9 },
      { kind: "added", text: "+const second = 2;", newLine: 10 },
      { kind: "context", text: " return second;", oldLine: 10, newLine: 11 },
    ];

    assert.equal(
      extractSnippetFromDiffRows(rows, 11, 9),
      "const first = 1;\nconst second = 2;\nreturn second;",
    );
  });

  it("rejects a selected range with no visible new-side code", () => {
    const rows: DiffRow[] = [
      { kind: "removed", text: "-const removed = true;", oldLine: 4 },
    ];

    assert.throws(
      () => extractSnippetFromDiffRows(rows, 4, 4),
      /does not contain visible new-side code/i,
    );
  });

  it("builds a bounded read-only prompt with PR and snippet metadata", () => {
    const request: SnippetExplanationRequest = {
      owner: "openai",
      repo: "review-bud",
      number: 42,
      pullRequestTitle: "Keep review context close",
      pullRequestDescription: "This PR keeps review actions next to the changed code.",
      file: "src/example.ts",
      filePatch: "@@ -8,2 +8,3 @@\n const before = true;\n+const value = input ?? fallback;",
      startLine: 9,
      endLine: 10,
      code: "const value = input ?? fallback;\nreturn value;",
      headRepoFullName: "openai/review-bud",
      headSha: "0123456789abcdef",
    };

    const prompt = buildSnippetExplanationPrompt(
      request,
      "const before = true;\nconst value = input ?? fallback;\nreturn value;",
    );

    assert.match(prompt, /openai\/review-bud#42/);
    assert.match(prompt, /Keep review context close/);
    assert.match(prompt, /src\/example\.ts/);
    assert.match(prompt, /lines 9-10/);
    assert.match(prompt, /```typescript/);
    assert.match(prompt, /const value = input \?\? fallback;/);
    assert.match(prompt, /keeps review actions next to the changed code/i);
    assert.match(prompt, /current file diff/i);
    assert.match(prompt, /nearby source/i);
    assert.match(prompt, /inspect repository files/i);
    assert.match(prompt, /read-only commands/i);
    assert.match(prompt, /do not modify files/i);
  });

  it("bounds large PR context fields and marks omitted content", () => {
    const prompt = buildSnippetExplanationPrompt(
      {
        owner: "openai",
        repo: "review-bud",
        number: 42,
        pullRequestTitle: "Bound prompt context",
        pullRequestDescription: "d".repeat(20_000),
        file: "src/example.ts",
        filePatch: "p".repeat(50_000),
        startLine: 1,
        endLine: 1,
        code: "const value = helper();",
        headRepoFullName: "openai/review-bud",
        headSha: "0123456789abcdef",
      },
      "s".repeat(20_000),
    );

    assert.match(prompt, /content truncated/i);
    assert.ok(prompt.length < 35_000);
  });

  it("extracts bounded nearby source with original line numbers", () => {
    const source = Array.from({ length: 80 }, (_, index) => `line ${index + 1}`).join("\n");

    const context = extractNearbySource(source, 40, 42, 3);

    assert.match(context, /^37: line 37/m);
    assert.match(context, /^45: line 45/m);
    assert.doesNotMatch(context, /^36: line 36/m);
  });

  it("rejects blank explanation snippets", () => {
    assert.throws(
      () =>
        buildSnippetExplanationPrompt({
          owner: "openai",
          repo: "review-bud",
          number: 42,
          pullRequestTitle: "Blank snippet",
          pullRequestDescription: "",
          file: "src/example.ts",
          filePatch: "",
          startLine: 1,
          endLine: 1,
          code: "   \n",
          headRepoFullName: "openai/review-bud",
          headSha: "0123456789abcdef",
        }),
      /snippet is empty/i,
    );
  });

  it("turns authentication failures into an actionable login message", () => {
    assert.equal(
      normalizeCodexExplanationError(new Error("401 Unauthorized: login required")),
      "Codex is signed out. Run `codex login`, choose Sign in with ChatGPT, then try again.",
    );
  });

  it("preserves a useful message for other Codex failures", () => {
    assert.equal(
      normalizeCodexExplanationError(new Error("Model usage limit reached")),
      "Codex could not explain this snippet: Model usage limit reached",
    );
  });
});
