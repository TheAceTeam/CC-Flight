import { addMinutes, differenceInMinutes, isValid, parseISO } from "date-fns";
import { CausalConfidence, CausalEdge, CausalEdgeType, Episode, EventStatus, ProjectRecord, ProjectTimeline, SkillUsage, TaskJourney, TaskJourneyStage, TimelineEvent, TimelineLane, TokenUsage } from "./types";
import { stableId } from "./id";

const EPISODE_GAP_MINUTES = 90;
const LANE_ORDER: TimelineLane[] = ["Product", "Architecture", "Code", "Agent Runs", "Verification", "Risks"];

export function buildProjectTimeline(project: ProjectRecord, events: TimelineEvent[]): ProjectTimeline {
  const sortedEvents = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return {
    project,
    events: sortedEvents,
    episodes: groupEpisodes(project.id, sortedEvents),
    causalEdges: buildCausalEdges(project.id, sortedEvents),
    taskJourneys: buildTaskJourneys(project.id, sortedEvents),
    tokenUsage: aggregateTokenUsage(project.id, sortedEvents)
  };
}

export function aggregateTokenUsage(projectId: string, events: TimelineEvent[]): TokenUsage {
  return aggregateEventTokenUsage(events.filter((event) => event.projectId === projectId));
}

function aggregateEventTokenUsage(events: TimelineEvent[]): TokenUsage {
  return events.reduce<TokenUsage>(
    (total, event) => ({
      input: total.input + (event.tokenUsage?.input ?? 0),
      output: total.output + (event.tokenUsage?.output ?? 0),
      reasoning: total.reasoning + (event.tokenUsage?.reasoning ?? 0),
      cachedInput: total.cachedInput + (event.tokenUsage?.cachedInput ?? 0),
      total: total.total + (event.tokenUsage?.total ?? 0)
    }),
    { input: 0, output: 0, reasoning: 0, cachedInput: 0, total: 0 }
  );
}

export function buildTaskJourneys(projectId: string, events: TimelineEvent[]): TaskJourney[] {
  const projectEvents = events.filter((event) => event.projectId === projectId);
  const promptIndexes = projectEvents
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.kind === "user_prompt");

  return promptIndexes.map(({ event: prompt, index }, promptIndex) => {
    const nextPromptIndex = promptIndexes[promptIndex + 1]?.index ?? projectEvents.length;
    const nextPrompt = promptIndexes[promptIndex + 1]?.event;
    const endIndex = nextPromptIndex;
    const journeyEvents = projectEvents.slice(index, endIndex);
    const end = journeyEvents.at(-1) ?? prompt;
    const stages = buildTaskJourneyStages(journeyEvents);
    const failures = journeyEvents.filter((event) => event.status === "failed").length;
    const successes = journeyEvents.filter((event) => event.lane === "Verification" && event.status === "success").length;
    const status: EventStatus = failures > 0 ? "failed" : successes > 0 ? "success" : "unknown";
    const stageCounts = stages.reduce<Partial<Record<TimelineLane, number>>>((counts, stage) => {
      counts[stage.lane] = stage.count;
      return counts;
    }, {});

    return {
      id: stableId("task_journey", projectId, prompt.id, end.id),
      projectId,
      sessionId: prompt.sessionId,
      promptEventId: prompt.id,
      startedAt: prompt.timestamp,
      endedAt: end.timestamp,
      durationMs: durationBetween(prompt.timestamp, end.timestamp),
      title: prompt.title,
      summary: `From user input through ${journeyEvents.length} event(s), ${stages.length} stage(s), ending at ${nextPrompt ? "next user input" : "session end"}.`,
      status,
      exitType: nextPrompt ? "next_prompt" : "session_end",
      eventIds: journeyEvents.map((event) => event.id),
      tokenUsage: aggregateEventTokenUsage(journeyEvents),
      skills: aggregateEventSkills(journeyEvents),
      stageCounts,
      stages
    };
  });
}

function aggregateEventSkills(events: TimelineEvent[]): SkillUsage[] {
  const byIdentity = new Map<string, SkillUsage>();
  for (const event of events) {
    for (const skill of event.skills ?? []) {
      const key = `${skill.name}\0${skill.path ?? ""}\0${skill.source}`;
      if (!byIdentity.has(key)) {
        byIdentity.set(key, skill);
      }
    }
  }
  return [...byIdentity.values()].sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source));
}

function durationBetween(start: string, end: string): number {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return 0;
  return Math.max(0, endMs - startMs);
}

function buildTaskJourneyStages(events: TimelineEvent[]): TaskJourneyStage[] {
  const byLane = new Map<TimelineLane, { lane: TimelineLane; eventIds: string[]; firstEventId: string; lastEventId: string; failures: number; successes: number }>();
  for (const event of events) {
    const current =
      byLane.get(event.lane) ??
      {
        lane: event.lane,
        eventIds: [],
        firstEventId: event.id,
        lastEventId: event.id,
        failures: 0,
        successes: 0
      };
    current.eventIds.push(event.id);
    current.lastEventId = event.id;
    if (event.status === "failed") current.failures += 1;
    if (event.status === "success") current.successes += 1;
    byLane.set(event.lane, current);
  }

  return LANE_ORDER.flatMap((lane) => {
    const stage = byLane.get(lane);
    if (!stage) return [];
    const status: EventStatus = stage.failures > 0 ? "failed" : stage.successes > 0 ? "success" : "unknown";
    return [{ lane, count: stage.eventIds.length, status, firstEventId: stage.firstEventId, lastEventId: stage.lastEventId, eventIds: stage.eventIds }];
  });
}

export function buildCausalEdges(projectId: string, events: TimelineEvent[]): CausalEdge[] {
  const sortedEvents = events.filter((event) => event.projectId === projectId);
  const byId = new Map(sortedEvents.map((event) => [event.id, event]));
  const edges = new Map<string, CausalEdge>();

  const addEdge = (
    from: TimelineEvent | undefined,
    to: TimelineEvent | undefined,
    type: CausalEdgeType,
    confidence: CausalConfidence,
    reason: string,
    evidence: string | null = null
  ) => {
    if (!from || !to || from.id === to.id) return;
    const key = `${from.id}:${to.id}:${type}`;
    if (edges.has(key)) return;
    edges.set(key, {
      id: stableId("causal", projectId, from.id, to.id, type),
      projectId,
      fromEventId: from.id,
      toEventId: to.id,
      type,
      confidence,
      reason,
      evidence
    });
  };

  for (let index = 1; index < sortedEvents.length; index += 1) {
    const previous = sortedEvents[index - 1];
    const current = sortedEvents[index];
    if (previous.turnId && current.turnId === previous.turnId) {
      addEdge(previous, current, "same_turn", "deterministic", `Same turn_id ${current.turnId}.`, current.turnId);
    }
  }

  for (const event of sortedEvents) {
    const output = event.outputEventId ? byId.get(event.outputEventId) : undefined;
    if (output) {
      addEdge(event, output, output.status === "failed" ? "failed_by" : "same_call", "deterministic", `Function call ${event.callId ?? event.id} produced this output.`, event.callId);
    }
  }

  const sessions = groupBySession(sortedEvents);
  for (const sessionEvents of sessions.values()) {
    addPromptEdges(sessionEvents, addEdge);
    addForwardCausalEdges(sessionEvents, addEdge);
  }

  return [...edges.values()].sort((a, b) => {
    const fromDelta = (byId.get(a.fromEventId)?.timestamp ?? "").localeCompare(byId.get(b.fromEventId)?.timestamp ?? "");
    return fromDelta || (byId.get(a.toEventId)?.timestamp ?? "").localeCompare(byId.get(b.toEventId)?.timestamp ?? "") || a.type.localeCompare(b.type);
  });
}

function groupBySession(events: TimelineEvent[]): Map<string, TimelineEvent[]> {
  const sessions = new Map<string, TimelineEvent[]>();
  for (const event of events) {
    const current = sessions.get(event.sessionId) ?? [];
    current.push(event);
    sessions.set(event.sessionId, current);
  }
  return sessions;
}

function addPromptEdges(
  sessionEvents: TimelineEvent[],
  addEdge: (from: TimelineEvent | undefined, to: TimelineEvent | undefined, type: CausalEdgeType, confidence: CausalConfidence, reason: string, evidence?: string | null) => void
) {
  let pendingPrompts: TimelineEvent[] = [];
  for (const event of sessionEvents) {
    if (event.kind === "user_prompt") {
      pendingPrompts.push(event);
      continue;
    }

    if (pendingPrompts.length === 0) continue;
    if (event.lane === "Architecture" && (event.kind === "file_change" || event.kind === "tool_call")) {
      for (const prompt of pendingPrompts) {
        addEdge(prompt, event, "updates_design", "inferred", "First architecture or design artifact after this prompt in the same session.", prompt.title);
      }
    }
    if (event.lane === "Code" && (event.kind === "file_change" || event.toolName === "git")) {
      for (const prompt of pendingPrompts) {
        addEdge(prompt, event, "implements_prompt", "inferred", "First code change after this prompt in the same session.", prompt.title);
      }
    }

    if (event.lane === "Architecture" || event.lane === "Code") {
      pendingPrompts = pendingPrompts.filter((prompt) => {
        const hasArchitectureEdge = event.lane === "Architecture";
        const hasCodeEdge = event.lane === "Code";
        return !(hasArchitectureEdge || hasCodeEdge) || prompt.id === event.id;
      });
    }
  }
}

function addForwardCausalEdges(
  sessionEvents: TimelineEvent[],
  addEdge: (from: TimelineEvent | undefined, to: TimelineEvent | undefined, type: CausalEdgeType, confidence: CausalConfidence, reason: string, evidence?: string | null) => void
) {
  const pendingVerification: TimelineEvent[] = [];
  const pendingCommit: TimelineEvent[] = [];
  const pendingRetry: TimelineEvent[] = [];
  const pendingFailure: TimelineEvent[] = [];

  for (const event of sessionEvents) {
    if (event.lane === "Verification" && event.status === "success") {
      for (const source of pendingVerification.splice(0)) {
        addEdge(source, event, "verified_by", "inferred", "Nearest successful verification after this change in the same session.");
      }
    }

    if (event.toolName === "git" || Boolean(event.commitHash)) {
      for (const source of pendingCommit.splice(0)) {
        addEdge(source, event, "committed_as", "deterministic", "Nearest git commit after this change in the same session.");
      }
    }

    if (isRetryEvent(event)) {
      for (const source of pendingRetry.splice(0)) {
        addEdge(source, event, "retried_by", "inferred", "A later agent message or command indicates the failed step was retried.");
      }
    }

    if (event.status === "failed" && (event.lane === "Risks" || event.lane === "Verification")) {
      for (const source of pendingFailure.splice(0)) {
        addEdge(source, event, "failed_by", "inferred", "Nearest failed verification or risk event after this step in the same session.");
      }
    }

    if ((event.lane === "Code" || event.lane === "Architecture") && event.status !== "failed") {
      pendingVerification.push(event);
      pendingCommit.push(event);
    }
    if (event.status === "failed") {
      pendingRetry.push(event);
    } else {
      pendingFailure.push(event);
    }
  }
}

export function groupEpisodes(projectId: string, events: TimelineEvent[]): Episode[] {
  const projectEvents = events.filter((event) => event.projectId === projectId);
  if (projectEvents.length === 0) return [];

  const groups: TimelineEvent[][] = [];
  let current: TimelineEvent[] = [];

  for (const event of projectEvents) {
    const previous = current.at(-1);
    if (!previous || previous.sessionId === event.sessionId || minutesBetween(previous.timestamp, event.timestamp) <= EPISODE_GAP_MINUTES) {
      current.push(event);
    } else {
      groups.push(current);
      current = [event];
    }
  }
  if (current.length > 0) groups.push(current);

  return groups.map((group, index) => {
    const start = group[0];
    const end = group.at(-1) ?? start;
    const prompt = group.find((event) => event.kind === "user_prompt");
    const failures = group.filter((event) => event.status === "failed").length;
    const verifications = group.filter((event) => event.lane === "Verification" && event.status === "success").length;
    const status: EventStatus = failures > 0 ? "failed" : verifications > 0 ? "success" : "unknown";

    return {
      id: stableId("episode", projectId, start.timestamp, end.timestamp, index),
      projectId,
      startedAt: start.timestamp,
      endedAt: end.timestamp,
      title: prompt?.title ?? `Auto grouped episode ${index + 1}`,
      summary: `Auto grouped ${group.length} events across ${new Set(group.map((event) => event.sessionId)).size} run(s).`,
      status,
      eventIds: group.map((event) => event.id)
    };
  });
}

function minutesBetween(left: string, right: string): number {
  const a = parseISO(left);
  const b = parseISO(right);
  if (!isValid(a) || !isValid(b)) {
    return 0;
  }
  return Math.abs(differenceInMinutes(b, a));
}

function isAfter(candidate: TimelineEvent, base: TimelineEvent): boolean {
  return candidate.timestamp > base.timestamp || (candidate.timestamp === base.timestamp && candidate.id > base.id);
}

function isRetryEvent(event: TimelineEvent): boolean {
  return /\bretry\b|\bretrying\b|重试|再次尝试/i.test(`${event.title}\n${event.detail ?? ""}`);
}

export function makePlaceholderDate(seed: string): string {
  const date = parseISO(seed);
  return isValid(date) ? date.toISOString() : addMinutes(new Date(0), 1).toISOString();
}
