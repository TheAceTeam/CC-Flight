import { createHash } from "node:crypto";
import path from "node:path";

export const CHROME_DEVTOOLS_CONFIG_PATH = "/.well-known/appspecific/com.chrome.devtools.json";

export function buildChromeDevToolsConfig(root = process.cwd()) {
  const workspaceRoot = path.resolve(root);
  return {
    workspace: {
      root: workspaceRoot,
      uuid: uuidFromRoot(workspaceRoot)
    }
  };
}

function uuidFromRoot(root: string) {
  const chars = createHash("sha256").update(root).digest("hex").slice(0, 32).split("");
  chars[12] = "4";
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  const hex = chars.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
