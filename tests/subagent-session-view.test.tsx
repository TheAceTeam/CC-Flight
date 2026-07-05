import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../ui/src/App";

const { fetchTaskJourneyDetailMock, fetchTimelineMock } = vi.hoisted(() => ({
  fetchTaskJourneyDetailMock: vi.fn(),
  fetchTimelineMock: vi.fn(),
}));

vi.mock("../ui/src/api", () => ({
  fetchConfig: vi.fn(async () => ({ projectDir: null })),
  fetchProjects: vi.fn(async () => {
    const sessions = fixtureSessions();
    return [
      {
        id: "project-alpha",
        name: "Alpha Dashboard",
        cwd: "/tmp/alpha-dashboard",
        repoRoot: "/tmp/alpha-dashboard",
        createdAt: "2026-06-21T00:00:00.000Z",
        updatedAt: "2026-06-21T00:00:00.000Z",
        tokenUsage: zeroTokens(),
        sessions,
      },
    ];
  }),
  fetchDailyTokenUsage: vi.fn(async () => ({
    projectId: "project-alpha",
    points: [],
    total: zeroTokens(),
  })),
  fetchEventEvidence: vi.fn(),
  fetchIngestJob: vi.fn(),
  fetchRun: vi.fn(),
  fetchTaskJourneyDetail: fetchTaskJourneyDetailMock,
  fetchTimeline: fetchTimelineMock,
  resetDatabase: vi.fn(),
  startIngest: vi.fn(),
}));

describe("Subagent session view", () => {
  beforeEach(() => {
    fetchTaskJourneyDetailMock.mockReset();
    fetchTimelineMock.mockReset();
    fetchTimelineMock.mockImplementation(async () => fixtureEmptyTimeline());
    Element.prototype.scrollIntoView = vi.fn();
    const store = new Map<string, string>([["superview-tour-completed", "true"]]);
    vi.stubGlobal("localStorage", {
      clear: vi.fn(() => store.clear()),
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      removeItem: vi.fn((key: string) => store.delete(key)),
      setItem: vi.fn((key: string, value: string) => store.set(key, value)),
    });
  });

  test("hides the legacy subagent activity panel and drawer", async () => {
    render(<App />);

    expect(screen.queryByRole("region", { name: "Run Ledger" })).not.toBeInTheDocument();
    await screen.findByRole("region", { name: "Project Activity" });
    expect(screen.queryByRole("region", { name: "Subagent Activity" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /Subagent Worker/ })).not.toBeInTheDocument();
  });

  test("shows recent activity instead of an empty journey message", async () => {
    render(<App />);

    const activity = await screen.findByRole("region", {
      name: "Project Activity",
    });
    expect(within(activity).getByText("Read failing spec")).toBeInTheDocument();
    expect(
      screen.queryByText("No user-input task journeys are visible on this page."),
    ).not.toBeInTheDocument();
  });

  test("renders nested subagent work in the subagent details tab", async () => {
    const timeline = fixtureTimelineWithParentJourney();
    fetchTimelineMock.mockImplementation(async () => timeline);
    fetchTaskJourneyDetailMock.mockImplementation(async () => fixtureJourneyDetailWithSubThread());

    const { container } = render(<App />);

    const parentThread = await screen.findByRole("button", {
      name: /Build weather card/,
    });
    expect(parentThread).toHaveTextContent("Subagent 1");

    fireEvent.click(await screen.findByRole("tab", { name: "Subagent" }));

    expect(await screen.findByText("Subagent sub-thread")).toBeInTheDocument();
    expect(screen.getByText("1 sub-thread")).toBeInTheDocument();
    expect(screen.getByText("The subagent found a forecast parsing bug.")).toBeInTheDocument();
    expect(
      Array.from(container.querySelectorAll<HTMLElement>(".conversation-master-item")).filter((item) =>
        item.textContent?.includes("Build weather card"),
      ),
    ).toHaveLength(1);
  });
});

function fixtureEmptyTimeline() {
  return {
    project: {
      id: "project-alpha",
      name: "Alpha Dashboard",
      cwd: "/tmp/alpha-dashboard",
      repoRoot: "/tmp/alpha-dashboard",
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z",
    },
    episodes: [],
    events: [
      {
        id: "event-project-activity",
        projectId: "project-alpha",
        sessionId: "codex:subagent-session",
        turnId: null,
        timestamp: "2026-06-21T00:05:10.000Z",
        kind: "tool_call",
        lane: "Code",
        title: "Read failing spec",
        detail: "The subagent opened tests/failing.test.ts.",
        toolName: "shell",
        callId: "call-read-spec",
        status: "success",
        files: ["tests/failing.test.ts"],
        rawEventRefId: null,
        tokenUsage: null,
        skills: [],
      },
    ],
    causalEdges: [],
    taskJourneys: [],
    tokenUsage: zeroTokens(),
    totalEvents: 0,
    limit: 100000,
    offset: 0,
  };
}

function fixtureTimelineWithParentJourney() {
  const events = [
    timelineEvent({
      id: "event-parent-prompt",
      sessionId: "codex:main-session",
      timestamp: "2026-06-21T00:00:00.000Z",
      kind: "user_prompt",
      lane: "Product",
      title: "Build weather card",
      detail: "Build weather card",
    }),
    timelineEvent({
      id: "event-parent-assistant",
      sessionId: "codex:main-session",
      timestamp: "2026-06-21T00:00:01.000Z",
      kind: "assistant_message",
      lane: "Agent Runs",
      title: "Delegate to subagent",
      detail: "I will ask a subagent to inspect the parser.",
    }),
  ];
  return {
    ...fixtureEmptyTimeline(),
    events,
    taskJourneys: [
      {
        id: "task-parent",
        projectId: "project-alpha",
        sessionId: "codex:main-session",
        promptEventId: "event-parent-prompt",
        startedAt: "2026-06-21T00:00:00.000Z",
        endedAt: "2026-06-21T00:00:01.000Z",
        durationMs: 1000,
        title: "Build weather card",
        summary: "Parent journey",
        status: "success",
        exitType: "session_end",
        eventIds: events.map((event) => event.id),
        tokenUsage: zeroTokens(),
        subThreadCount: 1,
        skills: [],
        stageCounts: {},
        stages: [],
      },
    ],
  };
}

function fixtureJourneyDetailWithSubThread() {
  const timeline = fixtureTimelineWithParentJourney();
  const subEvents = [
    timelineEvent({
      id: "event-subthread-prompt",
      sessionId: "codex:subagent-session",
      timestamp: "2026-06-21T00:00:02.000Z",
      kind: "user_prompt",
      lane: "Product",
      title: "Inspect parser",
      detail: "Inspect the weather parser",
    }),
    timelineEvent({
      id: "event-subthread-thought",
      sessionId: "codex:subagent-session",
      timestamp: "2026-06-21T00:00:03.000Z",
      kind: "assistant_message",
      lane: "Agent Runs",
      title: "Found parser bug",
      detail: "The subagent found a forecast parsing bug.",
    }),
  ];
  return {
    journey: timeline.taskJourneys[0],
    events: timeline.events,
    causalEdges: [],
    subThreads: [
      {
        id: "subthread-1",
        sourcePath: "/tmp/alpha-dashboard/main-session/subagents/agent-worker.jsonl",
        session: fixtureSessions()[1],
        journey: {
          ...timeline.taskJourneys[0],
          id: "task-subthread",
          sessionId: "codex:subagent-session",
          promptEventId: "event-subthread-prompt",
          title: "Inspect the weather parser",
          eventIds: subEvents.map((event) => event.id),
        },
        events: subEvents,
      },
    ],
  };
}

function timelineEvent(overrides: Record<string, unknown>): any {
  return {
    projectId: "project-alpha",
    turnId: null,
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

function zeroTokens() {
  return { input: 0, output: 0, reasoning: 0, cachedInput: 0, total: 0 };
}

function fixtureSessions() {
  return [
    {
      id: "codex:main-session",
      projectId: "project-alpha",
      path: "/tmp/alpha-dashboard/rollout-main.jsonl",
      cwd: "/tmp/alpha-dashboard",
      startedAt: "2026-06-21T00:00:00.000Z",
      endedAt: "2026-06-21T00:04:00.000Z",
      cliVersion: null,
      modelProvider: null,
      source: "rollout-main.jsonl",
      provider: "codex",
      externalSessionId: "main-session",
      agentName: "Codex CLI",
    },
    {
      id: "codex:subagent-session",
      projectId: "project-alpha",
      path: "/tmp/alpha-dashboard/rollout-subagent.jsonl",
      cwd: "/tmp/alpha-dashboard",
      startedAt: "2026-06-21T00:05:00.000Z",
      endedAt: "2026-06-21T00:07:00.000Z",
      cliVersion: null,
      modelProvider: null,
      source: "rollout-subagent.jsonl",
      provider: "codex",
      externalSessionId: "subagent-session",
      agentName: "Subagent Worker",
    },
  ] as const;
}
