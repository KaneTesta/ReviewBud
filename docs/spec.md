# Spec: Local Pull Request Review Tool

## Objective
Build a local Electron app for reading and understanding GitHub pull requests without using the GitHub web UI and without checking out the PR branch in the user's active workspace. The app should let the user paste a PR URL, fetch metadata/diffs through the GitHub CLI, cache the result locally, and review changed files in a focused desktop UI.

Success means the user can review a PR while Codex continues running in another checkout, with no branch switching and no mutation of the target repository. The user can also Cmd-click symbols in the diff to open surrounding implementation context in the right-hand pane without losing their current file position.

## Tech Stack
- Electron for the desktop shell
- TypeScript for main, preload, renderer, and tests
- Vite for renderer build and development
- React for UI
- Node `child_process` for invoking `gh api`
- TypeScript language service for TS/JS definition lookup against app-owned snapshots
- Node `node:test` for unit tests that do not need browser or GitHub access

## Commands
- Install: `npm install`
- Dev: `npm run dev`
- Build: `npm run build`
- Typecheck: `npm run typecheck`
- Test: `npm test`
- Electron preview: `npm run start`

## Project Structure
- `src/main` -> Electron main process, IPC handlers, GitHub fetching, local cache
- `src/main/source-snapshot.ts` -> App-owned hidden source snapshots for language intelligence
- `src/main/typescript-intelligence.ts` -> TypeScript/JavaScript definition lookup over snapshots
- `src/preload` -> Safe renderer bridge
- `src/renderer` -> React app, CSS, UI components
- `src/shared` -> Shared types and pure utilities
- `tests` -> Unit tests for parsing and data transforms
- `docs` -> Spec and implementation plan
- `dist` -> Compiled main/preload output
- `dist-renderer` -> Vite renderer output

## Code Style
Use explicit types at process boundaries and keep untrusted external data validation close to the boundary.

```ts
export function parsePullRequestUrl(input: string): PullRequestRef {
  const url = new URL(input.trim());
  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/);

  if (url.hostname !== "github.com" || !match) {
    throw new Error("Enter a GitHub pull request URL like https://github.com/owner/repo/pull/123");
  }

  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}
```

Conventions:
- Prefer small modules with narrow responsibilities.
- Keep renderer state simple with React hooks.
- Treat all GitHub/API data as untrusted until normalized.
- Avoid mutating user repositories; all persistence goes to Electron `userData`.

## Testing Strategy
- Unit-test pure logic with `node:test`.
- Typecheck main, preload, renderer, and tests with `tsc --noEmit`.
- Build both Electron and renderer bundles before considering the app working.
- Manual verification: run the app with `npm run dev`, paste a PR URL, and confirm metadata, files, diff, and notes render.

## Boundaries
- Always: Use `gh api` or cache for PR data; keep target repo checkout untouched; validate PR URLs; handle missing GitHub auth clearly.
- Always: Store source snapshots only under Electron `userData`; never modify the user's active checkout.
- Ask first: Adding nonessential dependencies, writing outside this repo, mutating a remote PR, or performing review actions on GitHub.
- Never: Checkout PR branches, commit secrets, store GitHub tokens in project files, or execute arbitrary user-entered shell commands.

## Success Criteria
- User can paste a GitHub PR URL and load PR title, author, branch labels, status, changed file list, reviews/comments, and unified diff text.
- User can select files, filter changed files, and scan additions/deletions in a local UI.
- User can Cmd-click a function or symbol in a diff line and inspect the definition from a TS/JS language-service snapshot when available, with raw PR-head file context as fallback.
- User can add local review notes and file status labels without sending anything to GitHub.
- The app caches PR payloads under Electron `userData` and can reload recently opened PRs.
- `npm run build`, `npm run typecheck`, and `npm test` complete successfully.

## Open Questions
- Whether posting final review comments back to GitHub should be added later.
- Whether the user wants AI summarization of large diffs in a future slice.
