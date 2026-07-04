# Agent Context Replay Design

## Summary

The current Three.js Context Flow demo shows motion, but it does not yet show the useful thing: **what context content the agent appears to carry from prompt to result, and how that content changes over time**.

This feature should add a parallel tab beside Thread View called **Context Replay**. It replays one user-prompt task journey as a sequence of observable context snapshots. Each snapshot shows the actual content blocks CC Flight can reconstruct from logs: user prompt, developer/system-like messages when present, history prompts, assistant summaries, tool inputs, tool outputs, file paths, file excerpts, errors, verification output, token usage, skills, and final response.

The product promise is not "we can see the model's private hidden context window." CC Flight can only show **observable context** from agent logs and stored redacted evidence. The UI must label inferred context state clearly.

## User Goal

Developers want to answer:

- What content entered the agent's working context at this point?
- Which context blocks were new, kept, changed, cited, ignored, or dropped?
- Did a stale instruction, old tool result, unrelated file, or previous summary keep influencing the run?
- Did the agent lose an important constraint before producing the result?
- Which exact log line or raw event supports each context block?

The useful insight is the changing **content ledger**, not a decorative replay path.

## Placement

Thread View should become a tabbed detail surface for the selected user input:

- `Conversation`
  - Current IM-style User -> process -> Codex thread.
- `Context Replay`
  - New tab for observable context snapshots and context diffs.

Run Atlas can later reuse the same model, but the first implementation belongs inside Thread View because the developer is already focused on one user-prompt task journey.

## MVP Data Boundary

Use existing data first:

- `TaskJourney`
- `TaskJourneyDetail.events`
- `TaskJourneyDetail.causalEdges`
- `TimelineEvent.detail`
- `TimelineEvent.files`
- `TimelineEvent.tokenUsage`
- `TimelineEvent.skills`
- `EventEvidence.rawEvent.redactedPayloadJson`
- `Artifact.excerpt`
- `CodexHistoryPrompt` if exposed through a small backend addition

Backend addition for MVP:

- Add a detail endpoint or extend task-journey detail to include raw event evidence for the journey events.
- Add session history prompts near the journey if available, because `history.jsonl` is one of the clearest observable context sources.

The MVP does not need embeddings, semantic search, or true model-side context-window introspection.

## Context Block Model

Create a shared model builder that turns journey detail and evidence into content blocks.

```ts
type ContextBlockType =
  | "user_prompt"
  | "developer_instruction"
  | "history_prompt"
  | "assistant_summary"
  | "reasoning_summary"
  | "tool_input"
  | "tool_output"
  | "file_reference"
  | "file_excerpt"
  | "error_output"
  | "verification_output"
  | "skill_instruction"
  | "final_response";

type ContextBlockState =
  | "new"
  | "retained"
  | "changed"
  | "cited"
  | "dropped"
  | "stale"
  | "contradicted";

interface ContextBlock {
  id: string;
  type: ContextBlockType;
  state: ContextBlockState;
  title: string;
  excerpt: string;
  sourceEventId: string | null;
  rawEventRefId: string | null;
  sourcePath: string | null;
  lineNo: number | null;
  timestamp: string;
  tokenEstimate: number;
  confidence: "direct" | "inferred";
  reason: string;
  files: string[];
  skills: string[];
}
```

## Snapshot Model

The replay should not just list events. It should show the context state at each important moment.

```ts
type ContextSnapshotPhase =
  | "prompt"
  | "history"
  | "planning"
  | "tool_call"
  | "tool_result"
  | "file_change"
  | "verification"
  | "response";

interface ContextSnapshot {
  id: string;
  phase: ContextSnapshotPhase;
  timestamp: string;
  eventId: string;
  title: string;
  blocks: ContextBlock[];
  addedBlockIds: string[];
  retainedBlockIds: string[];
  changedBlockIds: string[];
  droppedBlockIds: string[];
  warnings: ContextWarning[];
  tokenUsage: TokenUsage | null;
}

interface ContextWarning {
  id: string;
  severity: "low" | "medium" | "high";
  title: string;
  detail: string;
  blockIds: string[];
  eventIds: string[];
}
```

## State Inference Rules

The rules must be transparent and conservative.

- `new`
  - First snapshot containing the block's source event or source artifact.
- `retained`
  - Same block appears in the next snapshot because its source event still belongs to the active journey window.
- `changed`
  - A later block has the same type/source topic but different content, for example a later tool result for the same call or a rewritten plan summary.
- `cited`
  - Later assistant/tool/file event mentions the block's file path, command, tool call id, or a distinctive phrase from the block excerpt.
- `dropped`
  - A block was present in earlier snapshots but no later event references it after a phase boundary.
- `stale`
  - A retained block is older than newer contradictory tool/file evidence, or comes from history and is never cited.
- `contradicted`
  - Later error, verification failure, or tool output directly conflicts with the earlier block.

Every inferred state must show a reason string, for example:

- `Dropped after tool result: no later event mentions tests/storage-api.test.ts`
- `Cited by file_change event via path ui/src/App.tsx`
- `Potentially stale: history prompt predates selected run and is not cited later`

## UI Design

Context Replay has three panels.

### 1. Snapshot Rail

A horizontal or vertical time rail lists phases:

`Prompt -> History -> Tool Call -> Tool Result -> File Change -> Verification -> Response`

Each rail stop shows:

- timestamp
- phase label
- event kind
- added / dropped block counts
- warning marker if any

Clicking a stop updates the content ledger and 3D/2D visualization.

### 2. Context Ledger

This is the primary insight surface.

Each block is a readable card with:

- state badge: New / Retained / Changed / Cited / Dropped / Stale / Contradicted
- type badge
- source: event id, raw line, file path
- actual excerpt, capped with expand/collapse
- why CC Flight thinks the block is active or inactive
- token estimate or token usage contribution when available

Cards are grouped:

- Active context
- Newly added
- Changed or contradicted
- Dropped / stale

The user should be able to scan actual text, not just colored nodes.

### 3. Context Delta Visual

The visual layer can use Three.js, but it must stay subordinate to the ledger.

Recommended MVP visual:

- A 2.5D conveyor or stack of context cards, not abstract spheres.
- Cards flow from left to right by phase.
- Card color maps to block state.
- Retained cards move forward.
- Dropped cards fall below the main path.
- Contradicted cards shake or split.
- Cited cards get a visible link to the later event.

Three.js can animate the card movement and depth, but the cards must contain readable labels/excerpts. If readability suffers, prefer 2D DOM cards with light Three.js background motion.

## Example Interaction

For a run where the user asks "fix full timeline loading":

1. `Prompt`
   - New: user request mentioning `1-500 / 4708`.
2. `Tool Call`
   - New: `rg normalizeLimit`, `sed storage/database.ts`.
   - Retained: user request.
3. `Tool Result`
   - New: code excerpt showing `Math.min(500, ...)`.
   - Cited: user request because result explains the 500 cap.
4. `File Change`
   - Changed: backend limit becomes `100000`.
   - New: regression fixture with 650 events.
5. `Verification`
   - Cited: regression test output.
   - Dropped: unrelated UI context from earlier run.
6. `Response`
   - Retained: root cause, changed file, verification result.
   - Dropped: raw search output not needed in final answer.

This is the level of concrete content the UI must expose.

## Warnings

MVP warnings:

- **Lost constraint**
  - A user prompt phrase or file path appears early but disappears before response.
- **Stale history**
  - A history prompt appears in observable context but is not cited by later actions.
- **Contradicted context**
  - Tool result or verification failure conflicts with an earlier assumption.
- **Unverified final**
  - Final response references a fix but no later verification block exists.
- **Context overload**
  - Many retained blocks survive across phases without citation.

Warnings must link back to block cards and event evidence.

## Backend/API Changes

MVP uses a dedicated endpoint so the existing conversation detail view does not pay for raw evidence and context replay data unless the user opens the Context Replay tab.

### New Endpoint

`GET /api/task-journeys/:id/context-replay?projectId=...`

Response:

```ts
interface ContextReplayResponse {
  journey: TaskJourney;
  snapshots: ContextSnapshot[];
  blocks: ContextBlock[];
  evidenceByEventId: Record<string, EventEvidence>;
  warnings: ContextWarning[];
}
```

Do not extend `TaskJourneyDetail` for MVP. Context replay is likely to grow into a heavier response with raw evidence, history prompts, block diffs, and warnings; keeping it separate preserves the current Thread Conversation path.

## Frontend Architecture

Suggested files:

- `core/contextReplay.ts`
  - Pure model builder and inference rules.
- `runtime-node/contextReplay.ts`
  - Backend composition: journey detail + evidence + history prompts.
- `ui/src/ContextReplay.tsx`
  - React tab UI.
- `ui/src/ContextReplayScene.tsx`
  - Optional Three.js visual layer.
- `ui/src/contextReplayTypes.ts`
  - Frontend response types if not shared from core.

Thread View changes:

- Add selected detail tab state: `"conversation" | "context"`.
- Keep current Conversation tab unchanged.
- Load context replay lazily only when Context Replay tab opens.
- If replay is loading, show skeleton cards, not a blank canvas.

## Testing

Unit tests:

- Builds snapshots from a prompt -> tool result -> file change -> verification run.
- Marks blocks as `new`, `retained`, `cited`, and `dropped`.
- Detects stale history prompt.
- Detects unverified final response.
- Does not expose unredacted secret values from raw payload evidence.

API tests:

- Context replay endpoint returns snapshots and evidence for a fixture journey.
- Missing journey returns 404.
- Response remains stable when no raw evidence exists.

E2E tests:

- Select a user input in Thread View.
- Open `Context Replay` tab.
- Verify actual excerpt cards appear.
- Click a snapshot rail stop and see added/dropped counts change.
- Click a warning and see related block cards highlighted.
- If Three.js is enabled, canvas renders nonblank, but text ledger remains usable without WebGL.

## Non-Goals

- No claim of exact hidden model context.
- No model introspection beyond logs.
- No embeddings in MVP.
- No live tail in MVP.
- No auto-fixing prompt/context issues.
- No replacing the existing conversation thread.

## Acceptance Criteria

- Context Replay shows actual context text/excerpts, not only abstract nodes.
- Each snapshot explains what was added, retained, changed, dropped, or warned.
- Every block has a source event or explicit inferred label.
- The feature helps diagnose at least:
  - lost prompt constraints
  - stale history/context
  - unverified final responses
  - context overload
- The UI is readable without the Three.js visual layer.
- Existing Thread View behavior remains unchanged when the Context Replay tab is not opened.
