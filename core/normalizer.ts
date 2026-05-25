import path from "node:path";
import {
  Artifact,
  NormalizedBundle,
  ParsedCodexLine,
  ProjectRecord,
  RawEventRef,
  SessionRecord,
  TimelineEvent,
  TimelineLane,
  TurnRecord
} from "./types";
import { safeExcerpt } from "./redactor";
import { stableId } from "./id";

interface NormalizeOptions {
  repoRoot?: string | null;
}

export function normalizeCodexLines(lines: ParsedCodexLine[], options: NormalizeOptions = {}): NormalizedBundle | null {
  if (lines.length === 0) {
    return null;
  }

  const sessionMeta = lines.find((line) => line.type === "session_meta");
  const metaPayload = asRecord(sessionMeta?.payload);
  const sessionId = stringValue(metaPayload.id) ?? stableId("session", lines[0]?.sourcePath ?? "unknown");
  const cwd = stringValue(metaPayload.cwd) ?? process.cwd();
  const startedAt = stringValue(metaPayload.timestamp) ?? sessionMeta?.timestamp ?? lines[0]?.timestamp ?? new Date().toISOString();
  const repoRoot = options.repoRoot ?? null;
  const projectId = stableId("project", repoRoot ?? cwd);

  const project: ProjectRecord = {
    id: projectId,
    name: path.basename(repoRoot ?? cwd) || "Unknown Project",
    cwd,
    repoRoot,
    createdAt: startedAt,
    updatedAt: lines.at(-1)?.timestamp ?? startedAt
  };

  const session: SessionRecord = {
    id: sessionId,
    projectId,
    path: lines[0]?.sourcePath ?? "",
    cwd,
    startedAt,
    endedAt: lines.at(-1)?.timestamp ?? null,
    cliVersion: stringValue(metaPayload.cli_version),
    modelProvider: stringValue(metaPayload.model_provider),
    source: stringValue(metaPayload.source)
  };

  const rawEventRefs: RawEventRef[] = lines.map((line) => ({
    id: stableId("raw", sessionId, line.lineNo, line.sha256),
    sessionId,
    lineNo: line.lineNo,
    timestamp: line.timestamp,
    type: line.type,
    redactedPayloadJson: JSON.stringify(line.redactedPayload),
    sourcePath: line.sourcePath,
    sha256: line.sha256
  }));

  const turns = new Map<string, TurnRecord>();
  const events: TimelineEvent[] = [];
  const artifacts: Artifact[] = [];

  for (const [index, line] of lines.entries()) {
    const rawRef = rawEventRefs[index];
    const payload = asRecord(line.redactedPayload);
    const rawPayload = asRecord(line.payload);
    const turnId = stringValue(payload.turn_id) ?? stringValue(rawPayload.turn_id) ?? null;
    const payloadType = stringValue(payload.type) ?? stringValue(rawPayload.type);

    if (line.type === "turn_context") {
      const id = stringValue(payload.turn_id) ?? stableId("turn", sessionId, line.lineNo);
      turns.set(id, {
        id,
        sessionId,
        startedAt: line.timestamp,
        endedAt: null,
        cwd: stringValue(payload.cwd),
        model: stringValue(payload.model),
        approvalPolicy: stringValue(payload.approval_policy),
        sandboxPolicy: stringValue(payload.sandbox_policy)
      });
      events.push(makeEvent({ line, rawRef, projectId, sessionId, turnId: id, kind: "turn", lane: "Agent Runs", title: "Turn started", detail: stringValue(payload.cwd) }));
      continue;
    }

    if (line.type === "session_meta") {
      events.push(makeEvent({ line, rawRef, projectId, sessionId, turnId, kind: "session", lane: "Agent Runs", title: "Session started", detail: cwd, status: "success" }));
      continue;
    }

    if (line.type === "parse_error") {
      events.push(makeEvent({ line, rawRef, projectId, sessionId, turnId, kind: "error", lane: "Risks", title: "Parse error", detail: safeExcerpt(payload, 500), status: "failed" }));
      continue;
    }

    if (line.type === "response_item") {
      const event = normalizeResponseItem({ line, rawRef, projectId, sessionId, turnId, payload, rawPayload });
      events.push(event);
      artifacts.push(makeArtifact(event, rawRef, payload));
      continue;
    }

    if (line.type === "event_msg") {
      const event = normalizeEventMessage({ line, rawRef, projectId, sessionId, turnId, payload, payloadType: payloadType ?? undefined });
      events.push(event);
      if (event.kind === "error") {
        artifacts.push(makeArtifact(event, rawRef, payload));
      }
      continue;
    }

    events.push(makeEvent({ line, rawRef, projectId, sessionId, turnId, kind: "status", lane: "Agent Runs", title: line.type, detail: safeExcerpt(payload, 500) }));
  }

  associateFunctionCallOutputs(events);

  return {
    project,
    session,
    turns: Array.from(turns.values()),
    rawEventRefs,
    events,
    artifacts
  };
}

function normalizeResponseItem(input: {
  line: ParsedCodexLine;
  rawRef: RawEventRef;
  projectId: string;
  sessionId: string;
  turnId: string | null;
  payload: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
}): TimelineEvent {
  const { line, rawRef, projectId, sessionId, turnId, payload, rawPayload } = input;
  const payloadType = stringValue(payload.type) ?? stringValue(rawPayload.type);
  const role = stringValue(payload.role) ?? stringValue(rawPayload.role);

  if (payloadType === "message") {
    const text = extractMessageText(payload);
    if (role === "user") {
      return makeEvent({ line, rawRef, projectId, sessionId, turnId, kind: "user_prompt", lane: "Product", title: summarize(text, "User prompt"), detail: text, status: "success" });
    }
    if (role === "assistant") {
      return makeEvent({ line, rawRef, projectId, sessionId, turnId, kind: "assistant_message", lane: "Agent Runs", title: summarize(text, "Assistant message"), detail: text, status: "success" });
    }
    return makeEvent({ line, rawRef, projectId, sessionId, turnId, kind: "status", lane: "Agent Runs", title: `${role ?? "System"} message`, detail: text, status: "success" });
  }

  if (payloadType === "function_call") {
    const toolName = stringValue(payload.name) ?? stringValue(rawPayload.name) ?? "tool";
    const title = titleForToolCall(toolName, payload);
    const lane = laneForToolCall(toolName, payload);
    const kind = kindForToolCall(toolName, payload);
    return makeEvent({
      line,
      rawRef,
      projectId,
      sessionId,
      turnId,
      kind,
      lane,
      title,
      detail: safeExcerpt(payload.arguments ?? payload, 900),
      toolName,
      callId: stringValue(payload.call_id) ?? stringValue(rawPayload.call_id),
      status: "running",
      files: extractFiles(payload)
    });
  }

  if (payloadType === "function_call_output") {
    const output = stringValue(payload.output) ?? safeExcerpt(payload, 900);
    const failed = /failed|error|exit code [1-9]|exception|traceback/i.test(output);
    const verification = /test|lint|build|typecheck|tsc|playwright|pytest|vitest|pass|fail/i.test(output);
    return makeEvent({
      line,
      rawRef,
      projectId,
      sessionId,
      turnId,
      kind: failed ? "error" : verification ? "verification" : "tool_result",
      lane: failed ? "Risks" : verification ? "Verification" : "Agent Runs",
      title: failed ? "Tool output failed" : verification ? "Verification output" : "Tool output",
      detail: safeExcerpt(output, 1200),
      callId: stringValue(payload.call_id) ?? stringValue(rawPayload.call_id),
      status: failed ? "failed" : "success",
      files: extractFiles(payload)
    });
  }

  if (payloadType === "reasoning") {
    return makeEvent({ line, rawRef, projectId, sessionId, turnId, kind: "reasoning_marker", lane: "Agent Runs", title: "Reasoning segment", detail: "Reasoning content is not displayed.", status: "success" });
  }

  return makeEvent({ line, rawRef, projectId, sessionId, turnId, kind: "status", lane: "Agent Runs", title: payloadType ?? "Response item", detail: safeExcerpt(payload, 900) });
}

function normalizeEventMessage(input: {
  line: ParsedCodexLine;
  rawRef: RawEventRef;
  projectId: string;
  sessionId: string;
  turnId: string | null;
  payload: Record<string, unknown>;
  payloadType?: string;
}): TimelineEvent {
  const { line, rawRef, projectId, sessionId, turnId, payload, payloadType } = input;
  const message = stringValue(payload.message) ?? stringValue(payload.msg) ?? payloadType ?? "Event";
  const failed = /error|failed|abort|panic/i.test(message);
  return makeEvent({
    line,
    rawRef,
    projectId,
    sessionId,
    turnId,
    kind: failed ? "error" : "status",
    lane: failed ? "Risks" : "Agent Runs",
    title: summarize(message, payloadType ?? "Event"),
    detail: safeExcerpt(payload, 800),
    status: failed ? "failed" : "success"
  });
}

function makeEvent(input: {
  line: ParsedCodexLine;
  rawRef: RawEventRef;
  projectId: string;
  sessionId: string;
  turnId: string | null;
  kind: TimelineEvent["kind"];
  lane: TimelineLane;
  title: string;
  detail?: string | null;
  toolName?: string | null;
  callId?: string | null;
  status?: TimelineEvent["status"];
  files?: string[];
  durationMs?: number | null;
  outputEventId?: string | null;
}): TimelineEvent {
  return {
    id: stableId("event", input.sessionId, input.line.lineNo, input.kind, input.title),
    projectId: input.projectId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    timestamp: input.line.timestamp,
    kind: input.kind,
    lane: input.lane,
    title: input.title,
    detail: input.detail ?? null,
    toolName: input.toolName ?? null,
    callId: input.callId ?? null,
    status: input.status ?? "unknown",
    files: input.files ?? [],
    rawEventRefId: input.rawRef.id,
    durationMs: input.durationMs ?? null,
    outputEventId: input.outputEventId ?? null
  };
}

function associateFunctionCallOutputs(events: TimelineEvent[]): void {
  const callsById = new Map<string, TimelineEvent>();

  for (const event of events) {
    if (event.callId && event.toolName && (event.kind === "tool_call" || event.kind === "file_change" || event.kind === "verification")) {
      callsById.set(event.callId, event);
    }
  }

  for (const output of events) {
    if (!output.callId) continue;
    const call = callsById.get(output.callId);
    if (!call || call.id === output.id) continue;

    const failed = output.status === "failed" || output.kind === "error";
    call.status = failed ? "failed" : "success";
    call.outputEventId = output.id;
    call.durationMs = durationBetween(call.timestamp, output.timestamp);

    const normalized = outputShapeForCall(call, output);
    output.kind = normalized.kind;
    output.lane = normalized.lane;
    output.title = normalized.title;
    output.status = normalized.status;
    output.toolName = call.toolName;
    output.files = Array.from(new Set([...call.files, ...output.files]));
  }
}

function outputShapeForCall(call: TimelineEvent, output: TimelineEvent): Pick<TimelineEvent, "kind" | "lane" | "title" | "status"> {
  if (output.status === "failed" || output.kind === "error") {
    return { kind: "error", lane: "Risks", title: "Tool output failed", status: "failed" };
  }
  if (call.kind === "verification" || call.lane === "Verification") {
    return { kind: "verification", lane: "Verification", title: "Verification output", status: "success" };
  }
  if (call.kind === "file_change") {
    return { kind: "file_change", lane: call.lane, title: "Patch output", status: "success" };
  }
  return { kind: "tool_result", lane: call.lane, title: "Tool output", status: "success" };
}

function durationBetween(start: string, end: string): number | null {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return null;
  }
  return endMs - startMs;
}

function makeArtifact(event: TimelineEvent, rawRef: RawEventRef, payload: unknown): Artifact {
  return {
    id: stableId("artifact", event.id, rawRef.id),
    eventId: event.id,
    type: event.kind === "tool_result" || event.kind === "verification" || event.kind === "error" ? "command_output" : "payload",
    path: rawRef.sourcePath,
    excerpt: safeExcerpt(payload, 1600),
    sha256: rawRef.sha256
  };
}

function titleForToolCall(toolName: string, payload: Record<string, unknown>): string {
  const args = stringValue(payload.arguments) ?? "";
  if (toolName.includes("apply_patch")) return "Patched files";
  if (toolName.includes("exec_command")) return summarize(args, "Shell command");
  if (toolName.includes("web")) return "Web lookup";
  if (toolName.includes("browser") || toolName.includes("playwright")) return "Browser check";
  return `Tool call: ${toolName}`;
}

function laneForToolCall(toolName: string, payload: Record<string, unknown>): TimelineLane {
  const haystack = `${toolName} ${stringValue(payload.arguments) ?? ""}`;
  if (mentionsArchitectureFile(haystack)) return "Architecture";
  if (/apply_patch|write|edit|patch|git diff/i.test(haystack)) return "Code";
  if (/test|lint|build|typecheck|tsc|playwright|curl/i.test(haystack)) return "Verification";
  return "Agent Runs";
}

function kindForToolCall(toolName: string, payload: Record<string, unknown>): TimelineEvent["kind"] {
  const haystack = `${toolName} ${stringValue(payload.arguments) ?? ""}`;
  if (/apply_patch|write|edit|patch/i.test(haystack)) return "file_change";
  if (/test|lint|build|typecheck|tsc|playwright|curl/i.test(haystack)) return "verification";
  return "tool_call";
}

function extractMessageText(payload: Record<string, unknown>): string {
  const content = payload.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        const record = asRecord(item);
        return stringValue(record.text) ?? stringValue(record.content) ?? "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return safeExcerpt(payload, 500);
}

function extractFiles(value: unknown): string[] {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const matches = text.match(/(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9]+/g) ?? [];
  return Array.from(new Set(matches)).slice(0, 20);
}

function mentionsArchitectureFile(text: string): boolean {
  return /(?:^|[/"'\s])(?:docs?|design|plans?|architecture)(?:\/|[A-Za-z0-9_.-]*\.(?:md|mdx|txt|json|yaml|yml|toml))|(?:^|[/"'\s])(?:[A-Za-z0-9_.-]*-)?(?:design|plan|architecture)(?:-[A-Za-z0-9_.-]*)?\.(?:md|mdx|txt|json|yaml|yml|toml)/i.test(text);
}

function summarize(text: string | null | undefined, fallback: string): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return fallback;
  return clean.length > 88 ? `${clean.slice(0, 85)}...` : clean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
