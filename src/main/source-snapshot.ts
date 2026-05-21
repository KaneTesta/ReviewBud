import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface SourceSnapshotRequest {
  userDataPath: string;
  repositoryFullName: string;
  headSha: string;
}

export async function ensureSourceSnapshot({
  userDataPath,
  repositoryFullName,
  headSha,
}: SourceSnapshotRequest): Promise<string> {
  const snapshotRoot = path.join(userDataPath, "source-snapshots");
  await mkdir(snapshotRoot, { recursive: true });

  const snapshotPath = path.join(snapshotRoot, `${sanitizeSnapshotSegment(repositoryFullName)}-${headSha.slice(0, 12)}`);
  if (await directoryExists(path.join(snapshotPath, ".git"))) {
    return snapshotPath;
  }

  await execFileAsync("gh", ["repo", "clone", repositoryFullName, snapshotPath, "--", "--filter=blob:none"], {
    maxBuffer: 20 * 1024 * 1024,
  });
  await execFileAsync("git", ["-C", snapshotPath, "fetch", "origin", headSha, "--depth=1"], {
    maxBuffer: 20 * 1024 * 1024,
  });
  await execFileAsync("git", ["-C", snapshotPath, "checkout", "--detach", headSha], {
    maxBuffer: 20 * 1024 * 1024,
  });

  return snapshotPath;
}

function sanitizeSnapshotSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

async function directoryExists(directoryPath: string): Promise<boolean> {
  try {
    await access(directoryPath);
    return true;
  } catch {
    return false;
  }
}
