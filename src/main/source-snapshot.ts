import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface SourceSnapshotRequest {
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

  const snapshotPath = path.join(
    snapshotRoot,
    `${sanitizeSnapshotSegment(repositoryFullName)}-${sanitizeSnapshotSegment(headSha.slice(0, 12))}`,
  );
  if (!(await directoryExists(path.join(snapshotPath, ".git")))) {
    await execFileAsync("gh", ["repo", "clone", repositoryFullName, snapshotPath, "--", "--filter=blob:none"], {
      maxBuffer: 20 * 1024 * 1024,
    });
  }

  const currentHead = await snapshotHead(snapshotPath);
  if (currentHead === headSha) return snapshotPath;

  await execFileAsync("git", ["-C", snapshotPath, "fetch", "origin", headSha, "--depth=1"], {
    maxBuffer: 20 * 1024 * 1024,
  });
  await execFileAsync("git", ["-C", snapshotPath, "checkout", "--detach", headSha], {
    maxBuffer: 20 * 1024 * 1024,
  });

  return snapshotPath;
}

export function resolveSourceSnapshotFile(
  snapshotPath: string,
  repositoryPath: string,
): string {
  const snapshotRoot = path.resolve(snapshotPath);
  const filePath = path.resolve(snapshotRoot, repositoryPath);
  const relativePath = path.relative(snapshotRoot, filePath);

  if (
    relativePath === "" ||
    relativePath.startsWith(`..${path.sep}`) ||
    relativePath === ".." ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error("The requested file is outside the source snapshot.");
  }

  return filePath;
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

async function snapshotHead(snapshotPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", snapshotPath, "rev-parse", "HEAD"],
      { maxBuffer: 1024 * 1024 },
    );
    return stdout.trim();
  } catch {
    return null;
  }
}
