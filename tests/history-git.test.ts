import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseCodexHistoryJsonlContent } from "../core/history";
import { getCommits } from "../runtime-node/git-provider";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(prefix: string) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function git(repoRoot: string, args: string[]) {
  execFileSync("git", ["-C", repoRoot, ...args], {
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test Author",
      GIT_AUTHOR_EMAIL: "author@example.com",
      GIT_COMMITTER_NAME: "Test Committer",
      GIT_COMMITTER_EMAIL: "committer@example.com"
    }
  });
}

describe("Codex history parser", () => {
  it("returns safe records grouped by session id and keeps bad lines out", () => {
    const result = parseCodexHistoryJsonlContent(
      [
        JSON.stringify({ session_id: "sess-1", ts: "2026-05-25T01:00:00Z", text: "hello OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz" }),
        "{bad json",
        JSON.stringify({ session_id: "sess-1", ts: 1_764_000_000, text: "follow up" }),
        JSON.stringify({ session_id: "missing-text", ts: "2026-05-25T01:02:00Z" })
      ].join("\n"),
      "history.jsonl"
    );

    expect(result.records).toHaveLength(2);
    expect(result.badLines).toHaveLength(2);
    expect(result.bySessionId.get("sess-1")).toHaveLength(2);
    expect(result.records[0].text).toContain("[REDACTED]");
    expect(result.records[0].text).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(result.records[1].ts).toBe("2025-11-24T16:00:00.000Z");
  });
});

describe("git history provider", () => {
  it("returns [] for non-git directories", async () => {
    await expect(getCommits(tempDir("superview-non-git-"))).resolves.toEqual([]);
  });

  it("reads commit metadata and numstat from a temporary git repo", async () => {
    const repoRoot = tempDir("superview-git-");
    git(repoRoot, ["init"]);
    git(repoRoot, ["config", "user.name", "Test Author"]);
    git(repoRoot, ["config", "user.email", "author@example.com"]);

    writeFileSync(path.join(repoRoot, "one.txt"), "one\n");
    git(repoRoot, ["add", "one.txt"]);
    git(repoRoot, ["commit", "-m", "initial commit"]);

    mkdirSync(path.join(repoRoot, "nested"));
    writeFileSync(path.join(repoRoot, "one.txt"), "one\ntwo\n");
    writeFileSync(path.join(repoRoot, "nested", "two.txt"), "alpha\nbeta\n");
    git(repoRoot, ["add", "."]);
    git(repoRoot, ["commit", "-m", "update files"]);

    const commits = await getCommits(repoRoot, "2000-01-01T00:00:00Z", "2999-01-01T00:00:00Z");

    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatchObject({
      repoRoot,
      subject: "update files",
      authorName: "Test Author",
      authorEmail: "author@example.com",
      filesChanged: 2,
      insertions: 3,
      deletions: 0
    });
    expect(commits[0].hash).toMatch(/^[0-9a-f]{40}$/);
    expect(commits[0].shortHash).toBe(commits[0].hash.slice(0, commits[0].shortHash.length));
  });
});
