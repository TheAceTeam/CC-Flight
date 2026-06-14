# SuperView

[English](README.md) | [Simplified Chinese](README.zh-CN.md)

## Quick start

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/SeanXDO/SuperView/main/scripts/quickstart.sh)
```

SuperView is a local-first dashboard for understanding how coding agents work from prompt to result. It ingests agent logs, reconstructs task journeys, and turns raw CLI sessions into a conversation-first view with hidden agent work, evidence, token usage, and project-level telemetry.

The product goal is simple: make a coding agent run feel inspectable, replayable, and surprisingly visual.

## Preview

![SuperView dashboard showing the project with the most indexed logs](docs/assets/superview-most-logs-project-en.png)

## What It Shows

- Conversation threads shaped like the agent CLI flow: `User -> agent work -> Codex/Claude/OpenCode result`.
- IM-style bubbles for user prompts and agent responses, with long messages capped and expandable.
- Hidden process details behind `View process...`, so the main thread stays readable until the user wants the background work.
- Evidence drawers for raw event context, source path, line number, and redacted payloads.
- Project selector and provider filter for Codex, Claude Code, OpenCode, or all sources.
- Project-level token metrics, KV cache hit rate, per-task runtime, and per-task token usage.
- A collapsible daily token usage chart inside the Tokens metric card.
- A foreground Mario-style ingest loader that shows scanning progress without leaving the app looking frozen.
- Skill chips showing which agent/tool capabilities appeared inside each response bubble.

## Current Scope

SuperView is currently an MVP web app/dashboard. It is built for local developer use and stores data in a local SQLite database. The app is not yet packaged as a desktop application, but the architecture keeps that path open.

Supported log sources:

- Codex CLI sessions
- Claude Code project JSONL logs
- OpenCode exported sessions

By default, a plain ingest scans Codex logs only. Claude Code and OpenCode are supported when selected in the UI or passed through the ingest API as explicit sources.

## Quick Start

```bash
pnpm install
pnpm dev
```

Open the app:

```text
http://127.0.0.1:5173/
```

The API server runs at:

```text
http://127.0.0.1:5174/
```

## Ingest Agent Logs

### From The UI

1. Start the app with `pnpm dev`.
2. Choose a source: Codex, Claude Code, OpenCode, or all.
3. Optionally set a custom agent log root.
4. Click `Scan Agent Logs`.
5. Wait for the ingest loader to finish, then choose a project from the top-right selector.

### From The API

Scan default Codex logs:

```bash
curl -X POST http://127.0.0.1:5174/api/ingest \
  -H 'Content-Type: application/json' \
  -d '{"sources":[{"provider":"codex"}]}'
```

Scan Claude Code logs from a custom root:

```bash
curl -X POST http://127.0.0.1:5174/api/ingest \
  -H 'Content-Type: application/json' \
  -d '{"sources":[{"provider":"claude-code","root":"/path/to/.claude"}]}'
```

Scan an OpenCode export file:

```bash
curl -X POST http://127.0.0.1:5174/api/ingest \
  -H 'Content-Type: application/json' \
  -d '{"sources":[{"provider":"opencode","path":"/path/to/opencode-export.json"}]}'
```

Poll ingest status:

```bash
curl http://127.0.0.1:5174/api/ingest/jobs/<jobId>
```

## Default Log Locations

- Codex: `$HOME/.codex/sessions/**/*.jsonl`
- Claude Code: `$HOME/.claude/projects/**/*.jsonl`
- OpenCode: `opencode session list --format json` plus sanitized `opencode export`

## Scripts

```bash
pnpm dev        # Start API and Vite client
pnpm dev:server # Start the Express API only
pnpm dev:client # Start the Vite client only
pnpm build      # Typecheck and build the UI
pnpm preview    # Preview the production UI build
pnpm typecheck  # Run TypeScript checks
pnpm test       # Run Vitest tests
pnpm test:e2e   # Run Playwright tests
pnpm ingest     # Run the ingest CLI helper
```

## Architecture

```text
ui/            React + Vite dashboard
runtime-node/  Express API, ingest service, worker process, log adapters
core/          Parser, normalizer, redactor, timeline, replay, shared types
storage/       SQLite database layer and local data paths
tests/         Unit, integration, and browser-facing test coverage
docs/          Feature notes and TODO tracking
plan/          Planning artifacts and implementation notes
design/        HTML design previews
```

The ingest path is intentionally split from the API path. The API creates an ingest job and returns immediately. A worker process scans and parses log files, then writes normalized project/session/event data into SQLite. This keeps the dashboard responsive during large historical scans.

The ingest service also uses single-flight behavior: if an ingest is already active, another request returns the existing job instead of starting a second full scan.

## API Reference

- `GET /api/health`
- `POST /api/ingest`
- `GET /api/ingest/jobs/:id`
- `GET /api/projects`
- `GET /api/projects/:id/timeline`
- `GET /api/projects/:id/token-usage/daily`
- `GET /api/task-journeys/:id`
- `GET /api/events/:id/evidence`
- `GET /api/runs/:id`

## Environment Variables

```bash
SUPERVIEW_DATA_DIR=/path/to/data
SUPERVIEW_CODEX_HOME=/path/to/.codex
SUPERVIEW_CLAUDE_HOME=/path/to/.claude
SUPERVIEW_API_PORT=5174
```

Defaults:

- `SUPERVIEW_DATA_DIR` defaults to `.superview` in the current working directory.
- `SUPERVIEW_CODEX_HOME` defaults to `$HOME/.codex`.
- `SUPERVIEW_CLAUDE_HOME` defaults to `$HOME/.claude`.
- `SUPERVIEW_API_PORT` defaults to `5174`.

## Privacy Model

SuperView is local-first. It does not require accounts, cloud sync, or a remote backend.

Raw agent logs can contain sensitive prompts, file paths, tool output, and project context. SuperView stores normalized records locally and exposes redacted evidence payloads through the UI. Evidence views preserve enough provenance for debugging, including source path, line number, timestamp, and hash metadata.

Some reasoning content may appear as unavailable or hidden. This usually means the source log did not expose it, the content was encrypted, or the agent provider recorded a placeholder instead of plain reasoning text.

## Desktop App Direction

The MVP is a web app, but the current shape is desktop-friendly:

- The storage layer already uses local SQLite.
- Ingest needs local filesystem access, which maps cleanly to Electron or Tauri.
- The UI and API are separated, so packaging can either embed the API process or replace it with a desktop-native bridge.
- Privacy-sensitive data can remain on the user's machine.

Desktop packaging still needs explicit work around file permissions, database location, background ingest lifecycle, app updates, and log-source discovery.

## Roadmap

- Show the exact context passed through each task journey, from user prompt to final result.
- Add richer context provenance so users can see why an agent had or missed specific information.
- Improve desktop packaging and first-run log-source setup.
- Expand OpenCode and Claude Code compatibility as their log/export formats evolve.
- Add deeper comparisons across projects, days, and agent providers.
