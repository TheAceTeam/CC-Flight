import express from "express";
import { AgentProvider, AgentSourceConfig, TimelineLane, TimelineQuery } from "../core/types";
import { SuperViewDatabase } from "../storage/database";
import { IngestService } from "./ingest";

export function createServer() {
  const db = new SuperViewDatabase();
  const ingest = new IngestService(db);
  const app = express();
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/api/ingest", (req, res) => {
    const result = ingest.start(parseIngestBody(req.body));
    res.status(202).json({ jobId: result.job.id, alreadyRunning: result.alreadyRunning, job: result.job });
  });

  app.get("/api/ingest/jobs/:id", (req, res) => {
    const job = ingest.getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: "job not found" });
      return;
    }
    res.json(job);
  });

  app.get("/api/projects", (_req, res) => {
    const projectRecords = db.listProjects();
    const projectIds = projectRecords.map((project) => project.id);
    const tokenUsageByProject = db.getProjectTokenUsageByProjectIds(projectIds);
    const sessionsByProject = db.listSessionsByProjectIds(projectIds);
    const projects = projectRecords.map((project) => ({
      ...project,
      tokenUsage: tokenUsageByProject.get(project.id) ?? { input: 0, output: 0, reasoning: 0, cachedInput: 0, total: 0 },
      sessions: sessionsByProject.get(project.id) ?? []
    }));
    res.json({ projects });
  });

  app.get("/api/projects/:id/timeline", (req, res) => {
    const query = parseTimelineQuery(req.query);
    const timeline = db.getTimeline(req.params.id, query);
    if (!timeline) {
      res.status(404).json({ error: "project not found" });
      return;
    }
    res.json(timeline);
  });

  app.get("/api/projects/:id/token-usage/daily", (req, res) => {
    const usage = db.getProjectDailyTokenUsage(req.params.id);
    if (!usage) {
      res.status(404).json({ error: "project not found" });
      return;
    }
    res.json(usage);
  });

  app.get("/api/events/:id/evidence", (req, res) => {
    const evidence = db.getEventEvidence(req.params.id);
    if (!evidence) {
      res.status(404).json({ error: "event not found" });
      return;
    }
    res.json({
      event: evidence.event,
      artifacts: evidence.artifacts,
      rawEvent: evidence.rawEvent
        ? {
            id: evidence.rawEvent.id,
            sessionId: evidence.rawEvent.sessionId,
            lineNo: evidence.rawEvent.lineNo,
            timestamp: evidence.rawEvent.timestamp,
            type: evidence.rawEvent.type,
            sourcePath: evidence.rawEvent.sourcePath,
            sha256: evidence.rawEvent.sha256,
            redactedPayload: safeJsonParse(evidence.rawEvent.redactedPayloadJson)
          }
        : null
    });
  });

  app.get("/api/task-journeys/:id", (req, res) => {
    const projectId = firstQueryValue(req.query.projectId);
    const detail = db.getTaskJourneyDetail(req.params.id, projectId);
    if (!detail) {
      res.status(404).json({ error: "task journey not found" });
      return;
    }
    res.json(detail);
  });

  app.get("/api/runs/:id", (req, res) => {
    const replay = db.getRunReplay(req.params.id);
    if (!replay) {
      res.status(404).json({ error: "run not found" });
      return;
    }
    res.json(replay);
  });

  return app;
}

const AGENT_PROVIDERS: AgentProvider[] = ["codex", "claude-code", "opencode"];

function parseIngestBody(body: unknown) {
  if (!body || typeof body !== "object") return {};
  const record = body as Record<string, unknown>;
  const sources = Array.isArray(record.sources) ? record.sources.map(parseAgentSourceConfig).filter((source): source is AgentSourceConfig => Boolean(source)) : undefined;
  return {
    codexHome: typeof record.codexHome === "string" ? record.codexHome : undefined,
    sources
  };
}

function parseAgentSourceConfig(value: unknown): AgentSourceConfig | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const provider = typeof record.provider === "string" && AGENT_PROVIDERS.includes(record.provider as AgentProvider) ? (record.provider as AgentProvider) : null;
  if (!provider) return null;
  return {
    provider,
    root: typeof record.root === "string" ? record.root : undefined,
    path: typeof record.path === "string" ? record.path : undefined,
    mode: record.mode === "cli-export" || record.mode === "files" ? record.mode : undefined
  };
}

const TIMELINE_LANES: TimelineLane[] = ["Product", "Architecture", "Code", "Agent Runs", "Verification", "Risks"];

function parseTimelineQuery(query: Record<string, unknown>): TimelineQuery {
  const parsed: TimelineQuery = {};
  const limit = firstQueryValue(query.limit);
  const offset = firstQueryValue(query.offset);
  const lane = firstQueryValue(query.lane);
  const since = firstQueryValue(query.since);
  const until = firstQueryValue(query.until);

  if (limit !== undefined) parsed.limit = Number(limit);
  if (offset !== undefined) parsed.offset = Number(offset);
  if (lane && TIMELINE_LANES.includes(lane as TimelineLane)) parsed.lane = lane as TimelineLane;
  if (since) parsed.since = since;
  if (until) parsed.until = until;
  return parsed;
}

function firstQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : undefined;
  }
  return typeof value === "string" ? value : undefined;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.SUPERVIEW_API_PORT ?? 5174);
  createServer().listen(port, "127.0.0.1", () => {
    console.log(`SuperView API listening on http://127.0.0.1:${port}`);
  });
}
