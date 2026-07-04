# CC Flight MVP Implementation Plan

## 1. Product Goal

CC Flight is a local-first Codex log visualization dashboard for complex engineering work. The MVP turns Codex rollout JSONL files into a project timeline, then lets users drill into a single Codex run as a replayable side-scrolling level.

The memorable outcome is: "wow, I have never seen a coding agent from this angle."

## 2. MVP Scope

Phase 1 ships a vertical slice:

- Scan real `~/.codex/sessions/**/*.jsonl` files.
- Parse and normalize Codex session events.
- Store redacted evidence in local SQLite.
- Build project timelines with lanes for Product, Architecture, Code, Agent Runs, Verification, and Risks.
- Open a run replay view with level-like nodes for prompts, tool calls, patches, failures, and verification.
- Provide an evidence drawer for selected timeline or replay nodes.
- Support Bright and Dark Command Center themes.

Out of scope for Phase 1:

- Cloud upload, accounts, teams, shared workspaces, or remote sync.
- File watcher and background daemon.
- LLM-generated narrative summaries.
- Pattern Codex, badges, route rooms, or full desktop shell.
- Parsing `codex-tui.log`.

## 3. Architecture

CC Flight is built as a desktop-ready local web app:

```txt
React UI
  -> HTTP API now, desktop IPC later
    -> runtime-node
      -> core services
      -> storage
      -> local filesystem and git
```

Layer boundaries:

- `core/`: parser, normalizer, timeline builder, replay builder, redactor.
- `storage/`: SQLite schema, migrations, repositories.
- `runtime-node/`: filesystem scanner, git provider, Express API, ingest jobs.
- `ui/`: browser-only React application.
- Future `runtime-desktop/`: Electron or Tauri host that reuses `core/` and `storage/`.

The UI must never import `fs`, `path`, `child_process`, or SQLite modules. All local capabilities must go through API or future IPC.

## 4. Codex Log Integration

Primary data source:

- `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`

Supporting source:

- `~/.codex/history.jsonl`

Ignored for MVP:

- `~/.codex/log/codex-tui.log`

Normalized mapping:

- `session_meta` -> session and project metadata.
- `turn_context` -> turn boundary.
- `response_item.message` -> user or assistant message.
- `response_item.function_call` -> tool call.
- `response_item.function_call_output` -> tool result.
- `response_item.reasoning` -> reasoning marker only.
- `event_msg` -> progress, tool lifecycle, status, or error.

Privacy policy:

- Store redacted payloads by default.
- Store `source_path`, `line_no`, and `sha256` for traceability.
- Do not display encrypted reasoning contents.
- Do not persist full raw payload unless a future explicit `preserveRawLogs=true` setting is enabled.

## 5. Data Model

SQLite lives at `.superview/superview.sqlite` in development. Desktop builds should move this to the platform application data directory, for example macOS Application Support.

Tables:

- `schema_meta(version, updated_at)`
- `projects(id, name, cwd, repo_root, created_at, updated_at)`
- `sessions(id, project_id, path, cwd, started_at, ended_at, cli_version, model_provider, source)`
- `turns(id, session_id, started_at, ended_at, cwd, model, approval_policy, sandbox_policy)`
- `raw_event_refs(id, session_id, line_no, timestamp, type, redacted_payload_json, source_path, sha256)`
- `events(id, project_id, session_id, turn_id, timestamp, kind, lane, title, detail, tool_name, call_id, status, files_json, raw_event_ref_id)`
- `episodes(id, project_id, started_at, ended_at, title, summary, status, event_ids_json)`
- `artifacts(id, event_id, type, path, excerpt, sha256)`
- `ingest_jobs(id, status, started_at, finished_at, total_files, processed_files, total_events, errors_json)`

## 6. Timeline and Replay

Timeline lanes:

- Product: user goals, corrections, product decisions.
- Architecture: docs, design, plan, and architecture changes.
- Code: patches, file edits, diff-like activity.
- Agent Runs: sessions, turns, tool calls, and final answers.
- Verification: tests, builds, typechecks, browser checks, curl checks.
- Risks: failures, repeated retries, user rescue, unverified endings, parse errors.

Episode grouping:

- Same project.
- Same session, or neighboring events less than 90 minutes apart.
- First meaningful user prompt becomes the initial episode title.
- UI labels episode grouping as `Auto grouped`.

Replay node mapping:

- User prompt -> start gate.
- File read/search -> context block.
- Tool call -> platform.
- Patch/file change -> power-up block.
- Failed command -> hazard.
- Retry/repeated failure -> loop marker.
- Verification success -> finish flag.

Every replay node keeps its `eventId` so it can open the same evidence drawer as timeline nodes.

## 7. Frontend Experience

The first screen is the dashboard, not a landing page.

Core layout:

- Dark frosted shell header.
- Left Run Ledger.
- Center Project Timeline.
- Right Evidence Drawer.
- Run replay detail below or as selected panel.

Visual system:

- Follow `DESIGN.md`.
- Warm off-white workspace in bright theme.
- Deep warm dark workspace in dark theme.
- Orange telemetry for action, active state, timeline emphasis, and replay progress.
- Compact dashboard density.
- No decorative background animation.

Motion:

- Replay scrubber moves the agent marker through replay nodes.
- Factory strip or event sequence lights up in sync.
- Hazards and finish flags animate only during replay.

## 8. Desktop App Considerations

MVP must be desktop-ready without shipping a desktop app yet:

- Keep React UI browser-only.
- Put all local filesystem and git access behind runtime APIs.
- Keep parser, redactor, timeline, and replay logic in pure TypeScript modules.
- Centralize data directory resolution.
- Add `schema_meta(version)` now for future migrations.
- Make Codex home configurable through `SUPERVIEW_CODEX_HOME`.
- Handle missing git, non-repo cwd, git command failure, and very large repos gracefully.
- Use job-based ingest so desktop windows do not freeze.
- Avoid coupling API response shapes to SQLite row shapes.

Electron is the likely first desktop shell because CC Flight needs Node-friendly local file, git, and process access. Tauri can be revisited after the core product stabilizes.

## 9. Test Plan

Fixture files:

- `tests/fixtures/codex-rollouts/minimal-rollout.jsonl`
- `tests/fixtures/codex-rollouts/tool-call-rollout.jsonl`
- `tests/fixtures/codex-rollouts/failed-test-rollout.jsonl`
- `tests/fixtures/codex-rollouts/secret-output-rollout.jsonl`

Unit tests:

- Parser handles `session_meta`, `turn_context`, `response_item`, and `event_msg`.
- Normalizer joins `function_call` with `function_call_output`.
- Redactor masks tokens, API keys, passwords, authorization headers, and `.env`-style lines.
- Timeline builder assigns lanes and groups episodes.
- Replay builder creates expected level nodes.

Integration tests:

- Ingest job scans fixtures.
- Project API returns projects.
- Timeline API returns lanes, episodes, and events.
- Run API returns replay nodes and evidence.

E2E tests:

- Empty state can trigger fixture ingest.
- Timeline renders.
- Run replay can play, pause, and scrub.
- Evidence drawer opens.
- Bright and dark themes are readable.

## 10. Acceptance Criteria

- `pnpm dev` starts the local dashboard.
- Scan reads real Codex rollout JSONL files.
- The current CC Flight project can appear as a project timeline.
- Timeline shows lanes for Product, Code, Agent Runs, Verification, and Risks.
- Clicking a run opens replay view.
- Tool call, patch, failure, and verification evidence appear in replay.
- Evidence drawer displays redacted evidence only.
- Light and dark themes are readable.
- Fixture tests do not depend on real `~/.codex`.
- Non-git directories do not break ingest or timeline display.
- Desktop migration can reuse `core/` and `storage/`.

## 11. Assumptions

- `DESIGN.md` is the source of truth for visual and product framing.
- Phase 1 is local-only.
- The MVP uses deterministic rules, not LLM summaries.
- Raw Codex logs stay on the user's machine.
- Desktop packaging starts only after parser, timeline, replay, and evidence UX are stable.
