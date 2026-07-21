import { describe, expect, it } from "vitest";
import { DEFAULT_PRICING } from "../core/cost";
import type { TaskJourney, TimelineEvent } from "../core/types";
import { buildDiagnosticFindings, formatDuration } from "../ui/src/diagnostics";

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

describe("formatDuration", () => {
  it("formats durations under 1000ms as milliseconds", () => {
    expect(formatDuration(450)).toBe("450ms");
  });

  it("formats durations under 60 seconds as seconds", () => {
    expect(formatDuration(5200)).toBe("5.2s");
    expect(formatDuration(45_000)).toBe("45s");
  });

  it("formats durations under 60 minutes as minutes and seconds", () => {
    expect(formatDuration(74_000)).toBe("1m 14s");
    expect(formatDuration(300_000)).toBe("5m");
  });

  it("formats durations over 60 minutes using hours", () => {
    expect(formatDuration(3600_000)).toBe("1h");
    expect(formatDuration(3900_000)).toBe("1h 5m");
    expect(formatDuration(7200_000)).toBe("2h");
  });

  it("formats durations over 24 hours using days", () => {
    expect(formatDuration(86400_000)).toBe("1d");
    expect(formatDuration(90000_000)).toBe("1d 1h");
    expect(formatDuration(172800_000)).toBe("2d");
    expect(formatDuration(216000_000)).toBe("2d 12h");
  });

  it("rounds up to hours when rounding seconds reaches 60 minutes", () => {
    expect(formatDuration(3599_600)).toBe("1h");
  });
});
