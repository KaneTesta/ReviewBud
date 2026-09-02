export interface PullRequestRef {
  owner: string;
  repo: string;
  number: number;
}

export interface PullRequestSummary extends PullRequestRef {
  id: string;
  url: string;
  title: string;
  state: string;
  author: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  baseRef: string;
  headRef: string;
  headRepoFullName: string;
  headSha: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  mergeable: string | null;
  reviewDecision: string | null;
}

export interface PullRequestFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch: string;
}

export interface PullRequestDiscussion {
  id: string;
  author: string;
  body: string;
  path?: string;
  position?: number;
  line?: number;
  side?: "LEFT" | "RIGHT";
  startLine?: number;
  startSide?: "LEFT" | "RIGHT";
  isResolved?: boolean;
  isOutdated?: boolean;
  createdAt: string;
  url: string;
  kind: "review" | "comment";
}

export interface PullRequestDiscussionReplyRequest extends PullRequestRef {
  discussionId: string;
  body: string;
}

export interface ReviewNote {
  file: string;
  status: "unread" | "reviewing" | "done" | "question";
  note: string;
}

export interface DraftReviewComment {
  id: string;
  file: string;
  startLine: number;
  endLine: number;
  body: string;
  createdAt: string;
}

export type ReviewOutcome = "approve" | "request-changes" | "comment";

export interface DraftReviewSubmission {
  outcome: ReviewOutcome;
  body: string;
  submittedAt: string;
}

export interface PullRequestReviewSubmissionRequest extends PullRequestRef {
  headSha: string;
  outcome: ReviewOutcome;
  body: string;
  comments: DraftReviewComment[];
}

export interface CachedPullRequest {
  summary: PullRequestSummary;
  files: PullRequestFile[];
  discussions: PullRequestDiscussion[];
  diff: string;
  loadedAt: string;
}

export interface ReviewWorkspace {
  pullRequest: CachedPullRequest;
  notes: ReviewNote[];
  draftComments?: DraftReviewComment[];
  draftReview?: DraftReviewSubmission | null;
}

export interface DiffRow {
  text: string;
  kind: "hunk" | "added" | "removed" | "context";
  diffPosition?: number;
  oldLine?: number;
  newLine?: number;
  collapsedLines?: number;
  collapsedOldStart?: number;
  collapsedNewStart?: number;
  collapsedExpanded?: boolean;
}

export interface RepositorySummary {
  fullName: string;
  owner: string;
  repo: string;
  description: string;
  updatedAt: string;
  isStarred?: boolean;
}

export interface PullRequestListItem extends PullRequestRef {
  id: string;
  url: string;
  title: string;
  state: string;
  author: string;
  updatedAt: string;
}

export interface SymbolContextRequest {
  owner: string;
  repo: string;
  number: number;
  file: string;
  line: number;
  column?: number;
  symbol: string;
  headRepoFullName?: string;
  headSha?: string;
}

export interface SymbolContext {
  file: string;
  symbol: string;
  title: string;
  startLine: number;
  endLine: number;
  code: string;
  sourceCode?: string;
  source?: "language-service" | "language-server" | "raw-file";
}

export interface SnippetExplanationRequest extends PullRequestRef {
  pullRequestTitle: string;
  pullRequestDescription: string;
  file: string;
  filePatch: string;
  startLine: number;
  endLine: number;
  code: string;
  headRepoFullName: string;
  headSha: string;
}

export interface SnippetExplanation {
  file: string;
  startLine: number;
  endLine: number;
  code: string;
  markdown: string;
}
