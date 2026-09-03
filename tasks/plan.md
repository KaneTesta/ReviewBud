# Implementation Plan: Sync File Viewed State to GitHub

## Overview

Extend the existing local viewed toggle into a complete renderer-to-GitHub flow. The pull request's GraphQL node ID will be retained during normalization, the main process will select the supported GitHub viewed/unviewed mutation, and the renderer will update local progress only after GitHub succeeds.

## Architecture Decisions

- Retain GitHub's pull request `node_id` in `PullRequestSummary` so each toggle requires one GraphQL mutation rather than an extra lookup.
- Pass a typed `{ pullRequestId, path, viewed }` intent through preload IPC; GraphQL syntax remains isolated in `src/main/github.ts`.
- Fetch the complete paginated `viewerViewedState` collection at PR load and merge it into REST file data by exact path.
- Use `PullRequestFile.viewed` as the only viewed-state model; local `ReviewNote` data stores note text only.
- Use a pessimistic renderer update: disable the viewed control while pending, then update the in-memory file after success or show an error while retaining the prior state.
- Reuse the existing top-level error banner and serialized local review-state save path.

## Task List

### Phase 1: GitHub mutation foundation

- [x] Task 1: Define and test the file-viewed request and GraphQL mutation mapping.

### Checkpoint: Foundation

- [x] Focused viewed-state tests pass.
- [x] The type contract contains the GitHub node ID and file-viewed request.

### Phase 2: End-to-end wiring

- [x] Task 2: Connect the GitHub mutation through main-process IPC and preload.
- [x] Task 3: Make the renderer await GitHub, prevent duplicate toggles, persist success, and report failure.

### Checkpoint: Complete

- [x] Mark and unmark paths both reach the intended GraphQL mutations.
- [x] Local state cannot diverge after a failed mutation.
- [x] Unit tests, typecheck, and production build pass.
- [x] Changes are reviewed against the approved specification.

### Phase 3: GitHub-only source of truth

- [x] Task 4: Fetch and normalize every changed file's GitHub viewed state.
- [x] Task 5: Remove viewed status from local notes and migrate legacy cached workspaces.
- [x] Task 6: Drive renderer progress and toggles exclusively from the GitHub-backed file model.

### Checkpoint: GitHub-only state

- [x] Paginated GitHub viewed states cover every changed file.
- [x] Local workspace JSON no longer contains note status fields.
- [x] Reloading a PR replaces in-memory viewed state with GitHub's current state.
- [x] Unit tests, typecheck, production build, and code review pass.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Older cached workspaces lack the new node ID | Medium | Fresh PR loading already normalizes and saves the current GitHub payload; reject a missing ID clearly at the mutation boundary. |
| Repeated shortcut/button activation sends conflicting mutations | Medium | Guard and disable the toggle while one mutation is active. |
| GitHub mutation fails | Low | Retain the prior in-memory file state and show the existing accessible error banner. |
| Existing renderer edits overlap this feature | Medium | Patch only the viewed-state sections and preserve all unrelated changes. |
| GitHub returns `DISMISSED` after a viewed file changes | Medium | Treat only `VIEWED` as viewed; `DISMISSED` and `UNVIEWED` both map to false. |
| A pull request has more than 100 changed files | Medium | Use GraphQL cursor pagination with `gh api --paginate --slurp`. |
| Legacy cached notes contain viewed statuses | Medium | Normalize every note to `{ file, note }` before returning or writing a workspace. |

## Open Questions

None.
