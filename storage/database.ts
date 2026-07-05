import Database from "better-sqlite3";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import {
  AgentProvider,
  Artifact,
  CodexHistoryPrompt,
  DailyTokenUsageResponse,
  Episode,
  EventEvidence,
  GitCommitRecord,
  IngestJob,
  NormalizedBundle,
  ProjectRecord,
  RawEventRef,
  RunReplay,
  SessionRecord,
  TaskSubThread,
  TaskJourney,
  TaskJourneyDetail,
  TokenUsage,
  TimelineQuery,
  TimelineEvent,
  TurnRecord
} from "../core/types";
import { buildProjectTimeline, groupEpisodes } from "../core/timeline";
import { buildReplayNodes } from "../core/replay";
import { resolveDatabasePath } from "./paths";

const SCHEMA_VERSION = 1;

type EventRow = Omit<TimelineEvent, "files" | "tokenUsage" | "skills"> & {
  filesJson: string;
  tokenUsageJson: string | null;
  skillsJson: string | null;
};

export class CCFlightDatabase {
  private db: Database.Database;

  constructor(databasePath = resolveDatabasePath()) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  close() {
    this.db.close();
  }

  reset() {
    this.db.exec(`
      DROP TABLE IF EXISTS task_journey_skills;
      DROP TABLE IF EXISTS causal_edges;
      DROP TABLE IF EXISTS episodes;
      DROP TABLE IF EXISTS task_journeys;
      DROP TABLE IF EXISTS turn_skills;
      DROP TABLE IF EXISTS turns;
      DROP TABLE IF EXISTS events;
      DROP TABLE IF EXISTS raw_event_refs;
      DROP TABLE IF EXISTS artifacts;
      DROP TABLE IF EXISTS git_commits;
      DROP TABLE IF EXISTS history_prompts;
      DROP TABLE IF EXISTS sessions;
      DROP TABLE IF EXISTS ingested_files;
      DROP TABLE IF EXISTS ingest_jobs;
      DROP TABLE IF EXISTS projects;
      DROP TABLE IF EXISTS schema_meta;
    `);
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        version INTEGER PRIMARY KEY,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        cwd TEXT NOT NULL,
        repo_root TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        path TEXT NOT NULL,
        cwd TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        cli_version TEXT,
        model_provider TEXT,
        source TEXT,
        provider TEXT NOT NULL DEFAULT 'codex',
        external_session_id TEXT,
        agent_name TEXT,
        FOREIGN KEY(project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS turns (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        cwd TEXT,
        model TEXT,
        approval_policy TEXT,
        sandbox_policy TEXT,
        FOREIGN KEY(session_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS raw_event_refs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'codex',
        line_no INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        redacted_payload_json TEXT NOT NULL,
        source_path TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        turn_id TEXT,
        timestamp TEXT NOT NULL,
        kind TEXT NOT NULL,
        lane TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT,
        tool_name TEXT,
        call_id TEXT,
        status TEXT NOT NULL,
        files_json TEXT NOT NULL,
        raw_event_ref_id TEXT,
        duration_ms INTEGER,
        output_event_id TEXT,
        commit_hash TEXT,
        token_usage_json TEXT,
        skills_json TEXT,
        FOREIGN KEY(project_id) REFERENCES projects(id),
        FOREIGN KEY(session_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        type TEXT NOT NULL,
        path TEXT,
        excerpt TEXT NOT NULL,
        sha256 TEXT,
        FOREIGN KEY(event_id) REFERENCES events(id)
      );

      CREATE TABLE IF NOT EXISTS history_prompts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        ts TEXT NOT NULL,
        text TEXT NOT NULL,
        source_path TEXT NOT NULL,
        line_no INTEGER NOT NULL,
        FOREIGN KEY(session_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS git_commits (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        repo_root TEXT NOT NULL,
        hash TEXT NOT NULL,
        short_hash TEXT NOT NULL,
        author_name TEXT,
        author_email TEXT,
        timestamp TEXT NOT NULL,
        subject TEXT NOT NULL,
        files_changed INTEGER NOT NULL,
        insertions INTEGER NOT NULL,
        deletions INTEGER NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS episodes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL,
        event_ids_json TEXT NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS ingested_files (
        path TEXT PRIMARY KEY,
        mtime_ms REAL NOT NULL,
        size_bytes INTEGER NOT NULL,
        sha256 TEXT,
        session_id TEXT,
        processor_version TEXT,
        processed_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ingest_jobs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        phase TEXT NOT NULL DEFAULT 'queued',
        started_at TEXT NOT NULL,
        finished_at TEXT,
        total_files INTEGER NOT NULL,
        processed_files INTEGER NOT NULL,
        total_events INTEGER NOT NULL,
        skipped_files INTEGER NOT NULL DEFAULT 0,
        candidate_files INTEGER NOT NULL DEFAULT 0,
        changed_files INTEGER NOT NULL DEFAULT 0,
        processed_bytes INTEGER NOT NULL DEFAULT 0,
        total_bytes INTEGER NOT NULL DEFAULT 0,
        current_file TEXT,
        worker_pid INTEGER,
        processor_version TEXT,
        errors_json TEXT NOT NULL
      );
    `);

    this.ensureColumn("ingest_jobs", "phase", "TEXT NOT NULL DEFAULT 'queued'");
    this.ensureColumn("ingest_jobs", "skipped_files", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("ingest_jobs", "candidate_files", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("ingest_jobs", "changed_files", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("ingest_jobs", "processed_bytes", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("ingest_jobs", "total_bytes", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("ingest_jobs", "current_file", "TEXT");
    this.ensureColumn("ingest_jobs", "worker_pid", "INTEGER");
    this.ensureColumn("ingest_jobs", "processor_version", "TEXT");
    this.ensureColumn("events", "duration_ms", "INTEGER");
    this.ensureColumn("events", "output_event_id", "TEXT");
    this.ensureColumn("events", "commit_hash", "TEXT");
    this.ensureColumn("events", "token_usage_json", "TEXT");
    this.ensureColumn("events", "skills_json", "TEXT");
    this.ensureColumn("ingested_files", "processor_version", "TEXT");
    this.ensureColumn("sessions", "provider", "TEXT NOT NULL DEFAULT 'codex'");
    this.ensureColumn("sessions", "external_session_id", "TEXT");
    this.ensureColumn("sessions", "agent_name", "TEXT");
    this.ensureColumn("raw_event_refs", "provider", "TEXT NOT NULL DEFAULT 'codex'");
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_project_id ON events(project_id);
      CREATE INDEX IF NOT EXISTS idx_events_project_timestamp ON events(project_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
      CREATE INDEX IF NOT EXISTS idx_events_raw_event_ref_id ON events(raw_event_ref_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_project_id ON sessions(project_id);
      CREATE INDEX IF NOT EXISTS idx_episodes_project_id ON episodes(project_id);
      CREATE INDEX IF NOT EXISTS idx_artifacts_event_id ON artifacts(event_id);
      CREATE INDEX IF NOT EXISTS idx_raw_event_refs_source_path ON raw_event_refs(source_path);
    `);
    this.db.prepare("INSERT OR REPLACE INTO schema_meta(version, updated_at) VALUES (?, ?)").run(SCHEMA_VERSION, new Date().toISOString());
  }

  upsertBundle(bundle: NormalizedBundle) {
    const tx = this.db.transaction(() => {
      for (const sourcePath of new Set(bundle.rawEventRefs.map((raw) => raw.sourcePath))) {
        this.deleteRawSource(sourcePath);
      }
      this.upsertProject(bundle.project);
      this.upsertSession(bundle.session);
      for (const turn of bundle.turns) this.upsertTurn(turn);
      for (const raw of bundle.rawEventRefs) this.upsertRawEvent(raw);
      for (const event of bundle.events) this.upsertEvent(event);
      for (const prompt of bundle.historyPrompts ?? []) this.upsertHistoryPrompt(prompt);
      for (const commit of bundle.gitCommits ?? []) this.upsertGitCommit(bundle.project.id, bundle.session.id, commit);
      for (const artifact of bundle.artifacts) this.upsertArtifact(artifact);
      for (const artifact of this.gitArtifactsForCommits(bundle.project.id, bundle.gitCommits ?? [])) this.upsertArtifact(artifact);
      this.replaceProjectEpisodes(bundle.project.id, groupEpisodes(bundle.project.id, this.listEvents(bundle.project.id)));
    });
    tx();
  }

  private ensureColumn(table: string, column: string, definition: string) {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((row) => row.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  upsertProject(project: ProjectRecord) {
    this.db
      .prepare(
        `INSERT INTO projects(id, name, cwd, repo_root, created_at, updated_at)
         VALUES (@id, @name, @cwd, @repoRoot, @createdAt, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name,
           cwd=excluded.cwd,
           repo_root=excluded.repo_root,
           updated_at=excluded.updated_at`
      )
      .run(project);
  }

  upsertSession(session: SessionRecord) {
    this.db
      .prepare(
        `INSERT INTO sessions(id, project_id, path, cwd, started_at, ended_at, cli_version, model_provider, source, provider, external_session_id, agent_name)
         VALUES (@id, @projectId, @path, @cwd, @startedAt, @endedAt, @cliVersion, @modelProvider, @source, @provider, @externalSessionId, @agentName)
         ON CONFLICT(id) DO UPDATE SET
           project_id=excluded.project_id,
           path=excluded.path,
           cwd=excluded.cwd,
           ended_at=excluded.ended_at,
           cli_version=excluded.cli_version,
           model_provider=excluded.model_provider,
           source=excluded.source,
           provider=excluded.provider,
           external_session_id=excluded.external_session_id,
           agent_name=excluded.agent_name`
      )
      .run(session);
  }

  upsertTurn(turn: TurnRecord) {
    this.db
      .prepare(
        `INSERT INTO turns(id, session_id, started_at, ended_at, cwd, model, approval_policy, sandbox_policy)
         VALUES (@id, @sessionId, @startedAt, @endedAt, @cwd, @model, @approvalPolicy, @sandboxPolicy)
         ON CONFLICT(id) DO UPDATE SET
           ended_at=excluded.ended_at,
           cwd=excluded.cwd,
           model=excluded.model,
           approval_policy=excluded.approval_policy,
           sandbox_policy=excluded.sandbox_policy`
      )
      .run(turn);
  }

  upsertRawEvent(raw: RawEventRef) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO raw_event_refs(id, session_id, provider, line_no, timestamp, type, redacted_payload_json, source_path, sha256)
         VALUES (@id, @sessionId, @provider, @lineNo, @timestamp, @type, @redactedPayloadJson, @sourcePath, @sha256)`
      )
      .run(raw);
  }

  upsertEvent(event: TimelineEvent) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO events(id, project_id, session_id, turn_id, timestamp, kind, lane, title, detail, tool_name, call_id, status, files_json, raw_event_ref_id, duration_ms, output_event_id, commit_hash, token_usage_json, skills_json)
         VALUES (@id, @projectId, @sessionId, @turnId, @timestamp, @kind, @lane, @title, @detail, @toolName, @callId, @status, @filesJson, @rawEventRefId, @durationMs, @outputEventId, @commitHash, @tokenUsageJson, @skillsJson)`
      )
      .run({
        ...event,
        filesJson: JSON.stringify(event.files),
        durationMs: event.durationMs ?? null,
        outputEventId: event.outputEventId ?? null,
        commitHash: event.commitHash ?? null,
        tokenUsageJson: event.tokenUsage ? JSON.stringify(event.tokenUsage) : null,
        skillsJson: event.skills && event.skills.length > 0 ? JSON.stringify(event.skills) : null
      });
  }

  upsertHistoryPrompt(prompt: CodexHistoryPrompt) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO history_prompts(id, session_id, ts, text, source_path, line_no)
         VALUES (@id, @sessionId, @ts, @text, @sourcePath, @lineNo)`
      )
      .run({
        id: `${prompt.sessionId}:${prompt.lineNo}`,
        ...prompt
      });
  }

  upsertGitCommit(projectId: string, sessionId: string, commit: GitCommitRecord) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO git_commits(id, project_id, repo_root, hash, short_hash, author_name, author_email, timestamp, subject, files_changed, insertions, deletions)
         VALUES (@id, @projectId, @repoRoot, @hash, @shortHash, @authorName, @authorEmail, @timestamp, @subject, @filesChanged, @insertions, @deletions)`
      )
      .run({ ...commit, projectId, id: `${projectId}:${commit.hash}` });

    this.upsertEvent({
      id: `git_${projectId}_${commit.shortHash}`,
      projectId,
      sessionId,
      turnId: null,
      timestamp: commit.timestamp,
      kind: "file_change",
      lane: "Code",
      title: `Git commit ${commit.shortHash}: ${commit.subject}`,
      detail: `${commit.filesChanged} files, +${commit.insertions}/-${commit.deletions}`,
      toolName: "git",
      callId: null,
      status: "success",
      files: [],
      rawEventRefId: null,
      durationMs: null,
      outputEventId: null,
      commitHash: commit.hash,
      tokenUsage: null,
      skills: []
    });
  }

  private gitArtifactsForCommits(projectId: string, commits: GitCommitRecord[]): Artifact[] {
    return commits.map((commit) => ({
      id: `artifact_git_${projectId}_${commit.hash}`,
      eventId: `git_${projectId}_${commit.shortHash}`,
      type: "git",
      path: commit.repoRoot,
      excerpt: `${commit.hash}\n${commit.subject}\n${commit.filesChanged} files changed, ${commit.insertions} insertions, ${commit.deletions} deletions`,
      sha256: commit.hash
    }));
  }

  upsertArtifact(artifact: Artifact) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO artifacts(id, event_id, type, path, excerpt, sha256)
         VALUES (@id, @eventId, @type, @path, @excerpt, @sha256)`
      )
      .run(artifact);
  }

  upsertEpisodes(episodes: Episode[]) {
    const tx = this.db.transaction(() => {
      for (const episode of episodes) {
        this.db
          .prepare(
            `INSERT OR REPLACE INTO episodes(id, project_id, started_at, ended_at, title, summary, status, event_ids_json)
             VALUES (@id, @projectId, @startedAt, @endedAt, @title, @summary, @status, @eventIdsJson)`
          )
          .run({ ...episode, eventIdsJson: JSON.stringify(episode.eventIds) });
      }
    });
    tx();
  }

  pruneMissingIngestedFiles(providers: AgentProvider[], retainedSourceIds: Set<string>): number {
    const uniqueProviders = Array.from(new Set(providers));
    if (uniqueProviders.length === 0) return 0;
    const clauses = uniqueProviders.map(() => "path LIKE ?").join(" OR ");
    const rows = this.db.prepare(`SELECT path FROM ingested_files WHERE ${clauses}`).all(...uniqueProviders.map((provider) => `${provider}:%`)) as Array<{ path: string }>;
    const staleRows = rows.filter((row) => !retainedSourceIds.has(row.path));
    if (staleRows.length === 0) return 0;
    const tx = this.db.transaction(() => {
      for (const row of staleRows) {
        this.deleteIngestedSource(row.path);
      }
    });
    tx();
    return staleRows.length;
  }

  private replaceProjectEpisodes(projectId: string, episodes: Episode[]) {
    this.db.prepare("DELETE FROM episodes WHERE project_id = ?").run(projectId);
    for (const episode of episodes) {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO episodes(id, project_id, started_at, ended_at, title, summary, status, event_ids_json)
           VALUES (@id, @projectId, @startedAt, @endedAt, @title, @summary, @status, @eventIdsJson)`
        )
        .run({ ...episode, eventIdsJson: JSON.stringify(episode.eventIds) });
    }
  }

  private deleteIngestedSource(sourceId: string) {
    const sourcePath = sourcePathFromIngestedId(sourceId);
    this.deleteRawSource(sourcePath);
    this.db.prepare("DELETE FROM ingested_files WHERE path = ?").run(sourceId);
  }

  private deleteRawSource(sourcePath: string) {
    const projectRows = this.db
      .prepare(
        `SELECT DISTINCT e.project_id as projectId
         FROM events e
         JOIN raw_event_refs r ON r.id = e.raw_event_ref_id
         WHERE r.source_path = ?
         UNION
         SELECT project_id as projectId FROM sessions WHERE path = ?`
      )
      .all(sourcePath, sourcePath) as Array<{ projectId: string }>;
    const sessionRows = this.db
      .prepare(
        `SELECT DISTINCT session_id as sessionId FROM raw_event_refs WHERE source_path = ?
         UNION
         SELECT id as sessionId FROM sessions WHERE path = ?`
      )
      .all(sourcePath, sourcePath) as Array<{ sessionId: string }>;
    const projectIds = projectRows.map((row) => row.projectId);
    const sessionIds = sessionRows.map((row) => row.sessionId);

    this.db
      .prepare(
        `DELETE FROM artifacts
         WHERE event_id IN (
           SELECT e.id
           FROM events e
           JOIN raw_event_refs r ON r.id = e.raw_event_ref_id
           WHERE r.source_path = ?
         )`
      )
      .run(sourcePath);
    this.db
      .prepare(
        `DELETE FROM events
         WHERE raw_event_ref_id IN (
           SELECT id FROM raw_event_refs WHERE source_path = ?
         )`
      )
      .run(sourcePath);
    this.db.prepare("DELETE FROM raw_event_refs WHERE source_path = ?").run(sourcePath);
    this.deleteIngestedRowsForSourcePath(sourcePath);

    for (const sessionId of sessionIds) {
      this.deleteSessionIfOrphan(sessionId);
    }
    for (const projectId of projectIds) {
      this.refreshProjectEpisodes(projectId);
      this.deleteProjectIfOrphan(projectId);
    }
  }

  private refreshProjectEpisodes(projectId: string) {
    this.replaceProjectEpisodes(projectId, groupEpisodes(projectId, this.listEvents(projectId)));
  }

  private deleteSessionIfOrphan(sessionId: string) {
    const row = this.db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM events WHERE session_id = ?) as eventCount,
           (SELECT COUNT(*) FROM raw_event_refs WHERE session_id = ?) as rawCount`
      )
      .get(sessionId, sessionId) as { eventCount: number; rawCount: number };
    if (row.eventCount > 0 || row.rawCount > 0) return;
    this.db.prepare("DELETE FROM turns WHERE session_id = ?").run(sessionId);
    this.db.prepare("DELETE FROM history_prompts WHERE session_id = ?").run(sessionId);
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  }

  private deleteProjectIfOrphan(projectId: string) {
    this.db
      .prepare(
        `DELETE FROM projects
         WHERE id = ?
           AND NOT EXISTS (SELECT 1 FROM events WHERE project_id = ?)
           AND NOT EXISTS (SELECT 1 FROM sessions WHERE project_id = ?)
           AND NOT EXISTS (SELECT 1 FROM git_commits WHERE project_id = ?)
           AND NOT EXISTS (SELECT 1 FROM episodes WHERE project_id = ?)`
      )
      .run(projectId, projectId, projectId, projectId, projectId);
  }

  private deleteIngestedRowsForSourcePath(sourcePath: string) {
    for (const provider of ALL_AGENT_PROVIDERS) {
      this.db.prepare("DELETE FROM ingested_files WHERE path = ?").run(`${provider}:${sourcePath}`);
    }
  }

  upsertJob(job: IngestJob) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO ingest_jobs(id, status, phase, started_at, finished_at, total_files, processed_files, total_events, skipped_files, candidate_files, changed_files, processed_bytes, total_bytes, current_file, worker_pid, processor_version, errors_json)
         VALUES (@id, @status, @phase, @startedAt, @finishedAt, @totalFiles, @processedFiles, @totalEvents, @skippedFiles, @candidateFiles, @changedFiles, @processedBytes, @totalBytes, @currentFile, @workerPid, @processorVersion, @errorsJson)`
      )
      .run({
        ...job,
        phase: job.phase ?? phaseForStatus(job.status),
        skippedFiles: job.skippedFiles ?? 0,
        candidateFiles: job.candidateFiles ?? 0,
        changedFiles: job.changedFiles ?? 0,
        processedBytes: job.processedBytes ?? 0,
        totalBytes: job.totalBytes ?? 0,
        currentFile: job.currentFile ?? null,
        workerPid: job.workerPid ?? null,
        processorVersion: job.processorVersion ?? null,
        errorsJson: JSON.stringify(job.errors)
      });
  }

  getIngestedFile(path: string): { path: string; mtimeMs: number; sizeBytes: number; sha256: string | null; sessionId: string | null; processorVersion: string | null; processedAt: string } | null {
    const row = this.db
      .prepare(
        `SELECT path, mtime_ms as mtimeMs, size_bytes as sizeBytes, sha256, session_id as sessionId, processor_version as processorVersion, processed_at as processedAt
         FROM ingested_files WHERE path = ?`
      )
      .get(path) as { path: string; mtimeMs: number; sizeBytes: number; sha256: string | null; sessionId: string | null; processorVersion: string | null; processedAt: string } | undefined;
    return row ?? null;
  }

  upsertIngestedFile(file: { path: string; mtimeMs: number; sizeBytes: number; sha256?: string | null; sessionId?: string | null; processorVersion?: string | null; processedAt: string }) {
    this.db
      .prepare(
        `INSERT INTO ingested_files(path, mtime_ms, size_bytes, sha256, session_id, processor_version, processed_at)
         VALUES (@path, @mtimeMs, @sizeBytes, @sha256, @sessionId, @processorVersion, @processedAt)
         ON CONFLICT(path) DO UPDATE SET
           mtime_ms=excluded.mtime_ms,
           size_bytes=excluded.size_bytes,
           sha256=excluded.sha256,
           session_id=excluded.session_id,
           processor_version=excluded.processor_version,
           processed_at=excluded.processed_at`
      )
      .run({ ...file, sha256: file.sha256 ?? null, sessionId: file.sessionId ?? null, processorVersion: file.processorVersion ?? null });
  }

  listProjects(): ProjectRecord[] {
    return this.db
      .prepare("SELECT id, name, cwd, repo_root as repoRoot, created_at as createdAt, updated_at as updatedAt FROM projects ORDER BY updated_at DESC")
      .all() as ProjectRecord[];
  }

  getProject(projectId: string): ProjectRecord | null {
    return (
      (this.db
        .prepare("SELECT id, name, cwd, repo_root as repoRoot, created_at as createdAt, updated_at as updatedAt FROM projects WHERE id = ?")
        .get(projectId) as ProjectRecord | undefined) ?? null
    );
  }

  listEvents(projectId: string, query: TimelineQuery = {}): TimelineEvent[] {
    const { where, params } = this.timelineWhere(projectId, query);
    const limit = normalizeLimit(query.limit);
    const offset = Math.max(0, Math.trunc(query.offset ?? 0));
    const pagination = query.limit === undefined && query.offset === undefined ? "" : " LIMIT ? OFFSET ?";
    const paginationParams = pagination ? [limit, offset] : [];
    const rows = this.db
      .prepare(
        `SELECT id, project_id as projectId, session_id as sessionId, turn_id as turnId, timestamp, kind, lane, title, detail,
                tool_name as toolName, call_id as callId, status, files_json as filesJson, raw_event_ref_id as rawEventRefId,
                duration_ms as durationMs, output_event_id as outputEventId, commit_hash as commitHash, token_usage_json as tokenUsageJson,
                skills_json as skillsJson
         FROM events ${where} ORDER BY timestamp ASC${pagination}`
      )
      .all(...params, ...paginationParams) as EventRow[];
    return rows.map(rowToTimelineEvent);
  }

  countEvents(projectId: string, query: TimelineQuery = {}): number {
    const { where, params } = this.timelineWhere(projectId, query);
    const row = this.db.prepare(`SELECT COUNT(*) as total FROM events ${where}`).get(...params) as { total: number };
    return row.total;
  }

  getTimeline(projectId: string, query: TimelineQuery = {}) {
    const project = this.getProject(projectId);
    if (!project) return null;
    const events = this.listEvents(projectId, query);
    const timeline = buildProjectTimeline(project, events);
    const subagentEventIds = this.subagentEventIds(projectId);
    const taskJourneys = this.withSubThreadCounts(
      timeline.taskJourneys.filter((journey) => !subagentEventIds.has(journey.promptEventId)),
      projectId,
    );
    return {
      ...timeline,
      taskJourneys,
      episodes: this.listEpisodes(projectId),
      tokenUsage: this.getProjectTokenUsage(projectId),
      totalEvents: this.countEvents(projectId, query),
      limit: normalizeLimit(query.limit),
      offset: Math.max(0, Math.trunc(query.offset ?? 0))
    };
  }

  getProjectTokenUsage(projectId: string): TokenUsage {
    const rows = this.db.prepare("SELECT token_usage_json as tokenUsageJson FROM events WHERE project_id = ? AND token_usage_json IS NOT NULL").all(projectId) as Array<{ tokenUsageJson: string | null }>;
    return rows.reduce<TokenUsage>((total, row) => {
      const usage = parseTokenUsage(row.tokenUsageJson);
      return {
        input: total.input + (usage?.input ?? 0),
        output: total.output + (usage?.output ?? 0),
        reasoning: total.reasoning + (usage?.reasoning ?? 0),
        cachedInput: total.cachedInput + (usage?.cachedInput ?? 0),
        total: total.total + (usage?.total ?? 0)
      };
    }, { input: 0, output: 0, reasoning: 0, cachedInput: 0, total: 0 });
  }

  getProjectTokenUsageByProjectIds(projectIds: string[]): Map<string, TokenUsage> {
    const usageByProject = new Map(projectIds.map((projectId) => [projectId, emptyTokenUsage()]));
    if (projectIds.length === 0) return usageByProject;
    const placeholders = projectIds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(`SELECT project_id as projectId, token_usage_json as tokenUsageJson FROM events WHERE project_id IN (${placeholders}) AND token_usage_json IS NOT NULL`)
      .all(...projectIds) as Array<{ projectId: string; tokenUsageJson: string | null }>;
    for (const row of rows) {
      const usage = parseTokenUsage(row.tokenUsageJson);
      if (!usage) continue;
      const total = usageByProject.get(row.projectId) ?? emptyTokenUsage();
      addTokenUsage(total, usage);
      usageByProject.set(row.projectId, total);
    }
    return usageByProject;
  }

  getProjectDailyTokenUsage(projectId: string): DailyTokenUsageResponse | null {
    if (!this.getProject(projectId)) return null;
    const rows = this.db
      .prepare(
        `SELECT substr(timestamp, 1, 10) as date, token_usage_json as tokenUsageJson
         FROM events
         WHERE project_id = ? AND token_usage_json IS NOT NULL
         ORDER BY timestamp ASC`
      )
      .all(projectId) as Array<{ date: string; tokenUsageJson: string | null }>;
    const pointsByDate = new Map<string, TokenUsage>();
    const total = emptyTokenUsage();
    for (const row of rows) {
      const usage = parseTokenUsage(row.tokenUsageJson);
      if (!usage) continue;
      const point = pointsByDate.get(row.date) ?? emptyTokenUsage();
      addTokenUsage(point, usage);
      addTokenUsage(total, usage);
      pointsByDate.set(row.date, point);
    }
    return {
      projectId,
      points: Array.from(pointsByDate, ([date, usage]) => ({ date, ...usage })),
      total
    };
  }

  getTaskJourneyDetail(journeyId: string, projectId?: string): TaskJourneyDetail | null {
    const projects = projectId ? [this.getProject(projectId)].filter((project): project is ProjectRecord => Boolean(project)) : this.listProjects();
    for (const project of projects) {
      const events = this.listEvents(project.id);
      const timeline = buildProjectTimeline(project, events);
      const subagentEventIds = this.subagentEventIds(project.id);
      const taskJourneys = this.withSubThreadCounts(
        timeline.taskJourneys.filter((candidate) => !subagentEventIds.has(candidate.promptEventId)),
        project.id,
      );
      const journey = taskJourneys
        .find((candidate) => candidate.id === journeyId);
      if (!journey) continue;
      const eventIds = new Set(journey.eventIds);
      const journeyEvents = events.filter((event) => eventIds.has(event.id));
      return {
        journey,
        events: journeyEvents,
        causalEdges: timeline.causalEdges.filter((edge) => eventIds.has(edge.fromEventId) || eventIds.has(edge.toEventId)),
        subThreads: this.listSubThreadsForJourney(journey)
      };
    }
    return null;
  }

  private listSubThreadsForJourney(journey: TaskJourneyDetail["journey"]): TaskSubThread[] {
    const parentSession = this.getSession(journey.sessionId);
    if (!parentSession) return [];
    const parentKey = parentSession.externalSessionId || stripProviderPrefix(parentSession.id);
    if (!parentKey) return [];
    const escapedLike = escapeSqlLike(parentKey);
    const endClause = journey.exitType === "next_prompt" ? "AND e.timestamp <= ?" : "";
    const params = [
      `%/${escapedLike}/subagents/%`,
      `%\\${escapedLike}\\subagents\\%`,
      journey.startedAt,
      ...(journey.exitType === "next_prompt" ? [journey.endedAt] : [])
    ];
    const sourceRows = this.db
      .prepare(
        `SELECT r.source_path as sourcePath
         FROM raw_event_refs r
         JOIN events e ON e.raw_event_ref_id = r.id
         WHERE (r.source_path LIKE ? ESCAPE '\\' OR r.source_path LIKE ? ESCAPE '\\')
           AND e.timestamp >= ?
           ${endClause}
         GROUP BY r.source_path
         ORDER BY MIN(e.timestamp) ASC`
      )
      .all(...params) as Array<{ sourcePath: string }>;

    return sourceRows.flatMap((row, index) => {
      const events = this.listEventsForSourcePath(row.sourcePath);
      if (events.length === 0) return [];
      const subProject = this.getProject(events[0].projectId);
      if (!subProject) return [];
      const subTimeline = buildProjectTimeline(subProject, events);
      const subJourney = subTimeline.taskJourneys[0] ?? taskJourneyFromEvents(subProject.id, row.sourcePath, events);
      if (!subJourney) return [];
      return [
        {
          id: `${journey.id}:subthread:${index}`,
          sourcePath: row.sourcePath,
          session: this.getSession(events[0].sessionId),
          journey: subJourney,
          events
        }
      ];
    });
  }

  private withSubThreadCounts(journeys: TaskJourney[], projectId: string): TaskJourney[] {
    if (journeys.length === 0) return journeys;
    const sessionsById = new Map(this.listSessions(projectId).map((session) => [session.id, session]));
    const subagentSources = this.listSubagentSourceSummaries(projectId);
    if (subagentSources.length === 0) return journeys.map((journey) => ({ ...journey, subThreadCount: 0 }));
    return journeys.map((journey) => {
      const parentSession = sessionsById.get(journey.sessionId);
      const parentKey = parentSession?.externalSessionId || stripProviderPrefix(journey.sessionId);
      const subThreadCount = parentKey
        ? subagentSources.filter((source) => isSourceForParentSession(source.sourcePath, parentKey) && isSourceInJourneyWindow(source.startedAt, journey)).length
        : 0;
      return { ...journey, subThreadCount };
    });
  }

  private listSubagentSourceSummaries(projectId: string): Array<{ sourcePath: string; startedAt: string }> {
    return this.db
      .prepare(
        `SELECT r.source_path as sourcePath, MIN(e.timestamp) as startedAt
         FROM raw_event_refs r
         JOIN events e ON e.raw_event_ref_id = r.id
         WHERE e.project_id = ?
           AND (r.source_path LIKE '%/subagents/%' OR r.source_path LIKE '%\\subagents\\%')
         GROUP BY r.source_path
         ORDER BY MIN(e.timestamp) ASC`
      )
      .all(projectId) as Array<{ sourcePath: string; startedAt: string }>;
  }

  private listEventsForSourcePath(sourcePath: string): TimelineEvent[] {
    const rows = this.db
      .prepare(
        `SELECT e.id, e.project_id as projectId, e.session_id as sessionId, e.turn_id as turnId, e.timestamp, e.kind, e.lane, e.title, e.detail,
                e.tool_name as toolName, e.call_id as callId, e.status, e.files_json as filesJson, e.raw_event_ref_id as rawEventRefId,
                e.duration_ms as durationMs, e.output_event_id as outputEventId, e.commit_hash as commitHash, e.token_usage_json as tokenUsageJson,
                e.skills_json as skillsJson
         FROM events e
         JOIN raw_event_refs r ON r.id = e.raw_event_ref_id
         WHERE r.source_path = ?
         ORDER BY e.timestamp ASC`
      )
      .all(sourcePath) as EventRow[];
    return rows.map(rowToTimelineEvent);
  }

  private subagentEventIds(projectId: string): Set<string> {
    const rows = this.db
      .prepare(
        `SELECT e.id
         FROM events e
         JOIN raw_event_refs r ON r.id = e.raw_event_ref_id
         WHERE e.project_id = ?
           AND (r.source_path LIKE '%/subagents/%' OR r.source_path LIKE '%\\subagents\\%')`
      )
      .all(projectId) as Array<{ id: string }>;
    return new Set(rows.map((row) => row.id));
  }

  getEventEvidenceByEventIds(eventIds: string[]): Record<string, EventEvidence> {
    if (eventIds.length === 0) return {};
    const events = eventIds.map((eventId) => this.getEvent(eventId)).filter((event): event is TimelineEvent => Boolean(event));
    const artifactsByEventId = new Map<string, Artifact[]>();
    for (const artifact of this.listArtifactsForEvents(eventIds)) {
      const artifacts = artifactsByEventId.get(artifact.eventId) ?? [];
      artifacts.push(artifact);
      artifactsByEventId.set(artifact.eventId, artifacts);
    }

    const evidence: Record<string, EventEvidence> = {};
    for (const event of events) {
      evidence[event.id] = {
        event,
        artifacts: artifactsByEventId.get(event.id) ?? [],
        rawEvent: event.rawEventRefId ? this.getRawEvent(event.rawEventRefId) : null
      };
    }
    return evidence;
  }

  listHistoryPromptsForSession(sessionId: string): CodexHistoryPrompt[] {
    return this.db
      .prepare(
        `SELECT session_id as sessionId, ts, text, source_path as sourcePath, line_no as lineNo
         FROM history_prompts
         WHERE session_id = ?
         ORDER BY ts ASC, line_no ASC`
      )
      .all(sessionId) as CodexHistoryPrompt[];
  }

  private timelineWhere(projectId: string, query: TimelineQuery) {
    const clauses = ["project_id = ?"];
    const params: unknown[] = [projectId];
    if (query.lane) {
      clauses.push("lane = ?");
      params.push(query.lane);
    }
    if (query.since) {
      clauses.push("timestamp >= ?");
      params.push(query.since);
    }
    if (query.until) {
      clauses.push("timestamp <= ?");
      params.push(query.until);
    }
    return { where: `WHERE ${clauses.join(" AND ")}`, params };
  }

  listEpisodes(projectId: string): Episode[] {
    const rows = this.db
      .prepare(
        `SELECT id, project_id as projectId, started_at as startedAt, ended_at as endedAt,
                title, summary, status, event_ids_json as eventIdsJson
         FROM episodes WHERE project_id = ? ORDER BY started_at ASC`
      )
      .all(projectId) as Array<Omit<Episode, "eventIds"> & { eventIdsJson: string }>;
    return rows.map((row) => ({ ...row, eventIds: JSON.parse(row.eventIdsJson) as string[] }));
  }

  listSessions(projectId?: string): SessionRecord[] {
    const sql = `SELECT id, project_id as projectId, path, cwd, started_at as startedAt, ended_at as endedAt,
                        cli_version as cliVersion, model_provider as modelProvider, source, provider,
                        COALESCE(external_session_id, id) as externalSessionId, agent_name as agentName
                 FROM sessions ${projectId ? "WHERE project_id = ?" : ""} ORDER BY started_at DESC`;
    return (projectId ? this.db.prepare(sql).all(projectId) : this.db.prepare(sql).all()) as SessionRecord[];
  }

  listSessionsByProjectIds(projectIds: string[]): Map<string, SessionRecord[]> {
    const sessionsByProject = new Map(projectIds.map((projectId) => [projectId, [] as SessionRecord[]]));
    if (projectIds.length === 0) return sessionsByProject;
    const placeholders = projectIds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT id, project_id as projectId, path, cwd, started_at as startedAt, ended_at as endedAt,
                cli_version as cliVersion, model_provider as modelProvider, source, provider,
                COALESCE(external_session_id, id) as externalSessionId, agent_name as agentName
         FROM sessions WHERE project_id IN (${placeholders}) ORDER BY started_at DESC`
      )
      .all(...projectIds) as SessionRecord[];
    for (const session of rows) {
      const bucket = sessionsByProject.get(session.projectId) ?? [];
      bucket.push(session);
      sessionsByProject.set(session.projectId, bucket);
    }
    return sessionsByProject;
  }

  getSession(sessionId: string): SessionRecord | null {
    return (
      (this.db
        .prepare(
          `SELECT id, project_id as projectId, path, cwd, started_at as startedAt, ended_at as endedAt,
                  cli_version as cliVersion, model_provider as modelProvider, source, provider,
                  COALESCE(external_session_id, id) as externalSessionId, agent_name as agentName
           FROM sessions WHERE id = ?`
        )
        .get(sessionId) as SessionRecord | undefined) ?? null
    );
  }

  getRunReplay(sessionId: string): RunReplay | null {
    const session = this.getSession(sessionId);
    if (!session) return null;
    const events = this.listEventsForSession(session.projectId, sessionId);
    const artifacts = this.listArtifactsForEvents(events.map((event) => event.id));
    return {
      session,
      events,
      nodes: buildReplayNodes(events),
      artifacts
    };
  }

  listArtifactsForEvents(eventIds: string[]): Artifact[] {
    if (eventIds.length === 0) return [];
    const placeholders = eventIds.map(() => "?").join(",");
    return this.db
      .prepare(`SELECT id, event_id as eventId, type, path, excerpt, sha256 FROM artifacts WHERE event_id IN (${placeholders})`)
      .all(...eventIds) as Artifact[];
  }

  listEventsForSession(projectId: string, sessionId: string): TimelineEvent[] {
    const rows = this.db
      .prepare(
        `SELECT id, project_id as projectId, session_id as sessionId, turn_id as turnId, timestamp, kind, lane, title, detail,
                tool_name as toolName, call_id as callId, status, files_json as filesJson, raw_event_ref_id as rawEventRefId,
                duration_ms as durationMs, output_event_id as outputEventId, commit_hash as commitHash, token_usage_json as tokenUsageJson,
                skills_json as skillsJson
         FROM events WHERE project_id = ? AND session_id = ? ORDER BY timestamp ASC`
      )
      .all(projectId, sessionId) as EventRow[];
    return rows.map(rowToTimelineEvent);
  }

  getEvent(eventId: string): TimelineEvent | null {
    const row = this.db
      .prepare(
        `SELECT id, project_id as projectId, session_id as sessionId, turn_id as turnId, timestamp, kind, lane, title, detail,
                tool_name as toolName, call_id as callId, status, files_json as filesJson, raw_event_ref_id as rawEventRefId,
                duration_ms as durationMs, output_event_id as outputEventId, commit_hash as commitHash, token_usage_json as tokenUsageJson,
                skills_json as skillsJson
         FROM events WHERE id = ?`
      )
      .get(eventId) as EventRow | undefined;
    return row ? rowToTimelineEvent(row) : null;
  }

  getRawEvent(rawEventRefId: string): RawEventRef | null {
    const row = this.db
      .prepare(
        `SELECT id, session_id as sessionId, provider, line_no as lineNo, timestamp, type, redacted_payload_json as redactedPayloadJson,
                source_path as sourcePath, sha256
         FROM raw_event_refs WHERE id = ?`
      )
      .get(rawEventRefId) as RawEventRef | undefined;
    return row ?? null;
  }

  getEventEvidence(eventId: string): EventEvidence | null {
    const event = this.getEvent(eventId);
    if (!event) return null;
    return {
      event,
      artifacts: this.listArtifactsForEvents([event.id]),
      rawEvent: event.rawEventRefId ? this.getRawEvent(event.rawEventRefId) : null
    };
  }

  getJob(jobId: string): IngestJob | null {
    const row = this.db
      .prepare(
        `SELECT id, status, phase, started_at as startedAt, finished_at as finishedAt, total_files as totalFiles,
                processed_files as processedFiles, total_events as totalEvents, skipped_files as skippedFiles,
                candidate_files as candidateFiles, changed_files as changedFiles, processed_bytes as processedBytes,
                total_bytes as totalBytes, current_file as currentFile, worker_pid as workerPid,
                processor_version as processorVersion, errors_json as errorsJson
         FROM ingest_jobs WHERE id = ?`
      )
      .get(jobId) as (Omit<IngestJob, "errors"> & { errorsJson: string }) | undefined;
    return row ? { ...row, errors: JSON.parse(row.errorsJson) as string[] } : null;
  }

  getActiveIngestJob(): IngestJob | null {
    const row = this.db
      .prepare(
        `SELECT id, status, phase, started_at as startedAt, finished_at as finishedAt, total_files as totalFiles,
                processed_files as processedFiles, total_events as totalEvents, skipped_files as skippedFiles,
                candidate_files as candidateFiles, changed_files as changedFiles, processed_bytes as processedBytes,
                total_bytes as totalBytes, current_file as currentFile, worker_pid as workerPid,
                processor_version as processorVersion, errors_json as errorsJson
         FROM ingest_jobs
         WHERE status IN ('queued', 'running')
         ORDER BY started_at DESC
         LIMIT 1`
      )
      .get() as (Omit<IngestJob, "errors"> & { errorsJson: string }) | undefined;
    return row ? { ...row, errors: JSON.parse(row.errorsJson) as string[] } : null;
  }
}

function phaseForStatus(status: IngestJob["status"]): IngestJob["phase"] {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "running") return "scanning";
  return "queued";
}

const DEFAULT_TIMELINE_LIMIT = 200;
const MAX_TIMELINE_LIMIT = 100000;

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_TIMELINE_LIMIT;
  return Math.min(MAX_TIMELINE_LIMIT, Math.max(1, Math.trunc(limit)));
}

function emptyTokenUsage(): TokenUsage {
  return { input: 0, output: 0, reasoning: 0, cachedInput: 0, total: 0 };
}

function addTokenUsage(total: TokenUsage, usage: TokenUsage) {
  total.input += usage.input;
  total.output += usage.output;
  total.reasoning += usage.reasoning;
  total.cachedInput += usage.cachedInput;
  total.total += usage.total;
}

function rowToTimelineEvent(row: EventRow): TimelineEvent {
  const { filesJson, tokenUsageJson, skillsJson, ...event } = row;
  return {
    ...event,
    files: JSON.parse(filesJson) as string[],
    tokenUsage: parseTokenUsage(tokenUsageJson),
    skills: parseSkills(skillsJson)
  };
}

function parseTokenUsage(value: string | null): TokenUsage | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<TokenUsage>;
    return {
      input: Number(parsed.input ?? 0),
      output: Number(parsed.output ?? 0),
      reasoning: Number(parsed.reasoning ?? 0),
      cachedInput: Number(parsed.cachedInput ?? 0),
      total: Number(parsed.total ?? 0)
    };
  } catch {
    return null;
  }
}

function parseSkills(value: string | null): TimelineEvent["skills"] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function taskJourneyFromEvents(projectId: string, sourcePath: string, events: TimelineEvent[]): TaskJourney | null {
  const first = events[0];
  const last = events.at(-1);
  if (!first || !last) return null;
  return {
    id: `subthread:${projectId}:${sourcePath}`,
    projectId,
    sessionId: first.sessionId,
    promptEventId: first.id,
    startedAt: first.timestamp,
    endedAt: last.timestamp,
    durationMs: durationBetween(first.timestamp, last.timestamp),
    title: first.detail ?? first.title,
    summary: `Subagent thread with ${events.length} event(s).`,
    status: events.some((event) => event.status === "failed") ? "failed" : events.some((event) => event.status === "success") ? "success" : "unknown",
    exitType: "session_end",
    eventIds: events.map((event) => event.id),
    tokenUsage: aggregateEventTokenUsage(events),
    skills: [],
    stageCounts: {},
    stages: []
  };
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
    emptyTokenUsage()
  );
}

function durationBetween(start: string, end: string): number {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  return Math.max(0, endMs - startMs);
}

function stripProviderPrefix(sessionId: string): string {
  const index = sessionId.indexOf(":");
  return index >= 0 ? sessionId.slice(index + 1) : sessionId;
}

function isSourceForParentSession(sourcePath: string, parentKey: string): boolean {
  return sourcePath.includes(`/${parentKey}/subagents/`) || sourcePath.includes(`\\${parentKey}\\subagents\\`);
}

function isSourceInJourneyWindow(startedAt: string, journey: TaskJourney): boolean {
  if (startedAt < journey.startedAt) return false;
  return journey.exitType !== "next_prompt" || startedAt <= journey.endedAt;
}

function escapeSqlLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

const ALL_AGENT_PROVIDERS: AgentProvider[] = ["codex", "claude-code", "opencode"];

function sourcePathFromIngestedId(sourceId: string): string {
  for (const provider of ALL_AGENT_PROVIDERS) {
    const prefix = `${provider}:`;
    if (sourceId.startsWith(prefix)) return sourceId.slice(prefix.length);
  }
  return sourceId;
}
