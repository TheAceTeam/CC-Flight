import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../ui/src/App";

const { startIngestMock } = vi.hoisted(() => ({
  startIngestMock: vi.fn(),
}));

vi.mock("../ui/src/api", () => ({
  fetchConfig: vi.fn(async () => ({ projectDir: null, version: "0.7.0" })),
  fetchProjects: vi.fn(async () => [
    {
      id: "project-scan",
      name: "Scan Project",
      cwd: "/tmp/scan-project",
      repoRoot: "/tmp/scan-project",
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z",
      tokenUsage: zeroTokens(),
      sessions: [],
    },
  ]),
  fetchDailyTokenUsage: vi.fn(async () => ({
    projectId: "project-scan",
    points: [],
    total: zeroTokens(),
  })),
  fetchEventEvidence: vi.fn(),
  fetchIngestJob: vi.fn(),
  fetchRun: vi.fn(),
  fetchTaskJourneyDetail: vi.fn(),
  fetchTimeline: vi.fn(async () => ({
    project: {
      id: "project-scan",
      name: "Scan Project",
      cwd: "/tmp/scan-project",
      repoRoot: "/tmp/scan-project",
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:00:00.000Z",
    },
    episodes: [],
    events: [],
    causalEdges: [],
    taskJourneys: [],
    tokenUsage: zeroTokens(),
    totalEvents: 0,
    limit: 100000,
    offset: 0,
  })),
  resetDatabaseAndIngest: vi.fn(),
  startIngest: startIngestMock,
}));

describe("Scan loader", () => {
  beforeEach(() => {
    startIngestMock.mockReset();
    const store = new Map<string, string>([["superview-tour-completed", "true"]]);
    vi.stubGlobal("localStorage", {
      clear: vi.fn(() => store.clear()),
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      removeItem: vi.fn((key: string) => store.delete(key)),
      setItem: vi.fn((key: string, value: string) => store.set(key, value)),
    });
  });

  test("shows the blocking loader immediately while scan start is pending", async () => {
    startIngestMock.mockReturnValue(new Promise(() => {}));
    render(<App />);

    expect(await screen.findByText("v0.7.0")).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: /Scan Agent Logs/ }));
    const panel = screen.getByRole("region", { name: "Scan Agent Logs" });
    fireEvent.click(within(panel).getByRole("button", { name: "Scan Agent Logs" }));

    const loader = await screen.findByRole("status", {
      name: "Blocking operation",
    });
    expect(loader).toHaveTextContent("Scanning agent logs");
    expect(screen.getByRole("button", { name: /Scan Agent Logs/ })).toBeDisabled();
  });

  test("scans every checked agent log source", async () => {
    startIngestMock.mockResolvedValue("job-scan");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Scan Agent Logs/ }));
    const panel = screen.getByRole("region", { name: "Scan Agent Logs" });
    fireEvent.click(within(panel).getByRole("checkbox", { name: "Claude Code" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Scan Agent Logs" }));

    await waitFor(() =>
      expect(startIngestMock).toHaveBeenCalledWith({
        sources: [{ provider: "codex" }, { provider: "claude-code" }],
      }),
    );
  });
});

function zeroTokens() {
  return { input: 0, output: 0, reasoning: 0, cachedInput: 0, total: 0 };
}
