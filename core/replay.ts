import { ReplayNode, ReplayNodeType, SessionRecord, TimelineEvent } from "./types";

export function buildReplayNodes(events: TimelineEvent[]): ReplayNode[] {
  const runEvents = events
    .filter((event) => event.kind !== "reasoning_marker")
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return runEvents.map((event, index) => ({
    id: `node-${event.id}`,
    eventId: event.id,
    type: nodeTypeForEvent(event),
    label: labelForEvent(event),
    timestamp: event.timestamp,
    status: event.status,
    lane: event.lane,
    x: 80 + index * 120,
    detail: event.detail
  }));
}

export function buildRunReplay(session: SessionRecord, events: TimelineEvent[]) {
  return {
    session,
    events,
    nodes: buildReplayNodes(events),
    artifacts: []
  };
}

function nodeTypeForEvent(event: TimelineEvent): ReplayNodeType {
  if (hasRetrySignal(event)) return "loop";
  if (event.kind === "user_prompt") return "start";
  if (event.kind === "file_change") return "powerup";
  if (event.kind === "verification" && event.status === "success") return "finish";
  if (event.status === "failed" || event.kind === "error") return "hazard";
  if (event.kind === "verification") return "platform";
  if (/read|search|rg|find|open/i.test(`${event.title} ${event.detail ?? ""}`)) return "context";
  if (event.kind === "tool_call" || event.kind === "tool_result") return "platform";
  return "message";
}

function labelForEvent(event: TimelineEvent): string {
  if (hasRetrySignal(event)) return "Retry";
  if (event.kind === "user_prompt") return "Start";
  if (event.kind === "file_change") return "Patch";
  if (event.kind === "verification" && event.status === "success") return "Flag";
  if (event.kind === "verification") return "Check";
  if (event.status === "failed" || event.kind === "error") return "Hazard";
  if (event.kind === "tool_call") return event.toolName ?? "Tool";
  return event.title.length > 18 ? `${event.title.slice(0, 15)}...` : event.title;
}

function hasRetrySignal(event: TimelineEvent): boolean {
  return /retry|re-?run|try again|again|repeat|loop|重试|再试/i.test(`${event.title} ${event.detail ?? ""}`);
}
