# Spec: Inline Draft Comments

## Objective

Show locally saved draft review comments inside the active file's diff at the line range they target. Drafts must be visually distinguishable from published GitHub discussions and must no longer be duplicated in the bottom action pane.

## Tech Stack

Electron, React 18, TypeScript, Monaco Editor view zones, `react-markdown`, and the existing persisted `DraftReviewComment` model.

## Commands

- Test: `npm test`
- Typecheck: `npm run typecheck`
- Build: `npm run build`
- Dev: `npm run dev`

## Project Structure

- `src/renderer/src/App.tsx`: diff-position grouping, Monaco zones, and draft card rendering
- `src/renderer/styles.css`: draft card and badge styling
- `tests/comment-interaction.test.ts`: pure position-grouping behavior

## Code Style

Extend the existing view-zone pipeline with explicit types rather than converting drafts into fake GitHub discussions:

```ts
type DiffCommentGroup = {
  position: number;
  discussions: PullRequestDiscussion[];
  draftComments: DraftReviewComment[];
};
```

## Testing Strategy

Unit-test grouping for single-line drafts, line-range drafts, co-located published discussions, ordering, and unavailable lines. Run the complete test suite, typecheck, and production build after integration.

## Boundaries

- Always: retain draft persistence and full-range line highlighting; render draft Markdown with HTML disabled.
- Ask first: adding edit/delete behavior, changing persisted draft shape, or adding dependencies.
- Never: submit a draft to GitHub or represent a local draft as a published discussion.

## Success Criteria

- A draft appears in a Monaco view zone immediately after its selected line, or after the ending line for a range.
- Each draft card has a visible and screen-reader-readable **Draft** indicator.
- Published discussions and drafts targeting the same line share one ordered view zone.
- The action pane retains the draft count but no longer renders duplicate draft cards.
- Drafts with no visible target row are not attached to an incorrect line.
- Tests, typecheck, and build pass.

## Open Questions

None. Editing and deleting drafts remain separate future work.
