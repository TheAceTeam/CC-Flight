import path from "node:path";
import {
  Artifact,
  NormalizedBundle,
  ParsedCodexLine,
  ProjectRecord,
  RawEventRef,
  SessionRecord,
  SkillUsage,
  SkillUsageSource,
  TimelineEvent,
  TimelineLane,
  TokenUsage,
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
  let previousTotalTokenUsage: TokenUsage | null = null;

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
      const event = normalizeEventMessage({ line, rawRef, projectId, sessionId, turnId, payload, rawPayload, payloadType: payloadType ?? undefined, previousTotalTokenUsage });
      if (event.kind === "token_usage") {
        const totalUsage = extractTokenCountTotalUsage(rawPayload) ?? extractTokenCountTotalUsage(payload);
        previousTotalTokenUsage = totalUsage ?? (event.tokenUsage ? addTokenUsage(previousTotalTokenUsage, event.tokenUsage) : previousTotalTokenUsage);
      }
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
  const tokenUsage = extractTokenUsage(rawPayload);
  const skillSource = skillSourceForResponse(payloadType, role);
  const skills = extractSkillsForLine(line, skillSource);

  if (payloadType === "message") {
    const text = extractMessageText(payload);
    if (role === "user") {
      return makeEvent({ line, rawRef, projectId, sessionId, turnId, kind: "user_prompt", lane: "Product", title: summarize(text, "User prompt"), detail: text, status: "success", tokenUsage, skills });
    }
    if (role === "assistant") {
      return makeEvent({ line, rawRef, projectId, sessionId, turnId, kind: "assistant_message", lane: "Agent Runs", title: summarize(text, "Assistant message"), detail: text, status: "success", tokenUsage, skills });
    }
    return makeEvent({ line, rawRef, projectId, sessionId, turnId, kind: "status", lane: "Agent Runs", title: `${role ?? "System"} message`, detail: text, status: "success", tokenUsage, skills });
  }

  if (payloadType === "function_call" || payloadType === "custom_tool_call") {
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
      files: extractFiles(payload),
      tokenUsage,
      skills
    });
  }

  if (payloadType === "function_call_output" || payloadType === "custom_tool_call_output") {
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
      files: extractFiles(payload),
      tokenUsage,
      skills
    });
  }

  if (payloadType === "reasoning") {
    return makeEvent({ line, rawRef, projectId, sessionId, turnId, kind: "reasoning_marker", lane: "Agent Runs", title: "Reasoning segment", detail: "Reasoning content is not displayed.", status: "success", tokenUsage, skills });
  }

  return makeEvent({ line, rawRef, projectId, sessionId, turnId, kind: "status", lane: "Agent Runs", title: payloadType ?? "Response item", detail: safeExcerpt(payload, 900), tokenUsage, skills });
}

function normalizeEventMessage(input: {
  line: ParsedCodexLine;
  rawRef: RawEventRef;
  projectId: string;
  sessionId: string;
  turnId: string | null;
  payload: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
  payloadType?: string;
  previousTotalTokenUsage?: TokenUsage | null;
}): TimelineEvent {
  const { line, rawRef, projectId, sessionId, turnId, payload, rawPayload, payloadType, previousTotalTokenUsage } = input;
  if (payloadType === "token_count") {
    const totalUsage = extractTokenCountTotalUsage(rawPayload) ?? extractTokenCountTotalUsage(payload);
    const tokenUsage = tokenUsageDelta(previousTotalTokenUsage, totalUsage);
    return makeEvent({
      line,
      rawRef,
      projectId,
      sessionId,
      turnId,
      kind: "token_usage",
      lane: "Agent Runs",
      title: "Token usage update",
      detail: safeExcerpt(payload, 800),
      status: "success",
      tokenUsage,
      skills: extractSkillsForLine(line, "event_message")
    });
  }

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
    status: failed ? "failed" : "success",
    skills: extractSkillsForLine(line, "event_message")
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
  tokenUsage?: TokenUsage | null;
  skills?: SkillUsage[];
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
    outputEventId: input.outputEventId ?? null,
    tokenUsage: input.tokenUsage ?? null,
    skills: input.skills ?? []
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

function skillSourceForResponse(payloadType: string | null | undefined, role: string | null | undefined): SkillUsageSource {
  if (payloadType === "function_call" || payloadType === "custom_tool_call") return "tool_input";
  if (payloadType === "function_call_output" || payloadType === "custom_tool_call_output") return "tool_output";
  if (role === "developer") return "developer_message";
  if (role === "user") return "user_prompt";
  if (role === "assistant") return "assistant_message";
  return "event_message";
}

function extractSkillsForLine(line: ParsedCodexLine, source: SkillUsageSource): SkillUsage[] {
  if (source === "session_meta" || source === "developer_message") {
    return [];
  }
  const text = skillSearchText(line.payload);
  if (!text) return [];

  const skills = new Map<string, SkillUsage>();
  for (const match of matchSkillUsages(text, source, line.sourcePath)) {
    const key = `${match.name}\0${match.path ?? ""}\0${match.source}`;
    if (!skills.has(key)) skills.set(key, match);
  }
  return [...skills.values()];
}

function matchSkillUsages(text: string, source: SkillUsageSource, evidencePath: string): SkillUsage[] {
  if (!mightContainSkillUsage(text, source)) {
    return [];
  }

  const matches: SkillUsage[] = [];
  const push = (name: string, confidence: SkillUsage["confidence"], path: string | null, command: string | null, excerpt: string) => {
    const normalized = normalizeSkillName(name);
    if (!normalized) return;
    matches.push({
      name: normalized,
      source,
      confidence,
      path,
      command,
      evidencePath,
      excerpt: cleanExcerpt(excerpt)
    });
  };

  const pathPattern = /((?:~|\/)[^"'`\s]*\/skills\/([A-Za-z0-9_.:@-]+)(?:\/SKILL\.md)?)/gi;
  for (const match of text.matchAll(pathPattern)) {
    push(match[2], "explicit", match[1], null, match[0]);
  }

  for (const match of text.matchAll(/\b(?:using|use|activated|activate|loaded|loading)\s+(?:the\s+)?(?:skill|plugin skill)\s+[`"']?([A-Za-z0-9_.:@-]+)[`"']?/gi)) {
    push(match[1], "explicit", null, null, match[0]);
  }

  for (const match of text.matchAll(/\b(?:skill|技能)\s*[:=]\s*[`"']?([A-Za-z0-9_.:@-]+)[`"']?/gi)) {
    push(match[1], "explicit", null, null, match[0]);
  }

  for (const match of text.matchAll(/(?:^|[\s(])\/([A-Za-z][A-Za-z0-9_.:@-]{2,})(?=\s|$|[),.])/g)) {
    push(match[1], "inferred", null, `/${match[1]}`, match[0]);
  }

  return matches;
}

function mightContainSkillUsage(text: string, source: SkillUsageSource): boolean {
  if (/skill|技能|\/skills\//i.test(text)) return true;
  return source === "user_prompt" && /(?:^|\s)\/[A-Za-z][A-Za-z0-9_.:@-]{2,}(?=\s|$|[),.])/.test(text);
}

function skillSearchText(value: unknown): string {
  const fragments: string[] = [];
  collectSkillText(value, fragments);
  return fragments.join("\n");
}

function collectSkillText(value: unknown, fragments: string[]) {
  if (typeof value === "string") {
    fragments.push(value);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectSkillText(item, fragments);
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (typeof child === "string" && /skill|message|text|content|input|argument|output|command|cmd|path|source|aggregated_output|formatted_output/i.test(normalizedKey)) {
      fragments.push(child);
    } else if (typeof child === "object" && child) {
      collectSkillText(child, fragments);
    }
  }
}

function normalizeSkillName(value: string): string | null {
  const clean = value.replace(/^\/+/, "").replace(/\/SKILL\.md$/i, "").trim();
  if (!/^[A-Za-z0-9_.:@-]{3,80}$/.test(clean)) return null;
  if (/^(skill|skills|plugin|using|loaded)$/i.test(clean)) return null;
  return clean;
}

function cleanExcerpt(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 180);
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

function extractTokenUsage(payload: Record<string, unknown>): TokenUsage | null {
  const usageContainers = collectUsageContainers(payload);
  if (usageContainers.length === 0) return null;

  const input = firstNumber(usageContainers, ["input_tokens", "prompt_tokens", "input", "prompt"]);
  const output = firstNumber(usageContainers, ["output_tokens", "completion_tokens", "output", "completion"]);
  const reasoning = firstNumber(usageContainers, ["reasoning_tokens", "reasoning"]);
  const cachedInput = firstNumber(usageContainers, ["cached_input_tokens", "cached_tokens", "cache_read_input_tokens", "cached_input"]);
  const explicitTotal = firstNumber(usageContainers, ["total_tokens", "total"]);
  const knownSum = sumNumbers(input, output, reasoning);
  const total = explicitTotal ?? knownSum;

  if (input === null && output === null && reasoning === null && cachedInput === null && total === null) {
    return null;
  }

  return {
    input: input ?? 0,
    output: output ?? 0,
    reasoning: reasoning ?? 0,
    cachedInput: cachedInput ?? 0,
    total: total ?? 0
  };
}

function extractTokenCountTotalUsage(payload: Record<string, unknown>): TokenUsage | null {
  const info = asRecord(payload.info);
  const total = asRecord(info.total_token_usage ?? info.totalTokenUsage ?? payload.total_token_usage ?? payload.totalTokenUsage);
  if (Object.keys(total).length === 0) return null;
  return tokenUsageFromContainer(total);
}

function tokenUsageFromContainer(container: Record<string, unknown>): TokenUsage | null {
  const input = firstNumber(container, ["input_tokens", "prompt_tokens", "input", "prompt"]);
  const output = firstNumber(container, ["output_tokens", "completion_tokens", "output", "completion"]);
  const reasoning = firstNumber(container, ["reasoning_output_tokens", "reasoning_tokens", "reasoning"]);
  const cachedInput = firstNumber(container, ["cached_input_tokens", "cached_tokens", "cache_read_input_tokens", "cached_input"]);
  const explicitTotal = firstNumber(container, ["total_tokens", "total"]);
  const knownSum = sumNumbers(input, output);
  const total = explicitTotal ?? knownSum;

  if (input === null && output === null && reasoning === null && cachedInput === null && total === null) {
    return null;
  }

  return {
    input: input ?? 0,
    output: output ?? 0,
    reasoning: reasoning ?? 0,
    cachedInput: cachedInput ?? 0,
    total: total ?? 0
  };
}

function tokenUsageDelta(previous: TokenUsage | null | undefined, current: TokenUsage | null): TokenUsage | null {
  if (!current) return null;
  if (!previous) return current;
  const delta = {
    input: Math.max(0, current.input - previous.input),
    output: Math.max(0, current.output - previous.output),
    reasoning: Math.max(0, current.reasoning - previous.reasoning),
    cachedInput: Math.max(0, current.cachedInput - previous.cachedInput),
    total: Math.max(0, current.total - previous.total)
  };
  return hasTokenUsage(delta) ? delta : null;
}

function addTokenUsage(previous: TokenUsage | null | undefined, delta: TokenUsage): TokenUsage {
  return {
    input: (previous?.input ?? 0) + delta.input,
    output: (previous?.output ?? 0) + delta.output,
    reasoning: (previous?.reasoning ?? 0) + delta.reasoning,
    cachedInput: (previous?.cachedInput ?? 0) + delta.cachedInput,
    total: (previous?.total ?? 0) + delta.total
  };
}

function hasTokenUsage(usage: TokenUsage): boolean {
  return usage.input > 0 || usage.output > 0 || usage.reasoning > 0 || usage.cachedInput > 0 || usage.total > 0;
}

function collectUsageContainers(payload: Record<string, unknown>): unknown[] {
  const containers: unknown[] = [];
  for (const [key, value] of Object.entries(payload)) {
    const normalized = normalizeTokenKey(key);
    if ((normalized.includes("usage") || normalized.includes("tokens") || normalized.endsWith("details")) && value && typeof value === "object") {
      containers.push(value);
      containers.push(...collectNestedUsageContainers(value));
    }
  }
  return containers;
}

function collectNestedUsageContainers(value: unknown): unknown[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(collectNestedUsageContainers);

  const containers: unknown[] = [];
  for (const [key, child] of Object.entries(value)) {
    const normalized = normalizeTokenKey(key);
    if ((normalized.includes("usage") || normalized.includes("tokens") || normalized.endsWith("details")) && child && typeof child === "object") {
      containers.push(child);
    }
    containers.push(...collectNestedUsageContainers(child));
  }
  return containers;
}

function firstNumber(value: unknown, keys: string[]): number | null {
  const matches = collectTokenNumbers(value, new Set(keys.map(normalizeTokenKey)));
  return matches[0] ?? null;
}

function collectTokenNumbers(value: unknown, keys: Set<string>): number[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectTokenNumbers(item, keys));
  }

  const matches: number[] = [];
  for (const [key, child] of Object.entries(value)) {
    const numeric = numberValue(child);
    if (numeric !== null && keys.has(normalizeTokenKey(key))) {
      matches.push(numeric);
    }
    if (child && typeof child === "object") {
      matches.push(...collectTokenNumbers(child, keys));
    }
  }
  return matches;
}

function normalizeTokenKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value);
  }
  return null;
}

function sumNumbers(...values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length > 0 ? known.reduce((sum, value) => sum + value, 0) : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
