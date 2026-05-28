import { AlertTriangle, ChartColumn, FileText, Moon, RotateCw, Search, Sun } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AgentProvider, Artifact, DailyTokenUsageResponse, EventEvidence, IngestJob, ProjectTimeline, SkillUsage, TaskJourney, TaskJourneyDetail, TimelineEvent, TokenUsage } from "../../core/types";
import { fetchDailyTokenUsage, fetchEventEvidence, fetchIngestJob, fetchProjects, fetchTaskJourneyDetail, fetchTimeline, ProjectWithSessions, startIngest } from "./api";
import { DailyTokenUsagePanel } from "./DailyTokenUsagePanel";
import { IngestLevelProgress } from "./IngestLevelProgress";
import { formatMillionTokens } from "./tokenFormat";

type Theme = "light" | "dark";
type ProjectProviderFilter = AgentProvider | "all";

const TIMELINE_LIMIT = 300;
export function App() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("superview-theme") as Theme | null) ?? "light");
  const [projects, setProjects] = useState<ProjectWithSessions[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<ProjectTimeline | null>(null);
  const [timelineOffset, setTimelineOffset] = useState(0);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [dailyTokenUsage, setDailyTokenUsage] = useState<DailyTokenUsageResponse | null>(null);
  const [dailyTokenUsageLoading, setDailyTokenUsageLoading] = useState(false);
  const [tokenChartExpanded, setTokenChartExpanded] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<TimelineEvent | null>(null);
  const [journeyDetails, setJourneyDetails] = useState<Record<string, TaskJourneyDetail>>({});
  const [journeyLoadingIds, setJourneyLoadingIds] = useState<Record<string, boolean>>({});
  const journeyLoadingRef = useRef(new Set<string>());
  const [expandedJourneyIds, setExpandedJourneyIds] = useState<Record<string, boolean>>({});
  const [eventEvidence, setEventEvidence] = useState<EventEvidence | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [job, setJob] = useState<IngestJob | null>(null);
  const [agentProvider, setAgentProvider] = useState<AgentProvider>("codex");
  const [projectProviderFilter, setProjectProviderFilter] = useState<ProjectProviderFilter>("all");
  const [agentLogRoot, setAgentLogRoot] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("superview-theme", theme);
  }, [theme]);

  useEffect(() => {
    void loadProjects();
  }, []);

  useEffect(() => {
    if (!selectedProjectId) return;
    void loadTimeline(selectedProjectId, 0);
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) {
      setDailyTokenUsage(null);
      return;
    }
    void loadDailyTokenUsage(selectedProjectId);
  }, [selectedProjectId]);

  useEffect(() => {
    const filtered = filterProjectsByProvider(projects, projectProviderFilter);
    if (filtered.length === 0) {
      setSelectedProjectId(null);
      setTimeline(null);
      setSelectedEvent(null);
      return;
    }
    if (!selectedProjectId || !filtered.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(filtered[0].id);
    }
  }, [projects, projectProviderFilter, selectedProjectId]);

  useEffect(() => {
    if (!selectedEvent) {
      setEventEvidence(null);
      return;
    }

    let cancelled = false;
    setEvidenceLoading(true);
    void fetchEventEvidence(selectedEvent.id)
      .then((next) => {
        if (!cancelled) {
          setEventEvidence(next);
          setError(null);
        }
      })
      .catch((evidenceError) => {
        if (!cancelled) {
          setEventEvidence({ event: selectedEvent, artifacts: [], rawEvent: null });
          setError(evidenceError instanceof Error ? evidenceError.message : String(evidenceError));
        }
      })
      .finally(() => {
        if (!cancelled) setEvidenceLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedEvent]);

  useEffect(() => {
    if (!job || job.status === "completed" || job.status === "failed") return;
    const timer = window.setInterval(async () => {
      const next = await fetchIngestJob(job.id);
      setJob(next);
      if (next.status === "completed") {
        await loadProjects();
        if (selectedProjectId) await loadDailyTokenUsage(selectedProjectId);
      }
    }, 700);
    return () => window.clearInterval(timer);
  }, [job, selectedProjectId]);

  async function loadProjects() {
    setLoading(true);
    try {
      const next = await fetchProjects();
      setProjects(next);
      setSelectedProjectId((current) => current ?? next[0]?.id ?? null);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }

  async function loadTimeline(projectId: string, offset: number) {
    setTimelineLoading(true);
    try {
      const next = await fetchTimeline(projectId, { limit: TIMELINE_LIMIT, offset });
      setTimeline(next);
      setTimelineOffset(next.offset ?? offset);
      setSelectedEvent(next.events[0] ?? null);
      setExpandedJourneyIds({});
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setTimelineLoading(false);
    }
  }

  async function loadDailyTokenUsage(projectId: string) {
    setDailyTokenUsageLoading(true);
    try {
      const next = await fetchDailyTokenUsage(projectId);
      setDailyTokenUsage(next);
      setError(null);
    } catch (loadError) {
      setDailyTokenUsage(null);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setDailyTokenUsageLoading(false);
    }
  }

  async function loadNextTimelinePage() {
    if (!selectedProjectId || !timeline) return;
    const nextOffset = timelineOffset + (timeline.limit ?? TIMELINE_LIMIT);
    await loadTimeline(selectedProjectId, nextOffset);
  }

  async function loadPreviousTimelinePage() {
    if (!selectedProjectId) return;
    const previousOffset = Math.max(0, timelineOffset - TIMELINE_LIMIT);
    await loadTimeline(selectedProjectId, previousOffset);
  }

  async function handleScan() {
    if (isIngestBusy(job)) return;
    setError(null);
    try {
      const root = agentLogRoot.trim();
      const jobId = await startIngest(root ? { sources: [{ provider: agentProvider, root: root, path: root }] } : { sources: [{ provider: agentProvider }] });
      setJob(await fetchIngestJob(jobId));
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : String(scanError));
    }
  }

  async function loadJourneyDetail(journeyId: string, projectId = selectedProjectId ?? undefined) {
    if (journeyDetails[journeyId] || journeyLoadingRef.current.has(journeyId)) return;
    journeyLoadingRef.current.add(journeyId);
    setJourneyLoadingIds((current) => ({ ...current, [journeyId]: true }));
    try {
      const detail = await fetchTaskJourneyDetail(journeyId, projectId);
      setJourneyDetails((current) => ({ ...current, [journeyId]: detail }));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      journeyLoadingRef.current.delete(journeyId);
      setJourneyLoadingIds((current) => ({ ...current, [journeyId]: false }));
    }
  }

  function toggleJourneyDetails(journeyId: string) {
    setExpandedJourneyIds((current) => {
      const nextExpanded = !current[journeyId];
      if (nextExpanded) void loadJourneyDetail(journeyId);
      return { ...current, [journeyId]: nextExpanded };
    });
  }

  const filteredProjects = useMemo(() => filterProjectsByProvider(projects, projectProviderFilter), [projects, projectProviderFilter]);
  const selectedProject = filteredProjects.find((project) => project.id === selectedProjectId) ?? null;
  const journeys = timeline?.taskJourneys ?? [];
  const timelineEventsById = useMemo(() => new Map((timeline?.events ?? []).map((event) => [event.id, event])), [timeline]);

  const drawerEvent = selectedEvent;
  const drawerEvidence = eventEvidence?.event.id === drawerEvent?.id ? eventEvidence : null;
  const drawerArtifacts = drawerEvidence?.artifacts ?? [];
  const totalEvents = timeline?.totalEvents ?? timeline?.events.length ?? 0;
  const currentLimit = timeline?.limit ?? TIMELINE_LIMIT;
  const pageEnd = Math.min(timelineOffset + (timeline?.events.length ?? 0), totalEvents);
  const hasPreviousPage = timelineOffset > 0;
  const hasNextPage = totalEvents > timelineOffset + currentLimit;
  const projectTokenUsage = selectedProject?.tokenUsage ?? timeline?.tokenUsage ?? ZERO_TOKEN_USAGE;
  const ingestBusy = isIngestBusy(job);
  const blockingMessage = getBlockingMessage({ loading, timelineLoading, ingestBusy, dailyTokenUsageLoading });

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <strong>SuperView</strong>
          <span>Agent timeline command center</span>
        </div>
        <div className="topbar-actions">
          <label className="agent-root-control">
            <span>Agent log root</span>
            <input
              aria-label="Agent log root path"
              value={agentLogRoot}
              onChange={(event) => setAgentLogRoot(event.target.value)}
              placeholder="Blank scans default Codex logs"
              disabled={ingestBusy}
            />
          </label>
          <label className="agent-provider-control">
            <span>Source</span>
            <select aria-label="Agent log source" value={agentProvider} onChange={(event) => setAgentProvider(event.target.value as AgentProvider)} disabled={ingestBusy}>
              <option value="codex">Codex</option>
              <option value="claude-code">Claude Code</option>
              <option value="opencode">OpenCode</option>
            </select>
          </label>
          <button className="shell-button" onClick={handleScan} disabled={ingestBusy}>
            <RotateCw size={16} />
            Scan Agent Logs
          </button>
          <button className="icon-button" aria-label="Toggle theme" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
            {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
          </button>
        </div>
      </header>

      <main className="workspace">
        <section className="title-row">
          <div>
            <p className="eyebrow">Project Timeline</p>
            <h1>{selectedProject?.name ?? "No project indexed yet"}</h1>
            <p className="lead">Replay each user input as an agent conversation, with background work available on demand.</p>
          </div>
          <div className="title-actions">
            <div className="project-controls-panel">
              <label className="project-control">
                <span className="field-label">Provider</span>
                <select aria-label="Project provider" value={projectProviderFilter} onChange={(event) => setProjectProviderFilter(event.target.value as ProjectProviderFilter)} disabled={timelineLoading || ingestBusy}>
                  <option value="all">All</option>
                  <option value="codex">Codex</option>
                  <option value="claude-code">Claude Code</option>
                  <option value="opencode">OpenCode</option>
                </select>
              </label>
              <label className="project-control" htmlFor="project-select">
                <span className="field-label">Project</span>
                <select id="project-select" aria-label="Project" value={selectedProjectId ?? ""} onChange={(event) => setSelectedProjectId(event.target.value)} disabled={filteredProjects.length === 0 || timelineLoading || ingestBusy}>
                  {filteredProjects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name} - {providerSummary(project)} - {formatMillionTokens(project.tokenUsage.total)} tokens / KV {formatKvHitRate(project.tokenUsage)}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="status-cluster">
              <Metric label="Projects" value={filteredProjects.length} />
              <Metric label="Events" value={totalEvents} />
              <Metric label="Tasks" value={timeline?.taskJourneys.length ?? 0} />
              <Metric
                label="Tokens"
                value={projectTokenUsage.total}
                action={
                  selectedProject ? (
                    <button
                      className="metric-icon-button"
                      type="button"
                      aria-label={tokenChartExpanded ? "Hide daily token usage chart" : "Show daily token usage chart"}
                      aria-expanded={tokenChartExpanded}
                      onClick={() => setTokenChartExpanded((current) => !current)}
                    >
                      <ChartColumn size={15} />
                    </button>
                  ) : null
                }
                overlay={
                  selectedProject && tokenChartExpanded ? (
                    <DailyTokenUsagePanel
                      data={dailyTokenUsage}
                      loading={dailyTokenUsageLoading}
                      title="Tokens"
                      subtitle="Daily usage by day"
                      maxVisiblePoints={30}
                      className="token-chart-panel--metric-popover"
                      showHeaderToggle={false}
                      expanded={tokenChartExpanded}
                      onExpandedChange={setTokenChartExpanded}
                    />
                  ) : null
                }
              />
              <RatioMetric label="KV hit" value={formatKvHitRate(projectTokenUsage)} />
            </div>
          </div>
        </section>

        {error ? <div className="alert"><AlertTriangle size={16} />{error}</div> : null}
        {job && !ingestBusy ? <IngestLevelProgress job={job} /> : null}
        {blockingMessage ? <BlockingLoader message={blockingMessage} job={ingestBusy ? job : null} /> : null}

        {loading ? (
          <EmptyState title="Loading SuperView index" detail="Checking local SQLite state." agentProvider={agentProvider} onAgentProviderChange={setAgentProvider} agentLogRoot={agentLogRoot} onAgentLogRootChange={setAgentLogRoot} onScan={handleScan} disabled={ingestBusy} />
        ) : projects.length === 0 ? (
          <EmptyState title="No agent runs indexed" detail="Scan local Codex, Claude Code, or OpenCode logs to build the first timeline." agentProvider={agentProvider} onAgentProviderChange={setAgentProvider} agentLogRoot={agentLogRoot} onAgentLogRootChange={setAgentLogRoot} onScan={handleScan} disabled={ingestBusy} />
        ) : filteredProjects.length === 0 ? (
          <EmptyState title="No projects for this provider" detail="Switch the project filter to All, or scan logs for the selected provider." agentProvider={agentProvider} onAgentProviderChange={setAgentProvider} agentLogRoot={agentLogRoot} onAgentLogRootChange={setAgentLogRoot} onScan={handleScan} disabled={ingestBusy} />
        ) : (
          <div className="dashboard-grid conversation-dashboard-grid">
            <section className="timeline-panel">
              <div className="panel-heading">
                <FileText size={17} />
                <span>CLI Conversation</span>
                <em>{timelineOffset + 1}-{pageEnd} of {totalEvents}</em>
              </div>
              <div className="timeline-controls">
                <span>{timeline?.taskJourneys.length ?? 0} task journeys loaded from {timeline?.events.length ?? 0} events</span>
                <div>
                  <button className="secondary-button" onClick={loadPreviousTimelinePage} disabled={!hasPreviousPage || timelineLoading || ingestBusy}>Prev page</button>
                  <button className="secondary-button" onClick={loadNextTimelinePage} disabled={!hasNextPage || timelineLoading || ingestBusy}>Next page</button>
                </div>
              </div>
              <ConversationThread
                journeys={journeys}
                detailsByJourneyId={journeyDetails}
                timelineEventsById={timelineEventsById}
                expandedJourneyIds={expandedJourneyIds}
                loadingJourneyIds={journeyLoadingIds}
                selectedEventId={drawerEvent?.id ?? null}
                onToggleDetails={toggleJourneyDetails}
                onSelectEvent={(event) => {
                  setSelectedEvent(event);
                }}
              />
            </section>

            <EvidenceDrawer event={drawerEvent ?? null} artifacts={drawerArtifacts} rawEvent={drawerEvidence?.rawEvent ?? null} loading={evidenceLoading} />
          </div>
        )}
      </main>
    </div>
  );
}

function eventItemClass(event: TimelineEvent, selectedId: string | null) {
  const classes = ["log-entry", event.status];
  if (event.id === selectedId) classes.push("selected");
  return classes.join(" ");
}

function ConversationThread({
  journeys,
  detailsByJourneyId,
  timelineEventsById,
  expandedJourneyIds,
  loadingJourneyIds,
  selectedEventId,
  onToggleDetails,
  onSelectEvent
}: {
  journeys: TaskJourney[];
  detailsByJourneyId: Record<string, TaskJourneyDetail>;
  timelineEventsById: Map<string, TimelineEvent>;
  expandedJourneyIds: Record<string, boolean>;
  loadingJourneyIds: Record<string, boolean>;
  selectedEventId: string | null;
  onToggleDetails: (journeyId: string) => void;
  onSelectEvent: (event: TimelineEvent) => void;
}) {
  if (journeys.length === 0) {
    return <p className="muted">No user-input task journeys are visible on this page.</p>;
  }

  return (
    <div className="conversation-thread" aria-label="Task conversation thread">
      {journeys.map((journey) => (
        <ConversationTurn
          key={journey.id}
          journey={journey}
          detail={detailsByJourneyId[journey.id] ?? null}
          fallbackPrompt={timelineEventsById.get(journey.promptEventId) ?? null}
          expanded={Boolean(expandedJourneyIds[journey.id])}
          loading={Boolean(loadingJourneyIds[journey.id])}
          selectedEventId={selectedEventId}
          onToggleDetails={() => onToggleDetails(journey.id)}
          onSelectEvent={onSelectEvent}
        />
      ))}
    </div>
  );
}

function ConversationTurn({
  journey,
  detail,
  fallbackPrompt,
  expanded,
  loading,
  selectedEventId,
  onToggleDetails,
  onSelectEvent
}: {
  journey: TaskJourney;
  detail: TaskJourneyDetail | null;
  fallbackPrompt: TimelineEvent | null;
  expanded: boolean;
  loading: boolean;
  selectedEventId: string | null;
  onToggleDetails: () => void;
  onSelectEvent: (event: TimelineEvent) => void;
}) {
  const events = detail?.events ?? [];
  const prompt = fallbackPrompt ?? events.find((event) => event.id === journey.promptEventId || event.kind === "user_prompt");
  const assistantMessage = events.find((event) => event.kind === "assistant_message");
  const backgroundEvents = events.filter((event) => event.kind !== "user_prompt" && event.id !== assistantMessage?.id);
  const logEvents = events.filter((event) => event.kind === "tool_call" || event.kind === "tool_result" || event.kind === "file_change" || event.kind === "verification" || event.kind === "error");
  const skills = aggregateSkills(journey.skills, events);
  const agentOutput = assistantMessage?.detail ?? assistantMessage?.title ?? journey.summary;
  const provider = prompt ? providerFromSessionId(prompt.sessionId) : providerFromSessionId(journey.sessionId);
  const agentLabel = labelForProvider(provider);
  const promptText = prompt?.detail ?? journey.title;

  return (
    <article className={`conversation-turn ${journey.status}`}>
      <div className="conversation-summary">
        <div>
          <span>{journey.eventIds.length} events</span>
          <span>{formatExitType(journey.exitType)}</span>
          <span>{formatDuration(journey.durationMs)}</span>
          <span>{formatMillionTokens(journey.tokenUsage.total)} tokens</span>
          <span>KV hit {formatKvHitRate(journey.tokenUsage)}</span>
          {loading ? <span>Loading details</span> : null}
        </div>
      </div>

      <ChatBubble
        variant="user"
        label="User"
        text={promptText}
        skills={skills}
        selected={prompt?.id === selectedEventId}
        disabled={!prompt}
        onSelect={() => prompt ? onSelectEvent(prompt) : undefined}
      />

      <div className="message-row codex detail-message-row">
        <span className="message-avatar" aria-hidden="true">{avatarForProvider(provider)}</span>
        <div className="message-stack">
          <button className="conversation-message codex detail-toggle" onClick={onToggleDetails}>
            <span className="message-meta">Agent work</span>
            <span>{expanded ? "收起过程..." : "查看过程..."}</span>
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="background-details">
          <section>
            <div className="detail-section-heading">
              <span>Background Work</span>
              <em>{backgroundEvents.length} events</em>
            </div>
            <div className="log-list">
              {backgroundEvents.length > 0 ? (
                backgroundEvents.map((event) => (
                  <button key={event.id} className={eventItemClass(event, selectedEventId)} data-event-id={event.id} onClick={() => onSelectEvent(event)}>
                    <span>{event.kind}</span>
                    <strong>{event.title}</strong>
                    {event.skills && event.skills.length > 0 ? <small>Skills: {formatSkillNames(event.skills)}</small> : null}
                    <small>{event.detail ?? formatDate(event.timestamp)}</small>
                  </button>
                ))
              ) : (
                <p className="muted">No background work captured for this task.</p>
              )}
            </div>
          </section>

          <section>
            <div className="detail-section-heading">
              <span>Log</span>
              <em>{logEvents.length} entries</em>
            </div>
            <div className="log-list compact">
              {logEvents.length > 0 ? (
                logEvents.map((event) => (
                  <button key={event.id} className={eventItemClass(event, selectedEventId)} data-event-id={event.id} onClick={() => onSelectEvent(event)}>
                    <span>{event.toolName ?? event.kind}</span>
                    <strong>{event.title}</strong>
                    {event.skills && event.skills.length > 0 ? <small>Skills: {formatSkillNames(event.skills)}</small> : null}
                    <small>{event.detail ?? event.callId ?? formatDate(event.timestamp)}</small>
                  </button>
                ))
              ) : (
                <p className="muted">No tool or verification log entries captured.</p>
              )}
            </div>
          </section>
        </div>
      ) : null}

      <ChatBubble
        variant="codex"
        label={agentLabel}
        text={agentOutput}
        skills={skills}
        selected={assistantMessage?.id === selectedEventId}
        disabled={!assistantMessage}
        onSelect={() => assistantMessage ? onSelectEvent(assistantMessage) : undefined}
      />
    </article>
  );
}

function ChatBubble({
  variant,
  label,
  title,
  text,
  skills = [],
  selected,
  disabled,
  onSelect
}: {
  variant: "user" | "codex";
  label: string;
  title?: string;
  text: string;
  skills?: SkillUsage[];
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;

    const measure = () => {
      setCanExpand(body.scrollHeight > 250);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [text, title]);

  useEffect(() => {
    if (!canExpand) setExpanded(false);
  }, [canExpand]);

  return (
    <div className={`message-row ${variant}`}>
      <span className="message-avatar" aria-hidden="true">{variant === "user" ? "U" : "C"}</span>
      <div className="message-stack">
        <button className={`conversation-message ${variant} ${selected ? "selected" : ""}`} disabled={disabled} onClick={onSelect}>
          <span className="message-meta">{label}</span>
          <div ref={bodyRef} className="message-body" data-expanded={expanded ? "true" : "false"}>
            {title ? <strong>{title}</strong> : null}
            <p>{text}</p>
          </div>
          {skills.length > 0 ? <SkillChips skills={skills} /> : null}
          {canExpand && !expanded ? <span className="message-fade" aria-hidden="true" /> : null}
        </button>
        {canExpand ? (
          <button className="message-expand-toggle" onClick={() => setExpanded((current) => !current)}>
            {expanded ? "收起" : "展开"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SkillChips({ skills }: { skills: SkillUsage[] }) {
  const visibleSkills = dedupeSkills(skills).slice(0, 4);
  const remaining = Math.max(0, dedupeSkills(skills).length - visibleSkills.length);
  return (
    <div className="skill-chip-row" aria-label={`Skills: ${formatSkillNames(skills)}`}>
      <span className="skill-chip-label">Skills</span>
      {visibleSkills.map((skill) => (
        <span className="skill-chip" title={skill.excerpt || skill.path || skill.source} key={`${skill.name}-${skill.source}-${skill.path ?? ""}`}>
          {skill.name}
        </span>
      ))}
      {remaining > 0 ? <span className="skill-chip more">+{remaining}</span> : null}
    </div>
  );
}

function aggregateSkills(journeySkills: SkillUsage[] | undefined, events: TimelineEvent[]) {
  return dedupeSkills([...(journeySkills ?? []), ...events.flatMap((event) => event.skills ?? [])]);
}

function filterProjectsByProvider(projects: ProjectWithSessions[], provider: ProjectProviderFilter) {
  if (provider === "all") return projects;
  return projects.filter((project) => project.sessions.some((session) => session.provider === provider || session.id.startsWith(`${provider}:`)));
}

function providerSummary(project: ProjectWithSessions) {
  const providers = new Set(project.sessions.map((session) => session.provider ?? providerFromSessionId(session.id)));
  if (providers.size === 0) return "No provider";
  return [...providers].map(labelForProvider).join("+");
}

function dedupeSkills(skills: SkillUsage[]) {
  const byName = new Map<string, SkillUsage>();
  for (const skill of skills) {
    if (!byName.has(skill.name)) byName.set(skill.name, skill);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function formatSkillNames(skills: SkillUsage[]) {
  return dedupeSkills(skills).map((skill) => skill.name).join(", ");
}

function formatExitType(exitType: TaskJourney["exitType"]) {
  return exitType === "next_prompt" ? "Next input" : "Session end";
}

function providerFromSessionId(sessionId: string) {
  if (sessionId.startsWith("claude-code:")) return "claude-code";
  if (sessionId.startsWith("opencode:")) return "opencode";
  return "codex";
}

function labelForProvider(provider: string) {
  if (provider === "claude-code") return "Claude Code";
  if (provider === "opencode") return "OpenCode";
  return "Codex CLI";
}

function avatarForProvider(provider: string) {
  if (provider === "claude-code") return "CC";
  if (provider === "opencode") return "OC";
  return "C";
}

function Metric({ label, value, action, overlay }: { label: string; value: number; action?: ReactNode; overlay?: ReactNode }) {
  return (
    <div className="metric">
      <span>
        {label}
        {action}
      </span>
      <strong>{formatMetricValue(label, value)}</strong>
      {overlay}
    </div>
  );
}

function RatioMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function BlockingLoader({ message, job }: { message: string; job?: IngestJob | null }) {
  return (
    <div className="blocking-loader" role="status" aria-live="polite" aria-label="Blocking operation">
      <div className="blocking-loader-card">
        <div className="blocking-loader-message">
          <span className="blocking-loader-icon" aria-hidden="true" />
          <div>
            <strong>{message}</strong>
            <span>Keeping the workspace steady while SuperView updates.</span>
          </div>
        </div>
        {job ? <IngestLevelProgress job={job} /> : null}
      </div>
    </div>
  );
}

function EmptyState({
  title,
  detail,
  agentProvider,
  onAgentProviderChange,
  agentLogRoot,
  onAgentLogRootChange,
  onScan,
  disabled = false
}: {
  title: string;
  detail: string;
  agentProvider: AgentProvider;
  onAgentProviderChange: (value: AgentProvider) => void;
  agentLogRoot: string;
  onAgentLogRootChange: (value: string) => void;
  onScan: () => void;
  disabled?: boolean;
}) {
  return (
    <section className="empty-state">
      <Search size={34} />
      <h2>{title}</h2>
      <p>{detail}</p>
      <label className="empty-agent-provider">
        <span>Agent log source</span>
        <select aria-label="Empty agent log source" value={agentProvider} onChange={(event) => onAgentProviderChange(event.target.value as AgentProvider)} disabled={disabled}>
          <option value="codex">Codex</option>
          <option value="claude-code">Claude Code</option>
          <option value="opencode">OpenCode</option>
        </select>
      </label>
      <label className="empty-agent-root">
        <span>Agent log root path</span>
        <input aria-label="Empty agent log root path" value={agentLogRoot} onChange={(event) => onAgentLogRootChange(event.target.value)} placeholder="Blank scans default Codex logs" disabled={disabled} />
      </label>
      <button className="primary-button" onClick={onScan} disabled={disabled}>Scan Agent Logs</button>
    </section>
  );
}

function EvidenceDrawer({
  event,
  artifacts,
  rawEvent,
  loading
}: {
  event: TimelineEvent | null;
  artifacts: Artifact[];
  rawEvent: EventEvidence["rawEvent"];
  loading: boolean;
}) {
  return (
    <aside className="evidence-drawer">
      <div className="panel-heading">
        <FileText size={17} />
        <span>Evidence</span>
        {loading ? <em>Loading</em> : null}
      </div>
      {event ? (
        <>
          <div className={`status-badge ${event.status}`}>{formatEventKind(event.kind)}</div>
          <h2>{event.title}</h2>
          <dl>
            <dt>Kind</dt>
            <dd>{event.kind}</dd>
            <dt>Time</dt>
            <dd>{formatDate(event.timestamp)}</dd>
            {event.toolName ? <><dt>Tool</dt><dd>{event.toolName}</dd></> : null}
            {event.callId ? <><dt>Call</dt><dd>{event.callId}</dd></> : null}
          </dl>
          <pre>{event.detail ?? "No detail captured."}</pre>
          <h3>Artifacts</h3>
          {artifacts.length > 0 ? (
            artifacts.map((artifact) => (
              <div className="artifact" key={artifact.id}>
                <strong>{artifact.type}</strong>
                <small>{artifact.path ?? "Inline evidence"}</small>
                <pre>{artifact.excerpt}</pre>
              </div>
            ))
          ) : (
            <p className="muted">No artifacts attached to this event.</p>
          )}
          <h3>Raw Event</h3>
          {rawEvent ? (
            <div className="artifact">
              <strong>{rawEvent.type}</strong>
              <small>{rawEvent.sourcePath}:{rawEvent.lineNo}</small>
              <pre>{rawEvent.redactedPayloadJson}</pre>
            </div>
          ) : (
            <p className="muted">No raw event reference available.</p>
          )}
        </>
      ) : (
        <p className="muted">Select an episode, timeline event, or replay node to inspect redacted evidence.</p>
      )}
    </aside>
  );
}

function formatEventKind(kind: TimelineEvent["kind"]) {
  return kind.replace(/_/g, " ");
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatDuration(durationMs: number) {
  if (durationMs < 1000) return `${durationMs}ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

function formatKvHitRate(usage: TokenUsage) {
  if (usage.input <= 0) return "0.0%";
  return `${((usage.cachedInput / usage.input) * 100).toFixed(1)}%`;
}

function formatMetricValue(label: string, value: number) {
  return label === "Tokens" ? formatMillionTokens(value) : value.toLocaleString();
}

function isIngestBusy(job: IngestJob | null) {
  return job?.status === "queued" || job?.status === "running";
}

function getBlockingMessage({
  loading,
  timelineLoading,
  ingestBusy,
  dailyTokenUsageLoading
}: {
  loading: boolean;
  timelineLoading: boolean;
  ingestBusy: boolean;
  dailyTokenUsageLoading: boolean;
}) {
  if (ingestBusy) return "Scanning agent logs";
  if (timelineLoading) return "Loading timeline page";
  if (loading) return "Loading SuperView index";
  if (dailyTokenUsageLoading) return "Loading daily token usage";
  return null;
}

const ZERO_TOKEN_USAGE: TokenUsage = { input: 0, output: 0, reasoning: 0, cachedInput: 0, total: 0 };
