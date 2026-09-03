# File Viewed GitHub Sync Tasks

## Task 1: Add the typed GitHub mutation foundation

**Description:** Retain the GitHub pull request node ID, define the viewed-state request, and add a pure mapping from desired state to GraphQL mutation details.

**Acceptance criteria:**
- [x] Pull request summaries expose the GitHub node ID returned by the REST API.
- [x] Viewed `true` maps to `markFileAsViewed`; viewed `false` maps to `unmarkFileAsViewed`.
- [x] The exact pull request ID and file path are supplied as GraphQL variables.

**Verification:**
- [x] Focused test passes: `node --import tsx --test tests/github-file-viewed.test.ts`

**Dependencies:** None

**Files likely touched:**
- `src/shared/types.ts`
- `src/main/github.ts`
- `tests/github-file-viewed.test.ts`

**Estimated scope:** Medium (3 files)

## Task 2: Expose file-viewed mutation over IPC

**Description:** Register the main-process handler and add the typed preload method used by the renderer.

**Acceptance criteria:**
- [x] Renderer code can request a viewed-state change without direct GitHub access.
- [x] IPC delegates to the authenticated main-process GitHub function.

**Verification:**
- [x] Typecheck passes: `npm run typecheck`

**Dependencies:** Task 1

**Files likely touched:**
- `src/main/ipc.ts`
- `src/preload/index.ts`

**Estimated scope:** Small (2 files)

## Task 3: Synchronize the renderer toggle

**Description:** Await GitHub before applying the local viewed toggle, guard duplicate activation, persist the successful local state, and display mutation failures.

**Acceptance criteria:**
- [x] Button and keyboard toggles send the active pull request ID, exact file path, and desired state.
- [x] The viewed control is disabled while pending.
- [x] Success updates/persists local progress; failure retains prior state and shows an error.

**Verification:**
- [x] Full tests pass: `npm test`
- [x] Typecheck passes: `npm run typecheck`
- [x] Build succeeds: `npm run build`

**Dependencies:** Tasks 1 and 2

**Files likely touched:**
- `src/renderer/src/App.tsx`
- `tests/review-state.test.ts`

**Estimated scope:** Small (2 files)

## Final Checkpoint

- [x] All specification success criteria are met.
- [x] No real pull request was mutated during verification.
- [x] Code review reports no blocking findings.

## Task 4: Import viewed state from GitHub

**Description:** Fetch all paginated `PullRequestChangedFile.viewerViewedState` values and merge them into REST file details by exact path.

**Acceptance criteria:**
- [x] `VIEWED` maps to `PullRequestFile.viewed === true`.
- [x] `UNVIEWED`, `DISMISSED`, and missing matches map to false.
- [x] GraphQL pagination retrieves more than 100 changed files.

**Verification:**
- [x] Focused tests pass: `node --import tsx --test tests/github-file-viewed.test.ts`

**Dependencies:** Task 1

**Files likely touched:**
- `src/shared/types.ts`
- `src/main/github.ts`
- `tests/github-file-viewed.test.ts`

**Estimated scope:** Medium (3 files)

## Task 5: Remove locally persisted viewed status

**Description:** Reduce local review notes to note text, strip legacy statuses when loading/saving, and calculate progress from GitHub-backed files.

**Acceptance criteria:**
- [x] `ReviewNote` has no status field.
- [x] Legacy cached status fields are absent from normalized and newly saved workspaces.
- [x] Review progress counts `PullRequestFile.viewed` values.

**Verification:**
- [x] Focused tests pass: `node --import tsx --test tests/review-state.test.ts tests/review-submission-storage.test.ts`

**Dependencies:** Task 4

**Files likely touched:**
- `src/shared/types.ts`
- `src/shared/review-state.ts`
- `src/main/storage.ts`
- `tests/review-state.test.ts`
- `tests/review-submission-storage.test.ts`

**Estimated scope:** Medium (5 files)

## Task 6: Use GitHub-backed viewed state in the renderer

**Description:** Read current/progress state from pull request files and update only the in-memory file after a successful GitHub mutation.

**Acceptance criteria:**
- [x] Button, diff badge, progress count, and completion flow use `PullRequestFile.viewed`.
- [x] Successful toggles do not persist a note status.
- [x] Failed toggles retain the prior file state and show an error.

**Verification:**
- [x] Full tests pass: `npm test`
- [x] Typecheck passes: `npm run typecheck`
- [x] Build succeeds: `npm run build`

**Dependencies:** Tasks 4 and 5

**Files likely touched:**
- `src/renderer/src/App.tsx`
- `tests/review-state.test.ts`

**Estimated scope:** Small (2 files)

## GitHub-only State Checkpoint

- [x] All revised specification success criteria are met.
- [x] No real pull request was mutated during verification.
- [x] Code review reports no blocking findings.
