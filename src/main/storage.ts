import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CachedPullRequest, RecentPullRequest, ReviewNote, ReviewWorkspace } from "../shared/types.js";
import { pullRequestId } from "../shared/pr-url.js";

export class ReviewStorage {
  private readonly cacheDir: string;

  constructor(userDataPath: string) {
    this.cacheDir = path.join(userDataPath, "pull-requests");
  }

  async savePullRequest(pullRequest: CachedPullRequest): Promise<ReviewWorkspace> {
    await this.ensureCacheDir();
    const id = pullRequest.summary.id;
    const existing = await this.loadNotes(id);
    const nextNotes = mergeNotes(existing, pullRequest.files.map((file) => file.filename));
    const workspace: ReviewWorkspace = { pullRequest, notes: nextNotes };

    await writeFile(this.workspacePath(id), JSON.stringify(workspace, null, 2), "utf8");
    return workspace;
  }

  async saveNotes(id: string, notes: ReviewNote[]): Promise<ReviewNote[]> {
    const workspace = await this.loadWorkspace(id);
    const nextWorkspace = { ...workspace, notes };
    await writeFile(this.workspacePath(id), JSON.stringify(nextWorkspace, null, 2), "utf8");
    return notes;
  }

  async loadWorkspace(id: string): Promise<ReviewWorkspace> {
    const raw = await readFile(this.workspacePath(id), "utf8");
    return JSON.parse(raw) as ReviewWorkspace;
  }

  async listRecent(): Promise<RecentPullRequest[]> {
    await this.ensureCacheDir();
    const entries = await readdir(this.cacheDir);
    const workspaces = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map(async (entry) => {
          const raw = await readFile(path.join(this.cacheDir, entry), "utf8");
          return JSON.parse(raw) as ReviewWorkspace;
        }),
    );

    return workspaces
      .map(({ pullRequest }) => ({
        id: pullRequest.summary.id,
        title: pullRequest.summary.title,
        url: pullRequest.summary.url,
        owner: pullRequest.summary.owner,
        repo: pullRequest.summary.repo,
        number: pullRequest.summary.number,
        loadedAt: pullRequest.loadedAt,
      }))
      .sort((left, right) => right.loadedAt.localeCompare(left.loadedAt));
  }

  private async loadNotes(id: string): Promise<ReviewNote[]> {
    try {
      const workspace = await this.loadWorkspace(id);
      return workspace.notes;
    } catch {
      return [];
    }
  }

  private workspacePath(id: string): string {
    return path.join(this.cacheDir, `${sanitizeId(id)}.json`);
  }

  private async ensureCacheDir(): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });
  }
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function mergeNotes(existing: ReviewNote[], filenames: string[]): ReviewNote[] {
  const byFile = new Map(existing.map((note) => [note.file, note]));
  return filenames.map((filename) => byFile.get(filename) ?? { file: filename, status: "unread", note: "" });
}

export function idFromParts(owner: string, repo: string, number: number): string {
  return pullRequestId({ owner, repo, number });
}
