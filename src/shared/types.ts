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
  isResolved?: boolean;
  isOutdated?: boolean;
  createdAt: string;
  url: string;
  kind: "review" | "comment";
}

export interface ReviewNote {
  file: string;
  status: "unread" | "reviewing" | "done" | "question";
  note: string;
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
}

export interface RecentPullRequest {
  id: string;
  title: string;
  url: string;
  owner: string;
  repo: string;
  number: number;
  loadedAt: string;
}

export interface DiffRow {
  text: string;
  kind: "hunk" | "added" | "removed" | "context";
  oldLine?: number;
  newLine?: number;
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
  source?: "language-service" | "language-server" | "raw-file";
}
