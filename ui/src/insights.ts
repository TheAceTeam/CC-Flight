import type { TaskJourney, TimelineEvent } from "../../core/types";

export type InsightSeverity = "high" | "medium" | "low";
export type InsightSignalKind =
  | "missing_verification"
  | "failed_run"
  | "tool_loop"
  | "high_cost"
  | "file_blast"
  | "error_pressure"
  | "context_churn";

export interface JourneyInsightSignal {
  kind: InsightSignalKind;
  penalty: number;
  metric: number;
}

export interface JourneyInsight {
  id: string;
  journeyId: string;
  severity: InsightSeverity;
  score: number;
  title: string;
  primaryKind: InsightSignalKind;
  signals: JourneyInsightSignal[];
  metrics: {
    tokens: number;
    toolCalls: number;
    errors: number;
    files: number;
    verificationEvents: number;
    contextEvents: number;
  };
}

export function buildJourneyInsights(
  journeys: TaskJourney[],
  timelineEventsById: Map<string, TimelineEvent>,
  maxInsights = 3,
  attentionThreshold = 60,
): JourneyInsight[] {
  return journeys
    .map((journey, index) => ({ insight: scoreJourney(journey, timelineEventsById), index }))
    .filter(({ insight }) => insight.score < attentionThreshold)
    .sort((a, b) => a.insight.score - b.insight.score || a.index - b.index)
    .map(({ insight }) => insight)
    .slice(0, maxInsights);
}

export function scoreJourney(
  journey: TaskJourney,
  timelineEventsById: Map<string, TimelineEvent>,
): JourneyInsight {
  const events = journey.eventIds
    .map((eventId) => timelineEventsById.get(eventId))
    .filter((event): event is TimelineEvent => Boolean(event));
  const signals: JourneyInsightSignal[] = [];
  const tokenTotal = journey.tokenUsage.total;
  const toolCalls = events.filter((event) => event.toolName || event.kind === "tool_call").length;
  const errors = events.filter(
    (event) => event.status === "failed" || event.kind === "error" || event.lane === "Risks",
  ).length;
  const verificationEvents = events.filter(
    (event) => event.kind === "verification" || event.lane === "Verification",
  ).length;
  const contextEvents = events.filter(
    (event) => event.kind === "reasoning_marker" || event.kind === "status" || event.kind === "tool_result",
  ).length;
  const files = new Set(events.flatMap((event) => event.files)).size;
  const changedWithoutVerification = events.some((event) => event.kind === "file_change") && verificationEvents === 0;
  const repeatedToolPressure = maxRepeatedToolCount(events);

  if (changedWithoutVerification) {
    signals.push({ kind: "missing_verification", penalty: 42, metric: 1 });
  }
  if (journey.status === "failed") {
    signals.push({ kind: "failed_run", penalty: 38, metric: 1 });
  }
  if (
    repeatedToolPressure >= 4 &&
    repeatedToolPressure / Math.max(1, toolCalls) >= 0.35
  ) {
    signals.push({
      kind: "tool_loop",
      penalty: Math.min(28, 10 + repeatedToolPressure * 3),
      metric: repeatedToolPressure,
    });
  }
  if (tokenTotal >= 10_000) {
    signals.push({
      kind: "high_cost",
      penalty: Math.min(30, 10 + Math.round(tokenTotal / 5000)),
      metric: tokenTotal,
    });
  }
  if (files >= 5) {
    signals.push({
      kind: "file_blast",
      penalty: Math.min(24, 8 + files * 2),
      metric: files,
    });
  }
  if (errors > 0) {
    signals.push({
      kind: "error_pressure",
      penalty: Math.min(24, 8 + errors * 5),
      metric: errors,
    });
  }
  if (contextEvents >= 10) {
    signals.push({
      kind: "context_churn",
      penalty: Math.min(20, 6 + Math.round(contextEvents / 2)),
      metric: contextEvents,
    });
  }

  const totalPenalty = signals.reduce((sum, signal) => sum + signal.penalty, 0);
  const score = Math.max(0, Math.min(100, 100 - totalPenalty));
  const primaryKind = [...signals].sort((a, b) => b.penalty - a.penalty)[0]?.kind ?? "high_cost";

  return {
    id: `insight-${journey.id}`,
    journeyId: journey.id,
    severity: score < 40 ? "high" : score < 60 ? "medium" : "low",
    score,
    title: journey.title,
    primaryKind,
    signals,
    metrics: {
      tokens: tokenTotal,
      toolCalls,
      errors,
      files,
      verificationEvents,
      contextEvents,
    },
  };
}

function maxRepeatedToolCount(events: TimelineEvent[]) {
  const counts = new Map<string, number>();
  for (const event of events) {
    const key = event.toolName || (event.kind === "tool_call" ? event.title : null);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Math.max(0, ...counts.values());
}
