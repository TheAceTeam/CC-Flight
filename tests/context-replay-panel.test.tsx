import { render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { COPY } from "../ui/src/i18n";
import { ContextReplayPanel } from "../ui/src/App";
import type { ContextBlock, ContextReplayResponse, ContextSnapshot, SkillUsage, TaskJourney } from "../core/types";

describe("ContextReplayPanel metrics", () => {
  test("shows activated skill count and loaded skill list for the current session", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        disconnect() {}
      },
    );

    const { container } = render(
      <ContextReplayPanel
        copy={COPY.en.timeline}
        replay={replayFixture()}
        loading={false}
        selectedProjectName="project-fixture"
      />,
    );

    const metrics = screen.getByRole("group", { name: "Context Replay ledger" });
    expect(within(metrics).getByText("blocks")).toBeInTheDocument();

    const skillMetric = Array.from(
      container.querySelectorAll<HTMLElement>(".context-replay-metric"),
    ).find((metric) => within(metric).queryByText("skills"));

    expect(skillMetric).toHaveTextContent("2");

    const skillList = screen.getByRole("list", { name: "Skills" });
    expect(within(skillList).getByText("abtest")).toBeInTheDocument();
    expect(within(skillList).getByText("design-review")).toBeInTheDocument();
  });
});

const tokenUsage = { input: 1000, output: 500, reasoning: 0, cachedInput: 100, total: 1500 };

function replayFixture(): ContextReplayResponse {
  const skills: SkillUsage[] = [
    {
      name: "abtest",
      source: "user_prompt",
      confidence: "inferred",
      path: null,
      command: "/abtest",
      evidencePath: "rollout.jsonl",
      excerpt: "/abtest",
    },
    {
      name: "design-review",
      source: "assistant_message",
      confidence: "explicit",
      path: null,
      command: null,
      evidencePath: "rollout.jsonl",
      excerpt: "Using skill design-review",
    },
  ];
  const journey: TaskJourney = {
    id: "journey-1",
    projectId: "project-1",
    sessionId: "session-1",
    promptEventId: "event-1",
    startedAt: "2026-05-25T02:00:00.000Z",
    endedAt: "2026-05-25T02:00:01.000Z",
    durationMs: 1000,
    title: "Build metric panel",
    summary: "Fixture journey",
    status: "success",
    exitType: "session_end",
    eventIds: ["event-1"],
    tokenUsage,
    skills,
    stageCounts: {},
    stages: [],
  };
  const block: ContextBlock = {
    id: "block-1",
    type: "user_prompt",
    state: "cited",
    title: "Prompt",
    excerpt: "Build metric panel",
    sourceEventId: "event-1",
    rawEventRefId: null,
    sourcePath: "rollout.jsonl",
    lineNo: 1,
    timestamp: "2026-05-25T02:00:00.000Z",
    tokenEstimate: 4,
    confidence: "direct",
    reason: "User prompt entered the context.",
    files: [],
    skills: skills.map((skill) => skill.name),
  };
  const snapshot: ContextSnapshot = {
    id: "snapshot-1",
    phase: "prompt",
    timestamp: "2026-05-25T02:00:00.000Z",
    eventId: "event-1",
    title: "Prompt",
    blocks: [block],
    addedBlockIds: [block.id],
    retainedBlockIds: [],
    changedBlockIds: [],
    droppedBlockIds: [],
    warnings: [],
    tokenUsage,
  };

  return {
    journey,
    snapshots: [snapshot],
    blocks: [block],
    evidenceByEventId: {},
    warnings: [],
  };
}
