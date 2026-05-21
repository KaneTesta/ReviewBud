import type { DiffRow, PullRequestDiscussion } from "./types";

export function discussionsForFile(
  discussions: PullRequestDiscussion[],
  filename: string,
): PullRequestDiscussion[] {
  return discussions.filter((discussion) => discussion.path === filename);
}

export function discussionAffectsDiffPosition(
  discussion: PullRequestDiscussion,
  position: number,
): boolean {
  return discussion.position === position;
}

export function discussionAffectsDiffRow(
  discussion: PullRequestDiscussion,
  row: DiffRow,
): boolean {
  if (discussion.line != null) {
    return discussion.side === "LEFT"
      ? row.oldLine === discussion.line
      : row.newLine === discussion.line;
  }

  return row.diffPosition != null && discussionAffectsDiffPosition(discussion, row.diffPosition);
}

export function shouldCollapseDiscussion(discussion: PullRequestDiscussion): boolean {
  return discussion.isResolved === true || discussion.isOutdated === true;
}

export function discussionStateLabels(discussion: PullRequestDiscussion): string[] {
  return [
    discussion.isResolved ? "Resolved" : null,
    discussion.isOutdated ? "Outdated" : null,
  ].filter((label): label is string => label !== null);
}
