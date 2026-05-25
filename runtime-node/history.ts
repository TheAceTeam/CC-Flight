import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { parseCodexHistoryJsonlContent, type CodexHistoryParseResult } from "../core/history";

export async function parseCodexHistoryJsonlFile(sourcePath = join(homedir(), ".codex", "history.jsonl")): Promise<CodexHistoryParseResult> {
  const content = await readFile(sourcePath, "utf8");
  return parseCodexHistoryJsonlContent(content, sourcePath);
}
