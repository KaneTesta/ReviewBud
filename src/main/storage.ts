import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  CachedPullRequest,
  DraftReviewComment,
  RepositorySummary,
  DraftReviewSubmission,
  ReviewNote,
  ReviewWorkspace,
} from "../shared/types.js";

export class ReviewStorage {
  private readonly cacheDir: string;
  private readonly starredRepositoriesPath: string;

  constructor(userDataPath: string) {
    this.cacheDir = path.join(userDataPath, "pull-requests");
    this.starredRepositoriesPath = path.join(userDataPath, "starred-repositories.json");
  }

  async savePullRequest(pullRequest: CachedPullRequest): Promise<ReviewWorkspace> {
    await this.ensureCacheDir();
    const id = pullRequest.summary.id;
    const existing = await this.loadExistingWorkspace(id);
    const nextNotes = mergeNotes(existing?.notes ?? [], pullRequest.files.map((file) => file.filename));
    const workspace: ReviewWorkspace = {
      pullRequest,
      notes: nextNotes,
      draftComments: existing?.draftComments ?? [],
      draftReview: existing?.draftReview ?? null,
    };

    await writeFile(this.workspacePath(id), JSON.stringify(workspace, null, 2), "utf8");
    return workspace;
  }

  async saveSubmittedPullRequest(pullRequest: CachedPullRequest): Promise<ReviewWorkspace> {
    await this.ensureCacheDir();
    const id = pullRequest.summary.id;
    const existing = await this.loadExistingWorkspace(id);
    const workspace: ReviewWorkspace = {
      pullRequest,
      notes: mergeNotes(existing?.notes ?? [], pullRequest.files.map((file) => file.filename)),
      draftComments: [],
      draftReview: null,
    };

    await writeFile(this.workspacePath(id), JSON.stringify(workspace, null, 2), "utf8");
    return workspace;
  }

  async clearSubmittedReview(id: string): Promise<ReviewWorkspace> {
    const workspace = await this.loadWorkspace(id);
    const nextWorkspace: ReviewWorkspace = {
      ...workspace,
      draftComments: [],
      draftReview: null,
    };

    await writeFile(this.workspacePath(id), JSON.stringify(nextWorkspace, null, 2), "utf8");
    return nextWorkspace;
  }

  async loadWorkspace(id: string): Promise<ReviewWorkspace> {
    const raw = await readFile(this.workspacePath(id), "utf8");
    return normalizeWorkspace(JSON.parse(raw) as ReviewWorkspace);
  }

  async saveReviewState(
    id: string,
    state: {
      notes: ReviewNote[];
      draftComments: DraftReviewComment[];
      draftReview: DraftReviewSubmission | null;
    },
  ): Promise<ReviewWorkspace> {
    const workspace = await this.loadWorkspace(id);
    const nextWorkspace: ReviewWorkspace = {
      ...workspace,
      notes: normalizeNotes(state.notes),
      draftComments: state.draftComments,
      draftReview: state.draftReview,
    };

    await writeFile(this.workspacePath(id), JSON.stringify(nextWorkspace, null, 2), "utf8");
    return nextWorkspace;
  }

  async applyRepositoryStars(repositories: RepositorySummary[]): Promise<RepositorySummary[]> {
    const starredRepositories = await this.loadStarredRepositories();
    return repositories.map((repository) => ({
      ...repository,
      isStarred: starredRepositories.has(repository.fullName),
    }));
  }

  async setRepositoryStar(fullName: string, isStarred: boolean): Promise<string[]> {
    const normalizedFullName = fullName.trim();
    if (!normalizedFullName) {
      throw new Error("Repository full name is required.");
    }

    const starredRepositories = await this.loadStarredRepositories();
    if (isStarred) {
      starredRepositories.add(normalizedFullName);
    } else {
      starredRepositories.delete(normalizedFullName);
    }

    const nextStarredRepositories = [...starredRepositories].sort((left, right) => left.localeCompare(right));
    await writeFile(this.starredRepositoriesPath, JSON.stringify(nextStarredRepositories, null, 2), "utf8");
    return nextStarredRepositories;
  }

  private async loadExistingWorkspace(id: string): Promise<ReviewWorkspace | null> {
    try {
      return await this.loadWorkspace(id);
    } catch {
      return null;
    }
  }

  private workspacePath(id: string): string {
    return path.join(this.cacheDir, `${sanitizeId(id)}.json`);
  }

  private async ensureCacheDir(): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });
  }

  private async loadStarredRepositories(): Promise<Set<string>> {
    try {
      const raw = await readFile(this.starredRepositoriesPath, "utf8");
      const starredRepositories = JSON.parse(raw) as unknown;
      if (!Array.isArray(starredRepositories)) return new Set();
      return new Set(starredRepositories.filter((fullName): fullName is string => typeof fullName === "string"));
    } catch {
      return new Set();
    }
  }
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function mergeNotes(existing: ReviewNote[], filenames: string[]): ReviewNote[] {
  const byFile = new Map(existing.map((note) => [note.file, note]));
  return filenames.map((filename) => ({
    file: filename,
    note: byFile.get(filename)?.note ?? "",
  }));
}

function normalizeWorkspace(workspace: ReviewWorkspace): ReviewWorkspace {
  return {
    ...workspace,
    notes: normalizeNotes(workspace.notes),
    draftComments: workspace.draftComments ?? [],
    draftReview: workspace.draftReview ?? null,
  };
}

function normalizeNotes(notes: unknown): ReviewNote[] {
  if (!Array.isArray(notes)) return [];
  return notes.flatMap((note) => {
    if (!note || typeof note !== "object") return [];
    const { file, note: text } = note as { file?: unknown; note?: unknown };
    if (typeof file !== "string") return [];
    return [{ file, note: typeof text === "string" ? text : "" }];
  });
}
