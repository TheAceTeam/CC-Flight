import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import SqliteDatabase from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { IngestJob } from "../core/types";
import { normalizeOpenCodeExport } from "../runtime-node/adapters/opencode";
import { INGEST_PROCESSOR_VERSION, runIngestJob } from "../runtime-node/ingest";
import { CCFlightDatabase } from "../storage/database";

describe("OpenCode SQLite ingestion", () => {
  it("migrates legacy shared paths and keeps incremental sessions independent", async () => {
    const fixtureDir = mkdtempSync(path.join(tmpdir(), "cc-flight-opencode-"));
    const sourceDatabasePath = path.join(fixtureDir, "opencode.db");
    const index = new CCFlightDatabase(path.join(fixtureDir, "cc-flight.sqlite"));
    const previousDatabasePath = process.env.SUPERVIEW_OPENCODE_DB;

    try {
      initializeOpenCodeDatabase(sourceDatabasePath);
      writeOpenCodeSession(sourceDatabasePath, {
        id: "session-a",
        directory: path.join(fixtureDir, "session-a"),
        title: "Session A",
        updatedAt: 1_788_192_001_000,
        messages: [{ role: "user", text: "Run session A" }]
      });
      process.env.SUPERVIEW_OPENCODE_DB = sourceDatabasePath;

      seedLegacySharedSource(index, sourceDatabasePath, {
        id: "session-a",
        directory: path.join(fixtureDir, "session-a"),
        updatedAt: 1_788_192_001_000,
        messages: [{ role: "user", text: "Run session A" }]
      });
      expect(index.listSessions()[0].path).toBe(sourceDatabasePath);

      const migrationJob = await runOpenCodeIngest(index);
      expect(migrationJob.status).toBe("completed");
      expect(migrationJob.changedFiles).toBe(1);
      expect(openCodeSessionIds(index)).toEqual(["session-a"]);
      expect(index.listSessions()[0].path).toBe(`${sourceDatabasePath}#opencode-session=session-a`);

      writeOpenCodeSession(sourceDatabasePath, {
        id: "session-b",
        directory: path.join(fixtureDir, "session-b"),
        title: "Session B",
        updatedAt: 1_788_192_002_000,
        messages: [{ role: "user", text: "Run session B" }]
      });
      const additionJob = await runOpenCodeIngest(index);
      expect(additionJob.status).toBe("completed");
      expect(additionJob.changedFiles).toBe(1);
      expect(additionJob.skippedFiles).toBe(1);
      expect(openCodeSessionIds(index)).toEqual(["session-a", "session-b"]);

      writeOpenCodeSession(sourceDatabasePath, {
        id: "session-b",
        directory: path.join(fixtureDir, "session-b"),
        title: "Session B",
        updatedAt: 1_788_192_003_000,
        messages: [
          { role: "user", text: "Run session B" },
          { role: "assistant", text: "Session B verification complete" }
        ]
      });
      const updateJob = await runOpenCodeIngest(index);
      expect(updateJob.status).toBe("completed");
      expect(updateJob.changedFiles).toBe(1);
      expect(openCodeSessionIds(index)).toEqual(["session-a", "session-b"]);
      const sessionB = index.listSessions().find((session) => session.externalSessionId === "session-b");
      expect(index.listEvents(sessionB!.projectId)).toEqual(
        expect.arrayContaining([expect.objectContaining({ detail: "Session B verification complete" })])
      );

      deleteOpenCodeSession(sourceDatabasePath, "session-a");
      const pruneJob = await runOpenCodeIngest(index);
      expect(pruneJob.status).toBe("completed");
      expect(openCodeSessionIds(index)).toEqual(["session-b"]);
    } finally {
      if (previousDatabasePath === undefined) {
        delete process.env.SUPERVIEW_OPENCODE_DB;
      } else {
        process.env.SUPERVIEW_OPENCODE_DB = previousDatabasePath;
      }
      index.close();
      rmSync(fixtureDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});

async function runOpenCodeIngest(index: CCFlightDatabase): Promise<IngestJob> {
  const job: IngestJob = {
    id: `opencode-ingest-${Date.now()}-${Math.random()}`,
    status: "queued",
    phase: "queued",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    totalFiles: 0,
    processedFiles: 0,
    totalEvents: 0,
    errors: []
  };
  index.upsertJob(job);
  await runIngestJob(index, job.id, { sources: [{ provider: "opencode" }] });
  return index.getJob(job.id)!;
}

function openCodeSessionIds(index: CCFlightDatabase): string[] {
  return index
    .listSessions()
    .filter((session) => session.provider === "opencode")
    .map((session) => session.externalSessionId)
    .sort();
}

function seedLegacySharedSource(
  index: CCFlightDatabase,
  sourceDatabasePath: string,
  session: {
    id: string;
    directory: string;
    updatedAt: number;
    messages: Array<{ role: "user" | "assistant"; text: string }>;
  }
) {
  const bundle = normalizeOpenCodeExport(openCodeExport(session), sourceDatabasePath);
  if (!bundle) throw new Error("Expected legacy OpenCode bundle");
  index.upsertBundle(bundle);
  index.upsertIngestedFile({
    path: `opencode:ses:${session.id}`,
    mtimeMs: session.updatedAt,
    sizeBytes: session.messages.length,
    sessionId: bundle.session.id,
    processorVersion: INGEST_PROCESSOR_VERSION,
    processedAt: new Date().toISOString()
  });
}

function initializeOpenCodeDatabase(databasePath: string) {
  const db = new SqliteDatabase(databasePath);
  try {
    db.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY,
        directory TEXT NOT NULL,
        version TEXT,
        title TEXT,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL
      );
      CREATE TABLE message (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE part (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        data TEXT NOT NULL
      );
    `);
  } finally {
    db.close();
  }
}

function writeOpenCodeSession(
  databasePath: string,
  session: {
    id: string;
    directory: string;
    title: string;
    updatedAt: number;
    messages: Array<{ role: "user" | "assistant"; text: string }>;
  }
) {
  mkdirSync(session.directory, { recursive: true });
  const db = new SqliteDatabase(databasePath);
  try {
    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO session(id, directory, version, title, time_created, time_updated)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           directory=excluded.directory,
           version=excluded.version,
           title=excluded.title,
           time_updated=excluded.time_updated`
      ).run(session.id, session.directory, "1.0.0", session.title, session.updatedAt - 1_000, session.updatedAt);
      db.prepare("DELETE FROM part WHERE session_id = ?").run(session.id);
      db.prepare("DELETE FROM message WHERE session_id = ?").run(session.id);
      session.messages.forEach((message, index) => {
        const messageId = `${session.id}-message-${index}`;
        const createdAt = session.updatedAt - session.messages.length + index;
        db.prepare("INSERT INTO message(id, session_id, time_created, data) VALUES (?, ?, ?, ?)").run(
          messageId,
          session.id,
          createdAt,
          JSON.stringify({ id: messageId, sessionID: session.id, role: message.role, time: { created: createdAt } })
        );
        db.prepare("INSERT INTO part(id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)").run(
          `${messageId}-part`,
          messageId,
          session.id,
          createdAt,
          JSON.stringify({ type: "text", text: message.text })
        );
      });
    });
    tx();
  } finally {
    db.close();
  }
}

function deleteOpenCodeSession(databasePath: string, sessionId: string) {
  const db = new SqliteDatabase(databasePath);
  try {
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM part WHERE session_id = ?").run(sessionId);
      db.prepare("DELETE FROM message WHERE session_id = ?").run(sessionId);
      db.prepare("DELETE FROM session WHERE id = ?").run(sessionId);
    });
    tx();
  } finally {
    db.close();
  }
}

function openCodeExport(session: {
  id: string;
  directory: string;
  updatedAt: number;
  messages: Array<{ role: "user" | "assistant"; text: string }>;
}) {
  return {
    info: {
      id: session.id,
      directory: session.directory,
      version: "1.0.0",
      title: session.id,
      time: { created: session.updatedAt - 1_000, updated: session.updatedAt }
    },
    messages: session.messages.map((message, index) => ({
      info: {
        id: `${session.id}-message-${index}`,
        sessionID: session.id,
        role: message.role,
        time: { created: session.updatedAt - session.messages.length + index }
      },
      parts: [{ type: "text", text: message.text }]
    }))
  };
}
