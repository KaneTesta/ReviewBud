import type {
  DraftReviewComment,
  PullRequestReviewSubmissionRequest,
  ReviewOutcome,
} from "./types.js";

export type GitHubReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

export interface GitHubReviewCommentPayload {
  path: string;
  line: number;
  side: "RIGHT";
  body: string;
  start_line?: number;
  start_side?: "RIGHT";
}

export interface GitHubReviewPayload {
  commit_id: string;
  event: GitHubReviewEvent;
  body: string;
  comments: GitHubReviewCommentPayload[];
}

const reviewEvents: Record<ReviewOutcome, GitHubReviewEvent> = {
  approve: "APPROVE",
  "request-changes": "REQUEST_CHANGES",
  comment: "COMMENT",
};

export function buildGitHubReviewPayload(
  request: PullRequestReviewSubmissionRequest,
): GitHubReviewPayload {
  if (!Number.isInteger(request.number) || request.number <= 0) {
    throw new Error("Pull request number must be a positive integer.");
  }

  if (!isRepositorySegment(request.owner) || !isRepositorySegment(request.repo)) {
    throw new Error("Pull request owner and repository are invalid.");
  }

  if (!Object.hasOwn(reviewEvents, request.outcome)) {
    throw new Error("Review outcome is invalid.");
  }

  const body = request.body.trim();
  if (request.outcome !== "approve" && !body) {
    throw new Error("Review body is required for comments and change requests.");
  }

  if (!request.headSha.trim()) {
    throw new Error("Pull request head SHA is required.");
  }

  return {
    commit_id: request.headSha,
    event: reviewEvents[request.outcome],
    body,
    comments: request.comments.map(toGitHubReviewComment),
  };
}

function toGitHubReviewComment(comment: DraftReviewComment): GitHubReviewCommentPayload {
  const body = comment.body.trim();
  if (!body) {
    throw new Error("Draft comment body is required.");
  }

  if (!comment.file.trim() || comment.file.includes("\0")) {
    throw new Error("Draft comment file is invalid.");
  }

  if (
    !Number.isInteger(comment.startLine) ||
    !Number.isInteger(comment.endLine) ||
    comment.startLine <= 0 ||
    comment.endLine <= 0
  ) {
    throw new Error("Draft comment lines must be positive integers.");
  }

  const startLine = Math.min(comment.startLine, comment.endLine);
  const endLine = Math.max(comment.startLine, comment.endLine);
  const payload: GitHubReviewCommentPayload = {
    path: comment.file,
    line: endLine,
    side: "RIGHT",
    body,
  };

  if (startLine !== endLine) {
    payload.start_line = startLine;
    payload.start_side = "RIGHT";
  }

  return payload;
}

function isRepositorySegment(value: string): boolean {
  return Boolean(value.trim()) && !/[\/\u0000-\u001f]/.test(value);
}
