# Spec: Sync File Viewed State to GitHub

## Objective

When a reviewer uses **Mark viewed** in ReviewBud, update the same per-file viewed state on GitHub. Toggling an already-viewed file back to unread must likewise unmark it on GitHub. Local review state changes only after GitHub accepts the mutation, and a failed mutation remains visible to the reviewer without falsely changing progress.

## Tech Stack

- Electron main/preload IPC boundary
- React 18 and TypeScript renderer
- GitHub CLI `gh api graphql`
- GitHub GraphQL `markFileAsViewed` and `unmarkFileAsViewed` mutations
- Node test runner with `tsx`

## Commands

- Test: `npm test`
- Typecheck: `npm run typecheck`
- Build: `npm run build`
- Dev: `npm run dev`

## Project Structure

- `src/shared/` — typed viewed-state request contract and pure GraphQL request construction
- `src/main/` — authenticated GitHub lookup/mutation and IPC handler
- `src/preload/` — typed renderer-to-main API
- `src/renderer/` — viewed-toggle request state, local persistence, and error feedback
- `tests/` — mutation mapping and renderer interaction coverage

## Code Style

Pass a typed, GitHub-agnostic intent across the renderer boundary and keep GraphQL details in the main process:

```ts
await window.prTool.setFileViewed({
  owner: summary.owner,
  repo: summary.repo,
  number: summary.number,
  path: currentFile.filename,
  viewed: !currentFileViewed,
});
```

Use existing camelCase TypeScript names, explicit request interfaces, async functions, and the existing `Error` normalization pattern in the renderer.

## Testing Strategy

- Unit-test that viewed and unviewed intents select the correct GitHub GraphQL mutation and variables.
- Interaction-test that the renderer calls the preload API with the current PR/file identity and desired state.
- Interaction-test that local `ReviewNote` progress changes only after the GitHub request succeeds and remains unchanged when it fails.
- Verify repeated activation is disabled while the current file mutation is in flight.
- Run the full unit suite, TypeScript checks, and production build.
- Do not mutate a real pull request during automated verification.

## Boundaries

- Always: route GitHub access through the Electron main process, reuse `gh` authentication, support both mark and unmark, report failures, and retain local state on failure.
- Ask first: add dependencies, change GitHub authentication, alter persisted storage format, or run the mutation against a real pull request.
- Never: expose credentials to the renderer, silently swallow GitHub failures, or claim a file is viewed locally before a failed remote operation has completed.

## Success Criteria

- Activating **Mark viewed** invokes GitHub's `markFileAsViewed` mutation for the active pull request and exact file path.
- Activating **Viewed** invokes GitHub's `unmarkFileAsViewed` mutation for the same pull request and path.
- GitHub receives the pull request GraphQL node ID resolved from owner, repository, and pull request number.
- The local note, viewed counter, and completion flow update after the remote mutation succeeds and continue to persist through the existing local save path.
- While a mutation is running, duplicate activations for the current file are ignored and the control communicates its busy state.
- On failure, the prior local viewed state is retained and an accessible error message is displayed.
- Existing review-state behavior, tests, typechecking, and production build continue to pass.

## Open Questions

None. This scope propagates user-initiated changes outward to GitHub; importing GitHub's existing `viewerViewedState` when a pull request loads is a separate synchronization feature.
