import type {
  DraftReviewComment,
  DraftReviewSubmission,
  PullRequestFile,
  PullRequestFileViewedRequest,
  ReviewNote,
  ReviewOutcome,
  ReviewWorkspace,
} from "./types";

export function adjacentFile(
  files: PullRequestFile[],
  currentFilename: string | null,
  direction: "next" | "previous",
): string | null {
  if (files.length === 0) return null;
  const currentIndex = files.findIndex((file) => file.filename === currentFilename);
  const fallbackIndex = direction === "next" ? 0 : files.length - 1;
  if (currentIndex < 0) return files[fallbackIndex]?.filename ?? null;
  const delta = direction === "next" ? 1 : -1;
  const nextIndex = (currentIndex + delta + files.length) % files.length;
  return files[nextIndex]?.filename ?? null;
}

export function setFileViewed(
  files: PullRequestFile[],
  filename: string,
  viewed: boolean,
): PullRequestFile[] {
  return files.map((file) =>
    file.filename === filename ? { ...file, viewed } : file,
  );
}

export async function syncFileViewed(
  files: PullRequestFile[],
  pullRequestId: string,
  filename: string,
  updateFileViewed: (request: PullRequestFileViewedRequest) => Promise<void>,
): Promise<boolean> {
  const viewed = !(files.find((file) => file.filename === filename)?.viewed ?? false);
  await updateFileViewed({ pullRequestId, path: filename, viewed });
  return viewed;
}

export function upsertDraftComment(
  comments: DraftReviewComment[],
  input: {
    file: string;
    startLine: number;
    endLine: number;
    body: string;
    now?: string;
    id?: string;
  },
): DraftReviewComment[] {
  const startLine = Math.min(input.startLine, input.endLine);
  const endLine = Math.max(input.startLine, input.endLine);
  const body = input.body.trim();
  if (!body) return comments;
  const createdAt = input.now ?? new Date().toISOString();

  const comment: DraftReviewComment = {
    id: input.id ?? `draft-${Date.parse(createdAt)}-${comments.length + 1}`,
    file: input.file,
    startLine,
    endLine,
    body,
    createdAt,
  };

  return [...comments, comment];
}

export function createDraftReview(
  outcome: ReviewOutcome,
  body: string,
  now = new Date().toISOString(),
): DraftReviewSubmission {
  return {
    outcome,
    body: body.trim(),
    submittedAt: now,
  };
}

export function reviewProgress(files: PullRequestFile[]): { viewed: number; total: number } {
  return {
    viewed: files.filter((file) => file.viewed).length,
    total: files.length,
  };
}

export function completedAllFiles(
  previous: { viewed: number; total: number } | null,
  next: { viewed: number; total: number },
): boolean {
  return (
    next.total > 0 &&
    next.viewed === next.total &&
    previous?.viewed !== previous?.total
  );
}

export function withReviewState(
  workspace: ReviewWorkspace,
  nextState: {
    notes?: ReviewNote[];
    draftComments?: DraftReviewComment[];
    draftReview?: DraftReviewSubmission | null;
  },
): ReviewWorkspace {
  return {
    ...workspace,
    notes: nextState.notes ?? workspace.notes,
    draftComments: nextState.draftComments ?? workspace.draftComments ?? [],
    draftReview: nextState.draftReview === undefined ? (workspace.draftReview ?? null) : nextState.draftReview,
  };
}
