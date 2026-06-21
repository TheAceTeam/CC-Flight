import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { COPY } from "../ui/src/i18n";
import { InsightBoard } from "../ui/src/App";
import type { JourneyInsight } from "../ui/src/insights";

describe("InsightBoard mode toggle", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      clear: vi.fn(() => store.clear()),
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      removeItem: vi.fn((key: string) => store.delete(key)),
      setItem: vi.fn((key: string, value: string) => store.set(key, value)),
    });
  });

  test("defaults to compact cards and switches to full cards without losing selection", () => {
    const onSelectJourney = vi.fn();

    render(
      <InsightBoard
        copy={COPY.en.timeline}
        insights={[insight]}
        activeJourneyId={null}
        onSelectJourney={onSelectJourney}
      />,
    );

    const board = screen.getByLabelText("High-signal task insights");
    expect(within(board).getByText("Tool loop pressure")).toBeInTheDocument();
    expect(within(board).queryByText("4 repeated tool calls")).not.toBeInTheDocument();
    expect(within(board).queryByText("4 tools")).not.toBeInTheDocument();

    fireEvent.click(within(board).getByRole("button", { name: "Expand insight board" }));

    expect(within(board).getByText("4 repeated tool calls")).toBeInTheDocument();
    expect(within(board).getByText("4 tools")).toBeInTheDocument();

    fireEvent.click(within(board).getByRole("button", { name: /Tool loop pressure.*Risky task/ }));

    expect(onSelectJourney).toHaveBeenCalledWith("journey-risk");
    expect(within(board).getByRole("button", { name: "Compact insight board" })).toBeInTheDocument();
  });

  test("remembers the last selected display mode", () => {
    const first = render(
      <InsightBoard
        copy={COPY.en.timeline}
        insights={[insight]}
        activeJourneyId={null}
        onSelectJourney={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand insight board" }));
    expect(localStorage.getItem("superview-insight-board-mode")).toBe("full");
    first.unmount();

    render(
      <InsightBoard
        copy={COPY.en.timeline}
        insights={[insight]}
        activeJourneyId={null}
        onSelectJourney={vi.fn()}
      />,
    );

    const board = screen.getByLabelText("High-signal task insights");
    expect(within(board).getByText("4 repeated tool calls")).toBeInTheDocument();
    expect(within(board).getByRole("button", { name: "Compact insight board" })).toBeInTheDocument();
  });
});

const insight: JourneyInsight = {
  id: "insight-risk",
  journeyId: "journey-risk",
  severity: "medium",
  score: 58,
  title: "Risky task",
  primaryKind: "tool_loop",
  signals: [{ kind: "tool_loop", penalty: 42, metric: 4 }],
  metrics: {
    tokens: 12_900,
    toolCalls: 4,
    errors: 0,
    files: 0,
    verificationEvents: 0,
    contextEvents: 0,
  },
};
