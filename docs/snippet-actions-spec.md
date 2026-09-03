# Spec: Snippet Actions and Inline Comment Composer

## Objective

Let a reviewer select changed code and immediately choose between drafting a review comment, asking Codex for a general explanation, or asking a specific question about the snippet. Keep interactions spatially close to the code: draft-comment and question composition appear directly beneath the selected range, while AI answers join the existing context sidebar alongside opened symbol definitions. Make all actions keyboard-accessible and give Codex bounded prompt context plus unrestricted-depth, read-only repository access to follow relevant helper implementations as far as needed.

## Tech Stack

Electron 29, React 18, TypeScript, Monaco Editor, the official `@openai/codex-sdk`, `react-markdown`, and the existing typed preload/IPC boundary.

## Commands

- Test: `npm test`
- Typecheck: `npm run typecheck`
- Build: `npm run build`
- Dev: `npm run dev`

## Project Structure

- `src/shared/types.ts`: typed snippet-explanation/question request and response contracts
- `src/main`: read-only local Codex integration, source snapshots, and IPC handler
- `src/preload/index.ts`: typed renderer bridge for explanation requests
- `src/renderer/src/App.tsx`: Monaco selection actions, inline composer zone, and mixed context/explanation stack
- `src/renderer/styles.css`: snippet action menu, AI icon treatment, inline composer, and explanation presentation
- `tests`: pure selection, prompt, and placement behavior

## Code Style

Keep process boundaries explicit and model UI state as tagged data rather than loosely related booleans:

```ts
export type ContextSidebarEntry =
  | { kind: "symbol"; context: SymbolContext }
  | { kind: "explanation"; explanation: SnippetExplanation; question?: string };
```

Use named helpers for prompt construction and diff-line mapping. Keep authentication and Codex execution in the Electron main process; the renderer receives only typed status and response data.

## Testing Strategy

- Unit-test line-range normalization and selected-snippet extraction from diff rows.
- Unit-test the Codex prompt contract so file, range, PR metadata, description, nearby source, current-file patch, and code are present without shell interpolation.
- Unit-test snippet-menu keyboard routing so `C` and `E` activate only their corresponding action while the menu is open.
- Unit-test `A` routing, question validation, and prompt construction with the reviewer's question.
- Unit-test inline composer placement data and mixed sidebar-entry behavior where practical.
- Run the complete Node test suite, TypeScript checks, and production build.
- Manually verify selection menu placement, inline comment composition, loading/error states, Markdown rendering, and coexistence with symbol context in the Electron app.

## Boundaries

- Always: use the user's local Codex authentication, run explanation work read-only, bound prompt-sized PR context, render AI output as untrusted Markdown with raw HTML disabled, and preserve existing draft persistence/submission behavior.
- Ask first: allowing Codex to edit files, enabling network access, sending unbounded repository content in the prompt, or changing the persisted review schema.
- Never: read or copy Codex credential files, fall back to an OpenAI API key, allow Codex to modify the source snapshot, or publish comments without the existing finish-review action.

## Success Criteria

- Selecting one or more commentable new-side diff lines opens a compact action menu adjacent to the selection.
- The menu offers **Comment on code**, **Explain this snippet**, and **Ask about this snippet**, with a recognizable ChatGPT/AI SVG icon beside both AI actions.
- The menu shows `C` beside Comment, `E` beside Explain, and `A` beside Ask; pressing an action key while the menu is open activates it without requiring a modifier.
- Choosing **Comment on code** opens the draft composer directly beneath the selected line or range; saving produces the same persisted inline draft as today.
- The bottom action pane no longer contains the line-comment composer or tells the reviewer to look below.
- Choosing **Explain this snippet** opens the context sidebar, shows progress, and renders the Codex explanation in that sidebar.
- Choosing **Ask about this snippet** opens an inline question composer beneath the selected range. Submitting a non-empty question opens the context sidebar, displays the question, and renders Codex's Markdown answer below it.
- Existing symbol contexts remain visible when an explanation is added, and either entry can be closed independently.
- Every explanation prompt includes a bounded PR description, current-file patch, and nearby source lines in addition to the selected snippet.
- Codex execution uses the official local SDK/runtime, the saved ChatGPT/Codex login, and a read-only source snapshot at the PR head; it may inspect files and run read-only discovery commands to follow helper implementations, but has no network or write permissions and no API key is requested.
- Question answering has no application-level traversal-depth or file-hop limit: Codex may follow any relevant code path within the read-only source snapshot until it has enough evidence to answer. Runtime/model context limits still apply.
- Missing runtime, signed-out state, cancellation, and execution failures produce actionable UI without affecting review state.
- Tests, typecheck, and build pass.

## Open Questions

Pending approval of the surfaced assumptions: the Ask shortcut is `A`, its question composer is inline, and answers reuse the existing Context sidebar. The previous instruction to keep Markdown files out of commits remains in force.
