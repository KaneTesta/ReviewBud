# Publish Finished Reviews Tasks

## Task 1: Define and test the review-submission contract

**Description:** Add the typed renderer/main request and pure GitHub REST payload mapping.

**Acceptance criteria:**
- [x] Outcomes map to GitHub review events.
- [x] Single and multi-line drafts map to right-side line coordinates.
- [x] Blank inline draft bodies are rejected.

**Verification:**
- [x] `node --import tsx --test tests/review-submission.test.ts`

**Dependencies:** None

**Files likely touched:**
- `src/shared/types.ts`
- `src/shared/review-submission.ts`
- `tests/review-submission.test.ts`

**Estimated scope:** Small

## Task 2: Publish and persist through the Electron boundary

**Description:** Send the atomic review through GitHub, refresh the PR, preserve notes, and clear submitted drafts after success.

**Acceptance criteria:**
- [x] Main invokes the authenticated GitHub endpoint.
- [x] IPC/preload exposes one typed submission call.
- [x] Failure cannot clear local drafts.

**Verification:**
- [x] `npm run typecheck`

**Dependencies:** Task 1

**Files likely touched:**
- `src/main/github.ts`
- `src/main/ipc.ts`
- `src/main/storage.ts`
- `src/preload/index.ts`

**Estimated scope:** Medium

## Task 3: Connect the finish-review modal

**Description:** Replace the local save action with publishing feedback and duplicate-submit protection.

**Acceptance criteria:**
- [x] Primary action reads **Publish review**.
- [x] Publishing state disables closing and resubmission.
- [x] Errors stay visible in the open modal; success closes it.

**Verification:**
- [x] `npm test`
- [x] `npm run typecheck`
- [x] `npm run build`

**Dependencies:** Task 2

**Files likely touched:**
- `src/renderer/src/App.tsx`
- `src/renderer/styles.css`
- `tests/comment-interaction.test.ts`

**Estimated scope:** Small

## Task 4: Review the complete change

**Description:** Inspect the final diff for draft-loss, duplicate-submit, and regression risks.

**Acceptance criteria:**
- [x] All success criteria are met without unrelated changes.

**Verification:**
- [x] Inspect `git diff` and rerun the full verification suite.

**Dependencies:** Tasks 1-3

**Files likely touched:** All changed files

**Estimated scope:** Small
