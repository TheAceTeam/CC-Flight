import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { COPY } from "../ui/src/i18n";
import { InsightBoard } from "../ui/src/App";
import type { JourneyInsight } from "../ui/src/insights";

describe("InsightBoard visibility toggle", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      clear: vi.fn(() => store.clear()),
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      removeItem: vi.fn((key: string) => store.delete(key)),
      setItem: vi.fn((key: string, value: string) => store.set(key, value)),
    });
  });

  test("defaults to closed and toggles to maximized without losing selection", () => {
    const onSelectJourney = vi.fn();

    render(
      <InsightBoard
        copy={COPY.en.timeline}
        insights={[insight]}
        activeJourneyId={null}
        onSelectJourney={onSelectJourney}
      />,
    );

    const board = screen.getByLabelText("Sessions needing attention");
    expect(within(board).queryByText("Tool loop pressure")).not.toBeInTheDocument();
    expect(within(board).queryByText("4 repeated tool calls")).not.toBeInTheDocument();
    expect(within(board).getByRole("button", { name: "Maximize insight board" })).toBeInTheDocument();

    fireEvent.click(within(board).getByRole("button", { name: "Maximize insight board" }));

    expect(within(board).getByText("Tool loop pressure")).toBeInTheDocument();
    expect(within(board).getByText("4 repeated tool calls")).toBeInTheDocument();
    expect(within(board).getByText("4 tools")).toBeInTheDocument();

    fireEvent.click(within(board).getByRole("button", { name: /Tool loop pressure.*Risky task/ }));

    expect(onSelectJourney).toHaveBeenCalledWith("journey-risk");
    expect(within(board).getByRole("button", { name: "Close insight board" })).toBeInTheDocument();
  });

  test("remembers the selected visibility state", () => {
    const first = render(
      <InsightBoard
        copy={COPY.en.timeline}
        insights={[insight]}
        activeJourneyId={null}
        onSelectJourney={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Maximize insight board" }));
    expect(localStorage.getItem("superview-insight-board-mode")).toBe("maximized");
    first.unmount();

    const second = render(
      <InsightBoard
        copy={COPY.en.timeline}
        insights={[insight]}
        activeJourneyId={null}
        onSelectJourney={vi.fn()}
      />,
    );

    let board = screen.getByLabelText("Sessions needing attention");
    expect(within(board).getByText("4 repeated tool calls")).toBeInTheDocument();

    fireEvent.click(within(board).getByRole("button", { name: "Close insight board" }));
    expect(localStorage.getItem("superview-insight-board-mode")).toBe("closed");
    second.unmount();

    render(
      <InsightBoard
        copy={COPY.en.timeline}
        insights={[insight]}
        activeJourneyId={null}
        onSelectJourney={vi.fn()}
      />,
    );

    board = screen.getByLabelText("Sessions needing attention");
    expect(within(board).queryByText("4 repeated tool calls")).not.toBeInTheDocument();
    expect(within(board).getByRole("button", { name: "Maximize insight board" })).toBeInTheDocument();
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
