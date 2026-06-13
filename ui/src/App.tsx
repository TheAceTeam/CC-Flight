import { AlertTriangle, ChartColumn, ChevronDown, FileText, Languages, Moon, RotateCw, Search, Sun } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  AgentProvider,
  ContextBlock,
  ContextReplayResponse,
  ContextSnapshot,
  DailyTokenUsageResponse,
  IngestJob,
  ProjectTimeline,
  SkillUsage,
  TaskJourney,
  TaskJourneyDetail,
  TimelineEvent,
  TokenUsage
} from "../../core/types";
import {
  fetchContextReplay,
  fetchDailyTokenUsage,
  fetchIngestJob,
  fetchProjects,
  fetchTaskJourneyDetail,
  fetchTimeline,
  ProjectWithSessions,
  startIngest
} from "./api";
import { DailyTokenUsagePanel } from "./DailyTokenUsagePanel";
import { AppCopy, COPY, IngestCopy, Language, normalizeLanguage } from "./i18n";
import { IngestLevelProgress } from "./IngestLevelProgress";
import { formatMillionTokens } from "./tokenFormat";

type Theme = "light" | "dark";
type ProjectProviderFilter = AgentProvider | "all";
type MetricKey = "projects" | "events" | "tasks" | "tokens";
type ThreadDetailTab = "conversation" | "context";

const PROJECT_TIMELINE_LIMIT = 100000;

export function App() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("superview-theme") as Theme | null) ?? "light");
  const [language, setLanguage] = useState<Language>(() => normalizeLanguage(localStorage.getItem("superview-language")));
  const [projects, setProjects] = useState<ProjectWithSessions[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<ProjectTimeline | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [dailyTokenUsage, setDailyTokenUsage] = useState<DailyTokenUsageResponse | null>(null);
  const [dailyTokenUsageLoading, setDailyTokenUsageLoading] = useState(false);
  const [tokenChartExpanded, setTokenChartExpanded] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<TimelineEvent | null>(null);
  const [journeyDetails, setJourneyDetails] = useState<Record<string, TaskJourneyDetail>>({});
  const [journeyLoadingIds, setJourneyLoadingIds] = useState<Record<string, boolean>>({});
  const journeyLoadingRef = useRef(new Set<string>());
  const [contextReplays, setContextReplays] = useState<Record<string, ContextReplayResponse>>({});
  const [contextReplayLoadingIds, setContextReplayLoadingIds] = useState<Record<string, boolean>>({});
  const contextReplayLoadingRef = useRef(new Set<string>());
  const [expandedJourneyIds, setExpandedJourneyIds] = useState<Record<string, boolean>>({});
  const [job, setJob] = useState<IngestJob | null>(null);
  const [agentProvider, setAgentProvider] = useState<AgentProvider>("codex");
  const [projectProviderFilter, setProjectProviderFilter] = useState<ProjectProviderFilter>("all");
  const [agentLogRoot, setAgentLogRoot] = useState("");
  const [scanPanelOpen, setScanPanelOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const copy = COPY[language];

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("superview-theme", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = language;
    localStorage.setItem("superview-language", language);
  }, [language]);

  useEffect(() => {
    void loadProjects();
  }, []);

  useEffect(() => {
    if (!selectedProjectId) return;
    void loadTimeline(selectedProjectId);
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

  async function loadTimeline(projectId: string) {
    setTimelineLoading(true);
    try {
      const next = await fetchTimeline(projectId, { limit: PROJECT_TIMELINE_LIMIT, offset: 0 });
      setTimeline(next);
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

  async function handleScan() {
    if (isIngestBusy(job)) return;
    setScanPanelOpen(false);
    setError(null);
    try {
      const root = agentLogRoot.trim();
      const jobId = await startIngest(root ? { sources: [{ provider: agentProvider, root, path: root }] } : { sources: [{ provider: agentProvider }] });
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

  async function loadContextReplay(journeyId: string, projectId = selectedProjectId ?? undefined) {
    if (contextReplays[journeyId] || contextReplayLoadingRef.current.has(journeyId)) return;
    contextReplayLoadingRef.current.add(journeyId);
    setContextReplayLoadingIds((current) => ({ ...current, [journeyId]: true }));
    try {
      const replay = await fetchContextReplay(journeyId, projectId);
      setContextReplays((current) => ({ ...current, [journeyId]: replay }));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      contextReplayLoadingRef.current.delete(journeyId);
      setContextReplayLoadingIds((current) => ({ ...current, [journeyId]: false }));
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
  const totalEvents = timeline?.totalEvents ?? timeline?.events.length ?? 0;
  const projectTokenUsage = selectedProject?.tokenUsage ?? timeline?.tokenUsage ?? ZERO_TOKEN_USAGE;
  const ingestBusy = isIngestBusy(job);
  const blockingMessage = getBlockingMessage({ copy, loading, timelineLoading, ingestBusy, dailyTokenUsageLoading });
  const blockingJob = getBlockingJob({ job, message: blockingMessage, ingestBusy, loading, timelineLoading, dailyTokenUsageLoading });

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <strong>SuperView</strong>
          <span>{copy.brandSubtitle}</span>
        </div>
        <div className="topbar-actions">
          <div className="scan-dropdown">
            <button className="shell-button scan-dropdown-trigger" onClick={() => setScanPanelOpen((open) => !open)} disabled={ingestBusy} aria-expanded={scanPanelOpen} aria-controls="scan-agent-log-panel">
              <RotateCw size={16} />
              {copy.topbar.scan}
              <ChevronDown size={15} aria-hidden="true" />
            </button>
            {scanPanelOpen ? (
              <div className="scan-dropdown-panel" id="scan-agent-log-panel" role="region" aria-label={copy.topbar.scan}>
                <label className="agent-provider-control">
                  <span>{copy.topbar.source}</span>
                  <select aria-label={copy.topbar.sourceAria} value={agentProvider} onChange={(event) => setAgentProvider(event.target.value as AgentProvider)} disabled={ingestBusy}>
                    <option value="codex">Codex</option>
                    <option value="claude-code">Claude Code</option>
                    <option value="opencode">OpenCode</option>
                  </select>
                </label>
                <label className="agent-root-control">
                  <span>{copy.topbar.agentLogRoot}</span>
                  <input
                    aria-label={copy.topbar.agentLogRootAria}
                    value={agentLogRoot}
                    onChange={(event) => setAgentLogRoot(event.target.value)}
                    placeholder={copy.topbar.agentLogRootPlaceholder}
                    disabled={ingestBusy}
                  />
                </label>
                <button className="shell-button scan-dropdown-submit" onClick={handleScan} disabled={ingestBusy}>
                  <RotateCw size={16} />
                  {copy.topbar.scan}
                </button>
              </div>
            ) : null}
          </div>
          <button
            className="shell-button language-toggle-button"
            aria-label={copy.language.aria}
            title={copy.language.title}
            onClick={() => setLanguage((current) => (current === "en" ? "zh-CN" : "en"))}
          >
            <Languages size={16} />
            {copy.language.short}
          </button>
          <button className="icon-button" aria-label={copy.theme.aria} onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
            {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
          </button>
        </div>
      </header>

      <main className="workspace">
        <section className="title-row">
          <div>
            <p className="eyebrow">{copy.title.eyebrow}</p>
            <h1>{selectedProject?.name ?? copy.title.emptyProject}</h1>
            <p className="lead">{copy.title.lead}</p>
          </div>
          <div className="title-actions">
            <div className="project-controls-panel">
              <label className="project-control">
                <span className="field-label">{copy.projectControls.provider}</span>
                <select aria-label={copy.projectControls.providerAria} value={projectProviderFilter} onChange={(event) => setProjectProviderFilter(event.target.value as ProjectProviderFilter)} disabled={timelineLoading || ingestBusy}>
                  <option value="all">{copy.projectControls.all}</option>
                  <option value="codex">Codex</option>
                  <option value="claude-code">Claude Code</option>
                  <option value="opencode">OpenCode</option>
                </select>
              </label>
              <label className="project-control" htmlFor="project-select">
                <span className="field-label">{copy.projectControls.project}</span>
                <select id="project-select" aria-label={copy.projectControls.projectAria} value={selectedProjectId ?? ""} onChange={(event) => setSelectedProjectId(event.target.value)} disabled={filteredProjects.length === 0 || timelineLoading || ingestBusy}>
                  {filteredProjects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name} - {providerSummary(project, copy)} - {formatMillionTokens(project.tokenUsage.total)} {copy.timeline.tokens} / KV {formatKvHitRate(project.tokenUsage)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="status-cluster">
              <Metric metricKey="projects" label={copy.metrics.projects} value={filteredProjects.length} />
              <Metric metricKey="events" label={copy.metrics.events} value={totalEvents} />
              <Metric metricKey="tasks" label={copy.metrics.tasks} value={timeline?.taskJourneys.length ?? 0} />
              <Metric
                metricKey="tokens"
                label={copy.metrics.tokens}
                value={projectTokenUsage.total}
                action={
                  selectedProject ? (
                    <button
                      className="metric-icon-button"
                      type="button"
                      aria-label={tokenChartExpanded ? copy.metrics.hideDailyTokens : copy.metrics.showDailyTokens}
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
                      copy={copy.tokenChart}
                      data={dailyTokenUsage}
                      loading={dailyTokenUsageLoading}
                      title={copy.metrics.tokens}
                      subtitle={copy.metrics.dailyUsageByDay}
                      maxVisiblePoints={30}
                      className="token-chart-panel--metric-popover"
                      showHeaderToggle={false}
                      expanded={tokenChartExpanded}
                      onExpandedChange={setTokenChartExpanded}
                    />
                  ) : null
                }
              />
              <RatioMetric label={copy.metrics.kvHit} value={formatKvHitRate(projectTokenUsage)} />
            </div>
          </div>
        </section>

        {error ? <div className="alert"><AlertTriangle size={16} />{error}</div> : null}
        {job && !ingestBusy ? <IngestLevelProgress job={job} copy={copy.ingest} /> : null}
        {blockingMessage ? <BlockingLoader copy={copy.loading} ingestCopy={copy.ingest} message={blockingMessage} job={blockingJob} /> : null}

        {loading ? (
          <EmptyState
            copy={copy.empty}
            title={copy.empty.loadingTitle}
            detail={copy.empty.loadingDetail}
            agentProvider={agentProvider}
            onAgentProviderChange={setAgentProvider}
            agentLogRoot={agentLogRoot}
            onAgentLogRootChange={setAgentLogRoot}
            onScan={handleScan}
            disabled={ingestBusy}
            scanLabel={copy.topbar.scan}
            placeholder={copy.topbar.agentLogRootPlaceholder}
          />
        ) : projects.length === 0 ? (
          <EmptyState
            copy={copy.empty}
            title={copy.empty.noRunsTitle}
            detail={copy.empty.noRunsDetail}
            agentProvider={agentProvider}
            onAgentProviderChange={setAgentProvider}
            agentLogRoot={agentLogRoot}
            onAgentLogRootChange={setAgentLogRoot}
            onScan={handleScan}
            disabled={ingestBusy}
            scanLabel={copy.topbar.scan}
            placeholder={copy.topbar.agentLogRootPlaceholder}
          />
        ) : filteredProjects.length === 0 ? (
          <EmptyState
            copy={copy.empty}
            title={copy.empty.noProviderTitle}
            detail={copy.empty.noProviderDetail}
            agentProvider={agentProvider}
            onAgentProviderChange={setAgentProvider}
            agentLogRoot={agentLogRoot}
            onAgentLogRootChange={setAgentLogRoot}
            onScan={handleScan}
            disabled={ingestBusy}
            scanLabel={copy.topbar.scan}
            placeholder={copy.topbar.agentLogRootPlaceholder}
          />
        ) : (
          <div className="dashboard-grid conversation-dashboard-grid">
            <section className="timeline-panel">
              <div className="panel-heading">
                <FileText size={17} />
                <span>{copy.timeline.heading}</span>
              </div>
              <ConversationThread
                copy={copy.timeline}
                journeys={journeys}
                detailsByJourneyId={journeyDetails}
                contextReplaysByJourneyId={contextReplays}
                timelineEventsById={timelineEventsById}
                expandedJourneyIds={expandedJourneyIds}
                loadingJourneyIds={journeyLoadingIds}
                loadingContextReplayIds={contextReplayLoadingIds}
                selectedEventId={selectedEvent?.id ?? null}
                onToggleDetails={toggleJourneyDetails}
                onLoadContextReplay={(journeyId) => loadContextReplay(journeyId)}
                onSelectEvent={(event) => setSelectedEvent(event)}
              />
            </section>
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

function groupContextBlocks(blocks: ContextBlock[]) {
  return {
    added: blocks.filter((block) => block.state === "new"),
    active: blocks.filter((block) => block.state === "retained" || block.state === "cited"),
    changed: blocks.filter((block) => block.state === "changed" || block.state === "contradicted"),
    dropped: blocks.filter((block) => block.state === "dropped" || block.state === "stale")
  };
}

function buildBlockOriginSteps(snapshots: ContextSnapshot[]) {
  const steps = new Map<string, number>();
  snapshots.forEach((snapshot, snapshotIndex) => {
    for (const block of snapshot.blocks) {
      if (!steps.has(block.id)) steps.set(block.id, snapshotIndex + 1);
    }
  });
  return steps;
}

function ConversationThread({
  copy,
  journeys,
  detailsByJourneyId,
  contextReplaysByJourneyId,
  timelineEventsById,
  expandedJourneyIds,
  loadingJourneyIds,
  loadingContextReplayIds,
  selectedEventId,
  onToggleDetails,
  onLoadContextReplay,
  onSelectEvent
}: {
  copy: AppCopy["timeline"];
  journeys: TaskJourney[];
  detailsByJourneyId: Record<string, TaskJourneyDetail>;
  contextReplaysByJourneyId: Record<string, ContextReplayResponse>;
  timelineEventsById: Map<string, TimelineEvent>;
  expandedJourneyIds: Record<string, boolean>;
  loadingJourneyIds: Record<string, boolean>;
  loadingContextReplayIds: Record<string, boolean>;
  selectedEventId: string | null;
  onToggleDetails: (journeyId: string) => void;
  onLoadContextReplay: (journeyId: string) => void;
  onSelectEvent: (event: TimelineEvent) => void;
}) {
  const orderedJourneys = useMemo(() => [...journeys].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)), [journeys]);
  const [selectedJourneyId, setSelectedJourneyId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<ThreadDetailTab>("context");
  const selectedJourney = orderedJourneys.find((journey) => journey.id === selectedJourneyId) ?? orderedJourneys[0] ?? null;

  useEffect(() => {
    if (orderedJourneys.length === 0) {
      setSelectedJourneyId(null);
      return;
    }
    setSelectedJourneyId((current) => (current && orderedJourneys.some((journey) => journey.id === current) ? current : orderedJourneys[0].id));
  }, [orderedJourneys]);

  useEffect(() => {
    if (detailTab === "context" && selectedJourney) {
      onLoadContextReplay(selectedJourney.id);
    }
  }, [detailTab, onLoadContextReplay, selectedJourney]);

  useEffect(() => {
    function shouldIgnoreShortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName.toLowerCase();
      return event.altKey
        || event.ctrlKey
        || event.metaKey
        || tagName === "input"
        || tagName === "textarea"
        || tagName === "select"
        || Boolean(target?.isContentEditable);
    }

    function handleJourneyKeyDown(event: KeyboardEvent) {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      if (shouldIgnoreShortcut(event)) return;
      if (orderedJourneys.length === 0) return;
      const currentIndex = orderedJourneys.findIndex((journey) => journey.id === selectedJourney?.id);
      const baseIndex = currentIndex < 0 ? 0 : currentIndex;
      const lastIndex = orderedJourneys.length - 1;
      const nextIndex = event.key === "ArrowDown"
        ? Math.min(lastIndex, baseIndex + 1)
        : Math.max(0, baseIndex - 1);
      if (nextIndex === currentIndex) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      setSelectedJourneyId(orderedJourneys[nextIndex].id);
    }

    document.addEventListener("keydown", handleJourneyKeyDown);
    return () => document.removeEventListener("keydown", handleJourneyKeyDown);
  }, [orderedJourneys, selectedJourney]);

  if (journeys.length === 0) {
    return <p className="muted">{copy.emptyPage}</p>;
  }

  return (
    <div className="conversation-thread conversation-master-detail" aria-label={copy.aria}>
      <aside className="conversation-master" aria-label={copy.masterAria}>
        <div className="conversation-master-heading">
          <span>{copy.masterTitle}</span>
          <strong>{orderedJourneys.length}</strong>
        </div>
        <div className="conversation-master-list">
          {orderedJourneys.map((journey) => (
            <ConversationMasterItem
              key={journey.id}
              copy={copy}
              journey={journey}
              fallbackPrompt={timelineEventsById.get(journey.promptEventId) ?? null}
              active={journey.id === selectedJourney?.id}
              loading={Boolean(loadingJourneyIds[journey.id])}
              onSelect={() => setSelectedJourneyId(journey.id)}
            />
          ))}
        </div>
      </aside>

      <section className="conversation-detail-pane" aria-label={copy.detailsAria}>
        <div className="conversation-detail-heading">
          <span>{copy.detailsTitle}</span>
          <strong>{selectedJourney?.title ?? copy.emptySelection}</strong>
        </div>
        <div className="thread-detail-tabs" role="tablist" aria-label={copy.detailTabsAria}>
          <button type="button" role="tab" aria-selected={detailTab === "context"} className={detailTab === "context" ? "active" : ""} onClick={() => setDetailTab("context")}>
            {copy.contextReplayTab}
          </button>
          <button type="button" role="tab" aria-selected={detailTab === "conversation"} className={detailTab === "conversation" ? "active" : ""} onClick={() => setDetailTab("conversation")}>
            {copy.conversationTab}
          </button>
        </div>
        {selectedJourney ? (
          detailTab === "context" ? (
            <ContextReplayPanel
              copy={copy}
              replay={contextReplaysByJourneyId[selectedJourney.id] ?? null}
              loading={Boolean(loadingContextReplayIds[selectedJourney.id])}
            />
          ) : (
            <ConversationTurn
              key={selectedJourney.id}
              copy={copy}
              journey={selectedJourney}
              detail={detailsByJourneyId[selectedJourney.id] ?? null}
              fallbackPrompt={timelineEventsById.get(selectedJourney.promptEventId) ?? null}
              expanded={Boolean(expandedJourneyIds[selectedJourney.id])}
              loading={Boolean(loadingJourneyIds[selectedJourney.id])}
              selectedEventId={selectedEventId}
              onToggleDetails={() => onToggleDetails(selectedJourney.id)}
              onSelectEvent={onSelectEvent}
            />
          )
        ) : (
          <p className="muted">{copy.emptySelection}</p>
        )}
      </section>
    </div>
  );
}

function ConversationMasterItem({
  copy,
  journey,
  fallbackPrompt,
  active,
  loading,
  onSelect
}: {
  copy: AppCopy["timeline"];
  journey: TaskJourney;
  fallbackPrompt: TimelineEvent | null;
  active: boolean;
  loading: boolean;
  onSelect: () => void;
}) {
  const promptText = fallbackPrompt?.detail ?? journey.title;
  return (
    <button type="button" className={`conversation-master-item ${journey.status} ${active ? "active" : ""}`} aria-current={active ? "true" : undefined} onClick={onSelect}>
      <span>{formatDate(journey.startedAt, copy)}</span>
      <strong>{promptText}</strong>
      <em>
        {formatDuration(journey.durationMs)} · {formatMillionTokens(journey.tokenUsage.total)} {copy.tokens} · {copy.kvHit} {formatKvHitRate(journey.tokenUsage)}
      </em>
      {loading ? <small>{copy.loadingDetails}</small> : null}
    </button>
  );
}

function ContextReplayPanel({ copy, replay, loading }: { copy: AppCopy["timeline"]; replay: ContextReplayResponse | null; loading: boolean }) {
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const snapshotButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const ledgerContainerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const header = headerRef.current;
    const panel = panelRef.current;
    if (!header || !panel) return;
    const apply = () => {
      panel.style.setProperty("--replay-header-height", `${header.offsetHeight}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(header);
    return () => observer.disconnect();
  }, [replay]);

  function handleSelectBlock(id: string) {
    setSelectedBlockId(id);
    requestAnimationFrame(() => {
      const card = ledgerContainerRef.current?.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
      card?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }
  useEffect(() => {
    setSelectedSnapshotId(replay?.snapshots[0]?.id ?? null);
    setSelectedBlockId(null);
  }, [replay?.journey.id]);

  const activeSnapshot = replay?.snapshots.find((snapshot) => snapshot.id === selectedSnapshotId) ?? replay?.snapshots[0] ?? null;
  const activeSnapshotIndex = replay && activeSnapshot ? Math.max(0, replay.snapshots.findIndex((snapshot) => snapshot.id === activeSnapshot.id)) : -1;
  const groups = useMemo(() => groupContextBlocks(activeSnapshot?.blocks ?? []), [activeSnapshot]);
  const blockOriginSteps = useMemo(() => buildBlockOriginSteps(replay?.snapshots ?? []), [replay]);
  const selectedBlock = activeSnapshot?.blocks.find((block) => block.id === selectedBlockId) ?? activeSnapshot?.blocks[0] ?? null;

  function activateSnapshot(index: number, shouldFocus = false) {
    if (!replay?.snapshots.length) return;
    const nextSnapshot = replay.snapshots[index];
    if (!nextSnapshot) return;
    setSelectedSnapshotId(nextSnapshot.id);
    if (shouldFocus) {
      requestAnimationFrame(() => {
        const button = snapshotButtonRefs.current[nextSnapshot.id];
        button?.focus();
        button?.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
    }
  }

  function nextSnapshotIndexForKey(key: string) {
    if (!replay?.snapshots.length || activeSnapshotIndex < 0) return null;
    const lastIndex = replay.snapshots.length - 1;
    if (key === "ArrowRight") return Math.min(lastIndex, activeSnapshotIndex + 1);
    if (key === "ArrowLeft") return Math.max(0, activeSnapshotIndex - 1);
    if (key === "Home") return 0;
    if (key === "End") return lastIndex;
    return null;
  }

  function handleSnapshotKeyDown(event: React.KeyboardEvent) {
    const nextIndex = nextSnapshotIndexForKey(event.key);
    if (nextIndex === null) return;
    event.preventDefault();
    event.stopPropagation();
    activateSnapshot(nextIndex, true);
  }

  useEffect(() => {
    setSelectedSnapshotId((current) => {
      if (!replay?.snapshots.length) return null;
      return current && replay.snapshots.some((snapshot) => snapshot.id === current) ? current : replay.snapshots.at(-1)?.id ?? null;
    });
  }, [replay]);

  useEffect(() => {
    setSelectedBlockId((current) => {
      if (!activeSnapshot?.blocks.length) return null;
      return current && activeSnapshot.blocks.some((block) => block.id === current) ? current : activeSnapshot.blocks[0].id;
    });
  }, [activeSnapshot]);

  useEffect(() => {
    function shouldIgnoreShortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName.toLowerCase();
      return event.altKey
        || event.ctrlKey
        || event.metaKey
        || tagName === "input"
        || tagName === "textarea"
        || tagName === "select"
        || Boolean(target?.isContentEditable);
    }

    function handleGlobalKeyDown(event: KeyboardEvent) {
      if (shouldIgnoreShortcut(event)) return;
      const nextIndex = nextSnapshotIndexForKey(event.key);
      if (nextIndex !== null) {
        if (nextIndex === activeSnapshotIndex) return;
        event.preventDefault();
        activateSnapshot(nextIndex, true);
        return;
      }

      const blocks = activeSnapshot?.blocks ?? [];
      if (blocks.length === 0) return;
      const lowered = event.key.toLowerCase();
      const isPrev = lowered === "a" || lowered === "w";
      const isNext = lowered === "d" || lowered === "s";
      if (!isPrev && !isNext) return;
      const currentBlockIndex = blocks.findIndex((block) => block.id === selectedBlockId);
      const baseIndex = currentBlockIndex < 0 ? 0 : currentBlockIndex;
      const lastIndex = blocks.length - 1;
      const nextBlockIndex = isNext
        ? Math.min(lastIndex, baseIndex + 1)
        : Math.max(0, baseIndex - 1);
      event.preventDefault();
      if (nextBlockIndex === currentBlockIndex) return;
      handleSelectBlock(blocks[nextBlockIndex].id);
    }

    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, [activeSnapshotIndex, replay, activeSnapshot, selectedBlockId]);

  if (loading && !replay) {
    return (
      <section className="context-replay-panel" aria-label={copy.contextReplayLedgerAria}>
        <div className="context-replay-loading">{copy.contextReplayLoading}</div>
      </section>
    );
  }

  if (!replay || !activeSnapshot) {
    return (
      <section className="context-replay-panel" aria-label={copy.contextReplayLedgerAria}>
        <p className="muted">{copy.contextReplayEmpty}</p>
      </section>
    );
  }

  return (
    <section ref={panelRef} className="context-replay-panel" aria-label={copy.contextReplayLedgerAria}>
      <div ref={headerRef} className="context-replay-header">
        <div className="context-replay-summary">
          <div>
            <span>{copy.contextReplayTab}</span>
            <strong>{replay.journey.title}</strong>
            <p>{copy.contextReplayObserved}</p>
          </div>
          <div className="context-replay-metrics" role="group" aria-label={copy.contextReplayLedgerAria}>
            <div className="context-replay-metric">
              <span>{copy.contextReplayInput}</span>
              <strong>{activeSnapshot.tokenUsage ? formatMillionTokens(activeSnapshot.tokenUsage.input) : "—"}</strong>
            </div>
            <div className="context-replay-metric">
              <span>{copy.contextReplayOutput}</span>
              <strong>{activeSnapshot.tokenUsage ? formatMillionTokens(activeSnapshot.tokenUsage.output) : "—"}</strong>
            </div>
            <div className="context-replay-metric">
              <span>{copy.contextReplayTokenUsage}</span>
              <strong>{activeSnapshot.tokenUsage ? formatMillionTokens(activeSnapshot.tokenUsage.total) : "—"}</strong>
            </div>
            <div className="context-replay-metric">
              <span>{copy.contextReplayBlocks}</span>
              <strong>{replay.blocks.length}</strong>
            </div>
          </div>
        </div>

        <div className="context-snapshot-rail" aria-label={copy.contextReplaySnapshotRail}>
          {replay.snapshots.map((snapshot, index) => (
            <button
              key={snapshot.id}
              ref={(button) => {
                snapshotButtonRefs.current[snapshot.id] = button;
              }}
              type="button"
              className={snapshot.id === activeSnapshot.id ? "active" : ""}
              aria-current={snapshot.id === activeSnapshot.id ? "step" : undefined}
              aria-label={`${copy.contextReplayStep} ${index + 1}: ${snapshot.title}`}
              tabIndex={snapshot.id === activeSnapshot.id ? 0 : -1}
              onClick={() => activateSnapshot(index)}
              onKeyDown={handleSnapshotKeyDown}
            >
              <b className="context-snapshot-index">{index + 1}</b>
              <span>{snapshot.phase}</span>
              <strong>{snapshot.title}</strong>
              <em>+{snapshot.addedBlockIds.length} / -{snapshot.droppedBlockIds.length}</em>
            </button>
          ))}
        </div>

        <span className="hotkey-hint" aria-hidden="true">{copy.hotkeyHint}</span>
      </div>

      <div className="context-replay-workspace">
        <div className="context-ledger-groups" ref={ledgerContainerRef}>
          {activeSnapshot.warnings.length > 0 || replay.warnings.length > 0 ? (
            <div className="context-warning-strip" aria-label={copy.contextReplayWarnings}>
              {(activeSnapshot.warnings.length > 0 ? activeSnapshot.warnings : replay.warnings).map((warning) => (
                <button
                  type="button"
                  className={`context-warning ${warning.severity}`}
                  key={warning.id}
                  disabled={warning.blockIds.length === 0}
                  onClick={() => warning.blockIds[0] && handleSelectBlock(warning.blockIds[0])}
                  title={warning.blockIds.length > 0 ? copy.contextReplayWarningJump : undefined}
                >
                  <span>{warning.severity}</span>
                  <strong>{warning.title}</strong>
                  <p>{warning.detail}</p>
                </button>
              ))}
            </div>
          ) : null}
          <ContextBlockGroup copy={copy} title={copy.contextReplayActiveContext} blocks={groups.active} blockOriginSteps={blockOriginSteps} selectedBlockId={selectedBlock?.id ?? null} onSelectBlock={setSelectedBlockId} />
          <ContextBlockGroup copy={copy} title={copy.contextReplayAdded} blocks={groups.added} blockOriginSteps={blockOriginSteps} selectedBlockId={selectedBlock?.id ?? null} onSelectBlock={setSelectedBlockId} />
          <ContextBlockGroup copy={copy} title={copy.contextReplayChanged} blocks={groups.changed} blockOriginSteps={blockOriginSteps} selectedBlockId={selectedBlock?.id ?? null} onSelectBlock={setSelectedBlockId} />
          <ContextBlockGroup copy={copy} title={copy.contextReplayDropped} blocks={groups.dropped} blockOriginSteps={blockOriginSteps} selectedBlockId={selectedBlock?.id ?? null} onSelectBlock={setSelectedBlockId} />
        </div>
        <MiniScene
          copy={copy}
          blocks={activeSnapshot.blocks}
          warnings={activeSnapshot.warnings}
          blockOriginSteps={blockOriginSteps}
          selectedBlockId={selectedBlock?.id ?? null}
          onSelectBlock={handleSelectBlock}
        />
      </div>
    </section>
  );
}

function ContextBlockGroup({
  copy,
  title,
  blocks,
  blockOriginSteps,
  selectedBlockId,
  onSelectBlock
}: {
  copy: AppCopy["timeline"];
  title: string;
  blocks: ContextBlock[];
  blockOriginSteps: Map<string, number>;
  selectedBlockId: string | null;
  onSelectBlock: (blockId: string) => void;
}) {
  if (blocks.length === 0) return null;
  return (
    <section className="context-block-group">
      <div className="context-block-group-heading">
        <span>{title}</span>
        <em>{blocks.length}</em>
      </div>
      <div className="context-block-list">
        {blocks.map((block) => (
          <button
            key={block.id}
            type="button"
            data-block-id={block.id}
            className={`context-block-card ${block.state} ${block.id === selectedBlockId ? "active" : ""}`}
            aria-pressed={block.id === selectedBlockId}
            onClick={() => onSelectBlock(block.id)}
          >
            <div className="context-block-card-heading">
              <b>{blockOriginSteps.get(block.id) ?? 1}</b>
              <span>{block.state}</span>
              <em>{block.type}</em>
              <em>{copy.contextReplayFromStep(blockOriginSteps.get(block.id) ?? 1)}</em>
            </div>
            <strong>{block.title}</strong>
            <p>{block.excerpt}</p>
            <div className="context-block-meta">
              <span>{copy.contextReplaySource}: {block.sourcePath ?? block.sourceEventId ?? "inferred"}</span>
              <span>{copy.contextReplayTokens}: {block.tokenEstimate}</span>
            </div>
            <small>{copy.contextReplayReason}: {block.reason}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function isRetiredContextState(state: ContextBlock["state"]) {
  return state === "dropped" || state === "stale" || state === "contradicted";
}

function MiniScene({
  copy,
  blocks,
  warnings,
  blockOriginSteps,
  selectedBlockId,
  onSelectBlock
}: {
  copy: AppCopy["timeline"];
  blocks: ContextBlock[];
  warnings: ContextSnapshot["warnings"];
  blockOriginSteps: Map<string, number>;
  selectedBlockId: string | null;
  onSelectBlock: (blockId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevPositions = useRef<Map<string, { x: number; y: number }>>(new Map());
  const lastBlocksRef = useRef<ContextBlock[]>(blocks);

  const { active, retired } = useMemo(() => {
    const activeBlocks: ContextBlock[] = [];
    const retiredBlocks: ContextBlock[] = [];
    for (const block of blocks) {
      if (isRetiredContextState(block.state)) retiredBlocks.push(block);
      else activeBlocks.push(block);
    }
    return { active: activeBlocks, retired: retiredBlocks };
  }, [blocks]);

  // Capture positions DURING RENDER, before React commits the new DOM.
  // At this point, the DOM still reflects the previous render — exactly what we need
  // for FLIP. This runs synchronously every render but only reads DOM when blocks change.
  if (lastBlocksRef.current !== blocks) {
    const container = containerRef.current;
    if (container) {
      const positions = new Map<string, { x: number; y: number }>();
      const rect = container.getBoundingClientRect();
      for (const dot of container.querySelectorAll<HTMLElement>(".context-flow-dot")) {
        const blockId = dot.dataset.blockId;
        if (!blockId) continue;
        const dotRect = dot.getBoundingClientRect();
        positions.set(blockId, {
          x: dotRect.left - rect.left,
          y: dotRect.top - rect.top
        });
      }
      prevPositions.current = positions;
    }
    lastBlocksRef.current = blocks;
  }

  // After DOM commit, FLIP animate dots from old positions to new positions
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || prevPositions.current.size === 0) return;

    const rect = container.getBoundingClientRect();
    const prevIds = new Set(prevPositions.current.keys());
    const nextIds = new Set<string>();

    const movingDots: HTMLElement[] = [];
    for (const dot of container.querySelectorAll<HTMLElement>(".context-flow-dot")) {
      const blockId = dot.dataset.blockId!;
      nextIds.add(blockId);
      const prev = prevPositions.current.get(blockId);
      if (!prev) continue;

      const dotRect = dot.getBoundingClientRect();
      const newX = dotRect.left - rect.left;
      const newY = dotRect.top - rect.top;
      const dx = prev.x - newX;
      const dy = prev.y - newY;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;

      dot.classList.add("moving");
      dot.style.transition = "none";
      dot.style.transform = `translate(${dx}px, ${dy}px)`;
      movingDots.push(dot);
    }

    if (movingDots.length > 0) container.offsetHeight;

    requestAnimationFrame(() => {
      for (const dot of movingDots) {
        dot.style.transition = "";
      }
      if (movingDots.length > 0) container.offsetHeight;
      for (const dot of movingDots) {
        dot.style.transform = "";
      }
    });

    // Animate exiting dots (present in prev but not in next)
    for (const id of prevIds) {
      if (nextIds.has(id)) continue;
      const prev = prevPositions.current.get(id);
      if (!prev) continue;
      const exitingDot = document.createElement("button");
      exitingDot.type = "button";
      exitingDot.className = "context-flow-dot exiting";
      exitingDot.dataset.blockId = id;
      exitingDot.style.position = "absolute";
      exitingDot.style.left = `${prev.x}px`;
      exitingDot.style.top = `${prev.y}px`;
      exitingDot.innerHTML = "<span>×</span>";
      container.appendChild(exitingDot);
      exitingDot.offsetHeight;
      exitingDot.style.transition = "";
      exitingDot.style.transform = "translateY(28px)";
      setTimeout(() => exitingDot.remove(), 520);
    }
  }, [blocks]);

  return (
    <div ref={containerRef} className="context-mini-scene" aria-label={copy.contextReplayMiniSceneAria}>
      <MiniSceneLane
        kind="active"
        label={copy.contextReplayLaneActive}
        blocks={active}
        blockOriginSteps={blockOriginSteps}
        selectedBlockId={selectedBlockId}
        onSelectBlock={onSelectBlock}
        copy={copy}
      />
      <MiniSceneLane
        kind="retired"
        label={copy.contextReplayLaneRetired}
        blocks={retired}
        blockOriginSteps={blockOriginSteps}
        selectedBlockId={selectedBlockId}
        onSelectBlock={onSelectBlock}
        copy={copy}
      />
      <div className="context-mini-scene-section warnings">
        <div className="context-mini-scene-lane">
          <span>{copy.contextReplayLaneWarnings}</span>
          <em>{warnings.length}</em>
        </div>
        {warnings.length > 0 ? (
          <div className="context-mini-scene-warnings">
            {warnings.map((warning) => (
              <span
                key={warning.id}
                className={`context-mini-scene-warning ${warning.severity}`}
                title={`${warning.title} — ${warning.detail}`}
              >
                {warning.severity}
              </span>
            ))}
          </div>
        ) : (
          <p className="context-mini-scene-empty">—</p>
        )}
      </div>
    </div>
  );
}

function MiniSceneLane({
  kind,
  label,
  blocks,
  blockOriginSteps,
  selectedBlockId,
  onSelectBlock,
  copy
}: {
  kind: "active" | "retired";
  label: string;
  blocks: ContextBlock[];
  blockOriginSteps: Map<string, number>;
  selectedBlockId: string | null;
  onSelectBlock: (blockId: string) => void;
  copy: AppCopy["timeline"];
}) {
  return (
    <div className={`context-mini-scene-section ${kind}`}>
      <div className="context-mini-scene-lane">
        <span>{label}</span>
        <em>{blocks.length}</em>
      </div>
      {blocks.length > 0 ? (
        <div className="context-mini-scene-dots">
          {blocks.map((block, index) => (
            <FlowDot
              key={block.id}
              block={block}
              active={block.id === selectedBlockId}
              originStep={blockOriginSteps.get(block.id) ?? 1}
              onSelect={() => onSelectBlock(block.id)}
              copy={copy}
              index={index}
            />
          ))}
        </div>
      ) : (
        <p className="context-mini-scene-empty">—</p>
      )}
    </div>
  );
}

function FlowDot({
  block,
  active,
  originStep,
  onSelect,
  copy,
  index
}: {
  block: ContextBlock;
  active: boolean;
  originStep: number;
  onSelect: () => void;
  copy: AppCopy["timeline"];
  index: number;
}) {
  return (
    <button
      type="button"
      data-block-id={block.id}
      className={`context-flow-dot state-${block.state}${active ? " active" : ""}`}
      style={{ "--dot-index": index } as React.CSSProperties}
      onClick={onSelect}
      title={`${block.title} · ${block.state} · ${copy.contextReplayFromStep(originStep)}`}
      aria-pressed={active}
      aria-label={`${block.title} (${block.state}, ${copy.contextReplayFromStep(originStep)})`}
    >
      <span>{originStep}</span>
    </button>
  );
}

function ConversationTurn({
  copy,
  journey,
  detail,
  fallbackPrompt,
  expanded,
  loading,
  selectedEventId,
  onToggleDetails,
  onSelectEvent
}: {
  copy: AppCopy["timeline"];
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
          <span>{copy.eventCount(journey.eventIds.length)}</span>
          <span>{formatExitType(journey.exitType, copy)}</span>
          <span>{formatDuration(journey.durationMs)}</span>
          <span>{formatMillionTokens(journey.tokenUsage.total)} {copy.tokens}</span>
          <span>{copy.kvHit} {formatKvHitRate(journey.tokenUsage)}</span>
          {loading ? <span>{copy.loadingDetails}</span> : null}
        </div>
      </div>

      <ChatBubble
        copy={copy}
        variant="user"
        label={copy.user}
        text={promptText}
        skills={skills}
        selected={prompt?.id === selectedEventId}
        disabled={!prompt}
        onSelect={() => (prompt ? onSelectEvent(prompt) : undefined)}
      />

      <div className="message-row codex detail-message-row">
        <span className="message-avatar" aria-hidden="true">{avatarForProvider(provider)}</span>
        <div className="message-stack">
          <button className="conversation-message codex detail-toggle" onClick={onToggleDetails}>
            <span className="message-meta">{copy.agentWork}</span>
            <span>{expanded ? copy.hideProcess : copy.viewProcess}</span>
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="background-details">
          <section>
            <div className="detail-section-heading">
              <span>{copy.backgroundWork}</span>
              <em>{backgroundEvents.length} {copy.entries}</em>
            </div>
            <div className="log-list">
              {backgroundEvents.length > 0 ? (
                backgroundEvents.map((event) => (
                  <button key={event.id} className={eventItemClass(event, selectedEventId)} data-event-id={event.id} onClick={() => onSelectEvent(event)}>
                    <span>{event.kind}</span>
                    <strong>{event.title}</strong>
                    {event.skills && event.skills.length > 0 ? <small>{copy.skills}: {formatSkillNames(event.skills)}</small> : null}
                    <small>{event.detail ?? formatDate(event.timestamp, copy)}</small>
                  </button>
                ))
              ) : (
                <p className="muted">{copy.noBackground}</p>
              )}
            </div>
          </section>

          <section>
            <div className="detail-section-heading">
              <span>{copy.log}</span>
              <em>{logEvents.length} {copy.entries}</em>
            </div>
            <div className="log-list compact">
              {logEvents.length > 0 ? (
                logEvents.map((event) => (
                  <button key={event.id} className={eventItemClass(event, selectedEventId)} data-event-id={event.id} onClick={() => onSelectEvent(event)}>
                    <span>{event.toolName ?? event.kind}</span>
                    <strong>{event.title}</strong>
                    {event.skills && event.skills.length > 0 ? <small>{copy.skills}: {formatSkillNames(event.skills)}</small> : null}
                    <small>{event.detail ?? event.callId ?? formatDate(event.timestamp, copy)}</small>
                  </button>
                ))
              ) : (
                <p className="muted">{copy.noLog}</p>
              )}
            </div>
          </section>
        </div>
      ) : null}

      <ChatBubble
        copy={copy}
        variant="codex"
        label={agentLabel}
        text={agentOutput}
        skills={skills}
        selected={assistantMessage?.id === selectedEventId}
        disabled={!assistantMessage}
        onSelect={() => (assistantMessage ? onSelectEvent(assistantMessage) : undefined)}
      />
    </article>
  );
}

function ChatBubble({
  copy,
  variant,
  label,
  title,
  text,
  skills = [],
  selected,
  disabled,
  onSelect
}: {
  copy: AppCopy["timeline"];
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
          {skills.length > 0 ? <SkillChips copy={copy} skills={skills} /> : null}
          {canExpand && !expanded ? <span className="message-fade" aria-hidden="true" /> : null}
        </button>
        {canExpand ? (
          <button className="message-expand-toggle" onClick={() => setExpanded((current) => !current)}>
            {expanded ? copy.collapse : copy.expand}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SkillChips({ copy, skills }: { copy: AppCopy["timeline"]; skills: SkillUsage[] }) {
  const uniqueSkills = dedupeSkills(skills);
  const visibleSkills = uniqueSkills.slice(0, 4);
  const remaining = Math.max(0, uniqueSkills.length - visibleSkills.length);
  return (
    <div className="skill-chip-row" aria-label={`${copy.skills}: ${formatSkillNames(skills)}`}>
      <span className="skill-chip-label">{copy.skills}</span>
      {visibleSkills.map((skill) => (
        <span className="skill-chip" title={skill.excerpt || skill.path || skill.source} key={`${skill.name}-${skill.source}-${skill.path ?? ""}`}>
          {skill.name}
        </span>
      ))}
      {remaining > 0 ? <span className="skill-chip more">+{remaining}</span> : null}
    </div>
  );
}

function Metric({ metricKey, label, value, action, overlay }: { metricKey: MetricKey; label: string; value: number; action?: ReactNode; overlay?: ReactNode }) {
  return (
    <div className="metric">
      <span>
        {label}
        {action}
      </span>
      <strong>{formatMetricValue(metricKey, value)}</strong>
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

function BlockingLoader({ copy, ingestCopy, message, job }: { copy: AppCopy["loading"]; ingestCopy: IngestCopy; message: string; job?: IngestJob | null }) {
  return (
    <div className="blocking-loader" role="status" aria-live="polite" aria-label={copy.aria}>
      <div className="blocking-loader-card">
        <div className="blocking-loader-message">
          <span className="blocking-loader-icon" aria-hidden="true" />
          <div>
            <strong>{message}</strong>
            <span>{copy.steady}</span>
          </div>
        </div>
        {job ? <IngestLevelProgress job={job} copy={ingestCopy} /> : null}
      </div>
    </div>
  );
}

function EmptyState({
  copy,
  title,
  detail,
  agentProvider,
  onAgentProviderChange,
  agentLogRoot,
  onAgentLogRootChange,
  onScan,
  scanLabel,
  placeholder,
  disabled = false
}: {
  copy: AppCopy["empty"];
  title: string;
  detail: string;
  agentProvider: AgentProvider;
  onAgentProviderChange: (value: AgentProvider) => void;
  agentLogRoot: string;
  onAgentLogRootChange: (value: string) => void;
  onScan: () => void;
  scanLabel: string;
  placeholder: string;
  disabled?: boolean;
}) {
  return (
    <section className="empty-state">
      <Search size={34} />
      <h2>{title}</h2>
      <p>{detail}</p>
      <label className="empty-agent-provider">
        <span>{copy.source}</span>
        <select aria-label={copy.sourceAria} value={agentProvider} onChange={(event) => onAgentProviderChange(event.target.value as AgentProvider)} disabled={disabled}>
          <option value="codex">Codex</option>
          <option value="claude-code">Claude Code</option>
          <option value="opencode">OpenCode</option>
        </select>
      </label>
      <label className="empty-agent-root">
        <span>{copy.root}</span>
        <input aria-label={copy.rootAria} value={agentLogRoot} onChange={(event) => onAgentLogRootChange(event.target.value)} placeholder={placeholder} disabled={disabled} />
      </label>
      <button className="primary-button" onClick={onScan} disabled={disabled}>{scanLabel}</button>
    </section>
  );
}

function aggregateSkills(journeySkills: SkillUsage[] | undefined, events: TimelineEvent[]) {
  return dedupeSkills([...(journeySkills ?? []), ...events.flatMap((event) => event.skills ?? [])]);
}

function filterProjectsByProvider(projects: ProjectWithSessions[], provider: ProjectProviderFilter) {
  if (provider === "all") return projects;
  return projects.filter((project) => project.sessions.some((session) => session.provider === provider || session.id.startsWith(`${provider}:`)));
}

function providerSummary(project: ProjectWithSessions, copy: AppCopy) {
  const providers = new Set(project.sessions.map((session) => session.provider ?? providerFromSessionId(session.id)));
  if (providers.size === 0) return copy.projectControls.noProvider;
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

function formatExitType(exitType: TaskJourney["exitType"], copy: AppCopy["timeline"]) {
  return exitType === "next_prompt" ? copy.nextInput : copy.sessionEnd;
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

function formatDate(value: string, _copy?: unknown) {
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

function formatMetricValue(metricKey: MetricKey, value: number) {
  return metricKey === "tokens" ? formatMillionTokens(value) : value.toLocaleString();
}

function isIngestBusy(job: IngestJob | null) {
  return job?.status === "queued" || job?.status === "running";
}

function getBlockingMessage({
  copy,
  loading,
  timelineLoading,
  ingestBusy,
  dailyTokenUsageLoading
}: {
  copy: AppCopy;
  loading: boolean;
  timelineLoading: boolean;
  ingestBusy: boolean;
  dailyTokenUsageLoading: boolean;
}) {
  if (ingestBusy) return copy.loading.scanningLogs;
  if (timelineLoading) return copy.loading.loadingTimeline;
  if (loading) return copy.loading.loadingIndex;
  if (dailyTokenUsageLoading) return copy.loading.loadingDailyTokens;
  return null;
}

function getBlockingJob({
  job,
  message,
  ingestBusy,
  loading,
  timelineLoading,
  dailyTokenUsageLoading
}: {
  job: IngestJob | null;
  message: string | null;
  ingestBusy: boolean;
  loading: boolean;
  timelineLoading: boolean;
  dailyTokenUsageLoading: boolean;
}) {
  if (!message) return null;
  if (ingestBusy && job) return job;
  if (loading) return createLoaderJob("loading-projects", "scanning", 3, 12, message);
  if (timelineLoading) return createLoaderJob("loading-timeline", "normalizing", 7, 12, message);
  if (dailyTokenUsageLoading) return createLoaderJob("loading-token-usage", "parsing", 5, 12, message);
  return createLoaderJob("loading-superview", "scanning", 4, 12, message);
}

function createLoaderJob(id: string, phase: IngestJob["phase"], processedFiles: number, totalFiles: number, currentFile: string): IngestJob {
  return {
    id,
    status: "running",
    phase,
    startedAt: new Date(0).toISOString(),
    finishedAt: null,
    totalFiles,
    processedFiles,
    totalEvents: processedFiles * 10,
    errors: [],
    skippedFiles: Math.max(0, processedFiles - 2),
    candidateFiles: totalFiles,
    changedFiles: processedFiles,
    processedBytes: 0,
    totalBytes: 0,
    currentFile
  };
}

const ZERO_TOKEN_USAGE: TokenUsage = { input: 0, output: 0, reasoning: 0, cachedInput: 0, total: 0 };
