import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CachedPullRequest, ReviewNote, ReviewWorkspace } from "../shared/types.js";

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

  async loadWorkspace(id: string): Promise<ReviewWorkspace> {
    const raw = await readFile(this.workspacePath(id), "utf8");
    return JSON.parse(raw) as ReviewWorkspace;
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
