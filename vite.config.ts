import type { IncomingMessage, ServerResponse } from "node:http";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { buildChromeDevToolsConfig, CHROME_DEVTOOLS_CONFIG_PATH } from "./runtime-node/chrome-devtools";

export default defineConfig({
  plugins: [react(), chromeDevToolsWorkspacePlugin()],
  root: "ui",
  server: {
    proxy: {
      "/api": "http://127.0.0.1:5174"
    }
  },
  build: {
    outDir: "../dist/ui",
    emptyOutDir: true
  }
});

function chromeDevToolsWorkspacePlugin() {
  return {
    name: "superview-chrome-devtools-workspace",
    configureServer(server: { middlewares: { use: (path: string, handler: (req: IncomingMessage, res: ServerResponse) => void) => void } }) {
      server.middlewares.use(CHROME_DEVTOOLS_CONFIG_PATH, serveChromeDevToolsConfig);
    },
    configurePreviewServer(server: { middlewares: { use: (path: string, handler: (req: IncomingMessage, res: ServerResponse) => void) => void } }) {
      server.middlewares.use(CHROME_DEVTOOLS_CONFIG_PATH, serveChromeDevToolsConfig);
    }
  };
}

function serveChromeDevToolsConfig(_req: IncomingMessage, res: ServerResponse) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(buildChromeDevToolsConfig()));
}
