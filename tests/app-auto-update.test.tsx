import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../ui/src/App";
import {
  fetchDailyTokenUsage,
  fetchProjects,
  fetchTimeline,
  startIngest,
} from "../ui/src/api";

vi.mock("../ui/src/api", () => ({
  fetchConfig: vi.fn(async () => ({ projectDir: null, version: "0.7.1" })),
  fetchProjects: vi.fn(async () => [
    {
      id: "project-auto",
      name: "Auto Project",
      cwd: "/tmp/auto",
      repoRoot: "/tmp/auto",
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z",
      tokenUsage: { input: 0, output: 0, reasoning: 0, cachedInput: 0, total: 0 },
      sessions: [],
    },
  ]),
  fetchDailyTokenUsage: vi.fn(async () => ({
    projectId: "project-auto",
    points: [],
    total: { input: 0, output: 0, reasoning: 0, cachedInput: 0, total: 0 },
  })),
  fetchEventEvidence: vi.fn(),
  fetchIngestJob: vi.fn(async () => ({
    id: "job-auto",
    status: "completed",
    phase: "completed",
    startedAt: "2026-06-21T00:00:00.000Z",
    finishedAt: "2026-06-21T00:00:01.000Z",
    totalFiles: 0,
    processedFiles: 0,
    totalEvents: 0,
    errors: [],
  })),
  fetchTaskJourneyDetail: vi.fn(),
  fetchTimeline: vi.fn(async () => ({
    project: {
      id: "project-auto",
      name: "Auto Project",
      cwd: "/tmp/auto",
      repoRoot: "/tmp/auto",
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z",
    },
    episodes: [],
    events: [],
    causalEdges: [],
    taskJourneys: [],
    tokenUsage: { input: 0, output: 0, reasoning: 0, cachedInput: 0, total: 0 },
    totalEvents: 0,
    limit: 100000,
    offset: 0,
  })),
  resetDatabaseAndIngest: vi.fn(),
  startIngest: vi.fn(async () => "job-auto"),
}));

describe("App auto update toggle", () => {
  beforeEach(() => {
    const store = new Map<string, string>([["superview-tour-completed", "true"]]);
    vi.stubGlobal("localStorage", {
      clear: vi.fn(() => store.clear()),
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      removeItem: vi.fn((key: string) => store.delete(key)),
      setItem: vi.fn((key: string, value: string) => store.set(key, value)),
    });
    vi.mocked(fetchProjects).mockClear();
    vi.mocked(fetchTimeline).mockClear();
    vi.mocked(fetchDailyTokenUsage).mockClear();
    vi.mocked(startIngest).mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("defaults on and can stop background refresh polling", async () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");
    render(<App />);

    const toggle = await screen.findByRole("button", { name: "Auto update on" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    await waitFor(() => {
      const autoUpdateIntervals = setIntervalSpy.mock.calls.filter((call) =>
        [15_000, 60_000].includes(Number(call[1])),
      );
      expect(autoUpdateIntervals).toHaveLength(2);
    });

    const autoUpdateTimerIds = setIntervalSpy.mock.calls
      .map((call, index) => ({
        delay: Number(call[1]),
        id: setIntervalSpy.mock.results[index]?.value,
      }))
      .filter(({ delay }) => [15_000, 60_000].includes(delay))
      .map(({ id }) => id);

    fireEvent.click(toggle);
    expect(localStorage.getItem("superview-auto-update")).toBe("off");
    expect(screen.getByRole("button", { name: "Auto update off" })).toHaveAttribute("aria-pressed", "false");

    await waitFor(() => {
      for (const timerId of autoUpdateTimerIds) {
        expect(clearIntervalSpy).toHaveBeenCalledWith(timerId);
      }
    });
  });

  test("keeps auto update off when the previous choice was disabled", async () => {
    localStorage.setItem("superview-auto-update", "off");
    const setIntervalSpy = vi.spyOn(window, "setInterval");

    render(<App />);

    const toggle = await screen.findByRole("button", { name: "Auto update off" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    await waitFor(() => {
      expect(fetchTimeline).toHaveBeenCalled();
    });
    const autoUpdateIntervals = setIntervalSpy.mock.calls.filter((call) =>
      [15_000, 60_000].includes(Number(call[1])),
    );
    expect(autoUpdateIntervals).toHaveLength(0);
  });

  test("refreshes the database with the selected project's agent providers", async () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    vi.mocked(fetchProjects).mockResolvedValueOnce([
      {
        id: "project-auto",
        name: "Auto Project",
        cwd: "/tmp/auto",
        repoRoot: "/tmp/auto",
        createdAt: "2026-06-21T00:00:00.000Z",
        updatedAt: "2026-06-21T00:00:00.000Z",
        tokenUsage: { input: 0, output: 0, reasoning: 0, cachedInput: 0, total: 0 },
        sessions: [
          session("codex:main", "codex"),
          session("claude-code:worker", "claude-code"),
        ],
      },
    ]);

    render(<App />);

    await screen.findByRole("button", { name: "Auto update on" });
    await waitFor(() => {
      expect(
        setIntervalSpy.mock.calls.some((call) => Number(call[1]) === 60_000),
      ).toBe(true);
    });

    const dbTimerCallback = setIntervalSpy.mock.calls
      .filter((call) => Number(call[1]) === 60_000)
      .at(-1)?.[0] as (() => Promise<void>) | undefined;
    expect(dbTimerCallback).toBeTruthy();
    await act(async () => {
      await dbTimerCallback?.();
    });

    expect(startIngest).toHaveBeenCalledWith({
      sources: [{ provider: "codex" }, { provider: "claude-code" }],
    });
  });
});

function session(id: string, provider: "codex" | "claude-code" | "opencode") {
  return {
    id,
    projectId: "project-auto",
    path: `/tmp/${id}.jsonl`,
    cwd: "/tmp/auto",
    startedAt: "2026-06-21T00:00:00.000Z",
    endedAt: "2026-06-21T00:00:01.000Z",
    cliVersion: null,
    modelProvider: null,
    source: "fixture",
    provider,
    externalSessionId: id,
    agentName: null,
  };
}
