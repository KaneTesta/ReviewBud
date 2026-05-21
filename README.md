# ReviewBud

ReviewBud is a local Electron app for reading GitHub pull requests without using the GitHub web UI and without checking out PR branches in your active workspace.

Paste a pull request URL, fetch the PR through the GitHub CLI, review metadata and diffs in a focused desktop UI, add local notes, and Cmd-click symbols in TypeScript or JavaScript diffs to inspect surrounding implementation context.

## Requirements

- Node.js 20 or newer
- npm
- GitHub CLI (`gh`) installed and authenticated

```bash
gh auth status
```

## Quick Start

```bash
npm install
npm run dev
```

In the app, paste a GitHub pull request URL such as:

```text
https://github.com/owner/repo/pull/123
```

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite renderer and Electron app in development mode |
| `npm run start` | Start Electron from the built main process output |
| `npm run build` | Build the Electron main/preload files and Vite renderer |
| `npm run typecheck` | Typecheck the project |
| `npm test` | Run unit tests with Node's test runner |

## Project Structure

| Path | Purpose |
| --- | --- |
| `src/main` | Electron main process, GitHub access, IPC handlers, local storage, source snapshots, and TypeScript intelligence |
| `src/preload` | Safe renderer bridge exposed to the React app |
| `src/renderer` | React renderer UI and styles |
| `src/shared` | Shared types and pure utilities |
| `tests` | Unit tests for URL parsing, symbol context, and TypeScript intelligence |
| `docs` | Product spec and implementation plan |

## How It Works

ReviewBud shells out to `gh api` from the Electron main process so it can reuse your existing GitHub authentication without storing tokens in the project. Pull request payloads, local notes, and app-owned source snapshots are stored under Electron `userData`.

The app is designed to keep your active repository checkout untouched. It does not check out PR branches, change worktrees, or write review state into the target repository.

## Verification

Before shipping changes, run:

```bash
npm test
npm run typecheck
npm run build
```

## Boundaries

- GitHub access stays in the Electron main process.
- Renderer code talks to the main process through typed preload APIs.
- External GitHub data is normalized before use.
- Local persistence belongs in Electron `userData`, not in target repositories.
- GitHub tokens and secrets must not be committed.
