import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  CachedPullRequest,
  PullRequestDiscussion,
  PullRequestFile,
  PullRequestRef,
  PullRequestSummary,
  SymbolContext,
  SymbolContextRequest,
} from "../shared/types.js";
import { pullRequestId } from "../shared/pr-url.js";
import { extractSymbolContext } from "../shared/symbol-context.js";
import { ensureSourceSnapshot } from "./source-snapshot.js";
import { resolveTypeScriptSymbolContext } from "./typescript-intelligence.js";

const execFileAsync = promisify(execFile);

interface GitHubPullResponse {
  html_url: string;
  title: string;
  state: string;
  user?: { login?: string };
  body?: string | null;
  created_at: string;
  updated_at: string;
  base?: { ref?: string };
  head?: {
    ref?: string;
    sha?: string;
    repo?: {
      full_name?: string;
    } | null;
  };
  additions: number;
  deletions: number;
  changed_files: number;
  mergeable: boolean | null;
}

interface GraphQLReviewDecisionResponse {
  repository?: {
    pullRequest?: {
      reviewDecision?: string | null;
    };
  };
}

interface GraphQLReviewThreadsResponse {
  repository?: {
    pullRequest?: {
      reviewThreads?: {
        nodes?: Array<{
          isResolved: boolean;
          isOutdated: boolean;
          comments: {
            nodes?: Array<{
              databaseId?: number | null;
            } | null> | null;
          };
        } | null> | null;
      };
    };
  };
}

interface ReviewThreadState {
  isResolved: boolean;
  isOutdated: boolean;
}

interface GitHubFileResponse {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

interface GitHubReviewResponse {
  id: number;
  user?: { login?: string };
  body?: string | null;
  submitted_at?: string | null;
  html_url?: string;
}

interface GitHubCommentResponse {
  id: number;
  user?: { login?: string };
  body?: string | null;
  path?: string;
  position?: number | null;
  created_at: string;
  html_url?: string;
}

async function ghJson<T>(args: string[]): Promise<T> {
  try {
    const { stdout } = await execFileAsync("gh", ["api", ...args], {
      maxBuffer: 25 * 1024 * 1024,
    });
    return JSON.parse(stdout) as T;
  } catch (error) {
    throw new Error(formatGhError(error));
  }
}

async function ghText(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("gh", ["api", ...args], {
      maxBuffer: 50 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    throw new Error(formatGhError(error));
  }
}

function formatGhError(error: unknown): string {
  if (error && typeof error === "object" && "stderr" in error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? "").trim();
    if (stderr) {
      return `GitHub CLI failed: ${stderr}`;
    }
  }

  return "GitHub CLI failed. Make sure `gh` is installed and authenticated with `gh auth login`.";
}

export async function fetchPullRequest(ref: PullRequestRef): Promise<CachedPullRequest> {
  const path = `repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`;
  const [pr, files, reviews, comments, diff, reviewDecision, reviewThreadStates] = await Promise.all([
    ghJson<GitHubPullResponse>([path]),
    ghJson<GitHubFileResponse[]>([`${path}/files`, "--paginate"]),
    ghJson<GitHubReviewResponse[]>([`${path}/reviews`, "--paginate"]),
    ghJson<GitHubCommentResponse[]>([`${path}/comments`, "--paginate"]),
    ghText([path, "-H", "Accept: application/vnd.github.v3.diff"]),
    fetchReviewDecision(ref),
    fetchReviewThreadStates(ref),
  ]);

  return {
    summary: normalizeSummary(ref, pr, reviewDecision),
    files: files.map(normalizeFile),
    discussions: [
      ...reviews.filter((review) => review.body?.trim()).map(normalizeReview),
      ...comments.map((comment) => normalizeComment(comment, reviewThreadStates.get(comment.id))),
    ].sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    diff,
    loadedAt: new Date().toISOString(),
  };
}

export async function fetchSymbolContext(request: SymbolContextRequest, userDataPath: string): Promise<SymbolContext> {
  const pr = request.headRepoFullName && request.headSha
    ? null
    : await ghJson<GitHubPullResponse>([`repos/${request.owner}/${request.repo}/pulls/${request.number}`]);
  const headRepoFullName = request.headRepoFullName ?? pr?.head?.repo?.full_name ?? `${request.owner}/${request.repo}`;
  const headSha = request.headSha ?? pr?.head?.sha;

  if (!headSha) {
    throw new Error("Could not determine the PR head SHA for symbol lookup.");
  }

  try {
    const snapshotPath = await ensureSourceSnapshot({
      userDataPath,
      repositoryFullName: headRepoFullName,
      headSha,
    });
    const context = await resolveTypeScriptSymbolContext(snapshotPath, request);
    if (context) {
      return context;
    }
  } catch {
    // Raw GitHub file context below keeps Cmd-click useful even when a repo cannot be hydrated locally.
  }

  const source = await ghText([
    `repos/${headRepoFullName}/contents/${encodeContentPath(request.file)}`,
    "--method",
    "GET",
    "-f",
    `ref=${headSha}`,
    "-H",
    "Accept: application/vnd.github.raw",
  ]);

  return {
    ...extractSymbolContext(source, request),
    source: "raw-file",
  };
}

async function fetchReviewDecision(ref: PullRequestRef): Promise<string | null> {
  const query = `
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          reviewDecision
        }
      }
    }
  `;

  try {
    const response = await ghJson<GraphQLReviewDecisionResponse>([
      "graphql",
      "-f",
      `query=${query}`,
      "-F",
      `owner=${ref.owner}`,
      "-F",
      `repo=${ref.repo}`,
      "-F",
      `number=${ref.number}`,
    ]);

    return response.repository?.pullRequest?.reviewDecision ?? null;
  } catch {
    return null;
  }
}

async function fetchReviewThreadStates(ref: PullRequestRef): Promise<Map<number, ReviewThreadState>> {
  const query = `
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          reviewThreads(first: 100) {
            nodes {
              isResolved
              isOutdated
              comments(first: 100) {
                nodes {
                  databaseId
                }
              }
            }
          }
        }
      }
    }
  `;

  try {
    const response = await ghJson<GraphQLReviewThreadsResponse>([
      "graphql",
      "-f",
      `query=${query}`,
      "-F",
      `owner=${ref.owner}`,
      "-F",
      `repo=${ref.repo}`,
      "-F",
      `number=${ref.number}`,
    ]);

    const states = new Map<number, ReviewThreadState>();
    for (const thread of response.repository?.pullRequest?.reviewThreads?.nodes ?? []) {
      if (!thread) continue;
      for (const comment of thread.comments.nodes ?? []) {
        if (comment?.databaseId == null) continue;
        states.set(comment.databaseId, {
          isResolved: thread.isResolved,
          isOutdated: thread.isOutdated,
        });
      }
    }

    return states;
  } catch {
    return new Map();
  }
}

function normalizeSummary(
  ref: PullRequestRef,
  pr: GitHubPullResponse,
  reviewDecision: string | null,
): PullRequestSummary {
  return {
    ...ref,
    id: pullRequestId(ref),
    url: pr.html_url,
    title: pr.title,
    state: pr.state,
    author: pr.user?.login ?? "unknown",
    body: pr.body ?? "",
    createdAt: pr.created_at,
    updatedAt: pr.updated_at,
    baseRef: pr.base?.ref ?? "unknown",
    headRef: pr.head?.ref ?? "unknown",
    headRepoFullName: pr.head?.repo?.full_name ?? `${ref.owner}/${ref.repo}`,
    headSha: pr.head?.sha ?? "",
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changed_files,
    mergeable: pr.mergeable == null ? null : String(pr.mergeable),
    reviewDecision,
  };
}

function encodeContentPath(filePath: string): string {
  return filePath.split("/").map(encodeURIComponent).join("/");
}

function normalizeFile(file: GitHubFileResponse): PullRequestFile {
  return {
    filename: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    changes: file.changes,
    patch: file.patch ?? "",
  };
}

function normalizeReview(review: GitHubReviewResponse): PullRequestDiscussion {
  return {
    id: `review-${review.id}`,
    author: review.user?.login ?? "unknown",
    body: review.body ?? "",
    createdAt: review.submitted_at ?? "",
    url: review.html_url ?? "",
    kind: "review",
  };
}

function normalizeComment(comment: GitHubCommentResponse, threadState?: ReviewThreadState): PullRequestDiscussion {
  return {
    id: `comment-${comment.id}`,
    author: comment.user?.login ?? "unknown",
    body: comment.body ?? "",
    path: comment.path,
    position: comment.position ?? undefined,
    isResolved: threadState?.isResolved,
    isOutdated: threadState?.isOutdated,
    createdAt: comment.created_at,
    url: comment.html_url ?? "",
    kind: "comment",
  };
}
