import type {
  CodexHistoryPrompt,
  ContextBlock,
  ContextBlockState,
  ContextBlockType,
  ContextReplayResponse,
  ContextSnapshot,
  ContextSnapshotPhase,
  ContextWarning,
  EventEvidence,
  TimelineEvent,
  TaskJourneyDetail
} from "./types";

const UNAVAILABLE_REASONING_DETAILS = new Set([
  "Reasoning summary is not available in this log.",
  "Reasoning content is not displayed."
]);

export function buildContextReplay({
  detail,
  evidenceByEventId,
  historyPrompts = []
}: {
  detail: TaskJourneyDetail;
  evidenceByEventId?: Record<string, EventEvidence>;
  historyPrompts?: CodexHistoryPrompt[];
}): ContextReplayResponse {
  const evidence = evidenceByEventId ?? {};
  const events = orderedJourneyEvents(detail);
  const activeBlocks = new Map<string, ContextBlock>();
  const finalBlocks = new Map<string, ContextBlock>();
  const snapshots: ContextSnapshot[] = [];
  const warnings: ContextWarning[] = [];

  for (const [index, event] of events.entries()) {
    if (index === 1 && historyPrompts.length > 0) {
      const historyBlocks = historyPrompts.map((prompt, promptIndex) => historyPromptBlock(prompt, promptIndex, detail.journey.promptEventId));
      addSnapshot({
        snapshots,
        activeBlocks,
        finalBlocks,
        event: events[0],
        phase: "history",
        title: "History context",
        addedBlocks: historyBlocks,
        warnings: warningsForSnapshot(warnings, historyBlocks, events[0].id)
      });
    }

    const addedBlocks = blocksForEvent(event, evidence[event.id]);
    const snapshotWarnings: ContextWarning[] = [];
    const isFinalResponse = event.kind === "assistant_message" && index === events.length - 1;
    if (isFinalResponse && !hasSuccessfulVerificationBefore(events, index)) {
      snapshotWarnings.push({
        id: "warning-unverified-final",
        severity: "high",
        title: "Unverified final response",
        detail: "The final assistant response is observable, but no verification event appears before it in this task journey.",
        blockIds: addedBlocks.map((block) => block.id),
        eventIds: [event.id]
      });
    }

    addSnapshot({
      snapshots,
      activeBlocks,
      finalBlocks,
      event,
      phase: phaseForEvent(event),
      title: event.title,
      addedBlocks,
      warnings: snapshotWarnings
    });
    pushUniqueWarnings(warnings, snapshotWarnings);
  }

  const finalEvent = events.at(-1);
  if (finalEvent) {
    const staleHistoryBlocks = Array.from(activeBlocks.values()).filter((block) => block.type === "history_prompt" && block.state !== "cited");
    if (staleHistoryBlocks.length > 0) {
      const staleWarning: ContextWarning = {
        id: "warning-stale-history",
        severity: "medium",
        title: "Stale history context",
        detail: "A history prompt entered the observable context but was not cited by later tool, file, verification, or response events.",
        blockIds: staleHistoryBlocks.map((block) => block.id),
        eventIds: [finalEvent.id]
      };
      pushUniqueWarnings(warnings, [staleWarning]);
      const lastSnapshot = snapshots.at(-1);
      if (lastSnapshot) {
        const updatedBlocks = lastSnapshot.blocks.map((block) =>
          staleHistoryBlocks.some((stale) => stale.id === block.id)
            ? {
                ...block,
                state: "stale" as ContextBlockState,
                confidence: "inferred" as const,
                reason: "Potentially stale: history prompt is not cited by later observable events."
              }
            : block
        );
        lastSnapshot.blocks = updatedBlocks;
        lastSnapshot.warnings = [...lastSnapshot.warnings, staleWarning];
        for (const block of updatedBlocks) finalBlocks.set(block.id, block);
      }
    }
  }

  return {
    journey: detail.journey,
    snapshots,
    blocks: Array.from(finalBlocks.values()),
    evidenceByEventId: evidence,
    warnings
  };
}

function orderedJourneyEvents(detail: TaskJourneyDetail) {
  const byId = new Map(detail.events.map((event) => [event.id, event]));
  const ordered = detail.journey.eventIds.map((id) => byId.get(id)).filter((event): event is TimelineEvent => Boolean(event));
  return ordered.length > 0 ? ordered : [...detail.events].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

function addSnapshot({
  snapshots,
  activeBlocks,
  finalBlocks,
  event,
  phase,
  title,
  addedBlocks,
  warnings
}: {
  snapshots: ContextSnapshot[];
  activeBlocks: Map<string, ContextBlock>;
  finalBlocks: Map<string, ContextBlock>;
  event: TimelineEvent;
  phase: ContextSnapshotPhase;
  title: string;
  addedBlocks: ContextBlock[];
  warnings: ContextWarning[];
}) {
  const addedBlockIds = addedBlocks.map((block) => block.id);
  const retainedBlockIds: string[] = [];
  const changedBlockIds: string[] = [];
  const droppedBlockIds: string[] = [];

  for (const [id, block] of activeBlocks.entries()) {
    const next = nextBlockState(block, event, phase);
    if (next.state === "cited" || next.state === "changed") changedBlockIds.push(id);
    if (next.state === "dropped" || next.state === "stale" || next.state === "contradicted") droppedBlockIds.push(id);
    if (next.state === "retained") retainedBlockIds.push(id);
    activeBlocks.set(id, next);
  }

  for (const block of addedBlocks) {
    activeBlocks.set(block.id, block);
  }

  const blocks = Array.from(activeBlocks.values()).map((block) => ({ ...block }));
  for (const block of blocks) finalBlocks.set(block.id, block);

  snapshots.push({
    id: `context-snapshot-${event.id}-${phase}`,
    phase,
    timestamp: event.timestamp,
    eventId: event.id,
    title,
    blocks,
    addedBlockIds,
    retainedBlockIds,
    changedBlockIds,
    droppedBlockIds,
    warnings,
    tokenUsage: event.tokenUsage ?? null
  });
}

function nextBlockState(block: ContextBlock, event: TimelineEvent, phase: ContextSnapshotPhase): ContextBlock {
  if (event.id === block.sourceEventId) return block;
  if (referencesBlock(event, block)) {
    return {
      ...block,
      state: "cited",
      confidence: "inferred",
      reason: `Cited by ${event.kind} event via observable text, file path, command, or phrase.`
    };
  }
  if (phase === "response") {
    if (block.type === "history_prompt") {
      return {
        ...block,
        state: "stale",
        confidence: "inferred",
        reason: "Potentially stale: history prompt is not cited by the final response."
      };
    }
    if (block.type !== "user_prompt" && block.type !== "verification_output") {
      return {
        ...block,
        state: "dropped",
        confidence: "inferred",
        reason: `Dropped at final response: block content is not referenced by ${event.id}.`
      };
    }
  }
  if (block.state === "new") {
    return {
      ...block,
      state: "retained",
      reason: "Retained in the active observable journey window."
    };
  }
  return block;
}

function blocksForEvent(event: TimelineEvent, evidence: EventEvidence | undefined): ContextBlock[] {
  const blocks: ContextBlock[] = [];
  const base = {
    sourceEventId: event.id,
    rawEventRefId: event.rawEventRefId,
    timestamp: event.timestamp,
    sourcePath: evidence?.rawEvent?.sourcePath ?? null,
    lineNo: evidence?.rawEvent?.lineNo ?? null,
    files: event.files,
    skills: (event.skills ?? []).map((skill) => skill.name)
  };

  if (event.kind === "user_prompt") {
    blocks.push(contextBlock(event, base, "user_prompt", event.title, event.detail ?? event.title, "User prompt directly entered the agent conversation."));
  } else if (event.kind === "tool_call") {
    blocks.push(contextBlock(event, base, "tool_input", event.toolName ?? event.title, event.detail ?? event.title, "Tool input was invoked by the agent."));
  } else if (event.kind === "tool_result") {
    const artifacts = evidence?.artifacts.length ? evidence.artifacts : [];
    if (artifacts.length === 0) {
      blocks.push(contextBlock(event, base, "tool_output", event.toolName ?? event.title, event.detail ?? event.title, "Tool output was returned to the agent."));
    } else {
      for (const [index, artifact] of artifacts.entries()) {
        blocks.push(
          contextBlock(
            event,
            { ...base, sourcePath: artifact.path ?? base.sourcePath, files: artifact.path ? [artifact.path, ...event.files] : event.files },
            artifact.type === "file" ? "file_excerpt" : "tool_output",
            artifact.path ?? `${event.title} artifact`,
            artifact.excerpt,
            "Artifact excerpt is stored as redacted observable evidence.",
            index
          )
        );
      }
    }
  } else if (event.kind === "file_change") {
    for (const [index, file] of event.files.entries()) {
      blocks.push(contextBlock(event, { ...base, sourcePath: file, files: [file] }, "file_reference", file, file, "File path changed during this task.", index));
    }
    if (event.detail) {
      blocks.push(contextBlock(event, base, "file_excerpt", event.title, event.detail, "File change summary entered the observable context.", event.files.length));
    }
  } else if (event.kind === "verification") {
    blocks.push(contextBlock(event, base, "verification_output", event.title, event.detail ?? event.title, "Verification output is observable evidence for the result."));
  } else if (event.kind === "assistant_message") {
    blocks.push(contextBlock(event, base, "final_response", event.title, event.detail ?? event.title, "Assistant response is the visible result of this task journey."));
  } else if (event.kind === "reasoning_marker") {
    const summary = visibleReasoningSummary(event);
    if (summary) {
      blocks.push(contextBlock(event, base, "reasoning_summary", event.title, summary, "Reasoning summary marker was visible in the log."));
    }
  } else if (event.kind === "error") {
    blocks.push(contextBlock(event, base, "error_output", event.title, event.detail ?? event.title, "Error output contradicted or interrupted the active path."));
  }

  for (const [index, skill] of (event.skills ?? []).entries()) {
    blocks.push(
      contextBlock(
        event,
        base,
        "skill_instruction",
        skill.name,
        skill.excerpt || skill.command || skill.path || skill.name,
        `Skill ${skill.name} was detected from ${skill.source}.`,
        blocks.length + index
      )
    );
  }

  return blocks.filter((block) => block.excerpt.trim().length > 0);
}

function visibleReasoningSummary(event: TimelineEvent): string | null {
  const detail = event.detail?.trim();
  if (!detail || UNAVAILABLE_REASONING_DETAILS.has(detail)) return null;
  return detail;
}

function contextBlock(
  event: TimelineEvent,
  base: Pick<ContextBlock, "sourceEventId" | "rawEventRefId" | "timestamp" | "sourcePath" | "lineNo" | "files" | "skills">,
  type: ContextBlockType,
  title: string,
  excerpt: string,
  reason: string,
  index = 0
): ContextBlock {
  return {
    id: `context-block-${event.id}-${type}-${index}`,
    type,
    state: "new",
    title,
    excerpt: trimExcerpt(excerpt),
    tokenEstimate: estimateTokens(excerpt),
    confidence: "direct",
    reason,
    ...base
  };
}

function historyPromptBlock(prompt: CodexHistoryPrompt, index: number, promptEventId: string): ContextBlock {
  return {
    id: `context-block-history-${index}`,
    type: "history_prompt",
    state: "new",
    title: "History prompt",
    excerpt: trimExcerpt(prompt.text),
    sourceEventId: promptEventId,
    rawEventRefId: null,
    sourcePath: prompt.sourcePath,
    lineNo: prompt.lineNo,
    timestamp: prompt.ts,
    tokenEstimate: estimateTokens(prompt.text),
    confidence: "direct",
    reason: "History prompt is observable from history.jsonl near this session.",
    files: extractFilePaths(prompt.text),
    skills: []
  };
}

function phaseForEvent(event: TimelineEvent): ContextSnapshotPhase {
  if (event.kind === "user_prompt") return "prompt";
  if (event.kind === "tool_call") return "tool_call";
  if (event.kind === "tool_result") return "tool_result";
  if (event.kind === "file_change") return "file_change";
  if (event.kind === "verification") return "verification";
  if (event.kind === "assistant_message") return "response";
  return "planning";
}

function referencesBlock(event: TimelineEvent, block: ContextBlock) {
  const haystack = eventText(event);
  if (!haystack) return false;
  const needles = [
    ...block.files,
    block.sourcePath ?? "",
    ...extractFilePaths(block.excerpt),
    ...importantPhrases(block.excerpt),
    block.title
  ]
    .map((item) => item.trim())
    .filter((item) => item.length >= 4);
  return needles.some((needle) => haystack.includes(needle.toLowerCase()));
}

function eventText(event: TimelineEvent) {
  return [event.title, event.detail, event.toolName, event.callId, ...event.files].filter(Boolean).join("\n").toLowerCase();
}

function importantPhrases(text: string) {
  const filePaths = extractFilePaths(text);
  const compactNumbers = text.match(/\b\d+[-/]\d+\b/g) ?? [];
  const distinctivePhrases = (text.match(/\b[A-Za-z0-9_.-]+(?:\s+[A-Za-z0-9_.-]+){2,5}\b/g) ?? [])
    .map((phrase) => phrase.toLowerCase())
    .filter((phrase) => phrase.length >= 24)
    .slice(0, 4);
  return [...filePaths, ...compactNumbers, ...distinctivePhrases];
}

function extractFilePaths(text: string) {
  return text.match(/[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+/g) ?? [];
}

function trimExcerpt(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 360 ? `${normalized.slice(0, 357)}...` : normalized;
}

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.trim().length / 4));
}

function hasSuccessfulVerificationBefore(events: TimelineEvent[], finalIndex: number) {
  return events.slice(0, finalIndex).some((event) => event.kind === "verification" && event.status !== "failed");
}

function warningsForSnapshot(warnings: ContextWarning[], blocks: ContextBlock[], eventId: string) {
  return warnings.filter((warning) => warning.eventIds.includes(eventId) || warning.blockIds.some((blockId) => blocks.some((block) => block.id === blockId)));
}

function pushUniqueWarnings(target: ContextWarning[], warnings: ContextWarning[]) {
  for (const warning of warnings) {
    if (!target.some((item) => item.id === warning.id)) target.push(warning);
  }
}
