import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { TaskJourneyDetail, TimelineEvent } from "../core/types";
import { COPY } from "../ui/src/i18n";
import { IntentRoutePanel } from "../ui/src/IntentRoutePanel";

describe("IntentRoutePanel", () => {
  test("derives a proof gap from observable events and links to the final response", () => {
    const onSelectEvent = vi.fn();
    render(<IntentRoutePanel copy={COPY.en.timeline} detail={detailFixture()} loading={false} onSelectEvent={onSelectEvent} />);

    const panel = screen.getByRole("region", { name: "Task intent route" });
    expect(panel).toHaveTextContent("Outcome needs proof");
    expect(panel).toHaveTextContent("No verification observed");

    fireEvent.click(within(panel).getByRole("button", { name: "The route now shows task intent and proof." }));

    expect(onSelectEvent).toHaveBeenCalledWith(expect.objectContaining({ id: "response" }));
  });

  test("shows a loading state until task events are available", () => {
    render(<IntentRoutePanel copy={COPY.en.timeline} detail={null} loading onSelectEvent={vi.fn()} />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading task route");
  });
});

function detailFixture(): TaskJourneyDetail {
  const events = [
    event("input", "user_prompt", "Build an intent route for this task."),
    event("response", "assistant_message", "The route now shows task intent and proof."),
  ];
  return {
    journey: {
      id: "journey",
      projectId: "project",
      sessionId: "session",
      promptEventId: "input",
      startedAt: events[0].timestamp,
      endedAt: events[1].timestamp,
      durationMs: 1000,
      title: "Build intent route",
      summary: "Fixture",
      status: "success",
      exitType: "session_end",
      eventIds: events.map((event) => event.id),
      tokenUsage: { input: 100, output: 100, reasoning: 0, cachedInput: 0, total: 200 },
      skills: [],
      stageCounts: {},
      stages: [],
    },
    events,
    causalEdges: [],
  };
}

function event(id: string, kind: TimelineEvent["kind"], detail: string): TimelineEvent {
  return {
    id,
    projectId: "project",
    sessionId: "session",
    turnId: null,
    timestamp: `2026-07-20T00:00:0${id === "input" ? "0" : "1"}.000Z`,
    kind,
    lane: "Agent Runs",
    title: detail,
    detail,
    toolName: null,
    callId: null,
    status: "success",
    files: [],
    rawEventRefId: null,
  };
}
