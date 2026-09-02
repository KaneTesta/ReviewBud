# Spec: Pull Request Description Modal

## Objective

Let reviewers open the pull request description without leaving the diff. A toolbar button appears between **Mark viewed** and **Finish review**, and the platform shortcut is Cmd+Up on macOS or Ctrl+Up elsewhere.

## Implementation

- Read Markdown from the already-loaded `workspace.pullRequest.summary.body`.
- Render it with the existing safe `MarkdownBody` component.
- Show a clear empty state when the author did not provide a description.
- Keep focus within the modal and close it with Escape.

## Verification

- `npm test`
- `npm run typecheck`
- `npm run build`

## Success Criteria

- The **View PR description** button is between **Mark viewed** and **Finish review**.
- Cmd+Up on macOS (Ctrl+Up elsewhere) opens the modal outside typing controls.
- The modal renders the current PR description as Markdown and handles an empty description.
- Existing tests, typecheck, and build pass.
