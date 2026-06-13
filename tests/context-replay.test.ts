import { describe, expect, it } from "vitest";
import { buildContextReplay } from "../core/contextReplay";
import type { EventEvidence, TaskJourney, TaskJourneyDetail, TimelineEvent } from "../core/types";

const baseTokenUsage = { input: 0, output: 0, reasoning: 0, cachedInput: 0, total: 0 };

describe("context replay model", () => {
  it("builds observable context snapshots with cited, retained, and dropped blocks", () => {
    const events = [
      event("prompt", "user_prompt", "Product", "Fix full timeline loading", {
        detail: "Fix full timeline loading: AI Org shows 1-500 / 4708 and ui/src/App.tsx must keep every task visible."
      }),
      event("tool-call", "tool_call", "Code", "Search timeline cap", {
        detail: "rg normalizeLimit storage/database.ts ui/src/App.tsx",
        toolName: "exec_command",
        callId: "call-search"
      }),
      event("tool-result", "tool_result", "Code", "Found 500 cap", {
        detail: "storage/database.ts contains Math.min(500, requestedLimit).",
        toolName: "exec_command",
        callId: "call-search"
      }),
      event("file-change", "file_change", "Code", "Lift project timeline limit", {
        detail: "Changed PROJECT_TIMELINE_LIMIT to 100000 and removed pagination controls.",
        files: ["ui/src/App.tsx", "storage/database.ts"]
      }),
      event("verify", "verification", "Verification", "Regression passed", {
        detail: "vitest tests/storage-api.test.ts returns all 4708 events."
      }),
      event("final", "assistant_message", "Agent Runs", "Fix complete", {
        detail: "Fixed full timeline loading in ui/src/App.tsx and storage/database.ts. Regression passed."
      })
    ];
    const detail = makeDetail(events);
    const evidenceByEventId = {
      "tool-result": {
        event: events[2],
        artifacts: [
          {
            id: "artifact-tool-result",
            eventId: "tool-result",
            type: "command_output",
            path: null,
            excerpt: "const limit = Math.min(500, requestedLimit);",
            sha256: "artifact-sha"
          }
        ],
        rawEvent: null
      }
    } satisfies Record<string, EventEvidence>;

    const replay = buildContextReplay({ detail, evidenceByEventId, historyPrompts: [] });

    expect(replay.snapshots.map((snapshot) => snapshot.phase)).toEqual(["prompt", "tool_call", "tool_result", "file_change", "verification", "response"]);
    expect(replay.blocks.map((block) => block.excerpt)).toEqual(expect.arrayContaining([
      "Fix full timeline loading: AI Org shows 1-500 / 4708 and ui/src/App.tsx must keep every task visible.",
      "const limit = Math.min(500, requestedLimit);",
      "ui/src/App.tsx"
    ]));

    const fileChangeSnapshot = replay.snapshots.find((snapshot) => snapshot.eventId === "file-change");
    expect(fileChangeSnapshot?.retainedBlockIds.length).toBeGreaterThan(0);
    expect(fileChangeSnapshot?.addedBlockIds.length).toBeGreaterThan(0);

    const finalSnapshot = replay.snapshots.at(-1);
    const promptBlock = finalSnapshot?.blocks.find((block) => block.sourceEventId === "prompt");
    const toolResultBlock = finalSnapshot?.blocks.find((block) => block.sourceEventId === "tool-result" && block.type === "tool_output");
    expect(promptBlock).toMatchObject({
      state: "cited",
      confidence: "inferred"
    });
    expect(toolResultBlock).toMatchObject({
      state: "dropped",
      reason: expect.stringContaining("not referenced")
    });
    expect(replay.warnings).toEqual([]);
  });

  it("detects stale history and unverified final responses without leaking raw secrets", () => {
    const events = [
      event("prompt", "user_prompt", "Product", "Update onboarding", {
        detail: "Update onboarding copy and do not expose API keys."
      }),
      event("tool-result", "tool_result", "Code", "Read env file", {
        detail: "Loaded environment output with [REDACTED] values.",
        toolName: "exec_command",
        callId: "call-env"
      }),
      event("final", "assistant_message", "Agent Runs", "Done", {
        detail: "Updated onboarding copy."
      })
    ];
    const detail = makeDetail(events);
    const replay = buildContextReplay({
      detail,
      evidenceByEventId: {
        "tool-result": {
          event: events[1],
          artifacts: [
            {
              id: "secret-artifact",
              eventId: "tool-result",
              type: "command_output",
              path: ".env",
              excerpt: "OPENAI_API_KEY=[REDACTED]",
              sha256: "secret-sha"
            }
          ],
          rawEvent: {
            id: "raw-secret",
            sessionId: "session-1",
            provider: "codex",
            lineNo: 42,
            timestamp: events[1].timestamp,
            type: "response_item",
            redactedPayloadJson: "{\"apiKey\":\"[REDACTED]\"}",
            sourcePath: "rollout.jsonl",
            sha256: "raw-sha"
          }
        }
      },
      historyPrompts: [
        {
          sessionId: "session-1",
          ts: "2026-05-25T01:59:00.000Z",
          text: "Old instruction: prefer the deprecated onboarding flow.",
          sourcePath: "history.jsonl",
          lineNo: 5
        }
      ]
    });

    expect(replay.warnings.map((warning) => warning.id)).toEqual(expect.arrayContaining(["warning-stale-history", "warning-unverified-final"]));
    expect(JSON.stringify(replay)).toContain("[REDACTED]");
    expect(JSON.stringify(replay)).not.toContain("sk-live-secret");
  });
});

function makeDetail(events: TimelineEvent[]): TaskJourneyDetail {
  const journey: TaskJourney = {
    id: "journey-1",
    projectId: "project-1",
    sessionId: "session-1",
    promptEventId: events[0].id,
    startedAt: events[0].timestamp,
    endedAt: events.at(-1)?.timestamp ?? events[0].timestamp,
    durationMs: Date.parse(events.at(-1)?.timestamp ?? events[0].timestamp) - Date.parse(events[0].timestamp),
    title: events[0].title,
    summary: "Fixture journey",
    status: "success",
    exitType: "session_end",
    eventIds: events.map((item) => item.id),
    tokenUsage: baseTokenUsage,
    skills: [],
    stageCounts: {},
    stages: []
  };
  return { journey, events, causalEdges: [] };
}

function event(
  id: string,
  kind: TimelineEvent["kind"],
  lane: TimelineEvent["lane"],
  title: string,
  overrides: Partial<TimelineEvent> = {}
): TimelineEvent {
  const index = ["prompt", "tool-call", "tool-result", "file-change", "verify", "final"].indexOf(id);
  return {
    id,
    projectId: "project-1",
    sessionId: "session-1",
    turnId: "turn-1",
    timestamp: new Date(Date.UTC(2026, 4, 25, 2, 0, Math.max(index, 0))).toISOString(),
    kind,
    lane,
    title,
    detail: null,
    toolName: null,
    callId: null,
    status: "success",
    files: [],
    rawEventRefId: null,
    tokenUsage: null,
    skills: [],
    ...overrides
  };
}
