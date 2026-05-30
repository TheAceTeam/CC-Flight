import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { IngestJob } from "../core/types";
import { IngestLevelProgress } from "../ui/src/IngestLevelProgress";

function makeJob(overrides: Partial<IngestJob> = {}): IngestJob {
  return {
    id: "job-1",
    status: "running",
    phase: "parsing",
    startedAt: "2026-05-28T00:00:00.000Z",
    finishedAt: null,
    totalFiles: 20,
    processedFiles: 5,
    totalEvents: 42,
    changedFiles: 3,
    skippedFiles: 2,
    currentFile: "/repo/logs/session.jsonl",
    errors: [],
    ...overrides
  };
}

describe("IngestLevelProgress", () => {
  test("renders a status region with progress, level counters, and current file", () => {
    render(<IngestLevelProgress job={makeJob()} />);

    expect(screen.getByRole("status")).toHaveAccessibleName("Ingest running, parsing, 5 of 20 files processed, 25 percent");
    expect(screen.getByText("5/20 files")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("Phase: parsing")).toBeInTheDocument();
    expect(screen.getByText("Current: /repo/logs/session.jsonl")).toBeInTheDocument();
    expect(screen.getByText("Coins 3")).toBeInTheDocument();
    expect(screen.getByText("Cleared blocks 2")).toBeInTheDocument();
    expect(screen.getByText("Hazards 0")).toBeInTheDocument();
    expect(screen.getByText("Events 42")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Pixel Mario running" })).toHaveClass("ingest-level-avatar--running");
  });

  test("surfaces completed and failed visual states", () => {
    const { rerender } = render(
      <IngestLevelProgress job={makeJob({ status: "completed", phase: "completed", processedFiles: 20, finishedAt: "2026-05-28T00:01:00.000Z" })} />
    );

    expect(screen.getByText("Castle clear")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAccessibleName("Ingest completed, completed, 20 of 20 files processed, 100 percent");
    expect(screen.getByRole("img", { name: "Pixel Mario victory" })).not.toHaveClass("ingest-level-avatar--running");

    rerender(<IngestLevelProgress job={makeJob({ status: "failed", phase: "failed", errors: ["Parse failed"], processedFiles: 8 })} />);

    expect(screen.getByText("Level failed")).toBeInTheDocument();
    expect(screen.getByText("Parse failed")).toBeInTheDocument();
    expect(screen.getByText("Hazards 1")).toBeInTheDocument();
  });
});
