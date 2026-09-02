# Spec: Publish Finished Reviews

## Objective

Make **Finish review** submit a real GitHub pull-request review instead of only saving a local draft. The submitted review includes the selected outcome, the overall Markdown body, and all current inline draft comments.

## Tech Stack

- Electron main/preload IPC boundary
- React and TypeScript renderer
- GitHub CLI `gh api` against the pull-request reviews REST endpoint
- Node test runner with `tsx`

## Commands

- Test: `npm test`
- Typecheck: `npm run typecheck`
- Build: `npm run build`
- Dev: `npm run dev`

## Project Structure

- `src/shared/` — request contracts and pure review-submission mapping
- `src/main/` — authenticated GitHub request and persisted workspace refresh
- `src/preload/` — typed renderer-to-main API
- `src/renderer/` — modal submission state and feedback
- `tests/` — pure contract and interaction tests

## Code Style

Use typed request objects and keep GitHub-specific values out of the renderer:

```ts
await window.prTool.submitReview({
  owner,
  repo,
  number,
  headSha,
  outcome,
  body,
  comments,
});
```

## Testing Strategy

- Unit-test outcome and inline-range conversion to the GitHub REST payload.
- Test review-state clearing separately from GitHub transport behavior.
- Run the full unit suite, TypeScript checks, and production build.
- Manually verify that the modal reports publishing progress/errors and does not dismiss on failure.

## Boundaries

- Always: submit through the main process, trim/validate comment bodies, preserve drafts on failure, clear submitted drafts only after success.
- Ask first: add dependencies, alter GitHub authentication, or publish a review against a real PR during verification.
- Never: expose credentials to the renderer, silently discard drafts, or create a pending GitHub review.

## Success Criteria

- The primary modal action is labelled **Publish review** and invokes GitHub.
- Outcomes map to `APPROVE`, `REQUEST_CHANGES`, and `COMMENT`.
- Inline drafts use current-file `RIGHT` line/range coordinates in the atomic review request.
- Duplicate submissions are disabled while a request is active.
- GitHub errors remain visible in the open modal and all drafts remain available.
- Success clears submitted draft comments/review state, closes the modal, and refreshes the PR workspace when that follow-up fetch succeeds.

## Open Questions

None. This implementation assumes local drafts describe lines on the right side of the current diff, matching how the editor creates them.
