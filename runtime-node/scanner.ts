import fg from "fast-glob";
import path from "node:path";
import { resolveCodexHome } from "../storage/paths";

export async function scanRolloutFiles(codexHome = resolveCodexHome()): Promise<string[]> {
  const roots = [
    path.join(codexHome, "sessions"),
    path.join(codexHome, "archived_sessions")
  ];
  const files = await Promise.all(
    roots.map((root) =>
      fg("**/*.jsonl", {
        cwd: root,
        absolute: true,
        onlyFiles: true,
        suppressErrors: true
      })
    )
  );
  return Array.from(new Set(files.flat()));
}
