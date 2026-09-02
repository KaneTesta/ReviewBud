# Spec: Resolved Comment Placement

## Objective

Render resolved review comments only when GitHub supplies an authoritative current line that exists in the current diff. Resolved or outdated REST comments can degrade to `position: 1`; GraphQL thread metadata is used to discard that stale placement. Threads with no matching current diff line are not shown.

## Tech Stack

- Electron 29 application with a React 18 renderer
- TypeScript 5
- Monaco Editor view zones for line-level discussions
- Node's built-in test runner with `tsx`

## Commands

- Install: `npm install`
- Develop: `npm run dev`
- Test: `npm test`
- Typecheck: `npm run typecheck`
- Build: `npm run build`

## Project Structure

- `src/main/github.ts` — GitHub response normalization and review-thread metadata
- `src/renderer/src/App.tsx` — review UI and inline discussion partitioning
- `src/shared/discussions.ts` — pure discussion-state and location helpers
- `tests/discussions.test.ts` — discussion behavior tests
- `docs/` — feature specifications

## Code Style

Use typed React components and small pure helpers, formatted with two-space indentation and trailing commas:

```ts
export function discussionHasDiffLocation(discussion: PullRequestDiscussion): boolean {
  return discussion.line != null || discussion.position != null;
}
```

## Testing Strategy

- Unit-test GraphQL's `data` envelope and normalization of an outdated resolved thread whose REST comment reports stale `position: 1` but has no current line.
- Unit-test classification of comments with modern line locations, legacy diff positions, and no diff location.
- Preserve the existing tests for resolved and outdated disclosure state.
- Run the complete unit suite, TypeScript checks, and production build.
- Manually verify a resolved line-based comment appears beside its associated diff line rather than above the file.

## Boundaries

- Always: use GraphQL's current review-thread line ahead of stale REST placement; omit line comments that do not map to the current diff; keep genuinely file-level discussion above the diff; preserve status labels, Markdown content, replies, hover behavior, and keyboard access.
- Ask first: changing GitHub fetch behavior or adding dependencies.
- Never: hide resolved discussion permanently, treat an unresolved comment as resolved, remove reply functionality, or write review state into the target repository.

## Success Criteria

1. GitHub GraphQL responses are read through their top-level `data` envelope.
2. A resolved, outdated thread with a null current `line` does not reuse `originalLine` or stale REST `position: 1`.
3. A current thread uses its current `line`.
4. A discussion with only a legitimate legacy `position` continues to render at that diff position.
5. Line discussions with no matching current diff row are omitted instead of rendering above the file.
6. Existing minimised presentation for resolved and outdated discussions is preserved.
7. `npm test`, `npm run typecheck`, and `npm run build` pass.

## Open Questions

None.
