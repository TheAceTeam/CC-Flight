import { describe, expect, it } from "vitest";
import type { TaskJourney, TimelineEvent } from "../core/types";
import { buildJourneyInsights, scoreJourney, scoreJourneys } from "../ui/src/insights";

const zeroTokens = { input: 0, output: 0, reasoning: 0, cachedInput: 0, total: 0 };

describe("journey insights", () => {
  it("scores risky patch work as a low health score out of 100", () => {
    const journey = makeJourney("j-risk", {
      tokenUsage: { input: 16000, output: 1200, reasoning: 800, cachedInput: 0, total: 18000 },
      eventIds: ["prompt", "edit", "read-1", "read-2", "read-3", "read-4"],
    });
    const events = new Map([
      ["prompt", event("prompt", "user_prompt", "Product", "Fix timeline")],
      ["edit", event("edit", "file_change", "Code", "Patch", { files: ["ui/src/App.tsx", "storage/database.ts", "core/timeline.ts", "tests/core.test.ts", "README.md"] })],
      ["read-1", event("read-1", "tool_call", "Code", "Read", { toolName: "exec_command" })],
      ["read-2", event("read-2", "tool_call", "Code", "Read", { toolName: "exec_command" })],
      ["read-3", event("read-3", "tool_call", "Code", "Read", { toolName: "exec_command" })],
      ["read-4", event("read-4", "tool_call", "Code", "Read", { toolName: "exec_command" })],
    ]);

    const insight = scoreJourney(journey, events);

    expect(insight.severity).toBe("high");
    expect(insight.score).toBeGreaterThanOrEqual(0);
    expect(insight.score).toBeLessThan(60);
    expect(insight.primaryKind).toBe("missing_verification");
    expect(insight.signals.map((signal) => signal.kind)).toEqual(
      expect.arrayContaining(["missing_verification", "high_cost", "tool_loop", "file_blast"]),
    );
  });

  it("scores every input session and marks healthy sessions green", () => {
    const risky = makeJourney("j-risk", {
      tokenUsage: { input: 12000, output: 1000, reasoning: 0, cachedInput: 0, total: 13000 },
      eventIds: ["risk-prompt", "risk-change"],
    });
    const veryRisky = makeJourney("j-very-risk", {
      status: "failed",
      tokenUsage: { input: 20000, output: 4000, reasoning: 0, cachedInput: 0, total: 24000 },
      eventIds: ["very-prompt", "very-change", "very-error"],
    });
    const ordinary = makeJourney("j-ok", {
      eventIds: ["ok-prompt", "ok-change", "ok-test"],
    });
    const events = new Map([
      ["risk-prompt", event("risk-prompt", "user_prompt", "Product", "Risky")],
      ["risk-change", event("risk-change", "file_change", "Code", "Patch")],
      ["very-prompt", event("very-prompt", "user_prompt", "Product", "Very risky")],
      ["very-change", event("very-change", "file_change", "Code", "Patch", { files: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"] })],
      ["very-error", event("very-error", "error", "Risks", "Failed", { status: "failed" })],
      ["ok-prompt", event("ok-prompt", "user_prompt", "Product", "OK")],
      ["ok-change", event("ok-change", "file_change", "Code", "Patch")],
      ["ok-test", event("ok-test", "verification", "Verification", "Tests passed")],
    ]);

    const scores = scoreJourneys([ordinary, risky, veryRisky], events);

    expect(scores.map((insight) => insight.journeyId)).toEqual(["j-ok", "j-risk", "j-very-risk"]);
    expect(scores.find((insight) => insight.journeyId === "j-ok")?.severity).toBe("low");
    expect(scores.find((insight) => insight.journeyId === "j-ok")?.score).toBeGreaterThan(80);
  });

  it("surfaces red sessions first, then the lowest yellow sessions when no red exists", () => {
    const red = makeJourney("j-red", {
      status: "failed",
      tokenUsage: { input: 20000, output: 4000, reasoning: 0, cachedInput: 0, total: 24000 },
      eventIds: ["red-prompt", "red-change", "red-error"],
    });
    const yellow = makeJourney("j-yellow", {
      eventIds: ["yellow-prompt", "yellow-tool-1", "yellow-tool-2", "yellow-tool-3", "yellow-tool-4"],
    });
    const green = makeJourney("j-green", {
      eventIds: ["green-prompt", "green-change", "green-test"],
    });
    const events = new Map([
      ["red-prompt", event("red-prompt", "user_prompt", "Product", "Red")],
      ["red-change", event("red-change", "file_change", "Code", "Patch", { files: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"] })],
      ["red-error", event("red-error", "error", "Risks", "Failed", { status: "failed" })],
      ["yellow-prompt", event("yellow-prompt", "user_prompt", "Product", "Yellow")],
      ["yellow-tool-1", event("yellow-tool-1", "tool_call", "Code", "Read", { toolName: "exec_command" })],
      ["yellow-tool-2", event("yellow-tool-2", "tool_call", "Code", "Read", { toolName: "exec_command" })],
      ["yellow-tool-3", event("yellow-tool-3", "tool_call", "Code", "Read", { toolName: "exec_command" })],
      ["yellow-tool-4", event("yellow-tool-4", "tool_call", "Code", "Read", { toolName: "exec_command" })],
      ["green-prompt", event("green-prompt", "user_prompt", "Product", "Green")],
      ["green-change", event("green-change", "file_change", "Code", "Patch")],
      ["green-test", event("green-test", "verification", "Verification", "Tests passed")],
    ]);

    expect(buildJourneyInsights([green, yellow, red], events, 3).map((insight) => insight.journeyId)).toEqual(["j-red"]);
    expect(buildJourneyInsights([green, yellow], events, 3).map((insight) => insight.journeyId)).toEqual(["j-yellow"]);
  });

  it("ranks selected attention sessions by lowest health score first", () => {
    const risky = makeJourney("j-risk", {
      tokenUsage: { input: 12000, output: 1000, reasoning: 0, cachedInput: 0, total: 13000 },
      eventIds: ["risk-prompt", "risk-change"],
    });
    const veryRisky = makeJourney("j-very-risk", {
      status: "failed",
      tokenUsage: { input: 20000, output: 4000, reasoning: 0, cachedInput: 0, total: 24000 },
      eventIds: ["very-prompt", "very-change", "very-error"],
    });
    const events = new Map([
      ["risk-prompt", event("risk-prompt", "user_prompt", "Product", "Risky")],
      ["risk-change", event("risk-change", "file_change", "Code", "Patch")],
      ["very-prompt", event("very-prompt", "user_prompt", "Product", "Very risky")],
      ["very-change", event("very-change", "file_change", "Code", "Patch", { files: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"] })],
      ["very-error", event("very-error", "error", "Risks", "Failed", { status: "failed" })],
    ]);

    const insights = buildJourneyInsights([risky, veryRisky], events, 3);

    expect(insights.map((insight) => insight.journeyId)).toEqual(["j-very-risk", "j-risk"]);
    expect(insights[0].score).toBeLessThan(insights[1].score);
  });
});

function makeJourney(id: string, overrides: Partial<TaskJourney> = {}): TaskJourney {
  return {
    id,
    projectId: "project-1",
    sessionId: "session-1",
    promptEventId: `${id}-prompt`,
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
