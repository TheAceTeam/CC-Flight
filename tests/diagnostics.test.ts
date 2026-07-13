import { describe, expect, it } from "vitest";
import { DEFAULT_PRICING } from "../core/cost";
import type { TaskJourney, TimelineEvent } from "../core/types";
import { buildDiagnosticFindings } from "../ui/src/diagnostics";

const zeroTokens = { input: 0, output: 0, reasoning: 0, cachedInput: 0, total: 0 };

describe("project diagnostics", () => {
  it("does not mark a recovered failed journey as critical", () => {
    const journey = makeJourney("recovered", {
      status: "failed",
      eventIds: ["prompt", "failed-test", "final"],
    });
    const events = new Map([
      ["prompt", event("prompt", "user_prompt", "Product", "Ask project questions")],
      [
        "failed-test",
        event("failed-test", "verification", "Verification", "Initial check failed", {
          status: "failed",
        }),
      ],
      [
        "final",
        event("final", "assistant_message", "Agent Runs", "Completed analysis", {
          detail: "Answered the project questions and completed the response.",
        }),
      ],
    ]);

    const findings = buildDiagnosticFindings([journey], events, DEFAULT_PRICING);

    expect(findings.find((finding) => finding.type === "failed_run")).toBeUndefined();
  });

  it("keeps terminal failed journeys critical", () => {
    const journey = makeJourney("terminal", {
      status: "failed",
      eventIds: ["prompt", "terminal-error"],
    });
    const events = new Map([
      ["prompt", event("prompt", "user_prompt", "Product", "Ship feature")],
      [
        "terminal-error",
        event("terminal-error", "error", "Risks", "Tool output failed", {
          status: "failed",
          detail: "exit code 1",
        }),
      ],
    ]);

    const findings = buildDiagnosticFindings([journey], events, DEFAULT_PRICING);

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "critical",
          type: "failed_run",
          journeyId: "terminal",
        }),
      ]),
    );
  });
});

function makeJourney(id: string, overrides: Partial<TaskJourney> = {}): TaskJourney {
  return {
    id,
    projectId: "project-1",
    sessionId: "session-1",
    promptEventId: "prompt",
    startedAt: "2026-06-21T00:00:00.000Z",
    endedAt: "2026-06-21T00:01:00.000Z",
    durationMs: 60_000,
    title: id,
    summary: id,
    status: "success",
    exitType: "session_end",
    eventIds: [],
    tokenUsage: zeroTokens,
    skills: [],
    stageCounts: {},
    stages: [],
    ...overrides,
  };
}

function event(
  id: string,
  kind: TimelineEvent["kind"],
  lane: TimelineEvent["lane"],
  title: string,
  overrides: Partial<TimelineEvent> = {},
): TimelineEvent {
  return {
    id,
    projectId: "project-1",
    sessionId: "session-1",
    turnId: "turn-1",
    timestamp: "2026-06-21T00:00:00.000Z",
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
    ...overrides,
  };
}
