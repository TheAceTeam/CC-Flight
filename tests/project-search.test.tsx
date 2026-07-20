import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../ui/src/App";

vi.mock("../ui/src/api", () => ({
  fetchConfig: vi.fn(async () => ({ projectDir: null, version: "0.7.0" })),
  fetchProjects: vi.fn(async () => [
    project("project-alpha", "Alpha Dashboard", "codex"),
    project("project-beta", "Beta Context Lab", "claude-code"),
    project("project-gamma", "Gamma Replay", "opencode"),
  ]),
  fetchDailyTokenUsage: vi.fn(async () => ({
    projectId: "project-alpha",
    points: [],
    total: { input: 0, output: 0, reasoning: 0, cachedInput: 0, total: 0 },
  })),
  fetchEventEvidence: vi.fn(),
  fetchIngestJob: vi.fn(),
  fetchTaskJourneyDetail: vi.fn(),
  fetchTimeline: vi.fn(async () => ({
    project: {
      id: "project-alpha",
      name: "Alpha Dashboard",
      cwd: "/tmp/alpha-dashboard",
      repoRoot: "/tmp/alpha-dashboard",
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
  startIngest: vi.fn(),
}));

describe("Project search", () => {
  beforeEach(() => {
    const store = new Map<string, string>([["superview-tour-completed", "true"]]);
    vi.stubGlobal("localStorage", {
      clear: vi.fn(() => store.clear()),
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      removeItem: vi.fn((key: string) => store.delete(key)),
      setItem: vi.fn((key: string, value: string) => store.set(key, value)),
    });
  });

  test("filters the project dropdown by search text", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Alpha Dashboard/ }));
    const list = screen.getByRole("listbox", { name: "Project" });
    expect(within(list).getByRole("option", { name: /Alpha Dashboard/ })).toBeInTheDocument();
    expect(within(list).getByRole("option", { name: /Beta Context Lab/ })).toBeInTheDocument();
    expect(within(list).getByRole("option", { name: /Gamma Replay/ })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search projects" }), {
      target: { value: "context" },
    });

    expect(within(list).queryByRole("option", { name: /Alpha Dashboard/ })).not.toBeInTheDocument();
    expect(within(list).getByRole("option", { name: /Beta Context Lab/ })).toBeInTheDocument();
    expect(within(list).queryByRole("option", { name: /Gamma Replay/ })).not.toBeInTheDocument();
  });
});

function project(id: string, name: string, provider: "codex" | "claude-code" | "opencode") {
  return {
    id,
    name,
    cwd: `/tmp/${name.toLowerCase().replaceAll(" ", "-")}`,
    repoRoot: `/tmp/${name.toLowerCase().replaceAll(" ", "-")}`,
    createdAt: "2026-06-21T00:00:00.000Z",
    updatedAt: "2026-06-21T00:00:00.000Z",
    tokenUsage: { input: 0, output: 0, reasoning: 0, cachedInput: 0, total: 0 },
    sessions: [
      {
        id: `${provider}:session-${id}`,
        provider,
        projectId: id,
        cwd: `/tmp/${name.toLowerCase().replaceAll(" ", "-")}`,
        startedAt: "2026-06-21T00:00:00.000Z",
        endedAt: "2026-06-21T00:00:00.000Z",
        sourcePath: "rollout.jsonl",
        model: null,
        cliVersion: null,
        tokenUsage: { input: 0, output: 0, reasoning: 0, cachedInput: 0, total: 0 },
      },
    ],
  };
}
