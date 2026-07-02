import {
  AlertTriangle,
  ArchiveX,
  Ban,
  Brain,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Cloud,
  CornerUpLeft,
  Eye,
  FileText,
  Github,
  Languages,
  Leaf,
  Map as MapIcon,
  Maximize2,
  Moon,
  Pause,
  Play,
  RotateCw,
  Search,
  Share2,
  Sparkles,
  Sun,
  Wifi,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import type {
  AgentProvider,
  ContextBlock,
  ContextReplayResponse,
  ContextSnapshot,
  DailyTokenUsageResponse,
  IngestJob,
  ProjectTimeline,
  SessionRecord,
  SkillUsage,
  TaskJourney,
  TaskJourneyDetail,
  TimelineEvent,
  TokenUsage,
} from "../../core/types";
import {
  fetchConfig,
  fetchContextReplay,
  fetchDailyTokenUsage,
  fetchIngestJob,
  fetchProjects,
  fetchTaskJourneyDetail,
  fetchTimeline,
  ProjectWithSessions,
  resetDatabase,
  startIngest,
} from "./api";
import { DailyTokenUsagePanel } from "./DailyTokenUsagePanel";
import { resolveAutoSelectId } from "./autoSelect";
import { AppCopy, COPY, IngestCopy, Language, TourCopy, normalizeLanguage } from "./i18n";
import { buildJourneyInsights, scoreJourneys } from "./insights";
import type { InsightSignalKind, JourneyInsight } from "./insights";
import { formatMillionTokens } from "./tokenFormat";
import {
  aggregateCostByModel,
  DEFAULT_PRICING,
  estimateProjectCost,
  formatCost,
  matchPricing,
  ModelPricing,
} from "../../core/cost";

type Theme = "light" | "dark" | "forest" | "plasma" | "morandi";
type ProjectProviderFilter = AgentProvider | "all";
type MetricKey = "projects" | "events" | "tasks" | "tokens";
type ThreadDetailTab = "conversation" | "context";

const PROJECT_TIMELINE_LIMIT = 100000;

const THEME_OPTIONS: Theme[] = ["light", "dark", "forest", "plasma", "morandi"];
const INSIGHT_BOARD_MODE_KEY = "superview-insight-board-mode";
const AUTO_UPDATE_KEY = "superview-auto-update";

function getAutoUpdateUiIntervalMs() {
  return Number(import.meta.env.VITE_SUPERVIEW_UI_POLL_MS ?? 15_000);
}

function getAutoUpdateDbIntervalMs() {
  return Number(import.meta.env.VITE_SUPERVIEW_DB_POLL_MS ?? 60_000);
}

function loadInitialTheme(): Theme {
  const stored = localStorage.getItem("superview-theme");
  return stored && (THEME_OPTIONS as string[]).includes(stored)
    ? (stored as Theme)
    : "light";
}

function loadInitialAutoUpdate() {
  return localStorage.getItem(AUTO_UPDATE_KEY) !== "off";
}

function ThemeIcon({ theme, size = 17 }: { theme: Theme; size?: number }) {
  if (theme === "light") return <Sun size={size} />;
  if (theme === "dark") return <Moon size={size} />;
  if (theme === "forest") return <Leaf size={size} />;
  if (theme === "morandi") return <Cloud size={size} />;
  return <Sparkles size={size} />;
}

export function App() {
  const [theme, setTheme] = useState<Theme>(loadInitialTheme);
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(loadInitialAutoUpdate);
  const [themePanelOpen, setThemePanelOpen] = useState(false);
  const themeDropdownRef = useRef<HTMLDivElement | null>(null);
  const projectDropdownRef = useRef<HTMLDivElement | null>(null);
  const [language, setLanguage] = useState<Language>(() =>
    normalizeLanguage(localStorage.getItem("superview-language")),
  );
  const [projects, setProjects] = useState<ProjectWithSessions[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  // Server --project-dir (launch dir). Drives auto-select once that project is ingested.
  const [serverProjectDir, setServerProjectDir] = useState<string | null>(null);
  // ?project= captured once at mount, before effects rewrite the URL from the selection.
  const initialUrlProject = useRef<string | null>(
    new URLSearchParams(window.location.search).get("project"),
  );
  // Locks once we've delivered the user to the launch-dir/url target, or they pick manually.
  const autoSelectDone = useRef(false);
  const [timeline, setTimeline] = useState<ProjectTimeline | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [dailyTokenUsage, setDailyTokenUsage] =
    useState<DailyTokenUsageResponse | null>(null);
  const [dailyTokenUsageLoading, setDailyTokenUsageLoading] = useState(false);
  const [tokenChartExpanded, setTokenChartExpanded] = useState(false);
  const [tokenTimelineOpen, setTokenTimelineOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<TimelineEvent | null>(
    null,
  );
  const [journeyDetails, setJourneyDetails] = useState<
    Record<string, TaskJourneyDetail>
  >({});
  const [journeyLoadingIds, setJourneyLoadingIds] = useState<
    Record<string, boolean>
  >({});
  const journeyLoadingRef = useRef(new Set<string>());
  const [contextReplays, setContextReplays] = useState<
    Record<string, ContextReplayResponse>
  >({});
  const [contextReplayLoadingIds, setContextReplayLoadingIds] = useState<
    Record<string, boolean>
  >({});
  const contextReplayLoadingRef = useRef(new Set<string>());
  const [collapsedJourneyIds, setCollapsedJourneyIds] = useState<
    Record<string, boolean>
  >({});
  const [job, setJob] = useState<IngestJob | null>(null);
  const jobRef = useRef(job);
  jobRef.current = job;
  const jobClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [agentProvider, setAgentProvider] = useState<AgentProvider>("codex");
  const [projectProviderFilter, setProjectProviderFilter] =
    useState<ProjectProviderFilter>("all");
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);
  const [projectSearchQuery, setProjectSearchQuery] = useState("");
  const [agentLogRoot, setAgentLogRoot] = useState("");
  const [scanPanelOpen, setScanPanelOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shareToast, setShareToast] = useState<string | null>(null);
  const shareToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [projectShareOpen, setProjectShareOpen] = useState(false);
  const [dropzoneOpen, setDropzoneOpen] = useState(false);
  const dropzoneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pricing, setPricing] = useState<ModelPricing[]>(() =>
    DEFAULT_PRICING.map((p) => ({ ...p, test: p.test })),
  );
  const [tourOpen, setTourOpen] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [tourCompleted, setTourCompleted] = useState<boolean>(() =>
    localStorage.getItem("superview-tour-completed") === "true",
  );

  const copy = COPY[language];

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("superview-theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(AUTO_UPDATE_KEY, autoUpdateEnabled ? "on" : "off");
  }, [autoUpdateEnabled]);

  useEffect(() => {
    if (!themePanelOpen) return;
    function handlePointerDown(event: MouseEvent) {
      if (!themeDropdownRef.current) return;
      if (themeDropdownRef.current.contains(event.target as Node)) return;
      setThemePanelOpen(false);
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setThemePanelOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [themePanelOpen]);

  useEffect(() => {
    if (!projectDropdownOpen) return;
    function handlePointerDown(event: MouseEvent) {
      if (!projectDropdownRef.current) return;
      if (projectDropdownRef.current.contains(event.target as Node)) return;
      setProjectDropdownOpen(false);
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setProjectDropdownOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [projectDropdownOpen]);

  useEffect(() => {
    document.documentElement.lang = language;
    localStorage.setItem("superview-language", language);
  }, [language]);

  // Auto-open tour for first-time visitors after data loads
  useEffect(() => {
    if (!tourCompleted && !loading) {
      const timer = setTimeout(() => setTourOpen(true), 600);
      return () => clearTimeout(timer);
    }
  }, [tourCompleted, loading]);

  useEffect(() => {
    localStorage.setItem("superview-tour-completed", String(tourCompleted));
  }, [tourCompleted]);

  useEffect(() => {
    void loadProjects();
  }, []);

  useEffect(() => {
    if (!selectedProjectId) return;
    const project = projects.find((p) => p.id === selectedProjectId);
    if (project?.cwd) {
      const url = new URL(window.location.href);
      url.searchParams.set("project", project.cwd);
      window.history.replaceState(null, "", url.toString());
    }
  }, [selectedProjectId, projects]);

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
    const currentValid =
      !!selectedProjectId &&
      filtered.some((project) => project.id === selectedProjectId);
    // Until we've settled on the launch-dir/url target, keep retrying as the
    // scan grows the list — the target project may not be ingested yet on the
    // first pass. Once it appears we select it; afterwards we never override.
    if (!autoSelectDone.current) {
      const targetId = resolveAutoSelectId(
        filtered,
        serverProjectDir,
        initialUrlProject.current,
      );
      if (targetId) {
        autoSelectDone.current = true;
        if (targetId !== selectedProjectId) setSelectedProjectId(targetId);
        return;
      }
    }
    if (!currentValid) {
      setSelectedProjectId(filtered[0].id);
    }
  }, [projects, projectProviderFilter, selectedProjectId, serverProjectDir]);

  // The launch-dir scan ingests projects incrementally and stays "running" for
  // minutes, so we can't wait for job completion to refresh. Instead, while an
  // auto-select target is pending, re-poll the project list — the target
  // appears well before the full scan finishes, and the selection effect above
  // latches onto it (setting autoSelectDone), which stops this poll.
  useEffect(() => {
    if (!serverProjectDir && !initialUrlProject.current) return;
    if (autoSelectDone.current) return;
    let attempts = 0;
    const timer = window.setInterval(async () => {
      if (autoSelectDone.current || attempts >= 45) {
        window.clearInterval(timer);
        return;
      }
      attempts += 1;
      try {
        setProjects(await fetchProjects());
      } catch {
        // ignore — next tick retries
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [serverProjectDir]);

  useEffect(() => {
    if (!job || job.status === "completed" || job.status === "failed") return;
    if (jobClearTimer.current) clearTimeout(jobClearTimer.current);
    const timer = window.setInterval(async () => {
      const next = await fetchIngestJob(job.id);
      setJob(next);
      if (next.status === "completed" || next.status === "failed") {
        try {
          const fresh = await fetchProjects();
          setProjects(fresh);
          if (selectedProjectId) {
            const [freshTimeline, freshTokens] = await Promise.all([
              fetchTimeline(selectedProjectId, { limit: PROJECT_TIMELINE_LIMIT, offset: 0 }),
              fetchDailyTokenUsage(selectedProjectId),
            ]);
            setTimeline(freshTimeline);
            setDailyTokenUsage(freshTokens);
          }
        } catch {
          // silent
        }
        jobClearTimer.current = setTimeout(() => setJob(null), 2500);
      }
    }, 700);
    return () => {
      window.clearInterval(timer);
      if (jobClearTimer.current) clearTimeout(jobClearTimer.current);
    };
  }, [job, selectedProjectId]);

  // Poll the selected project: refresh DB via provider-scoped scan every 60s, refresh UI every 15s
  useEffect(() => {
    if (!selectedProjectId) return;
    if (!autoUpdateEnabled) return;
    const uiTimer = window.setInterval(async () => {
      try {
        const [nextTimeline, nextTokens] = await Promise.all([
          fetchTimeline(selectedProjectId, {
            limit: PROJECT_TIMELINE_LIMIT,
            offset: 0,
          }),
          fetchDailyTokenUsage(selectedProjectId),
        ]);
        setTimeline(nextTimeline);
        setDailyTokenUsage(nextTokens);
      } catch {
        // silent
      }
    }, getAutoUpdateUiIntervalMs());
    const dbTimer = window.setInterval(async () => {
      if (isIngestBusy(jobRef.current)) return;
      try {
        const jobId = await startIngest({
          sources: [{ provider: agentProvider }],
        });
        setJob(await fetchIngestJob(jobId));
      } catch {
        // silent
      }
    }, getAutoUpdateDbIntervalMs());
    return () => {
      window.clearInterval(uiTimer);
      window.clearInterval(dbTimer);
    };
  }, [selectedProjectId, agentProvider, autoUpdateEnabled]);

  // Drag-and-drop JSONL import
  useEffect(() => {
    function onDragOver(event: DragEvent) {
      if (event.dataTransfer?.types.includes("Files")) {
        event.preventDefault();
        if (dropzoneTimer.current) clearTimeout(dropzoneTimer.current);
        setDropzoneOpen(true);
      }
    }
    function onDragLeave(event: DragEvent) {
      if (
        !event.currentTarget ||
        (event.relatedTarget &&
          (event.currentTarget as Node).contains(event.relatedTarget as Node))
      )
        return;
      dropzoneTimer.current = setTimeout(() => setDropzoneOpen(false), 150);
    }
    function onDrop(event: DragEvent) {
      event.preventDefault();
      setDropzoneOpen(false);
      if (dropzoneTimer.current) clearTimeout(dropzoneTimer.current);
      const files = event.dataTransfer?.files;
      if (!files || files.length === 0) return;
      void handleDropFiles(files);
    }
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      if (dropzoneTimer.current) clearTimeout(dropzoneTimer.current);
    };
  }, []);

  async function handleDropFiles(files: FileList) {
    for (const file of Array.from(files)) {
      if (!file.name.endsWith(".jsonl")) continue;
      try {
        const content = await file.text();
        const lines = content.trim().split("\n").filter(Boolean);
        const jobId = await startIngest({
          sources: [{ provider: "codex", path: file.name }],
        });
        setJob(await fetchIngestJob(jobId));
        // queue a re-scan after the upload completes
        setTimeout(async () => {
          try {
            const fresh = await fetchProjects();
            setProjects(fresh);
            if (selectedProjectId)
              setDailyTokenUsage(await fetchDailyTokenUsage(selectedProjectId));
          } catch {
            /* silent */
          }
        }, 3000);
      } catch {
        /* silent */
      }
    }
  }

  async function loadProjects() {
    setLoading(true);
    try {
      const next = await fetchProjects();
      setProjects(next);
      // Capture the launch dir so the selection effect can target it once that
      // project is ingested — the first scan may not have reached it yet.
      try {
        const config = await fetchConfig();
        setServerProjectDir(config.projectDir ?? null);
      } catch { /* best-effort */ }
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : String(loadError),
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadTimeline(projectId: string) {
    setTimelineLoading(true);
    try {
      const next = await fetchTimeline(projectId, {
        limit: PROJECT_TIMELINE_LIMIT,
        offset: 0,
      });
      setTimeline(next);
      setSelectedEvent(next.events[0] ?? null);
      setCollapsedJourneyIds({});
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : String(loadError),
      );
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
      setError(
        loadError instanceof Error ? loadError.message : String(loadError),
      );
    } finally {
      setDailyTokenUsageLoading(false);
    }
  }

  async function handleReset() {
    if (!confirm(copy.timeline.resetDatabaseConfirm)) return;
    setScanPanelOpen(false);
    try {
      await resetDatabase();
      setJob(null);
      setTimeline(null);
      setSelectedEvent(null);
      setProjects([]);
      setSelectedProjectId(null);
      setDailyTokenUsage(null);
      setDailyTokenUsageLoading(false);
      setTimelineLoading(false);
      setTokenChartExpanded(false);
      setCollapsedJourneyIds({});
      setJourneyDetails({});
      setContextReplays({});
      setError(null);
      await loadProjects();
    } catch {
      // silent
    }
  }

  async function handleScan() {
    if (isIngestBusy(job)) return;
    setScanPanelOpen(false);
    setError(null);
    try {
      const root = agentLogRoot.trim();
      const jobId = await startIngest(
        root
          ? { sources: [{ provider: agentProvider, root, path: root }] }
          : { sources: [{ provider: agentProvider }] },
      );
      setJob(await fetchIngestJob(jobId));
    } catch (scanError) {
      setError(
        scanError instanceof Error ? scanError.message : String(scanError),
      );
    }
  }

  async function loadJourneyDetail(
    journeyId: string,
    projectId = selectedProjectId ?? undefined,
  ) {
    if (journeyDetails[journeyId] || journeyLoadingRef.current.has(journeyId))
      return;
    journeyLoadingRef.current.add(journeyId);
    setJourneyLoadingIds((current) => ({ ...current, [journeyId]: true }));
    try {
      const detail = await fetchTaskJourneyDetail(journeyId, projectId);
      setJourneyDetails((current) => ({ ...current, [journeyId]: detail }));
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : String(loadError),
      );
    } finally {
      journeyLoadingRef.current.delete(journeyId);
      setJourneyLoadingIds((current) => ({ ...current, [journeyId]: false }));
    }
  }

  async function loadContextReplay(
    journeyId: string,
    projectId = selectedProjectId ?? undefined,
  ) {
    if (
      contextReplays[journeyId] ||
      contextReplayLoadingRef.current.has(journeyId)
    )
      return;
    contextReplayLoadingRef.current.add(journeyId);
    setContextReplayLoadingIds((current) => ({
      ...current,
      [journeyId]: true,
    }));
    try {
      const replay = await fetchContextReplay(journeyId, projectId);
      setContextReplays((current) => ({ ...current, [journeyId]: replay }));
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : String(loadError),
      );
    } finally {
      contextReplayLoadingRef.current.delete(journeyId);
      setContextReplayLoadingIds((current) => ({
        ...current,
        [journeyId]: false,
      }));
    }
  }

  const providerFilteredProjects = useMemo(
    () => filterProjectsByProvider(projects, projectProviderFilter),
    [projects, projectProviderFilter],
  );
  const filteredProjects = useMemo(
    () => filterProjectsBySearch(providerFilteredProjects, projectSearchQuery),
    [providerFilteredProjects, projectSearchQuery],
  );
  const selectedProject =
    providerFilteredProjects.find((project) => project.id === selectedProjectId) ??
    null;
  const journeys = timeline?.taskJourneys ?? [];
  const timelineEventsById = useMemo(
    () => new Map((timeline?.events ?? []).map((event) => [event.id, event])),
    [timeline],
  );
  const sessionMap = useMemo(() => {
    const map = new Map<string, SessionRecord>();
    for (const s of selectedProject?.sessions ?? []) {
      map.set(s.id, s);
    }
    return map;
  }, [selectedProject?.sessions]);
  const totalEvents = timeline?.totalEvents ?? timeline?.events.length ?? 0;
  const projectTokenUsage =
    selectedProject?.tokenUsage ?? timeline?.tokenUsage ?? ZERO_TOKEN_USAGE;
  const recapSummaryLine = useMemo(() => {
    if (journeys.length === 0) return null;
    let totalCost = 0;
    let totalMs = 0;
    let minTs = Infinity;
    let maxTs = -Infinity;
    let priciestCost = 0;
    let priciestName = "";
    const dailyCost: Record<string, number> = {};
    const modelBreakdown = aggregateCostByModel(journeys, sessionMap, pricing);
    const favModel = modelBreakdown[0]?.label ?? "—";
    for (const j of journeys) {
      totalCost += estimateProjectCost(j.tokenUsage, undefined, pricing);
      totalMs += j.durationMs ?? 0;
      if (j.startedAt) {
        const t = Date.parse(j.startedAt);
        if (t < minTs) minTs = t;
        if (t > maxTs) maxTs = t;
        const dk = new Date(
          new Date(j.startedAt).getFullYear(),
          new Date(j.startedAt).getMonth(),
          new Date(j.startedAt).getDate(),
        ).toDateString();
        dailyCost[dk] =
          (dailyCost[dk] ?? 0) +
          estimateProjectCost(j.tokenUsage, undefined, pricing);
      }
      const c = estimateProjectCost(j.tokenUsage, undefined, pricing);
      if (c > priciestCost) {
        priciestCost = c;
        const cwd = sessionMap.get(j.sessionId)?.cwd;
        priciestName = cwd
          ? cwd
              .replace(/\\/g, "/")
              .split("/")
              .filter(Boolean)
              .slice(-2)
              .join("/") || cwd
          : "(unknown)";
      }
    }
    const hours = totalMs / 3600000;
    const spanDays =
      isFinite(minTs) && isFinite(maxTs)
        ? Math.max(1, Math.round((maxTs - minTs) / 86400000) + 1)
        : 1;
    let busyDay: { date: Date; cost: number } | null = null;
    for (const [dk, cost] of Object.entries(dailyCost)) {
      if (!busyDay || cost > busyDay.cost)
        busyDay = { date: new Date(dk), cost };
    }
    return {
      spanDays,
      sessions: journeys.length,
      cost: totalCost,
      hours,
      favModel,
      busyDay,
      priciestName,
      priciestCost,
    };
  }, [journeys, pricing, sessionMap]);

  function showShareToast(msg: string) {
    clearTimeout(shareToastTimer.current ?? undefined);
    setShareToast(msg);
    shareToastTimer.current = setTimeout(() => setShareToast(null), 2500);
  }

  const ingestBusy = isIngestBusy(job);
  const blockingMessage = getBlockingMessage({
    copy,
    loading,
    timelineLoading,
    dailyTokenUsageLoading,
  });
  const blockingJob = getBlockingJob({
    job,
    message: blockingMessage,
    ingestBusy,
    loading,
    timelineLoading,
    dailyTokenUsageLoading,
  });

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <strong>CC Flight</strong>
          <span>{copy.brandSubtitle}</span>
        </div>
        <div className="topbar-actions">
          <a
            className="icon-button"
            href="https://github.com/TheAceTeam/SuperView"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub"
            title="GitHub"
          >
            <Github size={16} />
          </a>
          <div className="scan-dropdown">
            <button
              className="shell-button scan-dropdown-trigger"
              onClick={() => setScanPanelOpen((open) => !open)}
              disabled={ingestBusy}
              aria-expanded={scanPanelOpen}
              aria-controls="scan-agent-log-panel"
            >
              <RotateCw size={16} />
              {copy.topbar.scan}
              <ChevronDown size={15} aria-hidden="true" />
            </button>
            {scanPanelOpen ? (
              <div
                className="scan-dropdown-panel"
                id="scan-agent-log-panel"
                role="region"
                aria-label={copy.topbar.scan}
              >
                <label className="agent-provider-control">
                  <span>{copy.topbar.source}</span>
                  <select
                    aria-label={copy.topbar.sourceAria}
                    value={agentProvider}
                    onChange={(event) =>
                      setAgentProvider(event.target.value as AgentProvider)
                    }
                    disabled={ingestBusy}
                  >
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
                <button
                  className="shell-button scan-dropdown-submit"
                  onClick={handleScan}
                  disabled={ingestBusy}
                >
                  <RotateCw size={16} />
                  {copy.topbar.scan}
                </button>
                <button
                  className="shell-button"
                  onClick={handleReset}
                  style={{
                    marginTop: 4,
                    fontSize: 11,
                    color: "rgba(255,120,120,.8)",
                  }}
                >
                  {copy.timeline.resetDatabase}
                </button>
              </div>
            ) : null}
          </div>
          <div className="project-dropdown" ref={projectDropdownRef}>
            <button
              className="shell-button project-dropdown-trigger"
              onClick={() => setProjectDropdownOpen((open) => !open)}
              aria-expanded={projectDropdownOpen}
              disabled={timelineLoading || ingestBusy}
            >
              <FileText size={16} />
              {selectedProject?.name ?? copy.projectControls.project}
              <ChevronDown size={15} aria-hidden="true" />
            </button>
            {projectDropdownOpen ? (
              <div className="project-dropdown-panel">
                <div
                  className="project-dropdown-chips"
                  role="group"
                  aria-label={copy.projectControls.provider}
                >
                  {(["all", "codex", "claude-code", "opencode"] as const).map(
                    (provider) => (
                      <button
                        key={provider}
                        type="button"
                        className={`project-dropdown-chip${projectProviderFilter === provider ? " active" : ""}`}
                        onClick={() => setProjectProviderFilter(provider)}
                      >
                        {provider === "all"
                          ? copy.projectControls.all
                          : provider === "codex"
                            ? "Codex"
                            : provider === "claude-code"
                              ? "Claude Code"
                              : "OpenCode"}
                      </button>
                    ),
                  )}
                </div>
                <label className="project-dropdown-search">
                  <Search size={13} aria-hidden="true" />
                  <input
                    type="search"
                    value={projectSearchQuery}
                    onChange={(event) => setProjectSearchQuery(event.target.value)}
                    placeholder={copy.projectControls.search}
                    aria-label={copy.projectControls.search}
                  />
                </label>
                <div
                  className="project-dropdown-list"
                  role="listbox"
                  aria-label={copy.projectControls.project}
                >
                  {filteredProjects.length === 0 ? (
                    <div className="project-dropdown-empty">
                      {providerFilteredProjects.length === 0
                        ? copy.empty.noProviderTitle
                        : copy.projectControls.noSearchResults}
                    </div>
                  ) : (
                    filteredProjects.map((project) => (
                      <button
                        key={project.id}
                        type="button"
                        role="option"
                        aria-selected={project.id === selectedProjectId}
                        className={`project-dropdown-item${project.id === selectedProjectId ? " active" : ""}`}
                        onClick={() => {
                          autoSelectDone.current = true;
                          setSelectedProjectId(project.id);
                          setProjectDropdownOpen(false);
                        }}
                      >
                        <span className="project-dropdown-item-name">
                          {project.name}
                        </span>
                        <span className="project-dropdown-item-meta">
                          {formatMillionTokens(project.tokenUsage.total)} / KV{" "}
                          {formatKvHitRate(project.tokenUsage)}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className={`shell-button auto-update-toggle${autoUpdateEnabled ? " active" : ""}`}
            aria-label={
              autoUpdateEnabled
                ? copy.topbar.autoUpdateOn
                : copy.topbar.autoUpdateOff
            }
            title={
              autoUpdateEnabled
                ? copy.topbar.autoUpdateOn
                : copy.topbar.autoUpdateOff
            }
            aria-pressed={autoUpdateEnabled}
            onClick={() => setAutoUpdateEnabled((enabled) => !enabled)}
          >
            {autoUpdateEnabled ? <Wifi size={16} /> : <WifiOff size={16} />}
            <span>{copy.topbar.autoUpdate}</span>
          </button>
          <div className="theme-dropdown" ref={themeDropdownRef}>
            <button
              className="icon-button"
              aria-label={copy.theme.aria}
              title={copy.theme.names[theme]}
              aria-haspopup="menu"
              aria-expanded={themePanelOpen}
              onClick={() => setThemePanelOpen((open) => !open)}
            >
              <ThemeIcon theme={theme} />
            </button>
            {themePanelOpen ? (
              <div
                className="theme-dropdown-panel"
                role="menu"
                aria-label={copy.theme.aria}
              >
                {THEME_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="menuitemradio"
                    aria-checked={theme === option}
                    className={`theme-dropdown-option${theme === option ? " active" : ""}`}
                    onClick={() => {
                      setTheme(option);
                      setThemePanelOpen(false);
                    }}
                  >
                    <ThemeIcon theme={option} size={15} />
                    <span>{copy.theme.names[option]}</span>
                    {theme === option ? (
                      <i className="theme-dropdown-check" aria-hidden="true">
                        ✓
                      </i>
                    ) : (
                      <span aria-hidden="true" />
                    )}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button
            className="icon-button tour-restart-button"
            aria-label={copy.tour.restart}
            title={copy.tour.restart}
            onClick={() => {
              setTourStep(0);
              setTourCompleted(false);
              setTourOpen(true);
            }}
          >
            <MapIcon size={16} />
          </button>
          <button
            className="shell-button language-toggle-button"
            aria-label={copy.language.aria}
            title={copy.language.title}
            onClick={() =>
              setLanguage((current) => (current === "en" ? "zh-CN" : "en"))
            }
          >
            <Languages size={16} />
            {copy.language.short}
          </button>
        </div>
      </header>

      <main className="workspace">
        <section className="title-row">
          <div>
            <p className="eyebrow">{copy.title.eyebrow}</p>
            <div className="title-heading-row">
              <h1>{selectedProject?.name ?? copy.title.emptyProject}</h1>
              {selectedProject && recapSummaryLine ? (
                <button
                  type="button"
                  className="icon-button title-share-button"
                  onClick={() => setProjectShareOpen(true)}
                  aria-label={copy.title.share}
                  title={copy.title.share}
                >
                  <Share2 size={15} />
                </button>
              ) : null}
            </div>
            <p className="lead">{copy.title.lead}</p>
          </div>
          {recapSummaryLine ? (
            <div className="recap-title-block">
              <h2 className="recap-title-summary">
                Across <em>{recapSummaryLine.spanDays}</em> day
                {recapSummaryLine.spanDays !== 1 ? "s" : ""}, you ran{" "}
                <em>{recapSummaryLine.sessions}</em> agent session
                {recapSummaryLine.sessions !== 1 ? "s" : ""}, spent{" "}
                <em>{formatCost(recapSummaryLine.cost)}</em>, and kept them
                working for <em>{recapSummaryLine.hours.toFixed(1)}h</em>.
              </h2>
            </div>
          ) : null}
        </section>
        {selectedProject ? (
          <SessionRecapPanel
            copy={copy.timeline}
            metricsCopy={copy.metrics}
            tokenChartCopy={copy.tokenChart}
            journeys={journeys}
            timelineEventsById={timelineEventsById}
            dailyTokenUsage={dailyTokenUsage}
            dailyTokenUsageLoading={dailyTokenUsageLoading}
            sessionMap={sessionMap}
            pricing={pricing}
            onPricingChange={setPricing}
          />
        ) : null}

        {error ? (
          <div className="alert">
            <AlertTriangle size={16} />
            {error}
          </div>
        ) : null}
        {blockingMessage ? (
          <BlockingLoader
            copy={copy.loading}
            ingestCopy={copy.ingest}
            message={blockingMessage}
            job={blockingJob}
          />
        ) : null}

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
        ) : providerFilteredProjects.length === 0 ? (
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
              <ConversationThread
                copy={copy.timeline}
                journeys={journeys}
                pricing={pricing}
                detailsByJourneyId={journeyDetails}
                contextReplaysByJourneyId={contextReplays}
                timelineEventsById={timelineEventsById}
                collapsedJourneyIds={collapsedJourneyIds}
                loadingJourneyIds={journeyLoadingIds}
                loadingContextReplayIds={contextReplayLoadingIds}
                selectedEventId={selectedEvent?.id ?? null}
                selectedProjectName={selectedProject?.name ?? ""}
                onLoadJourneyDetail={(journeyId) =>
                  loadJourneyDetail(journeyId)
                }
                onLoadContextReplay={(journeyId) =>
                  loadContextReplay(journeyId)
                }
                onSelectEvent={(event) => setSelectedEvent(event)}
                tokenTimelineOpen={tokenTimelineOpen}
                setTokenTimelineOpen={setTokenTimelineOpen}
                sessionMap={sessionMap}
              />
            </section>
          </div>
        )}
      </main>
      {dropzoneOpen ? (
        <div className="dropzone-overlay" aria-hidden="true">
          <div className="dropzone-message">{copy.timeline.dropzoneActive}</div>
        </div>
      ) : null}
      {tourOpen ? (
        <OnboardingTour
          step={tourStep}
          totalSteps={copy.tour.steps.length}
          copy={copy.tour}
          onPrev={() => setTourStep((s) => Math.max(0, s - 1))}
          onNext={() =>
            setTourStep((s) => Math.min(copy.tour.steps.length - 1, s + 1))
          }
          onDone={() => {
            setTourOpen(false);
            setTourCompleted(true);
          }}
          onSkip={() => {
            setTourOpen(false);
            setTourCompleted(true);
          }}
        />
      ) : null}
      {projectShareOpen && selectedProject && recapSummaryLine ? (
        <ProjectShareCard
          copy={copy.title}
          projectName={selectedProject.name}
          summary={recapSummaryLine}
          tokenUsage={projectTokenUsage}
          dailyUsage={dailyTokenUsage}
          repoUrl="https://github.com/TheAceTeam/SuperView"
          onClose={() => setProjectShareOpen(false)}
          onToast={showShareToast}
        />
      ) : null}
      {shareToast ? (
        <div className="share-toast" role="status" aria-live="polite">
          {shareToast}
        </div>
      ) : null}
    </div>
  );
}

function ProjectShareCard({
  copy,
  projectName,
  summary,
  tokenUsage,
  dailyUsage,
  repoUrl,
  onClose,
  onToast,
}: {
  copy: AppCopy["title"];
  projectName: string;
  summary: {
    spanDays: number;
    sessions: number;
    cost: number;
    hours: number;
    favModel: string;
    priciestName: string;
    priciestCost: number;
  };
  tokenUsage: TokenUsage;
  dailyUsage: DailyTokenUsageResponse | null;
  repoUrl: string;
  onClose: () => void;
  onToast: (msg: string) => void;
}) {
  const kv = formatKvHitRate(tokenUsage);
  const dateLabel = new Date().toLocaleDateString();
  const dailyPoints = (dailyUsage?.points ?? []).map((p) => ({
    date: p.date,
    total: p.total,
  }));
  const maxDaily = Math.max(1, ...dailyPoints.map((p) => p.total));
  const metrics: { label: string; value: string }[] = [
    {
      label: "Sessions",
      value: `${summary.sessions} · ${summary.spanDays} day${summary.spanDays !== 1 ? "s" : ""}`,
    },
    {
      label: "Cost",
      value: `${formatCost(summary.cost)} · ${summary.hours.toFixed(1)}h`,
    },
    {
      label: "Tokens",
      value: `${formatMillionTokens(tokenUsage.total)} · KV ${kv}`,
    },
    { label: "Top model", value: summary.favModel },
  ];
  if (summary.priciestName) {
    metrics.push({
      label: "Priciest area",
      value: `${summary.priciestName} (${formatCost(summary.priciestCost)})`,
    });
  }

  function buildPlainText() {
    const lines = [
      `${projectName} — SuperView project recap`,
      "",
      ...metrics.map((m) => `• ${m.label}: ${m.value}`),
      "",
      `Captured with SuperView — ${repoUrl}`,
    ];
    return lines.join("\n");
  }

  function buildMarkdown() {
    const lines = [
      `## ${projectName} — SuperView project recap`,
      "",
      ...metrics.map((m) => `- **${m.label}:** ${m.value}`),
      "",
      `_${projectName} · ${dateLabel} · SuperView — ${repoUrl}_`,
    ];
    return lines.join("\n");
  }

  async function handleCopyPlain() {
    try {
      await navigator.clipboard.writeText(buildPlainText());
      onToast(copy.shareCopied);
    } catch {
      onToast("Failed to copy");
    }
  }

  async function handleCopyMarkdown() {
    try {
      await navigator.clipboard.writeText(buildMarkdown());
      onToast(copy.shareCopied);
    } catch {
      onToast("Failed to copy");
    }
  }

  function handleDownloadPng() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name: string, fallback: string) =>
      cs.getPropertyValue(name).trim() || fallback;
    const paper = v("--paper", "#fcfaf7");
    const ink = v("--ink", "#423d38");
    const muted = v("--muted", "#797067");
    const orange = v("--orange", "#fe6e00");
    const line = v("--line", "#e3e0dd");
    const esc = (s: string) =>
      s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    const W = 640;
    const metricsBottom = 150 + metrics.length * 56;
    const chartH = dailyPoints.length > 0 ? 110 : 0;
    const H = metricsBottom + chartH + 64;
    const rows = metrics
      .map((m, i) => {
        const y = 150 + i * 56;
        return `
          <text x="48" y="${y}" font-family="ui-monospace, Menlo, monospace" font-size="13" fill="${muted}" letter-spacing="0.5">${esc(m.label.toUpperCase())}</text>
          <text x="48" y="${y + 24}" font-family="-apple-system, Segoe UI, Roboto, sans-serif" font-size="20" font-weight="600" fill="${ink}">${esc(m.value)}</text>
          <line x1="48" y1="${y + 38}" x2="${W - 48}" y2="${y + 38}" stroke="${line}" stroke-width="1" />`;
      })
      .join("");
    let chart = "";
    if (dailyPoints.length > 0) {
      const chartTop = metricsBottom + 8;
      const barAreaH = 70;
      const baseline = chartTop + 20 + barAreaH;
      const chartLeft = 48;
      const chartRight = W - 48;
      const gap = 3;
      const barW = Math.max(
        2,
        (chartRight - chartLeft - gap * (dailyPoints.length - 1)) / dailyPoints.length,
      );
      const bars = dailyPoints
        .map((p, i) => {
          const h = Math.max(3, (p.total / maxDaily) * barAreaH);
          const x = chartLeft + i * (barW + gap);
          const y = baseline - h;
          return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="1" fill="${orange}" />`;
        })
        .join("");
      chart = `
        <text x="48" y="${chartTop + 12}" font-family="ui-monospace, Menlo, monospace" font-size="13" fill="${muted}" letter-spacing="0.5">${esc(copy.shareUsageByDay.toUpperCase())}</text>
        ${bars}`;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <rect width="${W}" height="${H}" fill="${paper}" rx="20" />
      <text x="48" y="56" font-family="-apple-system, Segoe UI, Roboto, sans-serif" font-size="14" font-weight="700" fill="${orange}" letter-spacing="1">SUPERVIEW · PROJECT RECAP</text>
      <text x="48" y="100" font-family="-apple-system, Segoe UI, Roboto, sans-serif" font-size="34" font-weight="700" fill="${ink}">${esc(projectName)}</text>
      ${rows}
      ${chart}
      <text x="48" y="${H - 28}" font-family="ui-monospace, Menlo, monospace" font-size="12" fill="${muted}">${esc(`${dateLabel} · ${repoUrl}`)}</text>
    </svg>`;
    const scale = 2;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = W * scale;
      canvas.height = H * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        onToast("Failed to render image");
        return;
      }
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) {
          onToast("Failed to render image");
          return;
        }
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = `superview-${projectName.replace(/[^a-z0-9_-]+/gi, "-")}.png`;
        a.click();
        URL.revokeObjectURL(objectUrl);
        onToast(copy.sharePngSaved);
      }, "image/png");
    };
    img.onerror = () => onToast("Failed to render image");
    img.src =
      "data:image/svg+xml;base64," +
      btoa(unescape(encodeURIComponent(svg)));
  }

  return (
    <div className="share-overlay" onClick={onClose}>
      <div className="share-card" onClick={(e) => e.stopPropagation()}>
        <div className="share-card-header">
          <div className="share-card-header-brand">
            <strong>SuperView</strong>
            <span>{copy.shareCardTitle}</span>
          </div>
          <button
            type="button"
            className="share-card-close"
            onClick={onClose}
            aria-label={copy.shareClose}
          >
            ✕
          </button>
        </div>

        <div className="share-card-body">
          <div className="share-card-hero">
            <div className="share-card-hero-stat">{formatCost(summary.cost)}</div>
            <div className="share-card-hero-caption">{projectName}</div>
          </div>

          <div className="project-share-metrics">
            {metrics.map((m) => (
              <div className="project-share-metric" key={m.label}>
                <span className="project-share-metric-label">{m.label}</span>
                <span className="project-share-metric-value">{m.value}</span>
              </div>
            ))}
          </div>

          {dailyPoints.length > 0 ? (
            <div className="project-share-daily">
              <span className="project-share-daily-label">{copy.shareUsageByDay}</span>
              <div className="share-card-spark" role="img" aria-label={copy.shareUsageByDay}>
                {dailyPoints.map((p) => {
                  const height = Math.max(6, Math.round((p.total / maxDaily) * 100));
                  return (
                    <span
                      key={p.date}
                      className="share-card-spark-bar"
                      style={{ height: `${height}%`, background: "var(--orange)" }}
                      title={`${p.date} · ${formatMillionTokens(p.total)}`}
                    />
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="share-card-stats-footer">
            <span className="share-card-stats-project">
              {projectName} · {dateLabel} · SuperView
            </span>
          </div>
        </div>

        <div className="share-card-actions">
          <button type="button" className="share-card-btn" onClick={handleCopyPlain}>
            {copy.shareCopy}
          </button>
          <button type="button" className="share-card-btn" onClick={handleCopyMarkdown}>
            {copy.shareCopyMarkdown}
          </button>
          <button type="button" className="share-card-btn" onClick={handleDownloadPng}>
            {copy.shareDownloadPng}
          </button>
        </div>
      </div>
    </div>
  );
}

function groupContextBlocks(blocks: ContextBlock[]) {
  return {
    added: blocks.filter((block) => block.state === "new"),
    active: blocks.filter(
      (block) => block.state === "retained" || block.state === "cited",
    ),
    changed: blocks.filter(
      (block) => block.state === "changed" || block.state === "contradicted",
    ),
    dropped: blocks.filter(
      (block) => block.state === "dropped" || block.state === "stale",
    ),
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
  pricing,
  detailsByJourneyId,
  contextReplaysByJourneyId,
  timelineEventsById,
  collapsedJourneyIds,
  loadingJourneyIds,
  loadingContextReplayIds,
  selectedEventId,
  selectedProjectName,
  onLoadJourneyDetail,
  onLoadContextReplay,
  onSelectEvent,
  tokenTimelineOpen,
  setTokenTimelineOpen,
  sessionMap,
}: {
  copy: AppCopy["timeline"];
  journeys: TaskJourney[];
  pricing: ModelPricing[];
  detailsByJourneyId: Record<string, TaskJourneyDetail>;
  contextReplaysByJourneyId: Record<string, ContextReplayResponse>;
  timelineEventsById: Map<string, TimelineEvent>;
  collapsedJourneyIds: Record<string, boolean>;
  loadingJourneyIds: Record<string, boolean>;
  loadingContextReplayIds: Record<string, boolean>;
  selectedEventId: string | null;
  selectedProjectName: string;
  onLoadJourneyDetail: (journeyId: string) => void;
  onLoadContextReplay: (journeyId: string) => void;
  onSelectEvent: (event: TimelineEvent) => void;
  tokenTimelineOpen: boolean;
  setTokenTimelineOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  sessionMap: Map<string, SessionRecord>;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("newest");
  const orderedJourneys = useMemo(
    () => applySearchAndSort(journeys, searchQuery, sortKey, pricing),
    [journeys, searchQuery, sortKey, pricing],
  );
  const insights = useMemo(
    () => buildJourneyInsights(orderedJourneys, timelineEventsById),
    [orderedJourneys, timelineEventsById],
  );
  const journeyHealthById = useMemo(
    () =>
      new Map(
        scoreJourneys(orderedJourneys, timelineEventsById).map((insight) => [
          insight.journeyId,
          insight,
        ]),
      ),
    [orderedJourneys, timelineEventsById],
  );
  const [selectedJourneyId, setSelectedJourneyId] = useState<string | null>(
    null,
  );
  const masterListRef = useRef<HTMLDivElement>(null);
  const [detailTab, setDetailTab] = useState<ThreadDetailTab>("context");
  const selectedJourney =
    orderedJourneys.find((journey) => journey.id === selectedJourneyId) ??
    orderedJourneys[0] ??
    null;

  useEffect(() => {
    if (orderedJourneys.length === 0) {
      setSelectedJourneyId(null);
      return;
    }
    setSelectedJourneyId((current) =>
      current && orderedJourneys.some((journey) => journey.id === current)
        ? current
        : orderedJourneys[0].id,
    );
  }, [orderedJourneys]);

  // Scroll selected journey into view in the master list
  useEffect(() => {
    if (!selectedJourneyId || !masterListRef.current) return;
    const item = masterListRef.current.querySelector<HTMLElement>(
      `[data-journey-id="${selectedJourneyId}"]`,
    );
    item?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedJourneyId]);

  useEffect(() => {
    if (detailTab === "context" && selectedJourney) {
      onLoadContextReplay(selectedJourney.id);
    }
  }, [detailTab, onLoadContextReplay, selectedJourney]);

  useEffect(() => {
    if (
      detailTab !== "context" &&
      selectedJourney &&
      !collapsedJourneyIds[selectedJourney.id]
    ) {
      onLoadJourneyDetail(selectedJourney.id);
    }
  }, [detailTab, onLoadJourneyDetail, selectedJourney, collapsedJourneyIds]);

  useEffect(() => {
    function shouldIgnoreShortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName.toLowerCase();
      return (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select" ||
        Boolean(target?.isContentEditable)
      );
    }

    function handleJourneyKeyDown(event: KeyboardEvent) {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      if (shouldIgnoreShortcut(event)) return;
      if (orderedJourneys.length === 0) return;
      const currentIndex = orderedJourneys.findIndex(
        (journey) => journey.id === selectedJourney?.id,
      );
      const baseIndex = currentIndex < 0 ? 0 : currentIndex;
      const lastIndex = orderedJourneys.length - 1;
      const nextIndex =
        event.key === "ArrowDown"
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
    <div
      className="conversation-thread conversation-master-detail"
      aria-label={copy.aria}
    >
      <aside className="conversation-master" aria-label={copy.masterAria}>
        <div className="conversation-master-heading">
          <span>{copy.masterTitle}</span>
          <ul
            className="conversation-status-legend"
            aria-label={copy.statusLegendAria}
          >
            <li className="running">
              <i aria-hidden="true" />
              {copy.statusLegendRunning}
            </li>
            <li className="success">
              <i aria-hidden="true" />
              {copy.statusLegendSuccess}
            </li>
            <li className="failed">
              <i aria-hidden="true" />
              {copy.statusLegendFailed}
            </li>
          </ul>
          <strong>{orderedJourneys.length}</strong>
          <button
            type="button"
            className="timeline-chart-btn"
            aria-label="Token Timeline"
            title="Token Timeline"
            onClick={() => setTokenTimelineOpen((o) => !o)}
          >
            <ChartColumn size={13} />
          </button>
        </div>
        <div className="conversation-master-search">
          <input
            type="search"
            className="master-search-input"
            placeholder={copy.searchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label={copy.searchPlaceholder}
          />
          <select
            className="master-sort-select"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            aria-label={copy.sortLabel}
          >
            <option value="newest">{copy.sortNewest}</option>
            <option value="cost">{copy.sortCost}</option>
            <option value="duration">{copy.sortDuration}</option>
            <option value="tools">{copy.sortTools}</option>
            <option value="errors">{copy.sortErrors}</option>
          </select>
        </div>
        <InsightBoard
          copy={copy}
          insights={insights}
          activeJourneyId={selectedJourney?.id ?? null}
          onSelectJourney={setSelectedJourneyId}
        />
        <div className="conversation-master-list" ref={masterListRef}>
          {orderedJourneys.map((journey) => (
            <ConversationMasterItem
              key={journey.id}
              copy={copy}
              journey={journey}
              fallbackPrompt={
                timelineEventsById.get(journey.promptEventId) ?? null
              }
              active={journey.id === selectedJourney?.id}
              loading={Boolean(loadingJourneyIds[journey.id])}
              health={journeyHealthById.get(journey.id) ?? null}
              timelineEventsById={timelineEventsById}
              onSelect={() => setSelectedJourneyId(journey.id)}
            />
          ))}
        </div>
      </aside>

      <section
        className="conversation-detail-pane"
        aria-label={copy.detailsAria}
      >
        <div className="conversation-detail-heading">
          <span>{copy.detailsTitle}</span>
          <strong>{selectedJourney?.title ?? copy.emptySelection}</strong>
        </div>
        <ToolUsageBars
          tools={aggregateToolUsage(selectedJourney, timelineEventsById)}
          copy={copy}
        />
        <div
          className="thread-detail-tabs"
          role="tablist"
          aria-label={copy.detailTabsAria}
        >
          <button
            type="button"
            role="tab"
            aria-selected={detailTab === "context"}
            className={detailTab === "context" ? "active" : ""}
            onClick={() => setDetailTab("context")}
          >
            {copy.contextReplayTab}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={detailTab === "conversation"}
            className={detailTab === "conversation" ? "active" : ""}
            onClick={() => setDetailTab("conversation")}
          >
            {copy.conversationTab}
          </button>
        </div>
        {selectedJourney ? (
          detailTab === "context" ? (
            <ContextReplayPanel
              copy={copy}
              replay={contextReplaysByJourneyId[selectedJourney.id] ?? null}
              loading={Boolean(loadingContextReplayIds[selectedJourney.id])}
              selectedProjectName={selectedProjectName}
            />
          ) : (
            <CausalSpine
              key={selectedJourney.id}
              copy={copy}
              journey={selectedJourney}
              detail={detailsByJourneyId[selectedJourney.id] ?? null}
              fallbackPrompt={
                timelineEventsById.get(selectedJourney.promptEventId) ?? null
              }
              loading={Boolean(loadingJourneyIds[selectedJourney.id])}
              selectedEventId={selectedEventId}
              onSelectEvent={onSelectEvent}
            />
          )
        ) : (
          <p className="muted">{copy.emptySelection}</p>
        )}
      </section>
      {tokenTimelineOpen ? (
        <div
          className="factory-overlay"
          onClick={() => setTokenTimelineOpen(false)}
        >
          <div
            className="factory-overlay-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="factory-overlay-header">
              <span>Token Timeline</span>
              <button
                type="button"
                className="factory-overlay-close"
                onClick={() => setTokenTimelineOpen(false)}
              >
                ✕
              </button>
            </div>
            <TokenTimeline
              copy={copy}
              journeys={orderedJourneys}
              selectedProjectName={selectedProjectName}
              selectedJourneyId={selectedJourneyId}
              onSelectJourney={setSelectedJourneyId}
              onClose={() => setTokenTimelineOpen(false)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function InsightBoard({
  copy,
  insights,
  activeJourneyId,
  onSelectJourney,
}: {
  copy: AppCopy["timeline"];
  insights: JourneyInsight[];
  activeJourneyId: string | null;
  onSelectJourney: (journeyId: string) => void;
}) {
  const [closed, setClosed] = useState(
    () => localStorage.getItem(INSIGHT_BOARD_MODE_KEY) !== "maximized",
  );
  const modeLabel = closed ? copy.insightBoardMaximize : copy.insightBoardClose;
  const toggleMode = () => {
    setClosed((value) => {
      const next = !value;
      localStorage.setItem(INSIGHT_BOARD_MODE_KEY, next ? "closed" : "maximized");
      return next;
    });
  };

  return (
    <section
      className={`insight-board${closed ? " closed" : ""}`}
      aria-label={copy.insightBoardAria}
    >
      <div className="insight-board-heading">
        <span>
          <Zap size={13} />
          {copy.insightBoardTitle}
        </span>
        <div className="insight-board-actions">
          <button
            type="button"
            className="insight-mode-toggle"
            aria-label={modeLabel}
            title={modeLabel}
            aria-expanded={!closed}
            onClick={toggleMode}
          >
            {closed ? <Maximize2 size={13} /> : <X size={13} />}
          </button>
        </div>
      </div>
      {closed ? null : insights.length === 0 ? (
        <p>{copy.insightBoardEmpty}</p>
      ) : (
        <div className="insight-list">
          {insights.map((insight) => (
            <button
              key={insight.id}
              type="button"
              className={`insight-card ${insight.severity} ${insight.journeyId === activeJourneyId ? "active" : ""}`}
              onClick={() => onSelectJourney(insight.journeyId)}
              aria-current={insight.journeyId === activeJourneyId ? "true" : undefined}
            >
              <span className="insight-score">
                {copy.insightScore}
                <strong>{Math.round(insight.score)}</strong>
              </span>
              <span className="insight-copy">
                <strong>{copy.insightSignals[insight.primaryKind]}</strong>
                <em>{insight.title}</em>
              </span>
              <span className="insight-metrics">
                <span>{formatMillionTokens(insight.metrics.tokens)} {copy.tokens}</span>
                <span>{insight.metrics.toolCalls} {copy.insightTools}</span>
                <span>{insight.metrics.files} {copy.insightFiles}</span>
              </span>
              <span className="insight-reasons">
                {insight.signals
                  .filter((signal) => signal.kind !== "high_cost")
                  .slice(0, 3)
                  .map((signal) => (
                    <b key={signal.kind}>
                      {formatInsightSignal(copy, signal.kind, signal.metric)}
                    </b>
                  ))}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function formatInsightSignal(
  copy: AppCopy["timeline"],
  kind: InsightSignalKind,
  metric: number,
) {
  switch (kind) {
    case "missing_verification":
      return copy.insightReasonMissingVerification;
    case "failed_run":
      return copy.insightReasonFailedRun;
    case "tool_loop":
      return copy.insightReasonToolLoop(metric);
    case "high_cost":
      return copy.insightReasonHighCost(formatMillionTokens(metric));
    case "file_blast":
      return copy.insightReasonFileBlast(metric);
    case "error_pressure":
      return copy.insightReasonErrorPressure(metric);
    case "context_churn":
      return copy.insightReasonContextChurn(metric);
  }
}

function ConversationMasterItem({
  copy,
  journey,
  fallbackPrompt,
  active,
  loading,
  health,
  timelineEventsById,
  onSelect,
}: {
  copy: AppCopy["timeline"];
  journey: TaskJourney;
  fallbackPrompt: TimelineEvent | null;
  active: boolean;
  loading: boolean;
  health: JourneyInsight | null;
  timelineEventsById: Map<string, TimelineEvent>;
  onSelect: () => void;
}) {
  const promptText = fallbackPrompt?.detail ?? journey.title;
  const healthSeverity = health ? healthSeverityClass(health.score) : "green";
  return (
    <button
      type="button"
      data-journey-id={journey.id}
      className={`conversation-master-item ${journey.status} ${active ? "active" : ""}`}
      aria-current={active ? "true" : undefined}
      onClick={onSelect}
    >
      <span className="conversation-master-meta">
        <span>{formatDate(journey.startedAt, copy)}</span>
        {health ? (
          <span
            className={`journey-health-badge ${healthSeverity}`}
            aria-label={`${copy.insightScore} ${Math.round(health.score)}`}
          >
            {Math.round(health.score)}
          </span>
        ) : null}
      </span>
      <strong>{promptText}</strong>
      {active ? (
        <EventTape
          eventIds={journey.eventIds}
          timelineEventsById={timelineEventsById}
        />
      ) : null}
      <em>
        {formatDuration(journey.durationMs)} ·{" "}
        {formatMillionTokens(journey.tokenUsage.total)} {copy.tokens} ·{" "}
        {copy.kvHit} {formatKvHitRate(journey.tokenUsage)}
      </em>
      {loading ? <small>{copy.loadingDetails}</small> : null}
    </button>
  );
}

function healthSeverityClass(score: number) {
  if (score < 60) return "red";
  if (score <= 80) return "yellow";
  return "green";
}

export function ContextReplayPanel({
  copy,
  replay,
  loading,
  selectedProjectName,
}: {
  copy: AppCopy["timeline"];
  replay: ContextReplayResponse | null;
  loading: boolean;
  selectedProjectName: string;
}) {
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(
    null,
  );
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const snapshotButtonRefs = useRef<Record<string, HTMLButtonElement | null>>(
    {},
  );
  const ledgerContainerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(msg: string) {
    clearTimeout(toastTimer.current ?? undefined);
    setToastMessage(msg);
    toastTimer.current = setTimeout(() => setToastMessage(null), 2500);
  }

  useEffect(() => {
    return () => {
      clearTimeout(toastTimer.current ?? undefined);
    };
  }, []);

  useEffect(() => {
    const header = headerRef.current;
    const panel = panelRef.current;
    if (!header || !panel) return;
    const apply = () => {
      panel.style.setProperty(
        "--replay-header-height",
        `${header.offsetHeight}px`,
      );
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(header);
    return () => observer.disconnect();
  }, [replay]);

  function handleSelectBlock(id: string) {
    setSelectedBlockId(id);
    requestAnimationFrame(() => {
      const card = ledgerContainerRef.current?.querySelector<HTMLElement>(
        `[data-block-id="${id}"]`,
      );
      card?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }
  useEffect(() => {
    setSelectedSnapshotId(replay?.snapshots[0]?.id ?? null);
    setSelectedBlockId(null);
  }, [replay?.journey.id]);

  const activeSnapshot =
    replay?.snapshots.find((snapshot) => snapshot.id === selectedSnapshotId) ??
    replay?.snapshots[0] ??
    null;
  const activeSnapshotIndex =
    replay && activeSnapshot
      ? Math.max(
          0,
          replay.snapshots.findIndex(
            (snapshot) => snapshot.id === activeSnapshot.id,
          ),
        )
      : -1;
  const groups = useMemo(
    () => groupContextBlocks(activeSnapshot?.blocks ?? []),
    [activeSnapshot],
  );
  const blockOriginSteps = useMemo(
    () => buildBlockOriginSteps(replay?.snapshots ?? []),
    [replay],
  );
  const selectedBlock =
    activeSnapshot?.blocks.find((block) => block.id === selectedBlockId) ??
    activeSnapshot?.blocks[0] ??
    null;

  const [replayPlaying, setReplayPlaying] = useState(false);
  const [factoryOpen, setFactoryOpen] = useState(false);

  function activateSnapshot(index: number, shouldFocus = false) {
    if (!replay?.snapshots.length) return;
    const nextSnapshot = replay.snapshots[index];
    if (!nextSnapshot) return;
    setSelectedSnapshotId(nextSnapshot.id);
    setSelectedBlockId(null);
    if (shouldFocus) {
      requestAnimationFrame(() => {
        const button = snapshotButtonRefs.current[nextSnapshot.id];
        button?.focus();
        button?.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
    }
  }

  useEffect(() => {
    if (!replayPlaying || !replay) return;
    if (activeSnapshotIndex >= replay.snapshots.length - 1) {
      setReplayPlaying(false);
      return;
    }
    const timer = setTimeout(
      () => activateSnapshot(activeSnapshotIndex + 1),
      2000,
    );
    return () => clearTimeout(timer);
  }, [replayPlaying, activeSnapshotIndex, replay]);

  // Stop playback on manual snapshot or block interaction
  function handleDotOrBlockSelect(id: string) {
    setReplayPlaying(false);
    handleSelectBlock(id);
  }

  function handleUserActivateSnapshot(index: number, focus = false) {
    setReplayPlaying(false);
    activateSnapshot(index, focus);
  }

  function nextSnapshotIndexForKey(key: string) {
    if (!replay?.snapshots.length || activeSnapshotIndex < 0) return null;
    const lastIndex = replay.snapshots.length - 1;
    if (key === "ArrowRight")
      return Math.min(lastIndex, activeSnapshotIndex + 1);
    if (key === "ArrowLeft") return Math.max(0, activeSnapshotIndex - 1);
    if (key === "Home") return 0;
    if (key === "End") return lastIndex;
    return null;
  }

  function handleSnapshotKeyDown(event: React.KeyboardEvent) {
    if (factoryOpen) return;
    const nextIndex = nextSnapshotIndexForKey(event.key);
    if (nextIndex === null) return;
    event.preventDefault();
    event.stopPropagation();
    handleUserActivateSnapshot(nextIndex, true);
  }

  useEffect(() => {
    setSelectedSnapshotId((current) => {
      if (!replay?.snapshots.length) return null;
      return current &&
        replay.snapshots.some((snapshot) => snapshot.id === current)
        ? current
        : (replay.snapshots.at(-1)?.id ?? null);
    });
  }, [replay]);

  useEffect(() => {
    setSelectedBlockId((current) => {
      if (!activeSnapshot?.blocks.length) return null;
      return current &&
        activeSnapshot.blocks.some((block) => block.id === current)
        ? current
        : activeSnapshot.blocks[0].id;
    });
  }, [activeSnapshot]);

  useEffect(() => {
    function shouldIgnoreShortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName.toLowerCase();
      return (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select" ||
        Boolean(target?.isContentEditable)
      );
    }

    function handleGlobalKeyDown(event: KeyboardEvent) {
      if (shouldIgnoreShortcut(event)) return;
      // When factory overlay is open, only allow arrow navigation (switch snapshots),
      // pause WASD block navigation.
      if (factoryOpen) {
        const idx = nextSnapshotIndexForKey(event.key);
        if (idx !== null && idx !== activeSnapshotIndex) {
          event.preventDefault();
          handleUserActivateSnapshot(idx, true);
        }
        return;
      }

      const nextIndex = nextSnapshotIndexForKey(event.key);
      if (nextIndex !== null) {
        if (nextIndex === activeSnapshotIndex) return;
        event.preventDefault();
        handleUserActivateSnapshot(nextIndex, true);
        return;
      }

      const blocks = activeSnapshot?.blocks ?? [];
      if (blocks.length === 0) return;
      const lowered = event.key.toLowerCase();
      const isPrev = lowered === "a" || lowered === "w";
      const isNext = lowered === "d" || lowered === "s";
      if (!isPrev && !isNext) return;
      const currentBlockIndex = blocks.findIndex(
        (block) => block.id === selectedBlockId,
      );
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
  }, [
    activeSnapshotIndex,
    replay,
    activeSnapshot,
    selectedBlockId,
    factoryOpen,
  ]);

  if (loading && !replay) {
    return (
      <section
        className="context-replay-panel"
        aria-label={copy.contextReplayLedgerAria}
      >
        <div className="context-replay-loading">
          {copy.contextReplayLoading}
        </div>
      </section>
    );
  }

  if (!replay || !activeSnapshot) {
    return (
      <section
        className="context-replay-panel"
        aria-label={copy.contextReplayLedgerAria}
      >
        <p className="muted">{copy.contextReplayEmpty}</p>
      </section>
    );
  }

  return (
    <section
      ref={panelRef}
      className="context-replay-panel"
      aria-label={copy.contextReplayLedgerAria}
    >
      <div ref={headerRef} className="context-replay-header">
        <div className="context-replay-summary">
          <div>
            <span>{copy.contextReplayTab}</span>
            {replay && replay.snapshots.length > 1 ? (
              <button
                type="button"
                className="replay-play-btn"
                aria-label={
                  replayPlaying
                    ? copy.contextReplayAutoStop
                    : copy.contextReplayAutoReplay
                }
                onClick={() => {
                  if (replayPlaying) {
                    setReplayPlaying(false);
                    return;
                  }
                  if (activeSnapshotIndex >= replay.snapshots.length - 1)
                    activateSnapshot(0);
                  setReplayPlaying(true);
                }}
              >
                {replayPlaying ? <Pause size={12} /> : <Play size={12} />}
              </button>
            ) : null}
            {replay ? (
              <button
                type="button"
                className="share-btn"
                aria-label={copy.share}
                title={copy.share}
                onClick={() => setShareOpen(true)}
              >
                <Share2 size={12} />
              </button>
            ) : null}
            <strong>{replay.journey.title}</strong>
            <p>{copy.contextReplayObserved}</p>
          </div>
          <div
            className="context-replay-metrics"
            role="group"
            aria-label={copy.contextReplayLedgerAria}
          >
            <div className="context-replay-metric">
              <span>{copy.contextReplayInput}</span>
              <strong>
                {activeSnapshot.tokenUsage
                  ? formatMillionTokens(activeSnapshot.tokenUsage.input)
                  : "—"}
              </strong>
            </div>
            <div className="context-replay-metric">
              <span>{copy.contextReplayOutput}</span>
              <strong>
                {activeSnapshot.tokenUsage
                  ? formatMillionTokens(activeSnapshot.tokenUsage.output)
                  : "—"}
              </strong>
            </div>
            <div className="context-replay-metric">
              <span>{copy.contextReplayTokenUsage}</span>
              <strong>
                {activeSnapshot.tokenUsage
                  ? formatMillionTokens(activeSnapshot.tokenUsage.total)
                  : "—"}
              </strong>
            </div>
            <div className="context-replay-metric">
              <span>{copy.contextReplayBlocks}</span>
              <strong>{replay.blocks.length}</strong>
            </div>
            <div className="context-replay-metric">
              <span>{copy.contextReplaySkills}</span>
              <strong>{replay.journey.skills.length}</strong>
            </div>
          </div>
          {replay.journey.skills.length > 0 ? (
            <div className="context-session-skills">
              <span className="skill-chip-label">{copy.skills}</span>
              <ul className="skill-chip-row" aria-label={copy.skills}>
                {replay.journey.skills.map((skill) => (
                  <li key={`${skill.name}-${skill.source}-${skill.path ?? ""}`}>
                    <span
                      className="skill-chip"
                      title={[
                        skill.source,
                        skill.path ?? skill.command ?? skill.evidencePath,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    >
                      {skill.name}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div
          className="context-snapshot-rail"
          aria-label={copy.contextReplaySnapshotRail}
        >
          {replay.snapshots.map((snapshot, index) => (
            <Tooltip
              key={snapshot.id}
              text={`${copy.contextReplayStep} ${index + 1}: ${snapshot.title}`}
            >
              <button
                ref={(button) => {
                  snapshotButtonRefs.current[snapshot.id] = button;
                }}
                type="button"
                className={snapshot.id === activeSnapshot.id ? "active" : ""}
                aria-current={
                  snapshot.id === activeSnapshot.id ? "step" : undefined
                }
                aria-label={`${copy.contextReplayStep} ${index + 1}: ${snapshot.title}`}
                tabIndex={snapshot.id === activeSnapshot.id ? 0 : -1}
                onClick={() => handleUserActivateSnapshot(index)}
                onKeyDown={handleSnapshotKeyDown}
              >
                <b className="context-snapshot-index">{index + 1}</b>
                <span>{snapshot.phase}</span>
                <strong>{snapshot.title}</strong>
                <em>
                  +{snapshot.addedBlockIds.length} / -
                  {snapshot.droppedBlockIds.length}
                </em>
              </button>
            </Tooltip>
          ))}
        </div>

        <span className="hotkey-hint" aria-hidden="true">
          {copy.hotkeyHint}
        </span>
      </div>

      <div className="context-replay-body">
        <div className="context-replay-workspace">
          <div className="context-ledger-groups" ref={ledgerContainerRef}>
            {activeSnapshot.warnings.length > 0 ||
            replay.warnings.length > 0 ? (
              <div
                className="context-warning-strip"
                aria-label={copy.contextReplayWarnings}
              >
                {(activeSnapshot.warnings.length > 0
                  ? activeSnapshot.warnings
                  : replay.warnings
                ).map((warning) => (
                  <button
                    type="button"
                    className={`context-warning ${warning.severity}`}
                    key={warning.id}
                    disabled={warning.blockIds.length === 0}
                    onClick={() =>
                      warning.blockIds[0] &&
                      handleSelectBlock(warning.blockIds[0])
                    }
                    title={
                      warning.blockIds.length > 0
                        ? copy.contextReplayWarningJump
                        : undefined
                    }
                  >
                    <span>{warning.severity}</span>
                    <strong>{warning.title}</strong>
                    <p>{warning.detail}</p>
                  </button>
                ))}
              </div>
            ) : null}
            <ContextBlockGroup
              copy={copy}
              title={copy.contextReplayAdded}
              blocks={groups.added}
              blockOriginSteps={blockOriginSteps}
              selectedBlockId={selectedBlock?.id ?? null}
              onSelectBlock={handleDotOrBlockSelect}
            />
            <ContextBlockGroup
              copy={copy}
              title={copy.contextReplayActiveContext}
              blocks={groups.active}
              blockOriginSteps={blockOriginSteps}
              selectedBlockId={selectedBlock?.id ?? null}
              onSelectBlock={handleDotOrBlockSelect}
            />
            <ContextBlockGroup
              copy={copy}
              title={copy.contextReplayChanged}
              blocks={groups.changed}
              blockOriginSteps={blockOriginSteps}
              selectedBlockId={selectedBlock?.id ?? null}
              onSelectBlock={handleDotOrBlockSelect}
            />
            <ContextBlockGroup
              copy={copy}
              title={copy.contextReplayDropped}
              blocks={groups.dropped}
              blockOriginSteps={blockOriginSteps}
              selectedBlockId={selectedBlock?.id ?? null}
              onSelectBlock={handleDotOrBlockSelect}
            />
          </div>
          {factoryOpen ? (
            <div
              className="factory-overlay"
              onClick={() => setFactoryOpen(false)}
            >
              <div
                className="factory-overlay-panel"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="factory-overlay-header">
                  <span>Context Timeline</span>
                  <button
                    type="button"
                    className="factory-overlay-close"
                    onClick={() => setFactoryOpen(false)}
                  >
                    ✕
                  </button>
                </div>
                <FactoryStrip
                  copy={copy}
                  snapshots={replay.snapshots}
                  activeSnapshotId={activeSnapshot.id}
                  activeSnapshotIndex={activeSnapshotIndex}
                  blockOriginSteps={blockOriginSteps}
                  selectedBlockId={selectedBlock?.id ?? null}
                  onSelectBlock={handleDotOrBlockSelect}
                  onActivateSnapshot={(index) => {
                    handleUserActivateSnapshot(index);
                  }}
                />
              </div>
            </div>
          ) : null}
          {shareOpen ? (
            <ShareCard
              copy={copy}
              replay={replay}
              activeSnapshot={activeSnapshot}
              activeSnapshotIndex={activeSnapshotIndex}
              projectName={selectedProjectName}
              onClose={() => setShareOpen(false)}
              onCopy={showToast}
            />
          ) : null}

          {toastMessage ? (
            <div className="share-toast" role="status" aria-live="polite">
              {toastMessage}
            </div>
          ) : null}
        </div>

        <div
          className="context-mini-scene"
          aria-label={copy.contextReplayMiniSceneAria}
        >
          <MiniScene
            copy={copy}
            blocks={activeSnapshot.blocks}
            warnings={activeSnapshot.warnings}
            blockOriginSteps={blockOriginSteps}
            selectedBlockId={selectedBlock?.id ?? null}
            onSelectBlock={handleDotOrBlockSelect}
          />
          <button
            type="button"
            className="factory-expand-btn"
            aria-label="Context Timeline"
            onClick={() => setFactoryOpen((o) => !o)}
          >
            <Clock size={13} />
          </button>
        </div>
      </div>
    </section>
  );
}

type HeroKind = "cache" | "tokens" | "duration" | "risk" | "failed" | "default";

interface HeroPick {
  kind: HeroKind;
  stat: string;
  caption: string;
  tone: "orange" | "danger" | "success";
}

/** Clean a snapshot title for display in the share card — strip raw commands and truncate. */
function sanitizeShareTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  const cleaned = title.replace(/['"`]/g, "").replace(/\s+/g, " ").trim();
  // If the result looks like a shell command or JSON payload (>50% non-alpha chars), skip it
  const alpha = cleaned.replace(/[^a-zA-Z0-9一-鿿\s]/g, "").length;
  if (cleaned.length > 0 && alpha / cleaned.length < 0.4) return null;
  return cleaned.length > 80 ? `${cleaned.slice(0, 78)}...` : cleaned;
}

function pickHeroStat(
  copy: AppCopy["timeline"],
  replay: ContextReplayResponse,
  failedStepIndex: number,
  totalWarnings: number,
): HeroPick {
  const journey = replay.journey;
  const usage = journey.tokenUsage;
  const steps = replay.snapshots.length;
  const total = usage?.total ?? 0;
  const input = usage?.input ?? 0;
  const cached = usage?.cachedInput ?? 0;
  const cacheRatio = input > 0 ? cached / input : 0;
  const cachePct = `${Math.max(0, Math.min(100, cacheRatio * 100)).toFixed(0)}%`;

  if (journey.status === "failed" && failedStepIndex >= 0) {
    return {
      kind: "failed",
      stat: copy.shareHeroFailedStep(failedStepIndex + 1),
      caption: copy.shareCaptionFailed,
      tone: "danger",
    };
  }
  if (totalWarnings >= 2) {
    return {
      kind: "risk",
      stat: copy.shareHeroRiskSignals(totalWarnings),
      caption: copy.shareCaptionRiskSignals,
      tone: "danger",
    };
  }
  if (cacheRatio >= 0.7 && input > 0) {
    return {
      kind: "cache",
      stat: copy.shareHeroCacheHit(cachePct),
      caption: copy.shareCaptionCacheHit(formatMillionTokens(cached), steps),
      tone: "success",
    };
  }
  if (total >= 1_000_000) {
    return {
      kind: "tokens",
      stat: copy.shareHeroBigTokens(formatMillionTokens(total)),
      caption: copy.shareCaptionBigTokens(steps),
      tone: "orange",
    };
  }
  if (journey.durationMs >= 10 * 60 * 1000) {
    return {
      kind: "duration",
      stat: copy.shareHeroLongRun(formatDuration(journey.durationMs)),
      caption: copy.shareCaptionLongRun(steps),
      tone: "orange",
    };
  }
  return {
    kind: "default",
    stat: copy.shareHeroStepReplay(steps),
    caption: copy.shareCaptionStepReplay(formatDuration(journey.durationMs)),
    tone: "orange",
  };
}

const PHASE_TONES: Record<string, string> = {
  prompt: "var(--blue, var(--orange))",
  history: "var(--muted)",
  planning: "var(--orange)",
  tool_call: "var(--orange)",
  tool_result: "var(--success)",
  file_change: "var(--orange)",
  verification: "var(--success)",
  response: "var(--success)",
};

function ShareCard({
  copy,
  replay,
  activeSnapshot,
  activeSnapshotIndex,
  projectName,
  onClose,
  onCopy,
}: {
  copy: AppCopy["timeline"];
  replay: ContextReplayResponse;
  activeSnapshot: ContextSnapshot;
  activeSnapshotIndex: number;
  projectName: string;
  onClose: () => void;
  onCopy: (msg: string) => void;
}) {
  const snapshots = replay.snapshots;
  const snapshotCount = snapshots.length;
  const journey = replay.journey;
  const journeyUsage = journey.tokenUsage;
  const provider = providerFromSessionId(journey.sessionId);
  const providerLabel = labelForProvider(provider) || copy.shareProviderUnknown;

  // Aggregate warnings across all snapshots + replay-level warnings (dedupe by id)
  const warningSet = new Map<string, true>();
  for (const w of replay.warnings) warningSet.set(w.id, true);
  for (const snap of snapshots)
    for (const w of snap.warnings) warningSet.set(w.id, true);
  const totalWarnings = warningSet.size;

  // Find the failed snapshot index, if any (based on phase tone heuristic from journey.status)
  const failedSnapshotIndex =
    journey.status === "failed" ? Math.max(0, snapshots.length - 1) : -1;

  const hero = pickHeroStat(copy, replay, failedSnapshotIndex, totalWarnings);

  // Story summary: use the full journey title (CSS wraps long text)
  const rawTitle = (journey.title ?? "").trim().replace(/\s+/g, " ");
  const fullTitle = rawTitle || activeSnapshot.title;
  const storyLine = copy.shareStoryTemplate(
    providerLabel,
    snapshotCount,
    fullTitle,
  );

  // Skills: top 3 unique by name
  const seenSkillNames = new Set<string>();
  const topSkills: string[] = [];
  for (const s of journey.skills) {
    if (!s.name || seenSkillNames.has(s.name)) continue;
    seenSkillNames.add(s.name);
    topSkills.push(s.name);
    if (topSkills.length >= 3) break;
  }
  const skillsLine =
    topSkills.length > 0 ? copy.shareSkillsUsed(topSkills.join(", ")) : null;

  // Verdict
  let verdictLabel: string;
  let verdictNote: string;
  let verdictTone: "success" | "danger" | "orange";
  if (journey.status === "success") {
    verdictLabel = copy.shareVerdictCleared;
    verdictTone = "success";
    const verificationSnap = [...snapshots]
      .reverse()
      .find((s) => s.phase === "verification");
    const cleanTitle = sanitizeShareTitle(verificationSnap?.title);
    verdictNote = cleanTitle
      ? `${copy.shareVerdictNoteCleared} (${cleanTitle})`
      : copy.shareVerdictNoteCleared;
  } else if (journey.status === "failed") {
    verdictLabel = copy.shareVerdictFailed;
    verdictTone = "danger";
    const lastSnap = snapshots[snapshots.length - 1];
    const cleanTitle = sanitizeShareTitle(lastSnap?.title);
    verdictNote = cleanTitle
      ? copy.shareVerdictNoteFailed(cleanTitle)
      : copy.shareCaptionFailed;
  } else {
    verdictLabel = copy.shareVerdictRunning;
    verdictTone = "orange";
    verdictNote = copy.shareVerdictNoteRunning;
  }

  // Stats compact footer
  const kvPct = formatKvHitRate(journeyUsage);
  const compactStats = copy.shareStatsCompact(
    `${formatMillionTokens(journeyUsage?.total ?? 0)} ${copy.tokens}`,
    formatDuration(journey.durationMs),
    kvPct,
  );

  // Token sparkline data from per-snapshot totals
  const snapshotTotals = snapshots.map((s) => s.tokenUsage?.total ?? 0);
  const maxSnapshotTotal = Math.max(1, ...snapshotTotals);

  const now = new Date();
  const verdictSign =
    verdictTone === "success" ? "+" : verdictTone === "danger" ? "x" : "~";

  function buildPlainText() {
    const lines: string[] = [];
    lines.push(`${hero.stat}`);
    lines.push(hero.caption);
    lines.push("");
    lines.push(storyLine);
    if (skillsLine) lines.push(skillsLine);
    lines.push("");
    lines.push(`${verdictSign} ${verdictLabel} — ${verdictNote}`);
    if (totalWarnings > 0 && hero.kind !== "risk" && hero.kind !== "failed") {
      lines.push(copy.shareVerdictRisks(totalWarnings));
    }
    lines.push("");
    lines.push(
      `${snapshotCount} ${copy.contextReplayStep.toLowerCase()}s · ${compactStats}`,
    );
    lines.push(
      `${projectName || journey.projectId} · ${now.toLocaleDateString()}`,
    );
    return lines.join("\n");
  }

  function buildMarkdown() {
    const lines: string[] = [];
    lines.push(`## ${hero.stat}`);
    lines.push("");
    lines.push(hero.caption);
    lines.push("");
    lines.push(`> ${storyLine}`);
    if (skillsLine) {
      lines.push("");
      lines.push(`_${skillsLine}_`);
    }
    lines.push("");
    lines.push(`**${verdictLabel}** — ${verdictNote}`);
    if (totalWarnings > 0 && hero.kind !== "risk" && hero.kind !== "failed") {
      lines.push("");
      lines.push(`> ${copy.shareVerdictRisks(totalWarnings)}`);
    }
    lines.push("");
    lines.push(
      `\`${snapshotCount} ${copy.contextReplayStep.toLowerCase()}s · ${compactStats}\``,
    );
    lines.push("");
    lines.push(
      `_${projectName || journey.projectId} · ${now.toLocaleDateString()} · SuperView_`,
    );
    return lines.join("\n");
  }

  async function handleCopyPlain() {
    try {
      await navigator.clipboard.writeText(buildPlainText());
      onCopy(copy.shareCopied);
    } catch {
      onCopy("Failed to copy");
    }
  }

  async function handleCopyMarkdown() {
    try {
      await navigator.clipboard.writeText(buildMarkdown());
      onCopy(copy.shareCopied);
    } catch {
      onCopy("Failed to copy");
    }
  }

  return (
    <div className="share-overlay" onClick={onClose}>
      <div className="share-card" onClick={(e) => e.stopPropagation()}>
        <div className="share-card-header">
          <div className="share-card-header-brand">
            <strong>SuperView</strong>
            <span>{copy.shareCardTitle}</span>
          </div>
          <button
            type="button"
            className="share-card-close"
            onClick={onClose}
            aria-label={copy.shareClose}
          >
            ✕
          </button>
        </div>

        <div className="share-card-body">
          <div className={`share-card-hero share-card-hero--${hero.tone}`}>
            <div className="share-card-hero-stat">{hero.stat}</div>
            <div className="share-card-hero-caption">{hero.caption}</div>
          </div>

          <div className="share-card-story">
            <p className="share-card-story-line">{storyLine}</p>
            {skillsLine ? (
              <p className="share-card-story-skills">{skillsLine}</p>
            ) : null}
          </div>

          <div
            className={`share-card-verdict share-card-verdict--${verdictTone}`}
          >
            <span className="share-card-verdict-mark" aria-hidden="true">
              {verdictSign}
            </span>
            <span className="share-card-verdict-label">{verdictLabel}</span>
            <span className="share-card-verdict-note">{verdictNote}</span>
          </div>

          {totalWarnings > 0 &&
          hero.kind !== "risk" &&
          hero.kind !== "failed" ? (
            <div className="share-card-risks">
              <AlertTriangle size={12} aria-hidden="true" />
              <span>{copy.shareVerdictRisks(totalWarnings)}</span>
            </div>
          ) : null}

          <div
            className="share-card-visual"
            role="img"
            aria-label={copy.shareTimelineAria}
          >
            <div className="share-card-spark">
              {snapshots.map((snap, idx) => {
                const total = snapshotTotals[idx];
                const height = Math.max(
                  8,
                  Math.round((total / maxSnapshotTotal) * 100),
                );
                const color = PHASE_TONES[snap.phase] ?? "var(--orange)";
                const isActive = idx === activeSnapshotIndex;
                return (
                  <span
                    key={snap.id}
                    className={`share-card-spark-bar${isActive ? " active" : ""}`}
                    style={{ height: `${height}%`, background: color }}
                    title={`${snap.phase} · step ${idx + 1}`}
                  />
                );
              })}
            </div>
          </div>

          <div className="share-card-stats-footer">
            <span className="share-card-stats-compact">
              {snapshotCount} {copy.contextReplayStep.toLowerCase()}s ·{" "}
              {compactStats}
            </span>
            <span className="share-card-stats-project">
              {projectName || journey.projectId} · {now.toLocaleDateString()}
            </span>
          </div>
        </div>

        <div className="share-card-actions">
          <button
            type="button"
            className="share-card-btn"
            onClick={handleCopyPlain}
          >
            {copy.shareCopy}
          </button>
          <button
            type="button"
            className="share-card-btn"
            onClick={handleCopyMarkdown}
          >
            {copy.shareCopyMarkdown}
          </button>
        </div>
      </div>
    </div>
  );
}

function ContextBlockGroup({
  copy,
  title,
  blocks,
  blockOriginSteps,
  selectedBlockId,
  onSelectBlock,
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
            title={`${block.title}${block.excerpt ? ` — ${block.excerpt}` : ""}`}
          >
            <div className="context-block-card-heading">
              <b>{blockOriginSteps.get(block.id) ?? 1}</b>
              <RetiredStateIcon state={block.state} />
              <span>{block.state}</span>
              <em>{block.type}</em>
              <em>
                {copy.contextReplayFromStep(
                  blockOriginSteps.get(block.id) ?? 1,
                )}
              </em>
            </div>
            <strong>{block.title}</strong>
            <p>{block.excerpt}</p>
            <div className="context-block-meta">
              <span>
                {copy.contextReplaySource}:{" "}
                {block.sourcePath ?? block.sourceEventId ?? "inferred"}
              </span>
              <span>
                {copy.contextReplayTokens}: {block.tokenEstimate}
              </span>
            </div>
            <small>
              {copy.contextReplayReason}: {block.reason}
            </small>
          </button>
        ))}
      </div>
    </section>
  );
}

function isRetiredContextState(state: ContextBlock["state"]) {
  return state === "dropped" || state === "stale" || state === "contradicted";
}

function RetiredStateIcon({ state }: { state: ContextBlock["state"] }) {
  if (state === "dropped") return <ArchiveX size={12} aria-hidden="true" />;
  if (state === "stale") return <Clock size={12} aria-hidden="true" />;
  if (state === "contradicted") return <Ban size={12} aria-hidden="true" />;
  return null;
}

function MiniScene({
  copy,
  blocks,
  warnings,
  blockOriginSteps,
  selectedBlockId,
  onSelectBlock,
}: {
  copy: AppCopy["timeline"];
  blocks: ContextBlock[];
  warnings: ContextSnapshot["warnings"];
  blockOriginSteps: Map<string, number>;
  selectedBlockId: string | null;
  onSelectBlock: (blockId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevPositions = useRef<Map<string, { x: number; y: number }>>(
    new Map(),
  );
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
  if (lastBlocksRef.current !== blocks) {
    const container = containerRef.current;
    if (container) {
      const positions = new Map<string, { x: number; y: number }>();
      const rect = container.getBoundingClientRect();
      for (const dot of container.querySelectorAll<HTMLElement>(
        ".context-flow-dot",
      )) {
        const blockId = dot.dataset.blockId;
        if (!blockId) continue;
        const dotRect = dot.getBoundingClientRect();
        positions.set(blockId, {
          x: dotRect.left - rect.left,
          y: dotRect.top - rect.top,
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
    for (const dot of container.querySelectorAll<HTMLElement>(
      ".context-flow-dot",
    )) {
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
    <div
      ref={containerRef}
      className="context-mini-scene-inner"
      aria-label={copy.contextReplayMiniSceneAria}
    >
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
  copy,
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
  index,
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

function TokenTimeline({
  copy,
  journeys,
  selectedProjectName,
  selectedJourneyId,
  onSelectJourney,
  onClose,
}: {
  copy: AppCopy["timeline"];
  journeys: TaskJourney[];
  selectedProjectName: string;
  selectedJourneyId: string | null;
  onSelectJourney: (id: string) => void;
  onClose: () => void;
}) {
  const stats = useMemo(() => {
    let totalTokens = 0;
    let totalInput = 0;
    let totalOutput = 0;
    let totalCached = 0;
    let peakJourney: TaskJourney | null = null;
    let peakTotal = 0;
    for (const j of journeys) {
      const t = j.tokenUsage?.total ?? 0;
      totalTokens += t;
      totalInput += j.tokenUsage?.input ?? 0;
      totalOutput += j.tokenUsage?.output ?? 0;
      totalCached += j.tokenUsage?.cachedInput ?? 0;
      if (t > peakTotal) {
        peakTotal = t;
        peakJourney = j;
      }
    }
    return {
      totalTokens,
      totalInput,
      totalOutput,
      totalCached,
      peakJourney,
      peakTotal,
      count: journeys.length,
    };
  }, [journeys]);

  const maxTotal = Math.max(stats.peakTotal, 1);
  const ordered = useMemo(
    () =>
      [...journeys].sort(
        (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt),
      ),
    [journeys],
  );

  return (
    <div className="token-timeline">
      <div className="token-timeline-summary">
        <div className="token-timeline-summary-project">
          {selectedProjectName}
        </div>
        <div className="token-timeline-summary-stats">
          <div className="token-timeline-stat">
            <span>
              {(copy.statusLegendSuccess && "Conversations") || "Conversations"}
            </span>
            <strong>{stats.count}</strong>
          </div>
          <div className="token-timeline-stat">
            <span>Total</span>
            <strong>{formatMillionTokens(stats.totalTokens)}</strong>
          </div>
          <div className="token-timeline-stat">
            <span>Input</span>
            <strong style={{ color: "var(--blue)" }}>
              {formatMillionTokens(stats.totalInput)}
            </strong>
          </div>
          <div className="token-timeline-stat">
            <span>Output</span>
            <strong style={{ color: "var(--orange)" }}>
              {formatMillionTokens(stats.totalOutput)}
            </strong>
          </div>
          <div className="token-timeline-stat">
            <span>Cached</span>
            <strong style={{ color: "var(--success)" }}>
              {formatMillionTokens(stats.totalCached)}
            </strong>
          </div>
        </div>
      </div>

      <div className="token-timeline-legend">
        <span className="token-timeline-legend-item">
          <i className="seg input" />
          Input
        </span>
        <span className="token-timeline-legend-item">
          <i className="seg output" />
          Output
        </span>
        <span className="token-timeline-legend-item">
          <i className="seg cached" />
          Cached
        </span>
        <span className="token-timeline-legend-item">
          <i className="seg reasoning" />
          Reasoning
        </span>
      </div>

      <div className="token-timeline-bars">
        {ordered.map((journey, index) => {
          const usage = journey.tokenUsage ?? {
            input: 0,
            output: 0,
            reasoning: 0,
            cachedInput: 0,
            total: 0,
          };
          const total = usage.total;
          const heightPx = Math.max(8, (total / maxTotal) * 160);
          const isSelected = journey.id === selectedJourneyId;
          const inputPct = total > 0 ? (usage.input / total) * 100 : 0;
          const outputPct = total > 0 ? (usage.output / total) * 100 : 0;
          const cachedPct = total > 0 ? (usage.cachedInput / total) * 100 : 0;
          const reasoningPct = total > 0 ? (usage.reasoning / total) * 100 : 0;

          const tooltipText = `${journey.title}\n\n${formatMillionTokens(total)} tokens · ${formatDuration(journey.durationMs)} · ${journey.status}\nInput: ${formatMillionTokens(usage.input)} · Output: ${formatMillionTokens(usage.output)}\nCached: ${formatMillionTokens(usage.cachedInput)} · Reasoning: ${formatMillionTokens(usage.reasoning)}`;

          return (
            <Tooltip key={journey.id} text={tooltipText}>
              <button
                type="button"
                className={`token-timeline-bar ${journey.status}${isSelected ? " selected" : ""}`}
                onClick={() => {
                  onSelectJourney(journey.id);
                  onClose();
                }}
              >
                <div className="token-timeline-step">
                  <b>{index + 1}</b>
                </div>
                <div
                  className="token-timeline-stack"
                  style={{ height: `${heightPx}px` }}
                >
                  {reasoningPct > 0 ? (
                    <div
                      className="token-timeline-segment reasoning"
                      style={{ height: `${reasoningPct}%` }}
                    />
                  ) : null}
                  {outputPct > 0 ? (
                    <div
                      className="token-timeline-segment output"
                      style={{ height: `${outputPct}%` }}
                    />
                  ) : null}
                  {cachedPct > 0 ? (
                    <div
                      className="token-timeline-segment cached"
                      style={{ height: `${cachedPct}%` }}
                    />
                  ) : null}
                  {inputPct > 0 ? (
                    <div
                      className="token-timeline-segment input"
                      style={{ height: `${inputPct}%` }}
                    />
                  ) : null}
                </div>
                <span className="token-timeline-label">
                  {formatMillionTokens(total)}
                </span>
                <span className="token-timeline-title">{journey.title}</span>
              </button>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

function FactoryStrip({
  copy,
  snapshots,
  activeSnapshotId,
  activeSnapshotIndex,
  blockOriginSteps,
  selectedBlockId,
  onSelectBlock,
  onActivateSnapshot,
}: {
  copy: AppCopy["timeline"];
  snapshots: ContextSnapshot[];
  activeSnapshotId: string;
  activeSnapshotIndex: number;
  blockOriginSteps: Map<string, number>;
  selectedBlockId: string | null;
  onSelectBlock: (blockId: string) => void;
  onActivateSnapshot: (index: number) => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const activeEl = strip.querySelector(
      `[data-station-index="${activeSnapshotIndex}"]`,
    ) as HTMLElement | null;
    activeEl?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [activeSnapshotIndex]);

  return (
    <div
      ref={stripRef}
      className="context-factory-strip"
      aria-label={copy.contextReplayMiniSceneAria}
    >
      {snapshots.map((snapshot, index) => {
        const activeBlocks = snapshot.blocks.filter(
          (block) => block.state !== "dropped" && block.state !== "stale",
        );
        const droppedBlocks = snapshot.blocks.filter(
          (block) => block.state === "dropped" || block.state === "stale",
        );
        const isActive = snapshot.id === activeSnapshotId;
        const isFirst = index === 0;
        const added = snapshot.addedBlockIds.length;
        const removed = snapshot.droppedBlockIds.length;

        return (
          <FactoryStation
            key={snapshot.id}
            snapshot={snapshot}
            index={index}
            active={isActive}
            added={added}
            removed={removed}
            activeBlocks={activeBlocks}
            droppedBlocks={droppedBlocks}
            blockOriginSteps={blockOriginSteps}
            selectedBlockId={selectedBlockId}
            onSelectBlock={onSelectBlock}
            onActivate={onActivateSnapshot}
            copy={copy}
            isFirst={isFirst}
          />
        );
      })}
    </div>
  );
}

function FactoryStation({
  snapshot,
  index,
  active,
  added,
  removed,
  activeBlocks,
  droppedBlocks,
  blockOriginSteps,
  selectedBlockId,
  onSelectBlock,
  onActivate,
  copy,
  isFirst,
}: {
  snapshot: ContextSnapshot;
  index: number;
  active: boolean;
  added: number;
  removed: number;
  activeBlocks: ContextBlock[];
  droppedBlocks: ContextBlock[];
  blockOriginSteps: Map<string, number>;
  selectedBlockId: string | null;
  onSelectBlock: (blockId: string) => void;
  onActivate: (index: number) => void;
  copy: AppCopy["timeline"];
  isFirst: boolean;
}) {
  const Wrapper = active ? "div" : "button";

  return (
    <>
      {!isFirst ? (
        <div className="factory-station-connector">
          <span>→</span>
        </div>
      ) : null}
      <Wrapper
        type={active ? undefined : "button"}
        data-station-index={index}
        className={`factory-station${active ? " active" : ""}`}
        onClick={active ? undefined : () => onActivate(index)}
        aria-current={active ? "step" : undefined}
        aria-label={`${copy.contextReplayStep} ${index + 1}: ${snapshot.title}`}
        title={`${copy.contextReplayStep} ${index + 1}: ${snapshot.title}`}
      >
        <div className="factory-station-prompt" title={snapshot.title}>
          {snapshot.title}
        </div>
        <div className="factory-station-header">
          <span className="factory-station-phase">{snapshot.phase}</span>
          <b className="factory-station-index">{index + 1}</b>
          {added > 0 || removed > 0 ? (
            <span className="factory-station-delta">
              {added > 0 ? <em className="added">+{added}</em> : null}
              {removed > 0 ? <em className="removed">-{removed}</em> : null}
            </span>
          ) : null}
        </div>
        <div className="factory-station-blocks">
          {activeBlocks.length > 0 ? (
            activeBlocks.map((block) => (
              <button
                key={block.id}
                type="button"
                data-block-id={block.id}
                className={`factory-block-pill state-${block.state}${block.id === selectedBlockId ? " active" : ""}`}
                title={`${block.title} · ${block.state} · ${copy.contextReplayFromStep(blockOriginSteps.get(block.id) ?? 1)}`}
                aria-pressed={block.id === selectedBlockId}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectBlock(block.id);
                }}
              >
                {blockOriginSteps.get(block.id) ?? 1}
              </button>
            ))
          ) : (
            <span className="factory-station-empty">—</span>
          )}
        </div>
        {droppedBlocks.length > 0 ? (
          <div className="factory-station-drops">
            {droppedBlocks.map((block) => (
              <button
                key={block.id}
                type="button"
                data-block-id={block.id}
                className={`factory-block-pill dropped state-${block.state}`}
                title={`${block.title} · ${block.state}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectBlock(block.id);
                }}
              >
                {blockOriginSteps.get(block.id) ?? 1}
              </button>
            ))}
          </div>
        ) : null}
      </Wrapper>
    </>
  );
}

type SpineActionItem = {
  event: TimelineEvent;
  label: string;
  command: string | null;
  files: string[];
};

type SpineMove = {
  id: string;
  index: number;
  thoughtEvent: TimelineEvent | null;
  thoughtText: string | null;
  redacted: boolean;
  actions: SpineActionItem[];
  observeEvent: TimelineEvent | null;
  observeText: string | null;
  observeOk: boolean;
  outcomeLabel: string | null;
  hasObserve: boolean;
  isRedirect: boolean;
  eventIds: string[];
};

// Group the ordered event stream into think -> act -> observe "moves". A new
// move opens on each stated thought (assistant_message, or a redacted
// reasoning_marker when no message covers the span); tool calls and their
// results fold into the open move until the next thought boundary.
function buildSpineMoves(events: TimelineEvent[]): SpineMove[] {
  const moves: SpineMove[] = [];
  let current: SpineMove | null = null;

  const open = (
    event: TimelineEvent,
    redacted: boolean,
    withThought: boolean,
  ): SpineMove => {
    const move: SpineMove = {
      id: event.id,
      index: moves.length,
      thoughtEvent: withThought ? event : null,
      thoughtText:
        withThought && !redacted ? event.detail ?? event.title ?? null : null,
      redacted,
      actions: [],
      observeEvent: null,
      observeText: null,
      observeOk: true,
      outcomeLabel: null,
      hasObserve: false,
      isRedirect: false,
      eventIds: [event.id],
    };
    moves.push(move);
    return move;
  };

  for (const event of events) {
    switch (event.kind) {
      case "assistant_message":
        current = open(event, false, true);
        break;
      case "reasoning_marker":
        if (!current || current.actions.length > 0 || current.hasObserve) {
          current = open(event, true, true);
        }
        break;
      case "tool_call":
      case "file_change": {
        const move = current ?? (current = open(event, false, false));
        move.actions.push({
          event,
          label: event.toolName ?? event.kind,
          command: event.detail,
          files: event.files,
        });
        move.eventIds.push(event.id);
        break;
      }
      case "tool_result":
      case "verification":
      case "error": {
        const move = current ?? (current = open(event, false, false));
        move.observeEvent = event;
        move.observeText = event.detail ?? event.title ?? null;
        move.outcomeLabel = event.title ?? null;
        move.hasObserve = true;
        move.eventIds.push(event.id);
        if (event.status === "failed" || event.kind === "error") {
          move.observeOk = false;
        }
        break;
      }
      default:
        break;
    }
  }

  // A move is a redirect only when it contains a genuinely failed observation
  // and the agent kept going afterwards (a later move exists). The causal-edge
  // `failed_by`/`retried_by` signal is too noisy to corroborate here — those
  // edges fire from any step that precedes a later failure anywhere in the
  // session, so they light up on fully successful runs.
  return moves.map((move, index) => ({
    ...move,
    index,
    isRedirect: !move.observeOk && index < moves.length - 1,
  }));
}

function CausalSpine({
  copy,
  journey,
  detail,
  fallbackPrompt,
  loading,
  selectedEventId,
  onSelectEvent,
}: {
  copy: AppCopy["timeline"];
  journey: TaskJourney;
  detail: TaskJourneyDetail | null;
  fallbackPrompt: TimelineEvent | null;
  loading: boolean;
  selectedEventId: string | null;
  onSelectEvent: (event: TimelineEvent) => void;
}) {
  const events = detail?.events ?? [];
  const moves = useMemo(
    () => buildSpineMoves(events),
    [detail],
  );
  const [cur, setCur] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const moveRefs = useRef<(HTMLDivElement | null)[]>([]);

  const lastIndex = moves.length - 1;

  // Autoplay: advance one move at a time, then stop at the end.
  useEffect(() => {
    if (!playing) return;
    if (cur >= lastIndex) {
      setPlaying(false);
      return;
    }
    const id = window.setTimeout(
      () => setCur((c) => Math.min(lastIndex, c + 1)),
      1400,
    );
    return () => window.clearTimeout(id);
  }, [playing, cur, lastIndex]);

  // Keep the current move in view as the playhead advances.
  useEffect(() => {
    if (cur < 0) return;
    const el = moveRefs.current[cur];
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  }, [cur]);

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (cur >= lastIndex) setCur(-1);
    setPlaying(true);
  };

  const step = (delta: number) => {
    setPlaying(false);
    setCur((c) => Math.max(-1, Math.min(lastIndex, c + delta)));
  };

  const selectNode = (event: TimelineEvent, index: number) => {
    setPlaying(false);
    setCur(index);
    onSelectEvent(event);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      step(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      step(-1);
    } else if (e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      togglePlay();
    }
  };

  const onScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    setPlaying(false);
    const rect = e.currentTarget.getBoundingClientRect();
    const p = (e.clientX - rect.left) / rect.width;
    setCur(Math.max(-1, Math.min(lastIndex, Math.round(p * moves.length) - 1)));
  };

  if (loading && moves.length === 0) {
    return (
      <div className="spine-state" role="status" aria-live="polite">
        <span className="spine-loader" aria-hidden="true" />
        <p className="spine-state-title">{copy.loadingDetails}</p>
      </div>
    );
  }
  if (moves.length === 0) {
    return (
      <div className="spine-state spine-state-empty">
        <span className="spine-state-icon" aria-hidden="true">
          <ArchiveX size={26} />
        </span>
        <p className="spine-state-title">{copy.noBackground}</p>
      </div>
    );
  }

  const provider = providerFromSessionId(journey.sessionId);
  const prompt =
    fallbackPrompt ?? events.find((event) => event.kind === "user_prompt");
  const promptText = prompt?.detail ?? journey.title;
  const toolCalls = moves.reduce((n, m) => n + m.actions.length, 0);
  const corrections = moves.filter((m) => m.isRedirect).length;
  const pct = moves.length ? ((cur + 1) / moves.length) * 100 : 0;

  return (
    <div className="causal-spine" aria-label={copy.spineAria}>
      <header className="spine-header">
        <p className="spine-eyebrow">
          {copy.spineThought} → {copy.spineAction}
        </p>
        <h2 className="spine-title">{promptText}</h2>
        <div className="spine-runmeta">
          <div className="spine-m">
            <b>{moves.length}</b>
            <span>{copy.spineMoves}</span>
          </div>
          <div className="spine-m">
            <b>{toolCalls}</b>
            <span>{copy.spineToolCalls}</span>
          </div>
          <div className="spine-m">
            <b>{corrections}</b>
            <span>{copy.spineCorrections}</span>
          </div>
          <div className="spine-m">
            <b>{labelForProvider(provider)}</b>
            <span>{copy.shareProvider}</span>
          </div>
          {corrections > 0 ? (
            <span className="spine-pill redirect">
              <span className="spine-pill-dot" />
              {copy.spineRedirectedRun}
            </span>
          ) : null}
        </div>
      </header>

      <div className="spine-stage">
        <div
          className="spine-track"
          tabIndex={0}
          onKeyDown={onKeyDown}
          aria-label={copy.spineAria}
        >
          {moves.map((move) => {
            const played = move.index <= cur;
            const isCurrent = move.index === cur;
            return (
              <div
                key={move.id}
                ref={(el) => {
                  moveRefs.current[move.index] = el;
                }}
                className={`spine-move${move.isRedirect ? " is-redirect" : ""}${
                  played ? " played" : ""
                }${isCurrent ? " current" : ""}`}
              >
                <div className="spine-rail">
                  <span className="spine-station" />
                  <span className="spine-connector" />
                </div>
                <div className="spine-nodes">
                  {move.thoughtText || move.redacted ? (
                    <button
                      type="button"
                      className={`spine-node think${
                        move.thoughtEvent?.id === selectedEventId
                          ? " selected"
                          : ""
                      }`}
                      onClick={() =>
                        move.thoughtEvent
                          ? selectNode(move.thoughtEvent, move.index)
                          : setCur(move.index)
                      }
                    >
                      <span className="spine-role">
                        <Brain size={13} /> {copy.spineThought}
                      </span>
                      {move.redacted ? (
                        <div className="spine-effort">
                          <span className="spine-beats">
                            <i className="spine-beat hot" />
                            <i className="spine-beat hot" />
                            <i className="spine-beat hot" />
                          </span>
                          <span className="spine-effort-lbl">
                            {copy.spineRedacted}
                          </span>
                        </div>
                      ) : (
                        <div className="spine-body">{move.thoughtText}</div>
                      )}
                    </button>
                  ) : null}

                  {move.actions.length > 0 ? (
                    <button
                      type="button"
                      className={`spine-node act${
                        move.actions.some((a) => a.event.id === selectedEventId)
                          ? " selected"
                          : ""
                      }`}
                      onClick={() =>
                        selectNode(move.actions[0].event, move.index)
                      }
                    >
                      <span className="spine-role">
                        <Zap size={13} /> {copy.spineAction}
                      </span>
                      <div className="spine-act-list">
                        {move.actions.map((a) => (
                          <div className="spine-act-item" key={a.event.id}>
                            <span className="spine-verb">{a.label}</span>
                            {a.command ? (
                              <pre className="spine-pre">{a.command}</pre>
                            ) : null}
                            {a.files.length > 0 ? (
                              <div className="spine-files">
                                {a.files.map((f) => (
                                  <span className="spine-filechip" key={f}>
                                    {f}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </button>
                  ) : null}

                  {move.hasObserve ? (
                    <button
                      type="button"
                      className={`spine-node observe ${
                        move.observeOk ? "ok" : "err"
                      }${
                        move.observeEvent?.id === selectedEventId
                          ? " selected"
                          : ""
                      }`}
                      onClick={() =>
                        move.observeEvent
                          ? selectNode(move.observeEvent, move.index)
                          : setCur(move.index)
                      }
                    >
                      <span className="spine-role">
                        {move.observeOk ? <Check size={13} /> : <X size={13} />}{" "}
                        {copy.spineObserved}
                        {move.outcomeLabel ? (
                          <>
                            {" · "}
                            <span
                              className={`spine-outcome ${
                                move.observeOk ? "ok" : "err"
                              }`}
                            >
                              {move.outcomeLabel}
                            </span>
                          </>
                        ) : null}
                      </span>
                      {move.observeText ? (
                        <pre className="spine-pre">{move.observeText}</pre>
                      ) : null}
                      {move.isRedirect ? (
                        <div className="spine-redirect-tag">
                          <CornerUpLeft size={12} /> {copy.spineCourseCorrected}
                        </div>
                      ) : null}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <nav className="spine-minimap" aria-label={copy.spineAria}>
          <div className="spine-mtrack">
            {moves.map((move) => (
              <button
                key={move.id}
                type="button"
                className={`spine-mbtn${move.observeOk ? "" : " err"}${
                  move.isRedirect ? " redirect" : ""
                }${move.index === cur ? " current" : ""}`}
                title={`${copy.spineMoves} ${move.index + 1}`}
                onClick={() => {
                  setPlaying(false);
                  setCur(move.index);
                }}
              >
                <span className="spine-seg" />
              </button>
            ))}
          </div>
        </nav>
      </div>

      <div className="spine-transport" role="group" aria-label={copy.spineAria}>
        <button
          type="button"
          className="spine-tbtn primary"
          onClick={togglePlay}
        >
          {playing ? (
            <>
              <Pause size={13} /> {copy.spinePause}
            </>
          ) : cur >= lastIndex ? (
            <>
              <RotateCw size={13} /> {copy.spineReplay}
            </>
          ) : (
            <>
              <Play size={13} /> {copy.spinePlay}
            </>
          )}
        </button>
        <button
          type="button"
          className="spine-tbtn"
          title={copy.spineStepPrev}
          aria-label={copy.spineStepPrev}
          onClick={() => step(-1)}
        >
          <ChevronUp size={14} />
        </button>
        <span className="spine-pos">
          {Math.max(0, cur + 1)} / {moves.length}
        </span>
        <button
          type="button"
          className="spine-tbtn"
          title={copy.spineStepNext}
          aria-label={copy.spineStepNext}
          onClick={() => step(1)}
        >
          <ChevronDown size={14} />
        </button>
        <div
          className="spine-scrub"
          role="slider"
          aria-label={copy.spineScrubAria}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
          tabIndex={0}
          onClick={onScrub}
        >
          <div
            className="spine-scrub-fill"
            style={{ transform: `scaleX(${pct / 100})` }}
          />
        </div>
      </div>
    </div>
  );
}

function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });
  const wrapperRef = useRef<HTMLSpanElement>(null);

  function show() {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    const top = rect.bottom + 8;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - 500));
    setPosition({ top, left });
    setOpen(true);
  }

  function move(event: React.MouseEvent) {
    const pad = 14;
    let left = event.clientX + pad;
    let top = event.clientY + pad;
    if (left + 260 > window.innerWidth) left = event.clientX - 260 - pad;
    if (top + 120 > window.innerHeight) top = event.clientY - 120 - pad;
    setPosition({ top, left });
  }

  return (
    <span
      ref={wrapperRef}
      onMouseEnter={show}
      onMouseMove={move}
      onMouseLeave={() => setOpen(false)}
      onFocus={show}
      onBlur={() => setOpen(false)}
      style={{ display: "contents" }}
    >
      {children}
      {open && text
        ? createPortal(
            <div
              className="app-tooltip"
              style={{ top: position.top, left: position.left }}
              role="tooltip"
            >
              {text}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

function OnboardingTour({
  step,
  totalSteps,
  copy,
  onPrev,
  onNext,
  onDone,
  onSkip,
}: {
  step: number;
  totalSteps: number;
  copy: TourCopy;
  onPrev: () => void;
  onNext: () => void;
  onDone: () => void;
  onSkip: () => void;
}) {
  const targetSelectors = [
    ".scan-dropdown-trigger",
    ".project-dropdown-trigger",
    ".session-recap",
    ".token-chart-panel",
    ".conversation-master-item",
    ".context-replay-panel",
    ".context-replay-summary",
    ".factory-expand-btn",
    ".timeline-chart-btn",
    ".theme-dropdown",
  ];
  const targetPaddings = [10, 10, 12, 12, 10, 12, 8, 6, 6, 12];
  const targetPlacements: Array<"bottom" | "top" | "right" | "left"> = [
    "bottom",
    "bottom",
    "top",
    "top",
    "left",
    "top",
    "bottom",
    "bottom",
    "bottom",
    "bottom",
  ];
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [skipped, setSkipped] = useState(false);

  const currentSelector = targetSelectors[step] ?? null;
  const currentPadding = targetPaddings[step] ?? 10;
  const currentPlacement = targetPlacements[step] ?? "bottom";

  const journeyTargetSelectors = [
    ".context-replay-panel",
    ".context-replay-summary",
    ".factory-expand-btn",
    ".timeline-chart-btn",
  ];
  useLayoutEffect(() => {
    if (window.innerWidth < 760) return;
    function openAncestorDetails(el: Element) {
      let cur: Element | null = el;
      while (cur) {
        if (cur instanceof HTMLDetailsElement && !cur.open) {
          cur.open = true;
        }
        cur = cur.parentElement;
      }
    }
    let el = currentSelector
      ? document.querySelector(currentSelector)
      : null;
    // If targeting elements inside a journey and none found, expand the first journey
    if (!el && currentSelector && journeyTargetSelectors.includes(currentSelector)) {
      const firstItem: HTMLElement | null = document.querySelector(".conversation-master-item");
      if (firstItem) firstItem.click();
      setTimeout(() => {
        const retry = currentSelector ? document.querySelector(currentSelector) : null;
        if (retry) {
          openAncestorDetails(retry);
          retry.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 300);
      setTargetRect(null);
      return;
    }
    if (!el) {
      setTargetRect(null);
      return;
    }
    openAncestorDetails(el);
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    function recalc() {
      const fresh = currentSelector
        ? document.querySelector(currentSelector)
        : null;
      if (!fresh) {
        setTargetRect(null);
        return;
      }
      const raw = fresh.getBoundingClientRect();
      setTargetRect(
        new DOMRect(
          raw.left - currentPadding,
          raw.top - currentPadding,
          raw.width + currentPadding * 2,
          raw.height + currentPadding * 2,
        ),
      );
    }
    recalc();
    window.addEventListener("resize", recalc);
    window.addEventListener("scroll", recalc, { passive: true });
    return () => {
      window.removeEventListener("resize", recalc);
      window.removeEventListener("scroll", recalc);
    };
  }, [step, currentSelector, currentPadding]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSkipped(true);
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  useEffect(() => {
    if (skipped) {
      setTransitioning(true);
      const timer = setTimeout(() => {
        onSkip();
      }, 160);
      return () => clearTimeout(timer);
    }
  }, [skipped, onSkip]);

  function handleNext() {
    if (transitioning) return;
    setTransitioning(true);
    setTimeout(() => {
      if (step < totalSteps - 1) {
        onNext();
      } else {
        onDone();
      }
      setTransitioning(false);
    }, 100);
  }

  function handlePrev() {
    if (transitioning) return;
    setTransitioning(true);
    setTimeout(() => {
      onPrev();
      setTransitioning(false);
    }, 100);
  }

  function handleDone() {
    setTransitioning(true);
    setTimeout(() => {
      onDone();
    }, 160);
  }

  if (window.innerWidth < 760) return null;

  const cardWidth = Math.min(400, window.innerWidth - 32);
  const cardHeight = 200; // approximate, used for positioning
  const gap = 12;

  function computeCardPosition() {
    if (!targetRect) {
      return {
        top: Math.max(16, (window.innerHeight - cardHeight) / 2),
        left: Math.max(16, (window.innerWidth - cardWidth) / 2),
      };
    }
    const placements = [currentPlacement, "bottom", "top", "right", "left"];
    const unique = [...new Set(placements)];
    for (const placement of unique) {
      let top = 0, left = 0;
      switch (placement) {
        case "bottom":
          top = targetRect.bottom + gap;
          left = targetRect.left;
          break;
        case "top":
          top = targetRect.top - gap - cardHeight;
          left = targetRect.left;
          break;
        case "right":
          top = targetRect.top;
          left = targetRect.right + gap;
          break;
        case "left":
          top = targetRect.top;
          left = targetRect.left - gap - cardWidth;
          break;
        default:
          break;
      }
      top = Math.max(16, Math.min(top, window.innerHeight - cardHeight - 16));
      left = Math.max(16, Math.min(left, window.innerWidth - cardWidth - 16));
      const cardRect = {
        top,
        left,
        right: left + cardWidth,
        bottom: top + cardHeight,
      };
      const overlap = !(
        cardRect.right < targetRect.left ||
        cardRect.left > targetRect.right ||
        cardRect.bottom < targetRect.top ||
        cardRect.top > targetRect.bottom
      );
      if (!overlap) return { top, left };
    }
    return {
      top: Math.max(16, (window.innerHeight - cardHeight) / 2),
      left: Math.max(16, (window.innerWidth - cardWidth) / 2),
    };
  }

  const cardPos = computeCardPosition();
  const stepData = copy.steps[step] ?? { title: "", detail: "" };

  return createPortal(
    <div className="tour-root">
      <div className="tour-backplate" />
      {targetRect && (
        <>
          <div
            className="tour-spotlight"
            style={{
              left: targetRect.left,
              top: targetRect.top,
              width: targetRect.width,
              height: targetRect.height,
              borderRadius: 8,
            }}
          />
          <div
            className="tour-spotlight-border"
            style={{
              left: targetRect.left,
              top: targetRect.top,
              width: targetRect.width,
              height: targetRect.height,
              borderRadius: 8,
            }}
          />
        </>
      )}
      <div
        className="tour-card"
        style={{
          top: cardPos.top,
          left: cardPos.left,
          opacity: transitioning ? 0 : 1,
        }}
      >
        <div className="tour-card-step-label">
          {copy.stepLabel(step + 1, totalSteps)}
        </div>
        <h3 className="tour-card-title">{stepData.title}</h3>
        <p className="tour-card-detail">{stepData.detail}</p>
        <div className="tour-card-progress">
          {Array.from({ length: totalSteps }, (_, i) => (
            <span
              key={i}
              className={`tour-step-dot${i === step ? " active" : ""}`}
            />
          ))}
        </div>
        <div className="tour-card-actions">
          <button type="button" className="tour-skip-btn" onClick={onSkip}>
            {copy.skip}
          </button>
          <div className="tour-nav-group">
            {step > 0 && (
              <button type="button" className="tour-nav-btn" onClick={handlePrev}>
                {copy.prev}
              </button>
            )}
            {step < totalSteps - 1 ? (
              <button
                type="button"
                className="tour-nav-btn tour-next-btn"
                onClick={handleNext}
              >
                {copy.next}
              </button>
            ) : (
              <button
                type="button"
                className="tour-nav-btn tour-done-btn"
                onClick={handleDone}
              >
                {copy.done}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Metric({
  metricKey,
  label,
  value,
  action,
  overlay,
}: {
  metricKey: MetricKey;
  label: string;
  value: number;
  action?: ReactNode;
  overlay?: ReactNode;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{formatMetricValue(metricKey, value)}</strong>
      {action ? <div className="metric-action">{action}</div> : null}
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

function BlockingLoader({
  copy,
  ingestCopy,
  message,
  job,
}: {
  copy: AppCopy["loading"];
  ingestCopy: IngestCopy;
  message: string;
  job?: IngestJob | null;
}) {
  const percent =
    job && job.totalFiles > 0
      ? Math.round((job.processedFiles / job.totalFiles) * 100)
      : 0;
  return (
    <div
      className="blocking-loader"
      role="status"
      aria-live="polite"
      aria-label={copy.aria}
    >
      <div className="blocking-loader-card">
        <div className="blocking-loader-message">
          <span className="blocking-loader-icon" aria-hidden="true" />
          <div>
            <strong>{message}</strong>
            <span>{copy.steady}</span>
          </div>
        </div>
        {job ? (
          <div className="blocking-loader-progress">
            <div className="blocking-loader-progress-bar">
              <i style={{ width: `${percent}%` }} />
            </div>
            <div className="blocking-loader-progress-meta">
              <span>
                {ingestCopy.phase}: {job.phase}
              </span>
              <span>
                {job.processedFiles}/{job.totalFiles} {ingestCopy.files}
              </span>
              <span>
                {ingestCopy.events}: {job.totalEvents}
              </span>
            </div>
          </div>
        ) : null}
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
  disabled = false,
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
        <select
          aria-label={copy.sourceAria}
          value={agentProvider}
          onChange={(event) =>
            onAgentProviderChange(event.target.value as AgentProvider)
          }
          disabled={disabled}
        >
          <option value="codex">Codex</option>
          <option value="claude-code">Claude Code</option>
          <option value="opencode">OpenCode</option>
        </select>
      </label>
      <label className="empty-agent-root">
        <span>{copy.root}</span>
        <input
          aria-label={copy.rootAria}
          value={agentLogRoot}
          onChange={(event) => onAgentLogRootChange(event.target.value)}
          placeholder={placeholder}
          disabled={disabled}
        />
      </label>
      <button className="primary-button" onClick={onScan} disabled={disabled}>
        {scanLabel}
      </button>
    </section>
  );
}

function filterProjectsByProvider(
  projects: ProjectWithSessions[],
  provider: ProjectProviderFilter,
) {
  if (provider === "all") return projects;
  return projects.filter((project) =>
    project.sessions.some(
      (session) =>
        session.provider === provider || session.id.startsWith(`${provider}:`),
    ),
  );
}

function filterProjectsBySearch(
  projects: ProjectWithSessions[],
  searchQuery: string,
) {
  const query = searchQuery.trim().toLowerCase();
  if (!query) return projects;
  return projects.filter((project) =>
    [project.name, project.cwd, project.repoRoot ?? ""].some((value) =>
      value.toLowerCase().includes(query),
    ),
  );
}

function providerSummary(project: ProjectWithSessions, copy: AppCopy) {
  const providers = new Set(
    project.sessions.map(
      (session) => session.provider ?? providerFromSessionId(session.id),
    ),
  );
  if (providers.size === 0) return copy.projectControls.noProvider;
  return [...providers].map(labelForProvider).join("+");
}

function formatExitType(
  exitType: TaskJourney["exitType"],
  copy: AppCopy["timeline"],
) {
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
  return remainingSeconds > 0
    ? `${minutes}m ${remainingSeconds}s`
    : `${minutes}m`;
}

function formatKvHitRate(usage: TokenUsage) {
  if (usage.input <= 0) return "0.0%";
  const ratio = (usage.cachedInput / usage.input) * 100;
  // Clamp to [0, 100] — cache hit rate is bounded by definition; any value above
  // 100% indicates an upstream adapter bug and should never reach the UI.
  return `${Math.max(0, Math.min(100, ratio)).toFixed(1)}%`;
}

function formatMetricValue(metricKey: MetricKey, value: number) {
  return metricKey === "tokens"
    ? formatMillionTokens(value)
    : value.toLocaleString();
}

function isIngestBusy(job: IngestJob | null) {
  return job?.status === "queued" || job?.status === "running";
}

function getBlockingMessage({
  copy,
  loading,
  timelineLoading,
  dailyTokenUsageLoading,
}: {
  copy: AppCopy;
  loading: boolean;
  timelineLoading: boolean;
  dailyTokenUsageLoading: boolean;
}) {
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
  dailyTokenUsageLoading,
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
  if (loading)
    return createLoaderJob("loading-projects", "scanning", 3, 12, message);
  if (timelineLoading)
    return createLoaderJob("loading-timeline", "normalizing", 7, 12, message);
  if (dailyTokenUsageLoading)
    return createLoaderJob("loading-token-usage", "parsing", 5, 12, message);
  return createLoaderJob("loading-superview", "scanning", 4, 12, message);
}

function createLoaderJob(
  id: string,
  phase: IngestJob["phase"],
  processedFiles: number,
  totalFiles: number,
  currentFile: string,
): IngestJob {
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
    currentFile,
  };
}

// ── Tool Usage Types & Helpers ──

interface ToolUsageItem {
  name: string;
  count: number;
  errors: number;
}

function aggregateToolUsage(
  journey: TaskJourney | null,
  timelineEventsById: Map<string, TimelineEvent>,
): ToolUsageItem[] {
  if (!journey) return [];
  const map = new Map<string, { count: number; errors: number }>();
  for (const eventId of journey.eventIds) {
    const event = timelineEventsById.get(eventId);
    if (!event) continue;
    const toolName =
      event.toolName || (event.kind === "tool_call" ? event.title : null);
    if (!toolName) continue;
    const entry = map.get(toolName) ?? { count: 0, errors: 0 };
    entry.count++;
    if (event.status === "failed") entry.errors++;
    map.set(toolName, entry);
  }
  return [...map.entries()]
    .map(([name, { count, errors }]) => ({ name, count, errors }))
    .sort((a, b) => b.count - a.count);
}

function aggregateJourneyErrors(journeys: TaskJourney[]): number {
  return journeys.filter((j) => j.status === "failed").length;
}

function aggregateJourneyToolCalls(
  journeys: TaskJourney[],
  timelineEventsById: Map<string, TimelineEvent>,
): number {
  let count = 0;
  for (const j of journeys) {
    for (const eventId of j.eventIds) {
      const event = timelineEventsById.get(eventId);
      if (event?.toolName) count++;
    }
  }
  return count;
}

// ── ToolUsageBars ──

function ToolUsageBars({
  tools,
  copy,
}: {
  tools: ToolUsageItem[];
  copy: AppCopy["timeline"];
}) {
  const [expanded, setExpanded] = useState(false);
  if (tools.length === 0) {
    return (
      <section className="tool-usage-bars">
        <p className="muted">{copy.toolUsageEmpty}</p>
      </section>
    );
  }
  const maxCount = Math.max(...tools.map((t) => t.count));
  const visible = expanded ? tools : tools.slice(0, 5);
  return (
    <section className="tool-usage-bars" aria-label={copy.toolUsageHeading}>
      <div className="detail-section-heading">
        <span>{copy.toolUsageHeading}</span>
        <span style={{ color: "var(--muted)", fontSize: 10, fontWeight: 800 }}>
          {tools.length}
        </span>
      </div>
      <div className="tool-usage-list">
        {visible.map((tool) => (
          <div key={tool.name} className="tool-usage-row">
            <span className="tool-usage-name">{tool.name}</span>
            <span className="tool-usage-track">
              <span
                className="tool-usage-fill"
                style={{ width: `${(tool.count / maxCount) * 100}%` }}
              />
            </span>
            <span className="tool-usage-count">{tool.count}</span>
            {tool.errors > 0 ? (
              <span className="tool-usage-errors">
                {tool.errors} {copy.toolUsageErrors}
              </span>
            ) : null}
          </div>
        ))}
      </div>
      {tools.length > 5 ? (
        <button
          type="button"
          className="tool-usage-toggle"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded
            ? `▲ ${tools.length - 5} less`
            : `▼ ${tools.length - 5} more`}
        </button>
      ) : null}
    </section>
  );
}

// ── EventTape ──

function categorizeEvent(event: TimelineEvent): string {
  if (event.kind === "user_prompt") return "user";
  if (event.kind === "assistant_message") return "assistant";
  if (event.kind === "tool_call") return "tool";
  if (event.kind === "reasoning_marker") return "thinking";
  if (event.kind === "error" || event.status === "failed") return "error";
  return "meta";
}

const CATEGORY_LABELS: Record<string, string> = {
  user: "User message",
  assistant: "Assistant reply",
  tool: "Tool call",
  thinking: "Thinking",
  error: "Error",
  compact: "Compaction",
  meta: "Meta",
};

function formatTapeTime(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatTapeDate(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function EventTape({
  eventIds,
  timelineEventsById,
}: {
  eventIds: string[];
  timelineEventsById: Map<string, TimelineEvent>;
}) {
  const events = eventIds
    .map((id) => timelineEventsById.get(id))
    .filter((e): e is TimelineEvent => e !== undefined);

  if (events.length === 0) return null;

  const timestamps = events.map((e) => Date.parse(e.timestamp));
  const start = timestamps[0];
  const end = timestamps[timestamps.length - 1];
  const span = end - start;
  const useEvenSpacing =
    !isFinite(span) || span <= 0 || timestamps.some((t) => isNaN(t));
  const count = events.length;

  return (
    <div>
      <div className="event-tape" aria-hidden="true">
        <div className="event-tape-mid" />
        {events.map((event, i) => {
          const cat = categorizeEvent(event);
          const isTall = cat === "error" || cat === "compact";
          const left = useEvenSpacing
            ? `${count > 1 ? (i / (count - 1)) * 100 : 50}%`
            : `${((timestamps[i] - start) / span) * 100}%`;
          const opacity = cat === "meta" ? 0.4 : 0.85;

          const tooltipParts: string[] = [];
          tooltipParts.push(CATEGORY_LABELS[cat] ?? event.kind);
          if (event.toolName) tooltipParts.push(` · ${event.toolName}`);
          if (event.tokenUsage?.total != null) {
            tooltipParts.push(
              `\n${event.tokenUsage.total.toLocaleString()} tokens`,
            );
          }
          const timeStr = formatTapeTime(event.timestamp);
          if (timeStr) tooltipParts.push(`\n${timeStr}`);

          return (
            <Tooltip key={event.id} text={tooltipParts.join("")}>
              <div
                className={`event-tape-tick${isTall ? " tall" : ""} cat-${cat}`}
                style={{ left, opacity }}
              />
            </Tooltip>
          );
        })}
      </div>
      {count > 0 ? (
        <div className="event-tape-axis">
          <span>{formatTapeDate(events[0].timestamp)}</span>
          <span>{count > 1 ? formatDuration(span) : "1 event"}</span>
          <span>{formatTapeDate(events[count - 1].timestamp)}</span>
        </div>
      ) : null}
    </div>
  );
}

// ── Session Recap Panel ──

const CAL_RAMP = [
  "var(--surface-soft)",
  "color-mix(in srgb, var(--orange) 25%, var(--surface-soft))",
  "color-mix(in srgb, var(--orange) 50%, var(--surface-soft))",
  "color-mix(in srgb, var(--orange) 72%, var(--surface-soft))",
  "var(--orange)",
];

function rampIndex(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  const ratio = value / max;
  return ratio >= 0.66 ? 4 : ratio >= 0.33 ? 3 : ratio >= 0.12 ? 2 : 1;
}

function SessionRecapPanel({
  copy,
  metricsCopy,
  tokenChartCopy,
  journeys,
  timelineEventsById,
  dailyTokenUsage,
  dailyTokenUsageLoading,
  sessionMap,
  pricing,
  onPricingChange,
}: {
  copy: AppCopy["timeline"];
  metricsCopy: AppCopy["metrics"];
  tokenChartCopy: AppCopy["tokenChart"];
  journeys: TaskJourney[];
  timelineEventsById: Map<string, TimelineEvent>;
  dailyTokenUsage: DailyTokenUsageResponse | null;
  dailyTokenUsageLoading: boolean;
  sessionMap: Map<string, SessionRecord>;
  pricing: ModelPricing[];
  onPricingChange: (pricing: ModelPricing[]) => void;
}) {
  const [calMetric, setCalMetric] = useState<"cost" | "tokens" | "sessions">(
    "cost",
  );
  const [recapOpen, setRecapOpen] = useState(() => {
    const stored = localStorage.getItem("superview-recap-open");
    return stored !== null ? stored === "true" : true;
  });

  const totals = useMemo(() => {
    let sessions = journeys.length;
    let totalTokens = 0;
    let totalInput = 0;
    let totalOutput = 0;
    let totalCached = 0;
    let estCost = 0;
    let toolCalls = 0;
    let errors = 0;
    let totalDurationMs = 0;
    const toolAgg: Record<string, { count: number; errors: number }> = {};

    for (const j of journeys) {
      totalTokens += j.tokenUsage?.total ?? 0;
      totalInput += j.tokenUsage?.input ?? 0;
      totalOutput += j.tokenUsage?.output ?? 0;
      totalCached += j.tokenUsage?.cachedInput ?? 0;
      estCost += estimateProjectCost(j.tokenUsage, undefined, pricing);
      totalDurationMs += j.durationMs ?? 0;
      if (j.status === "failed") errors++;
      for (const eventId of j.eventIds) {
        const event = timelineEventsById.get(eventId);
        if (event?.toolName) {
          toolCalls++;
          const rec = toolAgg[event.toolName] ?? { count: 0, errors: 0 };
          rec.count++;
          if (event.status === "failed") rec.errors++;
          toolAgg[event.toolName] = rec;
        }
      }
    }

    return {
      sessions,
      totalTokens,
      totalInput,
      totalOutput,
      totalCached,
      estCost,
      toolCalls,
      errors,
      totalDurationMs,
      toolAgg,
    };
  }, [journeys, timelineEventsById, pricing]);

  const modelBreakdown = useMemo(
    () => aggregateCostByModel(journeys, sessionMap, pricing),
    [journeys, sessionMap, pricing],
  );

  // Calendar: aggregate journeys by date
  const dailyAgg = useMemo(() => {
    const map = new Map<
      number,
      { date: Date; cost: number; tokens: number; sessions: number }
    >();
    for (const j of journeys) {
      if (!j.startedAt) continue;
      const d = new Date(j.startedAt);
      const key = new Date(
        d.getFullYear(),
        d.getMonth(),
        d.getDate(),
      ).getTime();
      const rec = map.get(key) ?? {
        date: new Date(d.getFullYear(), d.getMonth(), d.getDate()),
        cost: 0,
        tokens: 0,
        sessions: 0,
      };
      rec.cost += estimateProjectCost(j.tokenUsage, undefined, pricing);
      rec.tokens += j.tokenUsage?.total ?? 0;
      rec.sessions++;
      map.set(key, rec);
    }
    return map;
  }, [journeys, pricing]);

  // Calendar weeks
  const calData = useMemo(() => {
    const entries = [...dailyAgg.values()];
    if (entries.length === 0)
      return {
        weeks: [],
        months: [] as { col: number; label: string }[],
        max: 0,
      };

    entries.sort((a, b) => a.date.getTime() - b.date.getTime());
    const minDate = entries[0].date;
    const maxDate = entries[entries.length - 1].date;
    // Cap to ~1 year
    const capMs = 53 * 7 * 86400000;
    const effectiveMin = new Date(
      Math.max(minDate.getTime(), maxDate.getTime() - capMs),
    );
    const start = new Date(effectiveMin);
    start.setDate(start.getDate() - start.getDay());

    const metricOf = (r: { cost: number; tokens: number; sessions: number }) =>
      calMetric === "cost"
        ? r.cost
        : calMetric === "tokens"
          ? r.tokens
          : r.sessions;
    let maxVal = 0;
    for (const r of entries) {
      if (r.date >= start) {
        const v = metricOf(r);
        if (v > maxVal) maxVal = v;
      }
    }

    const weeks: {
      date: Date;
      rec: (typeof entries)[0] | null;
      out: boolean;
    }[][] = [];
    const months: { col: number; label: string }[] = [];
    let cur = new Date(start);
    let lastMonth = -1;
    while (cur <= maxDate) {
      const week: {
        date: Date;
        rec: (typeof entries)[0] | null;
        out: boolean;
      }[] = [];
      for (let d = 0; d < 7; d++) {
        const dd = new Date(cur);
        const key = new Date(
          dd.getFullYear(),
          dd.getMonth(),
          dd.getDate(),
        ).getTime();
        const rec = dailyAgg.get(key) ?? null;
        const out = dd < effectiveMin || dd > maxDate;
        week.push({ date: dd, rec, out });
        const m = dd.getMonth();
        if (d === 0 && m !== lastMonth) {
          months.push({
            col: weeks.length,
            label: dd.toLocaleDateString(undefined, { month: "short" }),
          });
          lastMonth = m;
        }
        cur.setDate(cur.getDate() + 1);
      }
      weeks.push(week);
    }

    return { weeks, months, max: maxVal };
  }, [dailyAgg, calMetric]);

  // Clock: aggregate timeline events by hour × weekday
  const clockData = useMemo(() => {
    const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
    let maxVal = 0;
    for (const event of timelineEventsById.values()) {
      if (!event.timestamp) continue;
      const d = new Date(event.timestamp);
      if (isNaN(d.getTime())) continue;
      grid[d.getDay()][d.getHours()]++;
      if (grid[d.getDay()][d.getHours()] > maxVal)
        maxVal = grid[d.getDay()][d.getHours()];
    }
    return { grid, max: maxVal };
  }, [timelineEventsById]);

  // Efficiency metrics
  const efficiency = useMemo(() => {
    const totalInput = totals.totalInput + totals.totalCached;
    const cacheHitRate =
      totalInput > 0 ? (totals.totalCached / totalInput) * 100 : 0;
    const toolTotal = totals.toolCalls;
    const toolErrors = Object.values(totals.toolAgg).reduce(
      (sum, t) => sum + t.errors,
      0,
    );
    const failRate = toolTotal > 0 ? (toolErrors / toolTotal) * 100 : 0;
    const successRate = 100 - failRate;
    const tokensPerSession =
      totals.sessions > 0 ? totals.totalTokens / totals.sessions : 0;
    const costPerSession =
      totals.sessions > 0 ? totals.estCost / totals.sessions : 0;

    // Estimate cache savings
    let cacheSaved = 0;
    for (const j of journeys) {
      const session = sessionMap.get(j.sessionId);
      const model = session?.modelProvider ?? null;
      const tier = matchPricing(model, pricing);
      cacheSaved +=
        ((j.tokenUsage?.cachedInput ?? 0) * tier.inRate * 0.9) / 1_000_000;
    }

    return {
      cacheHitRate,
      successRate,
      failRate,
      toolErrors,
      tokensPerSession,
      costPerSession,
      cacheSaved,
    };
  }, [totals, journeys, sessionMap, pricing]);

  // gauge animation refs
  const gaugeRefs = useRef<(HTMLElement | null)[]>([]);

  const summaryFootnotes = useMemo(() => {
    const favModel = modelBreakdown[0]?.label ?? "—";
    let busyDay: { date: Date; cost: number } | null = null;
    for (const r of dailyAgg.values()) {
      if (!busyDay || r.cost > busyDay.cost)
        busyDay = { date: r.date, cost: r.cost };
    }
    let priciestCost = 0;
    let priciestName = "";
    for (const j of journeys) {
      const c = estimateProjectCost(j.tokenUsage, undefined, pricing);
      if (c > priciestCost) {
        priciestCost = c;
        const cwd = sessionMap.get(j.sessionId)?.cwd;
        priciestName = cwd
          ? cwd
              .replace(/\\/g, "/")
              .split("/")
              .filter(Boolean)
              .slice(-2)
              .join("/") || cwd
          : "(unknown)";
      }
    }
    return { favModel, busyDay, priciestName, priciestCost };
  }, [modelBreakdown, dailyAgg, journeys, pricing, sessionMap]);

  if (journeys.length === 0) {
    return (
      <details className="session-recap" open={recapOpen} onToggle={(e) => {
        const open = (e.target as HTMLDetailsElement).open;
        setRecapOpen(open);
        localStorage.setItem("superview-recap-open", String(open));
      }}>
        <summary>
          <span className="caret">▸</span>
          {copy.recapToggle}
        </summary>
        <div className="recap-body">
          <p className="recap-empty">{copy.recapEmpty}</p>
        </div>
      </details>
    );
  }

  const calMetricLabel = (v: number) =>
    calMetric === "cost"
      ? formatCost(v)
      : calMetric === "tokens"
        ? formatMillionTokens(v)
        : `${v} sess`;

  const toolList = Object.entries(totals.toolAgg).sort(
    (a, b) => b[1].count - a[1].count,
  );
  const toolMax = toolList.length > 0 ? toolList[0][1].count : 1;

  return (
    <details className="session-recap" open={recapOpen} onToggle={(e) => {
        const open = (e.target as HTMLDetailsElement).open;
        setRecapOpen(open);
        localStorage.setItem("superview-recap-open", String(open));
      }}>
      <summary>
        <span className="caret">▸</span>
        {copy.recapToggle}
        <span className="recap-summary-stats">
          <span>
            {totals.sessions} <b>{copy.readoutSessions.toLowerCase()}</b>
          </span>
          <span>
            <b>{formatCost(totals.estCost)}</b>
          </span>
          <span>
            <b>{formatMillionTokens(totals.totalTokens)}</b> tokens
          </span>
          <span className="recap-summary-footnotes">
            <span>
              most-used <b>{summaryFootnotes.favModel}</b>
            </span>
            {summaryFootnotes.busyDay ? (
              <span>
                busiest{" "}
                <b>
                  {summaryFootnotes.busyDay.date.toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </b>{" "}
                <em>{formatCost(summaryFootnotes.busyDay.cost)}</em>
              </span>
            ) : null}
            <span>
              priciest <b>{summaryFootnotes.priciestName}</b>{" "}
              <em>{formatCost(summaryFootnotes.priciestCost)}</em>
            </span>
          </span>
        </span>
      </summary>
      <div className="recap-body">
        {/* 01 Readout */}
        <div className="recap-eyebrow">
          <span className="tag">01</span> readout
        </div>
        <div className="recap-readout">
          <div className="r-cell">
            <div className="rk">{copy.readoutSessions}</div>
            <div className="rv">{totals.sessions}</div>
          </div>
          <div className="r-cell">
            <div className="rk">{copy.readoutEstCost}</div>
            <div className="rv cost">{formatCost(totals.estCost)}</div>
          </div>
          <div className="r-cell">
            <div className="rk">{copy.readoutTotalTokens}</div>
            <div className="rv">{formatMillionTokens(totals.totalTokens)}</div>
            <div className="rn">
              {formatMillionTokens(totals.totalInput)} in ·{" "}
              {formatMillionTokens(totals.totalOutput)} out
            </div>
          </div>
          <div className="r-cell">
            <div className="rk">{copy.readoutToolCalls}</div>
            <div className="rv">{totals.toolCalls.toLocaleString()}</div>
            <div className="rn">{efficiency.toolErrors} failed</div>
          </div>
          <div className="r-cell">
            <div className="rk">{copy.readoutErrors}</div>
            <div className={`rv${totals.errors > 0 ? " err" : ""}`}>
              {totals.errors}
            </div>
            <div className="rn">
              {totals.sessions - totals.errors} succeeded
            </div>
          </div>
        </div>

        {/* 02 Rhythm */}
        <div className="recap-eyebrow">
          <span className="tag">02</span> {copy.recapRhythmHeading}
        </div>
        <div className="recap-rhythm-grid">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="recap-rhythm-panel">
            <div className="recap-rhythm-head">
              <span className="recap-rhythm-title">
                {copy.recapDailyActivity}
              </span>
              <div className="recap-metric-toggle">
                <button
                  className={calMetric === "cost" ? "on" : ""}
                  onClick={() => setCalMetric("cost")}
                >
                  cost
                </button>
                <button
                  className={calMetric === "tokens" ? "on" : ""}
                  onClick={() => setCalMetric("tokens")}
                >
                  tokens
                </button>
                <button
                  className={calMetric === "sessions" ? "on" : ""}
                  onClick={() => setCalMetric("sessions")}
                >
                  sessions
                </button>
              </div>
            </div>
            {calData.weeks.length === 0 ? (
              <p className="recap-empty">no dated sessions</p>
            ) : (
              <>
                <div className="recap-cal-scroll">
                  <div className="recap-cal-months">
                    {calData.months.map((m, i) => (
                      <span
                        key={i}
                        style={
                          i > 0
                            ? {
                                marginLeft:
                                  (m.col -
                                    (calData.months[i - 1]?.col ?? m.col) -
                                    1) *
                                  16,
                              }
                            : undefined
                        }
                      >
                        {m.label}
                      </span>
                    ))}
                  </div>
                  <div className="recap-cal-body">
                    <div className="recap-cal-wdays">
                      {["", "M", "", "W", "", "F", ""].map((t, i) => (
                        <span key={i}>{t}</span>
                      ))}
                    </div>
                    <div className="recap-cal">
                      {calData.weeks.map((week, wi) => (
                        <div key={wi} className="recap-cal-week">
                          {week.map((day, di) => {
                            const v = day.rec
                              ? calMetric === "cost"
                                ? day.rec.cost
                                : calMetric === "tokens"
                                  ? day.rec.tokens
                                  : day.rec.sessions
                              : 0;
                            return (
                              <div
                                key={di}
                                className="recap-cal-day"
                                style={
                                  day.rec && !day.out
                                    ? {
                                        background:
                                          CAL_RAMP[rampIndex(v, calData.max)],
                                        borderColor: "transparent",
                                      }
                                    : undefined
                                }
                                title={
                                  day.rec
                                    ? `${day.date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${calMetricLabel(v)} · ${day.rec.sessions} session${day.rec.sessions !== 1 ? "s" : ""}`
                                    : undefined
                                }
                              />
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="recap-cal-legend">
                  less{" "}
                  {CAL_RAMP.map((c, i) => (
                    <i key={i} style={{ background: c }} />
                  ))}{" "}
                  more
                </div>
              </>
            )}
          </div>
          <div className="recap-rhythm-panel">
            <div className="recap-rhythm-head">
              <span className="recap-rhythm-title">
                {copy.recapWhenYouShip}
              </span>
              <span className="recap-rhythm-sub">events · hour × weekday</span>
            </div>
            {clockData.max === 0 ? (
              <p className="recap-empty">no timestamped events</p>
            ) : (
              <>
                <div className="recap-clock">
                  {[1, 2, 3, 4, 5, 6, 0].map((di) => {
                    const names = [
                      "Mon",
                      "Tue",
                      "Wed",
                      "Thu",
                      "Fri",
                      "Sat",
                      "Sun",
                    ];
                    const dayIdx = [1, 2, 3, 4, 5, 6, 0].indexOf(di);
                    return (
                      <Fragment key={di}>
                        <div className="cl-lbl">{names[dayIdx]}</div>
                        {Array.from({ length: 24 }, (_, h) => {
                          const v = clockData.grid[di][h];
                          return (
                            <div
                              key={`${di}-${h}`}
                              className="cl-cell"
                              style={
                                v > 0
                                  ? {
                                      background:
                                        CAL_RAMP[rampIndex(v, clockData.max)],
                                    }
                                  : undefined
                              }
                              title={
                                v > 0
                                  ? `${names[dayIdx]} ${String(h).padStart(2, "0")}:00 · ${v} event${v !== 1 ? "s" : ""}`
                                  : undefined
                              }
                            />
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </div>
                <div className="recap-clock-axis">
                  <span className="pad" />
                  <b>0</b>
                  <b>6</b>
                  <b>12</b>
                  <b>18</b>
                </div>
              </>
            )}
          </div>
          </div>
          {dailyTokenUsage && dailyTokenUsage.points.length > 0 ? (
            <div className="recap-rhythm-panel">
              <div className="recap-rhythm-head">
                <span className="recap-rhythm-title">
                  {metricsCopy.dailyUsageByDay}
                </span>
              </div>
              <DailyTokenUsagePanel
                copy={tokenChartCopy}
                data={dailyTokenUsage}
                loading={dailyTokenUsageLoading}
                title={metricsCopy.tokens}
                subtitle={metricsCopy.dailyUsageByDay}
                maxVisiblePoints={30}
                className=""
                showHeaderToggle={false}
                expanded={true}
                onExpandedChange={() => {}}
                variant="horizon"
              />
            </div>
          ) : null}
        </div>

        {/* 03 Efficiency */}
        <div className="recap-eyebrow">
          <span className="tag">03</span> {copy.recapEfficiencyHeading}
        </div>
        <div className="recap-eff-grid">
          <div className="recap-eff-card">
            <div className="et">{copy.recapCacheHit}</div>
            <div
              className={`ev${efficiency.cacheHitRate >= 50 ? " good" : efficiency.cacheHitRate < 15 ? " warn" : ""}`}
            >
              {efficiency.cacheHitRate.toFixed(0)}%
            </div>
            <div className="es">
              saved ~{formatCost(efficiency.cacheSaved)} vs uncached input
            </div>
            <div className="recap-gauge">
              <i
                ref={(el) => {
                  gaugeRefs.current[0] = el;
                }}
                style={{
                  width: `${Math.max(2, Math.min(100, efficiency.cacheHitRate))}%`,
                }}
                className=""
              />
            </div>
          </div>
          <div className="recap-eff-card">
            <div className="et">{copy.recapErrorRate}</div>
            <div
              className={`ev${efficiency.failRate > 10 ? " warn" : " good"}`}
            >
              {efficiency.successRate.toFixed(0)}%
            </div>
            <div className="es">
              {efficiency.toolErrors} failed of{" "}
              {totals.toolCalls.toLocaleString()} calls
            </div>
            <div className="recap-gauge">
              <i
                ref={(el) => {
                  gaugeRefs.current[1] = el;
                }}
                style={{
                  width: `${Math.max(2, Math.min(100, efficiency.successRate))}%`,
                }}
                className={efficiency.failRate > 10 ? "warn" : ""}
              />
            </div>
          </div>
          <div className="recap-eff-card">
            <div className="et">{copy.recapTokensPerSession}</div>
            <div className="ev">
              {formatMillionTokens(efficiency.tokensPerSession)}
            </div>
            <div className="es">
              avg across {totals.sessions} session
              {totals.sessions !== 1 ? "s" : ""}
            </div>
            <div className="recap-gauge">
              <i
                ref={(el) => {
                  gaugeRefs.current[2] = el;
                }}
                style={{
                  width: `${Math.max(2, Math.min(100, (efficiency.tokensPerSession / 1_000_000) * 100))}%`,
                }}
                className="clay"
              />
            </div>
          </div>
          <div className="recap-eff-card">
            <div className="et">{copy.recapCostPerSession}</div>
            <div className="ev cost">
              {formatCost(efficiency.costPerSession)}
            </div>
            <div className="es">
              avg {formatCost(efficiency.costPerSession)} / session
            </div>
            <div className="recap-gauge">
              <i
                ref={(el) => {
                  gaugeRefs.current[3] = el;
                }}
                style={{
                  width: `${Math.max(2, Math.min(100, efficiency.costPerSession * 100))}%`,
                }}
                className="clay"
              />
            </div>
          </div>
        </div>

        {/* 04 Spend by Model */}
        <div className="recap-eyebrow">
          <span className="tag">04</span> {copy.modelSpendHeading}
        </div>
        {modelBreakdown.length === 0 ? (
          <p className="recap-empty">{copy.modelSpendEmpty}</p>
        ) : (
          <div className="recap-model-table">
            <table>
              <thead>
                <tr>
                  <th>{copy.modelSpendModel}</th>
                  <th>{copy.modelSpendMsgs}</th>
                  <th>{copy.modelSpendInput}</th>
                  <th>{copy.modelSpendOutput}</th>
                  <th>{copy.modelSpendCached}</th>
                  <th>{copy.modelSpendCost}</th>
                </tr>
              </thead>
              <tbody>
                {modelBreakdown.map((m) => (
                  <tr key={m.model}>
                    <td>{m.label}</td>
                    <td>{m.messages}</td>
                    <td>{formatMillionTokens(m.input)}</td>
                    <td>{formatMillionTokens(m.output)}</td>
                    <td>{formatMillionTokens(m.cachedInput)}</td>
                    <td className="cost">{formatCost(m.cost)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>{copy.modelSpendTotal}</td>
                  <td>{modelBreakdown.reduce((s, m) => s + m.messages, 0)}</td>
                  <td>{formatMillionTokens(totals.totalInput)}</td>
                  <td>{formatMillionTokens(totals.totalOutput)}</td>
                  <td>{formatMillionTokens(totals.totalCached)}</td>
                  <td className="cost">{formatCost(totals.estCost)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* 05 Tool Usage */}
        <div className="recap-eyebrow">
          <span className="tag">05</span> {copy.toolUsageHeading}
        </div>
        {toolList.length === 0 ? (
          <p className="recap-empty">{copy.toolUsageEmpty}</p>
        ) : (
          <div className="recap-tools">
            {toolList.map(([name, rec]) => (
              <div key={name} className="recap-tool-row">
                <span className="name">{name}</span>
                <span className="track">
                  <span
                    className="fill"
                    style={{ width: `${(rec.count / toolMax) * 100}%` }}
                  />
                </span>
                <span className="figs">
                  {rec.count}
                  {rec.errors > 0 ? (
                    <>
                      {" "}
                      · <span className="e">{rec.errors} err</span>
                    </>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        )}

        <PricingEditor
          pricing={pricing}
          onPricingChange={onPricingChange}
          copy={copy}
        />
      </div>
    </details>
  );
}

// ── Search / Sort ──

type SortKey = "newest" | "cost" | "duration" | "tools" | "errors";

function applySearchAndSort(
  journeys: TaskJourney[],
  searchQuery: string,
  sortKey: SortKey,
  pricing?: ModelPricing[],
): TaskJourney[] {
  const query = searchQuery.trim().toLowerCase();
  const filtered = query
    ? journeys.filter((j) => j.title.toLowerCase().includes(query))
    : journeys;

  return [...filtered].sort((a, b) => {
    switch (sortKey) {
      case "cost":
        return (
          estimateProjectCost(b.tokenUsage, undefined, pricing) -
          estimateProjectCost(a.tokenUsage, undefined, pricing)
        );
      case "duration":
        return b.durationMs - a.durationMs;
      case "tools":
        return b.skills.length - a.skills.length;
      case "errors":
        return (
          (b.status === "failed" ? 1 : 0) - (a.status === "failed" ? 1 : 0)
        );
      case "newest":
      default:
        return Date.parse(b.startedAt) - Date.parse(a.startedAt);
    }
  });
}

// ── Pricing Editor ──

function PricingEditor({
  pricing,
  onPricingChange,
  copy,
}: {
  pricing: ModelPricing[];
  onPricingChange: (pricing: ModelPricing[]) => void;
  copy: AppCopy["timeline"];
}) {
  const providerOrder = ["Anthropic", "OpenAI", "Other"] as const;

  function handleRateChange(
    id: string,
    field: "inRate" | "outRate",
    value: string,
  ) {
    const num = parseFloat(value);
    if (isNaN(num) || num < 0) return;
    const next = pricing.map((p) => (p.id === id ? { ...p, [field]: num } : p));
    onPricingChange(next);
  }

  const grouped = useMemo(() => {
    const groups: Record<string, ModelPricing[]> = {};
    for (const p of pricing) {
      if (!groups[p.provider]) groups[p.provider] = [];
      groups[p.provider].push(p);
    }
    return groups;
  }, [pricing]);

  return (
    <details className="pricing-editor">
      <summary>
        <span className="caret">&#9654;</span>
        {copy.pricingHeading}
      </summary>
      <div className="pricing-editor-body">
        <p className="pricing-note">{copy.pricingNote}</p>
        <div className="pricing-headers">
          <span>Model</span>
          <span>{copy.pricingInputRate}</span>
          <span>{copy.pricingOutputRate}</span>
        </div>
        {providerOrder.map((provider) => {
          const items = grouped[provider] ?? [];
          if (items.length === 0) return null;
          return (
            <div key={provider}>
              <div className="pricing-provider-group">{provider}</div>
              {items.map((item) => (
                <div key={item.id} className="pricing-row">
                  <span className="pricing-row-label">{item.label}</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={item.inRate}
                    onChange={(e) =>
                      handleRateChange(item.id, "inRate", e.target.value)
                    }
                    aria-label={`${item.label} input rate`}
                  />
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={item.outRate}
                    onChange={(e) =>
                      handleRateChange(item.id, "outRate", e.target.value)
                    }
                    aria-label={`${item.label} output rate`}
                  />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </details>
  );
}

const ZERO_TOKEN_USAGE: TokenUsage = {
  input: 0,
  output: 0,
  reasoning: 0,
  cachedInput: 0,
  total: 0,
};
