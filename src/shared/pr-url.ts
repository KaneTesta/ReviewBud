import type { PullRequestRef } from "./types.js";

export const reviewBudProtocol = "reviewbud";

export function parsePullRequestUrl(input: string): PullRequestRef {
  const trimmed = input.trim();

  if (!trimmed) {
    throw new Error("Enter a GitHub pull request URL.");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Enter a full GitHub pull request URL like https://github.com/owner/repo/pull/123.");
  }

  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/);

  if (url.hostname !== "github.com" || !match) {
    throw new Error("Enter a GitHub pull request URL like https://github.com/owner/repo/pull/123.");
  }

  return {
    owner: decodeURIComponent(match[1]),
    repo: decodeURIComponent(match[2]),
    number: Number(match[3]),
  };
}

export function isPullRequestUrl(input: string): boolean {
  try {
    parsePullRequestUrl(input);
    return true;
  } catch {
    return false;
  }
}

export function createReviewBudPullRequestUrl(pullRequestUrl: string): string {
  if (!isPullRequestUrl(pullRequestUrl)) {
    throw new Error("Enter a GitHub pull request URL like https://github.com/owner/repo/pull/123.");
  }

  const url = new URL(`${reviewBudProtocol}://review-pr`);
  url.searchParams.set("url", pullRequestUrl.trim());
  return url.toString();
}

export function pullRequestUrlFromReviewBudUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  if (url.protocol !== `${reviewBudProtocol}:` || url.hostname !== "review-pr") {
    return null;
  }

  const pullRequestUrl = url.searchParams.get("url");
  if (!pullRequestUrl || !isPullRequestUrl(pullRequestUrl)) {
    return null;
  }

  return pullRequestUrl;
}

export function pullRequestId(ref: PullRequestRef): string {
  return `${ref.owner}_${ref.repo}_${ref.number}`;
}
