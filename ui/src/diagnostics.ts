import { estimateProjectCost, formatCost, type ModelPricing } from "../../core/cost";
import type { TaskJourney, TimelineEvent } from "../../core/types";
import { formatMillionTokens } from "./tokenFormat";

export type DiagnosticSeverity = "critical" | "high" | "medium" | "low";
export type DiagnosticFindingType =
  | "failed_run"
  | "missing_verification"
  | "tool_errors"
  | "high_cost"
  | "long_run"
  | "subagent_review";

export interface DiagnosticFinding {
  id: string;
  severity: DiagnosticSeverity;
  type: DiagnosticFindingType;
  journeyId: string;
  journeyTitle: string;
  summary: string;
  evidence: string[];
  recommendation: string;
  sortValue: number;
}

export function buildDiagnosticFindings(
  journeys: TaskJourney[],
  timelineEventsById: Map<string, TimelineEvent>,
  pricing: ModelPricing[],
): DiagnosticFinding[] {
  const costs = journeys.map((j) =>
    estimateProjectCost(j.tokenUsage, undefined, pricing),
  );
  const tokenCounts = journeys.map((j) => j.tokenUsage.total ?? 0);
  const durations = journeys.map((j) => j.durationMs ?? 0);
  const eventCounts = journeys.map((j) => j.eventIds.length);
  const p90Cost = percentile(costs, 0.9);
  const p90Tokens = percentile(tokenCounts, 0.9);
  const p90Duration = percentile(durations, 0.9);
  const p90Events = percentile(eventCounts, 0.9);
  const findings: DiagnosticFinding[] = [];

  for (const journey of journeys) {
    const events = journey.eventIds
      .map((eventId) => timelineEventsById.get(eventId))
      .filter((event): event is TimelineEvent => Boolean(event));
    const failedEvents = events.filter(
      (event) => event.status === "failed" || event.kind === "error",
    );
    const fileEvents = events.filter(
      (event) => event.kind === "file_change" || event.files.length > 0,
    );
    const verificationEvents = events.filter(
      (event) => event.kind === "verification" || event.lane === "Verification",
    );
    const hasSuccessfulVerification = verificationEvents.some(
      (event) => event.status === "success",
    );
    const cost = estimateProjectCost(journey.tokenUsage, undefined, pricing);
    const tokens = journey.tokenUsage.total ?? 0;
    const subThreadCount = journey.subThreadCount ?? 0;

    if (hasUnrecoveredTerminalFailure(journey, events)) {
      findings.push({
        id: `failed_run:${journey.id}`,
        severity: "critical",
        type: "failed_run",
        journeyId: journey.id,
        journeyTitle: journey.title,
        summary: "The user input ended in a failed state.",
        evidence:
          failedEvents.slice(0, 3).map(eventLabel).length > 0
            ? failedEvents.slice(0, 3).map(eventLabel)
            : [`Journey status: ${journey.status}`],
        recommendation:
          "Open the journey, inspect the failed event, and rerun with an explicit recovery step.",
        sortValue: 100000 + failedEvents.length,
      });
    }

    if (fileEvents.length > 0 && !hasSuccessfulVerification) {
      findings.push({
        id: `missing_verification:${journey.id}`,
        severity: "high",
        type: "missing_verification",
        journeyId: journey.id,
        journeyTitle: journey.title,
        summary: "Code or file changes were captured without a successful verification event.",
        evidence: [
          `${fileEvents.length} file-change signal${fileEvents.length === 1 ? "" : "s"}`,
          verificationEvents.length > 0
            ? `${verificationEvents.length} verification event${verificationEvents.length === 1 ? "" : "s"}, none successful`
            : "No verification event captured",
        ],
        recommendation:
          "Ask the agent to run the relevant build, test, typecheck, or smoke verification.",
        sortValue: 80000 + fileEvents.length,
      });
    }

    if (failedEvents.length >= 2) {
      findings.push({
        id: `tool_errors:${journey.id}`,
        severity: failedEvents.length >= 5 ? "high" : "medium",
        type: "tool_errors",
        journeyId: journey.id,
        journeyTitle: journey.title,
        summary: "Multiple tool or error events clustered in this journey.",
        evidence: failedEvents.slice(0, 4).map(eventLabel),
        recommendation:
          "Review the failing tool pattern before continuing the same implementation path.",
        sortValue: 70000 + failedEvents.length,
      });
    }

    if (
      journeys.length >= 5 &&
      cost > 0 &&
      cost >= p90Cost &&
      tokens >= p90Tokens
    ) {
      findings.push({
        id: `high_cost:${journey.id}`,
        severity: "medium",
        type: "high_cost",
        journeyId: journey.id,
        journeyTitle: journey.title,
        summary: "This journey sits in the top cost band for the loaded project.",
        evidence: [
          `Estimated cost ${formatCost(cost)}`,
          `${formatMillionTokens(tokens)} tokens`,
        ],
        recommendation:
          "Inspect whether repeated context, retries, or broad subagent fan-out drove the cost.",
        sortValue: 50000 + cost,
      });
    }

    if (
      journeys.length >= 5 &&
      ((journey.durationMs >= p90Duration && journey.durationMs > 15 * 60_000) ||
        (journey.eventIds.length >= p90Events && journey.eventIds.length >= 80))
    ) {
      findings.push({
        id: `long_run:${journey.id}`,
        severity: "low",
        type: "long_run",
        journeyId: journey.id,
        journeyTitle: journey.title,
        summary: "This journey is unusually long or event-heavy compared with the project.",
        evidence: [
          `Duration ${formatDuration(journey.durationMs)}`,
          `${journey.eventIds.length} events`,
        ],
        recommendation:
          "Consider splitting future work into smaller user inputs with clearer completion checks.",
        sortValue: 30000 + journey.eventIds.length,
      });
    }

    if (subThreadCount >= 2 || (subThreadCount > 0 && journey.status === "failed")) {
      findings.push({
        id: `subagent_review:${journey.id}`,
        severity: journey.status === "failed" ? "high" : "medium",
        type: "subagent_review",
        journeyId: journey.id,
        journeyTitle: journey.title,
        summary: "This journey launched subagents and should be reviewed as a threaded workflow.",
        evidence: [`${subThreadCount} subagent sub-thread${subThreadCount === 1 ? "" : "s"}`],
        recommendation:
          "Open the Subagent tab and compare launch prompts with each subagent outcome.",
        sortValue: 60000 + subThreadCount,
      });
    }
  }

  return findings.sort((a, b) => b.sortValue - a.sortValue).slice(0, 40);
}

function percentile(values: number[], ratio: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1),
  );
  return sorted[index];
}

function eventLabel(event: TimelineEvent) {
  return event.toolName
    ? `${event.toolName}: ${event.title}`
    : `${event.kind}: ${event.title}`;
}

function hasUnrecoveredTerminalFailure(
  journey: TaskJourney,
  events: TimelineEvent[],
) {
  const lastFailureIndex = findLastIndex(
    events,
    (event) => event.status === "failed" || event.kind === "error",
  );
  if (lastFailureIndex < 0) return false;
  if (events.length === 0) return journey.status === "failed";

  const eventsAfterFailure = events.slice(lastFailureIndex + 1);
  const recovered = eventsAfterFailure.some(
    (event) =>
      event.kind === "assistant_message" ||
      (event.kind === "verification" && event.status === "success") ||
      (event.kind === "tool_result" && event.status === "success"),
  );
  if (recovered) return false;

  const last = events.at(-1);
  return (
    journey.status === "failed" ||
    last?.kind === "error" ||
    last?.status === "failed"
  );
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean) {
  for (let index = items.length - 1; index >= 0; index--) {
    if (predicate(items[index])) return index;
  }
  return -1;
}

export function formatDuration(durationMs: number) {
  if (durationMs < 1000) return `${durationMs}ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  if (seconds >= 3600) {
    const totalMinutes = Math.round(seconds / 60);
    if (totalMinutes >= 1440) {
      const totalHours = Math.round(totalMinutes / 60);
      const days = Math.floor(totalHours / 24);
      const remainingHours = totalHours % 24;
      return remainingHours > 0
        ? `${days}d ${remainingHours}h`
        : `${days}d`;
    }
    const hours = Math.floor(totalMinutes / 60);
    const remainingMinutes = totalMinutes % 60;
    return remainingMinutes > 0
      ? `${hours}h ${remainingMinutes}m`
      : `${hours}h`;
  }
  let minutes = Math.floor(seconds / 60);
  let remainingSeconds = Math.round(seconds % 60);
  if (remainingSeconds === 60) {
    minutes += 1;
    remainingSeconds = 0;
  }
  if (minutes >= 60) {
    return "1h";
  }
  return remainingSeconds > 0
    ? `${minutes}m ${remainingSeconds}s`
    : `${minutes}m`;
}
