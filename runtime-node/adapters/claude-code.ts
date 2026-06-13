import fg from "fast-glob";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { AgentLogAdapter, NormalizedBundle, ParsedAgentEvent, TokenUsage } from "../../core/types";
import { normalizeCodexLines } from "../../core/normalizer";
import { resolveClaudeHome } from "../../storage/paths";
import { asRecord, fileSource, makeTokenUsage, parsedEvent, stringValue } from "./shared";

export const claudeCodeAdapter: AgentLogAdapter = {
  provider: "claude-code",
  async scan(config) {
    const root = config?.root ?? resolveClaudeHome();
    const projectsDir = path.join(root, "projects");
    const files = await fg("**/*.jsonl", {
      cwd: projectsDir,
      absolute: true,
      onlyFiles: true,
      suppressErrors: true
    });
    return Promise.all(files.map((file) => fileSource("claude-code", file)));
  },
  async parseSource(source, options = {}) {
    const content = await readFile(source.path, "utf8");
    const externalSessionId = externalSessionIdFromClaudeJsonl(content, source.path);
    const historyProject = externalSessionId ? await claudeHistoryProjectForSession(source.path, externalSessionId) : null;
    return normalizeClaudeCodeJsonl(content, source.path, options.repoRoot, historyProject);
  }
};

export function normalizeClaudeCodeJsonl(content: string, sourcePath: string, repoRoot?: string | null, projectCwdOverride?: string | null): NormalizedBundle | null {
  const rawLines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const records = rawLines.map((line) => JSON.parse(line) as unknown);
  if (records.length === 0) return null;

  const first = asRecord(records[0]);
  const externalSessionId = stringValue(first.sessionId) ?? path.basename(sourcePath, ".jsonl");
  const startedAt = stringValue(first.timestamp) ?? new Date(0).toISOString();
  const cwd = projectCwdOverride ?? stringValue(first.cwd) ?? process.cwd();
  const version = stringValue(first.version);

  const lines: ParsedAgentEvent[] = [
    parsedEvent({
      provider: "claude-code",
      sourcePath,
      lineNo: 1,
      timestamp: startedAt,
      type: "session_meta",
      payload: {
        id: externalSessionId,
        timestamp: startedAt,
        cwd,
        cli_version: version,
        model_provider: "Anthropic",
        source: "claude-code"
      },
      raw: rawLines[0]
    })
  ];

  let syntheticLine = 2;
  for (const [index, recordValue] of records.entries()) {
    const record = asRecord(recordValue);
    const timestamp = stringValue(record.timestamp) ?? startedAt;
    const type = stringValue(record.type);
    const message = asRecord(record.message);
    const role = stringValue(message.role) ?? type;
    const content = message.content;
    const usage = makeTokenUsage(message.usage ?? record.usage);

    for (const eventPayload of claudePayloadsForRecord(content, role, usage)) {
      lines.push(
        parsedEvent({
          provider: "claude-code",
          sourcePath,
          lineNo: syntheticLine,
          timestamp,
          type: "response_item",
          payload: eventPayload,
          raw: rawLines[index]
        })
      );
      syntheticLine += 1;
    }
  }

  return normalizeCodexLines(lines, {
    repoRoot,
    provider: "claude-code",
    prefixSessionId: true,
    modelProvider: "Anthropic",
    source: "claude-code",
    agentName: "Claude Code"
  });
}

function externalSessionIdFromClaudeJsonl(content: string, sourcePath: string): string | null {
  const firstLine = content.split(/\r?\n/).find((line) => line.trim().length > 0);
  if (!firstLine) return path.basename(sourcePath, ".jsonl");
  try {
    return stringValue(asRecord(JSON.parse(firstLine)).sessionId) ?? path.basename(sourcePath, ".jsonl");
  } catch {
    return path.basename(sourcePath, ".jsonl");
  }
}

async function claudeHistoryProjectForSession(sourcePath: string, externalSessionId: string): Promise<string | null> {
  const claudeRoot = claudeRootFromSourcePath(sourcePath);
  if (!claudeRoot) return null;
  try {
    const history = await readFile(path.join(claudeRoot, "history.jsonl"), "utf8");
    let project: string | null = null;
    for (const line of history.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const record = asRecord(JSON.parse(line));
        if (stringValue(record.sessionId) === externalSessionId) {
          project = stringValue(record.project) ?? project;
        }
      } catch {
        continue;
      }
    }
    return project;
  } catch {
    return null;
  }
}

function claudeRootFromSourcePath(sourcePath: string): string | null {
  const marker = `${path.sep}projects${path.sep}`;
  const index = sourcePath.lastIndexOf(marker);
  return index >= 0 ? sourcePath.slice(0, index) : null;
}

function claudePayloadsForRecord(content: unknown, role: string | null, usage: TokenUsage | null): Array<Record<string, unknown>> {
  if (role === "user" && containsToolResult(content)) {
    return toolResultsFromContent(content);
  }
  const payloads: Array<Record<string, unknown>> = [];
  const text = textFromContent(content);
  if (text) {
    payloads.push({
      type: "message",
      role: role === "assistant" ? "assistant" : "user",
      content: [{ type: role === "assistant" ? "output_text" : "input_text", text }],
      ...(usage ? { usage } : {})
    });
  }
  if (role === "assistant") {
    payloads.push(...toolCallsFromContent(content));
  }
  return payloads;
}

function containsToolResult(content: unknown): boolean {
  return contentItems(content).some((item) => stringValue(asRecord(item).type) === "tool_result");
}

function toolResultsFromContent(content: unknown): Array<Record<string, unknown>> {
  return contentItems(content)
    .filter((item) => stringValue(asRecord(item).type) === "tool_result")
    .map((item) => {
      const record = asRecord(item);
      return {
        type: "function_call_output",
        call_id: stringValue(record.tool_use_id) ?? stringValue(record.id),
        output: textFromContent(record.content)
      };
    });
}

function toolCallsFromContent(content: unknown): Array<Record<string, unknown>> {
  return contentItems(content)
    .filter((item) => stringValue(asRecord(item).type) === "tool_use")
    .map((item) => {
      const record = asRecord(item);
      return {
        type: "function_call",
        call_id: stringValue(record.id),
        name: stringValue(record.name) ?? "tool",
        arguments: JSON.stringify(record.input ?? {})
      };
    });
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  return contentItems(content)
    .map((item) => {
      if (typeof item === "string") return item;
      const record = asRecord(item);
      const type = stringValue(record.type);
      if (type === "text") return stringValue(record.text) ?? "";
      if (type === "tool_result") return textFromContent(record.content);
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function contentItems(content: unknown): unknown[] {
  if (Array.isArray(content)) return content;
  if (content === null || content === undefined) return [];
  return [content];
}
