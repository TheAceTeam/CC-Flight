import { AlertTriangle, ChevronRight, Database, FileText, Moon, Pause, Play, RotateCw, Search, Sun, TerminalSquare } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Artifact, IngestJob, ProjectTimeline, ReplayNode, RunReplay, TimelineEvent } from "../../core/types";
import { fetchIngestJob, fetchProjects, fetchRun, fetchTimeline, ProjectWithSessions, startIngest } from "./api";

type Theme = "light" | "dark";

const LANES = ["Product", "Architecture", "Code", "Agent Runs", "Verification", "Risks"];

export function App() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("superview-theme") as Theme | null) ?? "light");
  const [projects, setProjects] = useState<ProjectWithSessions[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<ProjectTimeline | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<TimelineEvent | null>(null);
  const [selectedRun, setSelectedRun] = useState<RunReplay | null>(null);
  const [selectedNode, setSelectedNode] = useState<ReplayNode | null>(null);
  const [job, setJob] = useState<IngestJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [playIndex, setPlayIndex] = useState(0);
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
    void fetchTimeline(selectedProjectId).then((next) => {
      setTimeline(next);
      setSelectedEvent(next.events[0] ?? null);
    });
  }, [selectedProjectId]);

  useEffect(() => {
    if (!job || job.status === "completed" || job.status === "failed") return;
    const timer = window.setInterval(async () => {
      const next = await fetchIngestJob(job.id);
      setJob(next);
      if (next.status === "completed") {
        await loadProjects();
      }
    }, 700);
    return () => window.clearInterval(timer);
  }, [job]);

  useEffect(() => {
    if (!playing || !selectedRun || selectedRun.nodes.length === 0) return;
    const timer = window.setInterval(() => {
      setPlayIndex((current) => {
        const next = Math.min(current + 1, selectedRun.nodes.length - 1);
        setSelectedNode(selectedRun.nodes[next] ?? null);
        if (next === selectedRun.nodes.length - 1) setPlaying(false);
        return next;
      });
    }, 620);
    return () => window.clearInterval(timer);
  }, [playing, selectedRun]);

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

  async function handleScan() {
    setError(null);
    const jobId = await startIngest();
    setJob(await fetchIngestJob(jobId));
  }

  async function openRun(sessionId: string) {
    const replay = await fetchRun(sessionId);
    setSelectedRun(replay);
    setPlayIndex(0);
    setSelectedNode(replay.nodes[0] ?? null);
    setSelectedEvent(replay.events[0] ?? null);
  }

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const eventsByLane = useMemo(() => {
    const groups = new Map<string, TimelineEvent[]>();
    for (const lane of LANES) groups.set(lane, []);
    for (const event of timeline?.events ?? []) {
      groups.get(event.lane)?.push(event);
    }
    return groups;
  }, [timeline]);

  const drawerEvent = selectedNode ? selectedRun?.events.find((event) => event.id === selectedNode.eventId) ?? selectedEvent : selectedEvent;
  const drawerArtifacts = selectedRun?.artifacts.filter((artifact) => artifact.eventId === drawerEvent?.id) ?? [];

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <strong>SuperView</strong>
          <span>Codex timeline command center</span>
        </div>
        <div className="topbar-actions">
          <button className="shell-button" onClick={handleScan} disabled={job?.status === "running"}>
            <RotateCw size={16} />
            Scan Codex Logs
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
            <p className="lead">From Codex session logs to engineering episodes, evidence, hazards, and replayable agent runs.</p>
          </div>
          <div className="status-cluster">
            <Metric label="Projects" value={projects.length} />
            <Metric label="Events" value={timeline?.events.length ?? 0} />
            <Metric label="Episodes" value={timeline?.episodes.length ?? 0} />
          </div>
        </section>

        {error ? <div className="alert"><AlertTriangle size={16} />{error}</div> : null}
        {job ? <JobStrip job={job} /> : null}

        {loading ? (
          <EmptyState title="Loading SuperView index" detail="Checking local SQLite state." onScan={handleScan} />
        ) : projects.length === 0 ? (
          <EmptyState title="No Codex runs indexed" detail="Scan local rollout JSONL files from ~/.codex/sessions to build the first timeline." onScan={handleScan} />
        ) : (
          <div className="dashboard-grid">
            <aside className="run-ledger">
              <div className="panel-heading">
                <Database size={17} />
                <span>Run Ledger</span>
              </div>
              <label className="field-label" htmlFor="project-select">Project</label>
              <select id="project-select" value={selectedProjectId ?? ""} onChange={(event) => setSelectedProjectId(event.target.value)}>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
              <div className="run-list">
                {(selectedProject?.sessions ?? []).map((session) => (
                  <button key={session.id} className={`run-row ${selectedRun?.session.id === session.id ? "active" : ""}`} onClick={() => void openRun(session.id)}>
                    <span>
                      <strong>{session.id.slice(0, 8)}</strong>
                      <small>{formatDate(session.startedAt)}</small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                ))}
              </div>
            </aside>

            <section className="timeline-panel">
              <div className="panel-heading">
                <FileText size={17} />
                <span>Engineering Timeline</span>
                <em>Auto grouped</em>
              </div>
              <div className="episode-strip">
                {(timeline?.episodes ?? []).map((episode) => (
                  <button key={episode.id} className={`episode ${episode.status}`} onClick={() => setSelectedEvent(timeline?.events.find((event) => event.id === episode.eventIds[0]) ?? null)}>
                    <strong>{episode.title}</strong>
                    <span>{episode.summary}</span>
                  </button>
                ))}
              </div>
              <div className="lanes">
                {LANES.map((lane) => (
                  <div className="lane" key={lane}>
                    <div className="lane-label">{lane}</div>
                    <div className="lane-track">
                      {(eventsByLane.get(lane) ?? []).slice(0, 18).map((event) => (
                        <button key={event.id} className={`event-dot ${event.status}`} title={event.title} onClick={() => setSelectedEvent(event)}>
                          <span>{shortLabel(event.title)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {selectedRun ? (
                <RunReplayPanel
                  run={selectedRun}
                  playing={playing}
                  playIndex={playIndex}
                  selectedNode={selectedNode}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onScrub={(index) => {
                    setPlayIndex(index);
                    setSelectedNode(selectedRun.nodes[index] ?? null);
                  }}
                  onSelectNode={(node, index) => {
                    setSelectedNode(node);
                    setPlayIndex(index);
                    setSelectedEvent(selectedRun.events.find((event) => event.id === node.eventId) ?? null);
                  }}
                />
              ) : null}
            </section>

            <EvidenceDrawer event={drawerEvent ?? null} artifacts={drawerArtifacts} />
          </div>
        )}
      </main>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EmptyState({ title, detail, onScan }: { title: string; detail: string; onScan: () => void }) {
  return (
    <section className="empty-state">
      <Search size={34} />
      <h2>{title}</h2>
      <p>{detail}</p>
      <button className="primary-button" onClick={onScan}>Scan Codex Logs</button>
    </section>
  );
}

function JobStrip({ job }: { job: IngestJob }) {
  const percent = job.totalFiles ? Math.round((job.processedFiles / job.totalFiles) * 100) : job.status === "completed" ? 100 : 0;
  return (
    <div className={`job-strip ${job.status}`}>
      <span>Ingest {job.status}</span>
      <div className="progress"><i style={{ width: `${percent}%` }} /></div>
      <strong>{job.processedFiles}/{job.totalFiles} files</strong>
      <span>{job.totalEvents} events</span>
    </div>
  );
}

function RunReplayPanel({
  run,
  playing,
  playIndex,
  selectedNode,
  onPlay,
  onPause,
  onScrub,
  onSelectNode
}: {
  run: RunReplay;
  playing: boolean;
  playIndex: number;
  selectedNode: ReplayNode | null;
  onPlay: () => void;
  onPause: () => void;
  onScrub: (index: number) => void;
  onSelectNode: (node: ReplayNode, index: number) => void;
}) {
  return (
    <div className="replay-panel">
      <div className="panel-heading">
        <TerminalSquare size={17} />
        <span>Selected Run Replay</span>
        <em>{run.nodes.length} nodes</em>
      </div>
      <div className="replay-controls">
        <button className="control-button" onClick={playing ? onPause : onPlay}>{playing ? <Pause size={15} /> : <Play size={15} />}{playing ? "Pause" : "Play run"}</button>
        <input aria-label="Replay scrubber" type="range" min={0} max={Math.max(run.nodes.length - 1, 0)} value={playIndex} onChange={(event) => onScrub(Number(event.target.value))} />
        <span>{playIndex + 1}/{Math.max(run.nodes.length, 1)}</span>
      </div>
      <div className="level-map">
        <div className="ground" />
        {run.nodes.map((node, index) => (
          <button
            key={node.id}
            className={`level-node ${node.type} ${selectedNode?.id === node.id ? "selected" : ""}`}
            style={{ left: node.x }}
            onClick={() => onSelectNode(node, index)}
          >
            <span>{node.label}</span>
          </button>
        ))}
        {selectedNode ? <div className="agent" style={{ left: selectedNode.x + 12 }} title="Agent marker" /> : null}
      </div>
    </div>
  );
}

function EvidenceDrawer({ event, artifacts }: { event: TimelineEvent | null; artifacts: Artifact[] }) {
  return (
    <aside className="evidence-drawer">
      <div className="panel-heading">
        <FileText size={17} />
        <span>Evidence</span>
      </div>
      {event ? (
        <>
          <div className={`status-badge ${event.status}`}>{event.lane}</div>
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
          {artifacts.map((artifact) => (
            <div className="artifact" key={artifact.id}>
              <strong>{artifact.type}</strong>
              <small>{artifact.path}</small>
              <pre>{artifact.excerpt}</pre>
            </div>
          ))}
        </>
      ) : (
        <p className="muted">Select an episode, timeline event, or replay node to inspect redacted evidence.</p>
      )}
    </aside>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function shortLabel(value: string) {
  return value.length > 24 ? `${value.slice(0, 21)}...` : value;
}
