import { redactString } from "./redactor";

export interface CodexHistoryRecord {
  sessionId: string;
  ts: string;
  text: string;
  sourcePath: string;
  lineNo: number;
}

export interface CodexHistoryBadLine {
  sourcePath: string;
  lineNo: number;
  error: string;
}

export interface CodexHistoryParseResult {
  records: CodexHistoryRecord[];
  bySessionId: Map<string, CodexHistoryRecord[]>;
  badLines: CodexHistoryBadLine[];
}

interface RawHistoryLine {
  session_id?: unknown;
  sessionId?: unknown;
  ts?: unknown;
  timestamp?: unknown;
  text?: unknown;
}

export function parseCodexHistoryJsonlContent(content: string, sourcePath = "history.jsonl"): CodexHistoryParseResult {
  const records: CodexHistoryRecord[] = [];
  const badLines: CodexHistoryBadLine[] = [];

  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const lineNo = index + 1;
    if (!raw.trim()) continue;

    try {
      const json = JSON.parse(raw) as RawHistoryLine;
      const sessionId = typeof json.session_id === "string" ? json.session_id : typeof json.sessionId === "string" ? json.sessionId : null;
      const ts = normalizeTimestamp(json.ts ?? json.timestamp);
      const text = typeof json.text === "string" ? json.text : null;

      if (!sessionId || !ts || text === null) {
        badLines.push({ sourcePath, lineNo, error: "missing required history fields" });
        continue;
      }

      records.push({
        sessionId,
        ts,
        text: redactString(text),
        sourcePath,
        lineNo
      });
    } catch (error) {
      badLines.push({
        sourcePath,
        lineNo,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return { records, bySessionId: groupBySessionId(records), badLines };
}

export function groupBySessionId(records: CodexHistoryRecord[]): Map<string, CodexHistoryRecord[]> {
  const bySessionId = new Map<string, CodexHistoryRecord[]>();
  for (const record of records) {
    const existing = bySessionId.get(record.sessionId);
    if (existing) {
      existing.push(record);
    } else {
      bySessionId.set(record.sessionId, [record]);
    }
  }
  return bySessionId;
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 10_000_000_000 ? value : value * 1000;
    return new Date(millis).toISOString();
  }

  return null;
}
