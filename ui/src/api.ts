import type { AgentSourceConfig, Artifact, ContextReplayResponse, DailyTokenUsageResponse, EventEvidence, IngestJob, ProjectTimeline, RunReplay, SessionRecord, TaskJourneyDetail, TokenUsage } from "../../core/types";

export interface ProjectWithSessions {
  id: string;
  name: string;
  cwd: string;
  repoRoot: string | null;
  createdAt: string;
  updatedAt: string;
  tokenUsage: TokenUsage;
  sessions: SessionRecord[];
}

export async function fetchProjects(): Promise<ProjectWithSessions[]> {
  const response = await fetch("/api/projects");
  if (!response.ok) throw new Error("Failed to load projects");
  const data = (await response.json()) as { projects: ProjectWithSessions[] };
  return data.projects;
}

export async function startIngest(options: { codexHome?: string; sources?: AgentSourceConfig[] } = {}): Promise<string> {
  const response = await fetch("/api/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options)
  });
  if (!response.ok) throw new Error("Failed to start ingest");
  const data = (await response.json()) as { jobId: string };
  return data.jobId;
}

export async function fetchIngestJob(jobId: string): Promise<IngestJob> {
  const response = await fetch(`/api/ingest/jobs/${jobId}`);
  if (!response.ok) throw new Error("Failed to load ingest job");
  return (await response.json()) as IngestJob;
}

export async function fetchTimeline(projectId: string, query: { limit?: number; offset?: number } = {}): Promise<ProjectTimeline> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.offset !== undefined) params.set("offset", String(query.offset));
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await fetch(`/api/projects/${projectId}/timeline${suffix}`);
  if (!response.ok) throw new Error("Failed to load timeline");
  return (await response.json()) as ProjectTimeline;
}

export async function fetchDailyTokenUsage(projectId: string): Promise<DailyTokenUsageResponse> {
  const response = await fetch(`/api/projects/${projectId}/token-usage/daily`);
  if (!response.ok) throw new Error("Failed to load daily token usage");
  return (await response.json()) as DailyTokenUsageResponse;
}

export async function fetchEventEvidence(eventId: string): Promise<EventEvidence> {
  const response = await fetch(`/api/events/${eventId}/evidence`);
  if (!response.ok) throw new Error("Failed to load event evidence");
  return (await response.json()) as EventEvidence;
}

export async function fetchTaskJourneyDetail(journeyId: string, projectId?: string): Promise<TaskJourneyDetail> {
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await fetch(`/api/task-journeys/${journeyId}${suffix}`);
  if (!response.ok) throw new Error("Failed to load task journey detail");
  return (await response.json()) as TaskJourneyDetail;
}

export async function fetchContextReplay(journeyId: string, projectId?: string): Promise<ContextReplayResponse> {
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await fetch(`/api/task-journeys/${journeyId}/context-replay${suffix}`);
  if (!response.ok) throw new Error("Failed to load context replay");
  return (await response.json()) as ContextReplayResponse;
}

export async function fetchRun(sessionId: string): Promise<RunReplay & { artifacts: Artifact[] }> {
  const response = await fetch(`/api/runs/${sessionId}`);
  if (!response.ok) throw new Error("Failed to load run");
  return (await response.json()) as RunReplay & { artifacts: Artifact[] };
}

export async function fetchConfig(): Promise<{ projectDir: string | null; version?: string }> {
  const response = await fetch("/api/config");
  if (!response.ok) throw new Error("Failed to load config");
  return (await response.json()) as { projectDir: string | null; version?: string };
}

export async function resetDatabase(): Promise<void> {
  await fetch("/api/reset", { method: "POST" });
}

export async function resetDatabaseAndIngest(options: { codexHome?: string; sources?: AgentSourceConfig[] } = {}): Promise<string> {
  const response = await fetch("/api/reset-and-ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options)
  });
  if (!response.ok) throw new Error("Failed to reset and start ingest");
  const data = (await response.json()) as { jobId: string };
  return data.jobId;
}
