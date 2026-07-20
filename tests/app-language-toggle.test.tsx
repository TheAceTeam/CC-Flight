import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../ui/src/App";

vi.mock("../ui/src/api", () => ({
  fetchConfig: vi.fn(async () => ({ projectDir: null, version: "0.7.0" })),
  fetchProjects: vi.fn(async () => []),
  fetchDailyTokenUsage: vi.fn(),
  fetchEventEvidence: vi.fn(),
  fetchIngestJob: vi.fn(),
  fetchTaskJourneyDetail: vi.fn(),
  fetchTimeline: vi.fn(),
  resetDatabaseAndIngest: vi.fn(),
  startIngest: vi.fn()
}));

describe("App language toggle", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      clear: vi.fn(() => store.clear()),
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      removeItem: vi.fn((key: string) => store.delete(key)),
      setItem: vi.fn((key: string, value: string) => store.set(key, value))
    });
  });

  test("switches between English and Simplified Chinese and persists the choice", async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "No agent runs indexed" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Switch language to Simplified Chinese" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Switch language to Simplified Chinese" }));

    expect(screen.getByRole("heading", { name: "还没有索引 Agent Runs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "切换语言到英文" })).toBeInTheDocument();
    expect(localStorage.getItem("superview-language")).toBe("zh-CN");
  });
});
