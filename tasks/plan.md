# Implementation Plan: Publish Finished Reviews

## Overview

Replace the local-only finish action with one vertical, typed flow from the modal through preload/IPC to GitHub's create-review endpoint, then refresh and persist the workspace.

## Architecture Decisions

- Submit one atomic REST review so the outcome, summary, and inline drafts are published together.
- Build the REST payload in a shared pure function so line/range and outcome mapping are directly testable.
- Main-process success clears submitted drafts immediately, then refreshes GitHub state on a best-effort basis so a refresh failure cannot invite a duplicate publish.
- Transport JSON through `gh api --input -` so nested comment arrays are encoded without shell interpolation.

## Task List

### Phase 1: Contract

- [x] Add typed submit request/payload mapping and unit tests.

### Checkpoint: Contract

- [x] Focused tests pass.

### Phase 2: Submission flow

- [x] Add GitHub transport, IPC/preload exposure, refresh, and draft clearing.
- [x] Connect the modal with pending/error feedback and publish wording.

### Checkpoint: Complete

- [x] Full tests, typecheck, and build pass.
- [x] Review the diff for draft-loss and duplicate-submit risks.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| A stale head SHA makes line comments invalid | Medium | Send the loaded head SHA and surface GitHub's error without clearing drafts. |
| Submission is retried accidentally | High | Disable modal controls and shortcut submission while pending. |
| Refresh overwrites local notes | Medium | Preserve notes while explicitly clearing only submitted draft fields. |

## Open Questions

None.
