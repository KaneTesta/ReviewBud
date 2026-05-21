import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  CachedPullRequest,
  PullRequestDiscussion,
  PullRequestDiscussionReplyRequest,
  PullRequestFile,
  PullRequestListItem,
  PullRequestRef,
  PullRequestSummary,
  RepositorySummary,
  SymbolContext,
  SymbolContextRequest,
} from "../shared/types.js";
import { replyTargetForDiscussion } from "../shared/discussions.js";
import { pullRequestId } from "../shared/pr-url.js";
import { extractSymbolContext } from "../shared/symbol-context.js";
import { ensureSourceSnapshot } from "./source-snapshot.js";
import { resolveTypeScriptSymbolContext } from "./typescript-intelligence.js";
import { resolvePythonSymbolContextWithLsp } from "./python-lsp.js";

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
  line?: number | null;
  side?: "LEFT" | "RIGHT" | null;
  start_line?: number | null;
  start_side?: "LEFT" | "RIGHT" | null;
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

async function ghEmpty(args: string[]): Promise<void> {
  try {
    await execFileAsync("gh", ["api", ...args], {
      maxBuffer: 25 * 1024 * 1024,
    });
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

export async function replyToPullRequestDiscussion(
  request: PullRequestDiscussionReplyRequest,
): Promise<CachedPullRequest> {
  const body = request.body.trim();
  if (!body) {
    throw new Error("Reply body is required.");
  }

  const target = replyTargetForDiscussion({
    id: request.discussionId,
    kind: request.discussionId.startsWith("comment-") ? "comment" : "review",
  });
  if (!target) {
    throw new Error("Unsupported discussion reply target.");
  }

  if (target.kind === "review-comment") {
    await ghEmpty([
      `repos/${request.owner}/${request.repo}/pulls/comments/${target.commentId}/replies`,
      "--method",
      "POST",
      "-f",
      `body=${body}`,
    ]);
  } else {
    await ghEmpty([
      `repos/${request.owner}/${request.repo}/issues/${request.number}/comments`,
      "--method",
      "POST",
      "-f",
      `body=${body}`,
    ]);
  }

  return fetchPullRequest(request);
}

export async function fetchRecentRepositories(): Promise<RepositorySummary[]> {
  const repositories = await ghJson<GitHubRepositoryResponse[]>([
    "graphql",
    "-f",
    `query={
      viewer {
        repositories(first: 30, orderBy: {field: UPDATED_AT, direction: DESC}, ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]) {
          nodes {
            nameWithOwner
            description
            updatedAt
          }
        }
      }
    }`,
    "--jq",
    ".data.viewer.repositories.nodes",
  ]);

  return repositories
    .map((repository) => {
      const [owner, repo] = repository.nameWithOwner.split("/");
      return {
        fullName: repository.nameWithOwner,
        owner: owner ?? "",
        repo: repo ?? "",
        description: repository.description ?? "",
        updatedAt: repository.updatedAt,
      };
    })
    .filter((repository) => repository.owner && repository.repo);
}

export async function searchRepositories(
  query: string,
  owner = "",
): Promise<RepositorySummary[]> {
  const searchQuery = buildRepositorySearchQuery(query, owner);
  if (!searchQuery) {
    return fetchRecentRepositories();
  }

  const response = await ghJson<GitHubRepositorySearchResponse>([
    "search/repositories",
    "--method",
    "GET",
    "-f",
    `q=${searchQuery}`,
    "-f",
    "sort=updated",
    "-f",
    "order=desc",
    "-f",
    "per_page=50",
  ]);

  return (response.items ?? [])
    .map((repository) => ({
      fullName: repository.full_name,
      owner: repository.owner?.login ?? repository.full_name.split("/")[0] ?? "",
      repo: repository.name,
      description: repository.description ?? "",
      updatedAt: repository.updated_at,
    }))
    .filter((repository) => repository.owner && repository.repo);
}

export function buildRepositorySearchQuery(query: string, owner = ""): string {
  const normalizedQuery = query.trim();
  const normalizedOwner = owner.trim();
  const parts = [
    normalizedQuery || "stars:>=0",
    "fork:true",
    normalizedOwner ? `user:${normalizedOwner}` : "",
  ].filter(Boolean);

  return parts.join(" ");
}

export async function fetchRecentPullRequests(
  ref: Pick<PullRequestRef, "owner" | "repo">,
): Promise<PullRequestListItem[]> {
  const pulls = await ghJson<GitHubPullListResponse[]>([
    `repos/${ref.owner}/${ref.repo}/pulls`,
    "--method",
    "GET",
    "-f",
    "state=all",
    "-f",
    "sort=updated",
    "-f",
    "direction=desc",
    "-f",
    "per_page=20",
  ]);

  return pulls.map((pull) => ({
    owner: ref.owner,
    repo: ref.repo,
    number: pull.number,
    id: pullRequestId({ owner: ref.owner, repo: ref.repo, number: pull.number }),
    url: pull.html_url,
    title: pull.title,
    state: pull.state,
    author: pull.user?.login ?? "unknown",
    updatedAt: pull.updated_at,
  }));
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
    const pythonContext = await resolvePythonSymbolContextWithLsp(snapshotPath, request);
    if (pythonContext) {
      return pythonContext;
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
    sourceCode: source,
    source: "raw-file",
  };
}

interface GitHubRepositoryResponse {
  nameWithOwner: string;
  description?: string | null;
  updatedAt: string;
}

interface GitHubPullListResponse {
  html_url: string;
  number: number;
  title: string;
  state: string;
  user?: { login?: string };
  updated_at: string;
}

interface GitHubRepositorySearchResponse {
  items?: Array<{
    full_name: string;
    name: string;
    owner?: { login?: string };
    description?: string | null;
    updated_at: string;
  }>;
}

export async function fetchFileSource(request: SymbolContextRequest): Promise<string> {
  const pr = request.headRepoFullName && request.headSha
    ? null
    : await ghJson<GitHubPullResponse>([`repos/${request.owner}/${request.repo}/pulls/${request.number}`]);
  const headRepoFullName = request.headRepoFullName ?? pr?.head?.repo?.full_name ?? `${request.owner}/${request.repo}`;
  const headSha = request.headSha ?? pr?.head?.sha;

  if (!headSha) {
    throw new Error("Could not determine the PR head SHA for source lookup.");
  }

  return ghText([
    `repos/${headRepoFullName}/contents/${encodeContentPath(request.file)}`,
    "--method",
    "GET",
    "-f",
    `ref=${headSha}`,
    "-H",
    "Accept: application/vnd.github.raw",
  ]);
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
    line: comment.line ?? undefined,
    side: comment.side ?? undefined,
    startLine: comment.start_line ?? undefined,
    startSide: comment.start_side ?? undefined,
    isResolved: threadState?.isResolved,
    isOutdated: threadState?.isOutdated,
    createdAt: comment.created_at,
    url: comment.html_url ?? "",
    kind: "comment",
  };
}
