import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { AgentLogAdapter, AgentLogSource, NormalizedBundle, ParsedAgentEvent } from "../../core/types";
import { normalizeCodexLines } from "../../core/normalizer";
import { opencodeDbCandidates } from "../../storage/paths";
import { asRecord, makeTokenUsage, numberTimestamp, parsedEvent, readJsonFile, stringValue } from "./shared";

const SOURCE_PREFIX = "opencode:ses:";
const DATABASE_SESSION_FRAGMENT = "#opencode-session=";

export const opencodeAdapter: AgentLogAdapter = {
  provider: "opencode",
  async scan(config) {
    if (config?.path) {
      return [await fileLikeSource(config.path)];
    }
    const dbPath = resolveOpencodeDb();
    if (!dbPath) return [];
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const rows = db
        .prepare(
          "SELECT s.id AS id, s.time_updated AS timeUpdated, COUNT(p.id) AS parts " +
            "FROM session s LEFT JOIN part p ON p.session_id = s.id GROUP BY s.id"
        )
        .all() as Array<{ id: string; timeUpdated: number; parts: number }>;
      return rows.map((row) => ({
        provider: "opencode" as const,
        id: `${SOURCE_PREFIX}${row.id}`,
        path: dbPath,
        sizeBytes: row.parts,
        mtimeMs: row.timeUpdated
      }));
    } finally {
      db.close();
    }
  },
  async parseSource(source, options = {}) {
    if (!source.id.startsWith(SOURCE_PREFIX)) {
      const json = await readJsonFile(source.path);
      return normalizeOpenCodeExport(json, source.path, options.repoRoot);
    }
    const sessionId = source.id.slice(SOURCE_PREFIX.length);
    const db = new Database(source.path, { readonly: true, fileMustExist: true });
    try {
      const session = db.prepare("SELECT * FROM session WHERE id = ?").get(sessionId) as
        | Record<string, unknown>
        | undefined;
      if (!session) return null;
      const messageRows = db
        .prepare("SELECT id, data FROM message WHERE session_id = ? ORDER BY time_created")
        .all(sessionId) as Array<{ id: string; data: string }>;
      const partRows = db
        .prepare("SELECT message_id AS messageId, data FROM part WHERE session_id = ? ORDER BY time_created")
        .all(sessionId) as Array<{ messageId: string; data: string }>;

      const partsByMessage = new Map<string, unknown[]>();
      for (const part of partRows) {
        const list = partsByMessage.get(part.messageId) ?? [];
        list.push(safeParse(part.data));
        partsByMessage.set(part.messageId, list);
      }

      const exportShape = {
        info: {
          id: session.id,
          directory: session.directory,
          version: session.version,
          title: session.title,
          time: { created: session.time_created, updated: session.time_updated }
        },
        messages: messageRows.map((message) => ({
          info: safeParse(message.data),
          parts: partsByMessage.get(message.id) ?? []
        }))
      };
      // The database is the physical locator, but each row-backed session must
      // remain independently replaceable in CC Flight's source-path index.
      return normalizeOpenCodeExport(
        exportShape,
        openCodeDatabaseSessionSourcePath(source.path, sessionId),
        options.repoRoot
      );
    } finally {
      db.close();
    }
  }
};

function openCodeDatabaseSessionSourcePath(databasePath: string, sessionId: string): string {
  return `${databasePath}${DATABASE_SESSION_FRAGMENT}${encodeURIComponent(sessionId)}`;
}

export function normalizeOpenCodeExport(json: unknown, sourcePath: string, repoRoot?: string | null): NormalizedBundle | null {
  const root = asRecord(json);
  const info = asRecord(root.info ?? root);
  const messages = asArray(root.messages ?? root.message ?? root.parts);
  const externalSessionId = stringValue(info.id) ?? stringValue(root.id) ?? path.basename(sourcePath, ".json");
  const cwd = stringValue(info.directory) ?? stringValue(info.cwd) ?? stringValue(root.cwd) ?? process.cwd();
  const startedAt = timestampFromValue(asRecord(info.time).created ?? info.created ?? messages[0]);
  const version = stringValue(info.version) ?? stringValue(root.version);
  const modelProvider = providerFromMessages(messages) ?? stringValue(info.provider);

  const lines: ParsedAgentEvent[] = [
    parsedEvent({
      provider: "opencode",
      sourcePath,
      lineNo: 1,
      timestamp: startedAt,
      type: "session_meta",
      payload: {
        id: externalSessionId,
        timestamp: startedAt,
        cwd,
        cli_version: version,
        model_provider: modelProvider,
        source: "opencode"
      }
    })
  ];

  let lineNo = 2;
  for (const messageValue of messages) {
    const message = asRecord(messageValue);
    const mi = asRecord(message.info ?? message);
    const timestamp = timestampFromValue(asRecord(mi.time).created ?? mi.created ?? mi.timestamp);
    const role = stringValue(mi.role) ?? stringValue(mi.type);
    const parts = asArray(message.parts ?? mi.parts ?? message.content);
    const usage = makeTokenUsage(mi.tokens ?? mi.usage);

    const messageText = textFromParts(parts);
    if ((role === "user" || role === "assistant") && messageText) {
      lines.push(
        parsedEvent({
          provider: "opencode",
          sourcePath,
          lineNo,
          timestamp,
          type: "response_item",
          payload: {
            type: "message",
            role,
            content: [{ type: role === "assistant" ? "output_text" : "input_text", text: messageText }],
            ...(usage ? { usage } : {})
          }
        })
      );
      lineNo += 1;
    }

    for (const part of parts) {
      const partRecord = asRecord(part);
      if (!isToolPart(partRecord)) continue;
      const state = asRecord(partRecord.state);
      const callId = stringValue(partRecord.callID) ?? stringValue(partRecord.callId) ?? stringValue(partRecord.id);
      lines.push(
        parsedEvent({
          provider: "opencode",
          sourcePath,
          lineNo,
          timestamp,
          type: "response_item",
          payload: {
            type: "function_call",
            call_id: callId,
            name: stringValue(partRecord.tool) ?? stringValue(partRecord.name) ?? "tool",
            arguments: JSON.stringify(state.input ?? partRecord.input ?? partRecord.arguments ?? {})
          }
        })
      );
      lineNo += 1;

      const output = toolOutput(state);
      lines.push(
        parsedEvent({
          provider: "opencode",
          sourcePath,
          lineNo,
          timestamp,
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: callId,
            output
          }
        })
      );
      lineNo += 1;
    }
  }

  return normalizeCodexLines(lines, {
    repoRoot,
    provider: "opencode",
    prefixSessionId: true,
    modelProvider,
    source: "opencode",
    agentName: "OpenCode"
  });
}

function resolveOpencodeDb(): string | null {
  for (const candidate of opencodeDbCandidates()) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      // ignore — try next candidate
    }
  }
  return null;
}

async function fileLikeSource(filePath: string): Promise<AgentLogSource> {
  const content = await readFile(filePath, "utf8");
  const stats = statSync(filePath);
  return {
    provider: "opencode",
    id: `opencode:${filePath}`,
    path: filePath,
    sizeBytes: Buffer.byteLength(content),
    mtimeMs: stats.mtimeMs
  };
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  for (const key of ["items", "data", "sessions", "messages"]) {
    if (Array.isArray(record[key])) return record[key];
  }
  return [];
}

function timestampFromValue(value: unknown): string {
  if (typeof value === "string") return value;
  const numeric = numberTimestamp(value);
  return numeric ?? new Date(0).toISOString();
}

function providerFromMessages(messages: unknown[]): string | null {
  for (const messageValue of messages) {
    const mi = asRecord(asRecord(messageValue).info ?? messageValue);
    const provider = stringValue(mi.providerID) ?? stringValue(mi.provider);
    if (provider) return provider;
  }
  return null;
}

function textFromParts(value: unknown): string {
  if (typeof value === "string") return value;
  return asArray(value)
    .map((part) => {
      if (typeof part === "string") return part;
      const record = asRecord(part);
      if (record.type && record.type !== "text") return "";
      return stringValue(record.text) ?? stringValue(record.content) ?? stringValue(record.output) ?? "";
    })
    .filter(Boolean)
    .join("\n");
}

function isToolPart(part: Record<string, unknown>) {
  const type = stringValue(part.type);
  if (type === "tool" || type === "tool_call") return true;
  if (type) return false;
  return Boolean(part.tool ?? part.name);
}

function toolOutput(state: Record<string, unknown>): string {
  const direct = stringValue(state.output);
  if (direct) return direct;
  const metaOutput = stringValue(asRecord(state.metadata).output);
  if (metaOutput) return metaOutput;
  return "";
}
