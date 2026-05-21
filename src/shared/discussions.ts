import type { PullRequestDiscussion } from "./types";

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

export function shouldCollapseDiscussion(discussion: PullRequestDiscussion): boolean {
  return discussion.isResolved === true || discussion.isOutdated === true;
}

export function discussionStateLabels(discussion: PullRequestDiscussion): string[] {
  return [
    discussion.isResolved ? "Resolved" : null,
    discussion.isOutdated ? "Outdated" : null,
  ].filter((label): label is string => label !== null);
}
