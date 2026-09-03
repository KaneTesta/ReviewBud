# Spec: Sync File Viewed State to GitHub

## Objective

Make GitHub the only source of truth for per-file viewed state. ReviewBud fetches each changed file's `viewerViewedState` when loading a pull request, displays and calculates progress from that state, and writes toggle changes back to GitHub. ReviewBud must not persist viewed/unviewed state in local review notes, and legacy cached note statuses must be removed when a workspace is normalized or saved.

## Tech Stack

- Electron main/preload IPC boundary
- React 18 and TypeScript renderer
- GitHub CLI `gh api graphql`
- GitHub GraphQL `PullRequestChangedFile.viewerViewedState`
- GitHub GraphQL `markFileAsViewed` and `unmarkFileAsViewed` mutations
- Node test runner with `tsx`

## Commands

- Test: `npm test`
- Typecheck: `npm run typecheck`
- Build: `npm run build`
- Dev: `npm run dev`

## Project Structure

- `src/shared/` — remote file-viewed model, typed mutation request, and pure review-progress helpers
- `src/main/` — paginated GitHub viewed-state fetch, mutation, IPC handler, and local cache normalization
- `src/preload/` — typed renderer-to-main API
- `src/renderer/` — GitHub-backed viewed toggle state and error feedback
- `tests/` — remote normalization, legacy cache migration, mutation mapping, and renderer state coverage

## Code Style

Pass a typed, GitHub-agnostic intent across the renderer boundary and keep GraphQL details in the main process:

```ts
await window.prTool.setFileViewed({
  pullRequestId: summary.nodeId,
  path: currentFile.filename,
  viewed: !currentFile.viewed,
});
```

Use existing camelCase TypeScript names, explicit request interfaces, async functions, and the existing `Error` normalization pattern in the renderer.

## Testing Strategy

- Unit-test normalization of paginated `viewerViewedState` results, including `VIEWED`, `UNVIEWED`, and `DISMISSED`.
- Unit-test that REST file payloads are merged with GitHub viewed states by exact path.
- Unit-test that local workspace normalization strips legacy note `status` fields and never writes them back.
- Unit-test that viewed and unviewed intents select the correct GitHub GraphQL mutation and variables.
- Interaction-test that the renderer updates the in-memory file model only after GitHub succeeds and retains it on failure.
- Verify repeated activation is disabled while the current file mutation is in flight.
- Run the full unit suite, TypeScript checks, and production build.
- Do not mutate a real pull request during automated verification.

## Boundaries

- Always: route GitHub access through the Electron main process, fetch all viewed-state pages, treat only `VIEWED` as viewed, support mark and unmark, strip legacy local status data, and report failures.
- Ask first: add dependencies, change GitHub authentication, delete entire cached workspaces, or run a mutation against a real pull request.
- Never: expose credentials to the renderer, derive viewed progress from local notes, persist viewed status locally, silently swallow GitHub failures, or treat `DISMISSED` as viewed.

## Success Criteria

- Loading a pull request fetches every changed file's `viewerViewedState` from GitHub with pagination.
- Each `PullRequestFile` carries a boolean viewed value derived from GitHub; `VIEWED` maps to true while `UNVIEWED` and `DISMISSED` map to false.
- `ReviewNote` contains only locally owned note data; viewed status is neither read from nor written to local workspace storage.
- Existing cached note statuses are stripped during workspace normalization and subsequent saves.
- Activating **Mark viewed** invokes GitHub's `markFileAsViewed` mutation for the active pull request and exact file path.
- Activating **Viewed** invokes GitHub's `unmarkFileAsViewed` mutation for the same pull request and path.
- GitHub receives the pull request GraphQL node ID retained from the pull request REST response.
- The in-memory file, viewed counter, and completion flow update after the remote mutation succeeds without persisting viewed state locally.
- While a mutation is running, duplicate activations for the current file are ignored and the control communicates its busy state.
- On failure, the prior GitHub-backed file state is retained and an accessible error message is displayed.
- Existing review-state behavior, tests, typechecking, and production build continue to pass.

## Open Questions

None. GitHub is authoritative. Reloading a pull request may therefore replace the current in-memory viewed state with newer state changed by another GitHub client.
