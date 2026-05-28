import Database from "better-sqlite3";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import {
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

export class SuperViewDatabase {
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
    this.db.prepare("INSERT OR REPLACE INTO schema_meta(version, updated_at) VALUES (?, ?)").run(SCHEMA_VERSION, new Date().toISOString());
  }

  upsertBundle(bundle: NormalizedBundle) {
    const tx = this.db.transaction(() => {
      this.upsertProject(bundle.project);
      this.upsertSession(bundle.session);
      for (const turn of bundle.turns) this.upsertTurn(turn);
      for (const raw of bundle.rawEventRefs) this.upsertRawEvent(raw);
      for (const event of bundle.events) this.upsertEvent(event);
      for (const prompt of bundle.historyPrompts ?? []) this.upsertHistoryPrompt(prompt);
      for (const commit of bundle.gitCommits ?? []) this.upsertGitCommit(bundle.project.id, bundle.session.id, commit);
      for (const artifact of bundle.artifacts) this.upsertArtifact(artifact);
      for (const artifact of this.gitArtifactsForCommits(bundle.project.id, bundle.gitCommits ?? [])) this.upsertArtifact(artifact);
      this.upsertEpisodes(groupEpisodes(bundle.project.id, bundle.events));
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
    return {
      ...timeline,
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
      const journey = timeline.taskJourneys.find((candidate) => candidate.id === journeyId);
      if (!journey) continue;
      const eventIds = new Set(journey.eventIds);
      const journeyEvents = events.filter((event) => eventIds.has(event.id));
      return {
        journey,
        events: journeyEvents,
        causalEdges: timeline.causalEdges.filter((edge) => eventIds.has(edge.fromEventId) || eventIds.has(edge.toEventId))
      };
    }
    return null;
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

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return 200;
  return Math.min(500, Math.max(1, Math.trunc(limit)));
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
