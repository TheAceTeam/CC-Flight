import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitCommitRecord } from "../core/types";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 3000;

export async function getRepoRoot(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { timeout: GIT_TIMEOUT_MS });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function getCommits(repoRoot: string, from?: string | null, to?: string | null): Promise<GitCommitRecord[]> {
  const args = [
    "-C",
    repoRoot,
    "log",
    "--date=iso-strict",
    "--pretty=format:%x1e%H%x1f%h%x1f%an%x1f%ae%x1f%ad%x1f%s",
    "--numstat"
  ];

  if (from) {
    args.push(`--since=${formatGitDateArg(from)}`);
  }
  if (to) {
    args.push(`--until=${formatGitDateArg(to)}`);
  }

  try {
    const { stdout } = await execFileAsync("git", args, {
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024
    });
    return parseGitLogNumstat(stdout, repoRoot);
  } catch {
    return [];
  }
}

function parseGitLogNumstat(stdout: string, repoRoot: string): GitCommitRecord[] {
  return stdout
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => parseGitCommitEntry(entry, repoRoot))
    .filter((commit): commit is GitCommitRecord => commit !== null);
}

function parseGitCommitEntry(entry: string, repoRoot: string): GitCommitRecord | null {
  const lines = entry.split(/\r?\n/).filter(Boolean);
  const header = lines.shift();
  if (!header) return null;

  const [hash, shortHash, authorName, authorEmail, timestamp, subject] = header.split("\x1f");
  if (!hash || !shortHash || !timestamp) return null;

  let filesChanged = 0;
  let insertions = 0;
  let deletions = 0;

  for (const line of lines) {
    const [inserted, deleted] = line.split(/\t/);
    if (inserted === undefined || deleted === undefined) continue;

    filesChanged += 1;
    insertions += parseNumstatCount(inserted);
    deletions += parseNumstatCount(deleted);
  }

  return {
    id: hash,
    projectId: repoRoot,
    repoRoot,
    hash,
    shortHash,
    authorName: authorName || null,
    authorEmail: authorEmail || null,
    timestamp,
    subject: subject ?? "",
    filesChanged,
    insertions,
    deletions
  };
}

function parseNumstatCount(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatGitDateArg(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return `@${Math.floor(parsed.getTime() / 1000)}`;
}
