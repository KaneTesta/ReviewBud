# Implementation Plan: Local Pull Request Review Tool

## Overview
Create a working Electron app from an empty repository. The first version is read-only against GitHub: it fetches PR data through `gh api`, caches it locally, and renders a compact review workspace with PR context, files, diff viewing, and local notes.

## Architecture Decisions
- Use the GitHub CLI instead of direct token management so the app can reuse the user's existing authentication and avoid storing secrets.
- Keep all GitHub access in Electron main process; renderer can only call typed preload APIs.
- Cache normalized PR payloads and user notes in Electron `userData`, not inside target repositories.
- Start with unified diff viewing rather than branch checkout, worktrees, or local repo mutation.
- Hydrate app-owned source snapshots under Electron `userData` for code intelligence. The user's active checkout is never touched.
- Use the TypeScript language service for TS/JS definition lookup first; fall back to raw GitHub file context for unsupported languages or snapshot failures.

## Task List

### Phase 1: Foundation
- [x] Task 1: Add project scaffold and documentation.
  - Acceptance: package scripts, TypeScript configs, Electron entrypoints, and docs exist.
  - Verify: `npm run typecheck`
  - Files: `package.json`, `tsconfig*.json`, `src/main`, `src/preload`, `src/renderer`, `docs`

- [x] Task 2: Add PR URL parsing and tests.
  - Acceptance: valid GitHub PR URLs parse; invalid URLs fail with helpful errors.
  - Verify: `npm test`
  - Files: `src/shared/pr-url.ts`, `tests/pr-url.test.ts`

### Phase 2: Core Review Flow
- [x] Task 3: Implement GitHub data fetching without checkout.
  - Acceptance: main process can fetch PR metadata, files, reviews/comments, and diff via `gh api`.
  - Verify: `npm run typecheck`
  - Files: `src/main/github.ts`, `src/main/ipc.ts`, `src/shared/types.ts`

- [x] Task 4: Implement local cache and notes.
  - Acceptance: loaded PRs and local review notes persist under Electron `userData`.
  - Verify: `npm run typecheck`
  - Files: `src/main/storage.ts`, `src/main/ipc.ts`, `src/shared/types.ts`

- [x] Task 5: Build the reviewer UI.
  - Acceptance: user can paste a PR URL, load/cache a PR, select files, filter files, inspect diff, and write local notes.
  - Verify: `npm run build`
  - Files: `src/renderer/App.tsx`, `src/renderer/styles.css`, `src/preload/index.ts`

### Phase 3: Verification
- [x] Task 6: Run tests, typecheck, and build.
  - Acceptance: verification commands pass or blockers are documented.
  - Verify: `npm test`, `npm run typecheck`, `npm run build`
  - Files: no production file changes expected

### Phase 4: Symbol Context
- [x] Task 7: Add diff line mapping and symbol context extraction.
  - Acceptance: changed/context diff lines map to PR head line numbers; implementation context extraction returns a useful code window around a clicked symbol.
  - Verify: `npm test`
  - Files: `src/shared/symbol-context.ts`, `tests/symbol-context.test.ts`

- [x] Task 8: Fetch symbol context from the PR head without checkout.
  - Acceptance: main process fetches full file content from the PR head repository/SHA via `gh api` and returns extracted context through IPC.
  - Verify: `npm run typecheck`
  - Files: `src/main/github.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/types.ts`

- [x] Task 9: Open symbol context in the right-hand pane on Cmd-click.
  - Acceptance: renderer tokenizes diff lines, Cmd-clicking an identifier opens implementation context in the right rail while preserving the selected PR file.
  - Verify: `npm run build`
  - Files: `src/renderer/src/App.tsx`, `src/renderer/styles.css`

- [x] Task 10: Add app-owned source snapshots and TS/JS definition lookup.
  - Acceptance: app clones/checks out the PR head SHA under Electron `userData`, resolves TypeScript/JavaScript definitions from that snapshot, and falls back to raw GitHub file context when unavailable.
  - Verify: `npm test`, `npm run typecheck`, `npm run build`
  - Files: `src/main/source-snapshot.ts`, `src/main/typescript-intelligence.ts`, `src/main/github.ts`, `tests/typescript-intelligence.test.ts`

## Risks and Mitigations
| Risk | Impact | Mitigation |
| --- | --- | --- |
| User does not have `gh` installed or authenticated | High | Detect command failures and show setup-oriented errors. |
| Large diffs become hard to scan | Medium | File filtering and per-file selection in v1; add virtualized diff later if needed. |
| GitHub API shape changes | Medium | Normalize at the main-process boundary and keep renderer using internal types. |
| Renderer access to Node APIs | High | Use sandboxed preload bridge and no direct Node integration in renderer. |

## Open Questions
- Should future versions create local review comments on GitHub or remain purely read-only?
- Should AI-generated summaries be stored locally, and which model/provider should power them?
