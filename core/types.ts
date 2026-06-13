export type AgentProvider = "codex" | "claude-code" | "opencode";

export type CodexOuterType = "session_meta" | "turn_context" | "response_item" | "event_msg";

export type EventKind =
  | "session"
  | "turn"
  | "user_prompt"
  | "assistant_message"
  | "tool_call"
  | "tool_result"
  | "reasoning_marker"
  | "token_usage"
  | "file_change"
  | "verification"
  | "error"
  | "status";

export type TimelineLane =
  | "Product"
  | "Architecture"
  | "Code"
  | "Agent Runs"
  | "Verification"
  | "Risks";

export type EventStatus = "running" | "success" | "failed" | "unknown";

export type CausalEdgeType =
  | "same_turn"
  | "same_call"
  | "implements_prompt"
  | "updates_design"
  | "verified_by"
  | "failed_by"
  | "retried_by"
  | "committed_as";

export type CausalConfidence = "deterministic" | "inferred";

export type ReplayNodeType =
  | "start"
  | "context"
  | "platform"
  | "powerup"
  | "hazard"
  | "loop"
  | "finish"
  | "message";

export interface ParsedCodexLine {
  sourcePath: string;
  lineNo: number;
  timestamp: string;
  type: CodexOuterType | string;
  payload: unknown;
  redactedPayload: unknown;
  sha256: string;
}

export type ParsedAgentEvent = ParsedCodexLine & {
  provider: AgentProvider;
};

export interface ProjectRecord {
  id: string;
  name: string;
  cwd: string;
  repoRoot: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionRecord {
  id: string;
  projectId: string;
  path: string;
  cwd: string;
  startedAt: string;
  endedAt: string | null;
  cliVersion: string | null;
  modelProvider: string | null;
  source: string | null;
  provider: AgentProvider;
  externalSessionId: string;
  agentName: string | null;
}

export interface TurnRecord {
  id: string;
  sessionId: string;
  startedAt: string;
  endedAt: string | null;
  cwd: string | null;
  model: string | null;
  approvalPolicy: string | null;
  sandboxPolicy: string | null;
}

export interface RawEventRef {
  id: string;
  sessionId: string;
  provider: AgentProvider;
  lineNo: number;
  timestamp: string;
  type: string;
  redactedPayloadJson: string;
  sourcePath: string;
  sha256: string;
}

export interface TokenUsage {
  input: number;
  output: number;
  reasoning: number;
  cachedInput: number;
  total: number;
}

export type DailyTokenUsagePoint = TokenUsage & {
  date: string;
};

export interface DailyTokenUsageResponse {
  projectId: string;
  points: DailyTokenUsagePoint[];
  total: TokenUsage;
}

export type SkillUsageSource =
  | "session_meta"
  | "developer_message"
  | "user_prompt"
  | "assistant_message"
  | "tool_input"
  | "tool_output"
  | "event_message";

export interface SkillUsage {
  name: string;
  source: SkillUsageSource;
  confidence: "explicit" | "inferred";
  path: string | null;
  command: string | null;
  evidencePath: string;
  excerpt: string;
}

export interface TimelineEvent {
  id: string;
  projectId: string;
  sessionId: string;
  turnId: string | null;
  timestamp: string;
  kind: EventKind;
  lane: TimelineLane;
  title: string;
  detail: string | null;
  toolName: string | null;
  callId: string | null;
  status: EventStatus;
  files: string[];
  rawEventRefId: string | null;
  durationMs?: number | null;
  outputEventId?: string | null;
  commitHash?: string | null;
  tokenUsage?: TokenUsage | null;
  skills?: SkillUsage[];
}

export interface Episode {
  id: string;
  projectId: string;
  startedAt: string;
  endedAt: string;
  title: string;
  summary: string;
  status: EventStatus;
  eventIds: string[];
}

export interface CausalEdge {
  id: string;
  projectId: string;
  fromEventId: string;
  toEventId: string;
  type: CausalEdgeType;
  confidence: CausalConfidence;
  reason: string;
  evidence: string | null;
}

export type TaskJourneyExitType = "next_prompt" | "session_end";

export interface TaskJourneyStage {
  lane: TimelineLane;
  count: number;
  status: EventStatus;
  firstEventId: string;
  lastEventId: string;
  eventIds: string[];
}

export interface TaskJourney {
  id: string;
  projectId: string;
  sessionId: string;
  promptEventId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  title: string;
  summary: string;
  status: EventStatus;
  exitType: TaskJourneyExitType;
  eventIds: string[];
  tokenUsage: TokenUsage;
  skills: SkillUsage[];
  stageCounts: Partial<Record<TimelineLane, number>>;
  stages: TaskJourneyStage[];
}

export interface TaskJourneyDetail {
  journey: TaskJourney;
  events: TimelineEvent[];
  causalEdges: CausalEdge[];
}

export type ContextBlockType =
  | "user_prompt"
  | "developer_instruction"
  | "history_prompt"
  | "assistant_summary"
  | "reasoning_summary"
  | "tool_input"
  | "tool_output"
  | "file_reference"
  | "file_excerpt"
  | "error_output"
  | "verification_output"
  | "skill_instruction"
  | "final_response";

export type ContextBlockState =
  | "new"
  | "retained"
  | "changed"
  | "cited"
  | "dropped"
  | "stale"
  | "contradicted";

export type ContextSnapshotPhase =
  | "prompt"
  | "history"
  | "planning"
  | "tool_call"
  | "tool_result"
  | "file_change"
  | "verification"
  | "response";

export interface ContextBlock {
  id: string;
  type: ContextBlockType;
  state: ContextBlockState;
  title: string;
  excerpt: string;
  sourceEventId: string | null;
  rawEventRefId: string | null;
  sourcePath: string | null;
  lineNo: number | null;
  timestamp: string;
  tokenEstimate: number;
  confidence: "direct" | "inferred";
  reason: string;
  files: string[];
  skills: string[];
}

export interface ContextWarning {
  id: string;
  severity: "low" | "medium" | "high";
  title: string;
  detail: string;
  blockIds: string[];
  eventIds: string[];
}

export interface ContextSnapshot {
  id: string;
  phase: ContextSnapshotPhase;
  timestamp: string;
  eventId: string;
  title: string;
  blocks: ContextBlock[];
  addedBlockIds: string[];
  retainedBlockIds: string[];
  changedBlockIds: string[];
  droppedBlockIds: string[];
  warnings: ContextWarning[];
  tokenUsage: TokenUsage | null;
}

export interface Artifact {
  id: string;
  eventId: string;
  type: "payload" | "command_output" | "file" | "git" | "note";
  path: string | null;
  excerpt: string;
  sha256: string | null;
}

export interface IngestJob {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  phase:
    | "queued"
    | "scanning"
    | "diffing"
    | "loading_history"
    | "parsing"
    | "normalizing"
    | "writing"
    | "completed"
    | "failed";
  startedAt: string;
  finishedAt: string | null;
  totalFiles: number;
  processedFiles: number;
  totalEvents: number;
  errors: string[];
  skippedFiles?: number;
  candidateFiles?: number;
  changedFiles?: number;
  processedBytes?: number;
  totalBytes?: number;
  currentFile?: string | null;
  workerPid?: number | null;
  processorVersion?: string | null;
}

export interface AgentSourceConfig {
  provider: AgentProvider;
  root?: string;
  path?: string;
  mode?: "files" | "cli-export";
}

export interface AgentLogSource {
  provider: AgentProvider;
  id: string;
  path: string;
  sizeBytes: number;
  mtimeMs: number;
}

export interface AgentParseOptions {
  repoRoot?: string | null;
}

export interface AgentLogAdapter {
  provider: AgentProvider;
  scan(config?: AgentSourceConfig): Promise<AgentLogSource[]>;
  parseSource(source: AgentLogSource, options?: AgentParseOptions): Promise<NormalizedBundle | null>;
}

export interface IngestResult {
  job: IngestJob;
  projects: number;
  sessions: number;
  events: number;
}

export interface ReplayNode {
  id: string;
  eventId: string;
  type: ReplayNodeType;
  label: string;
  timestamp: string;
  status: EventStatus;
  lane: TimelineLane;
  x: number;
  detail: string | null;
}

export interface RunReplay {
  session: SessionRecord;
  events: TimelineEvent[];
  nodes: ReplayNode[];
  artifacts: Artifact[];
}

export interface ProjectTimeline {
  project: ProjectRecord;
  episodes: Episode[];
  events: TimelineEvent[];
  causalEdges: CausalEdge[];
  taskJourneys: TaskJourney[];
  tokenUsage: TokenUsage;
  totalEvents?: number;
  limit?: number;
  offset?: number;
}

export interface TimelineQuery {
  limit?: number;
  offset?: number;
  lane?: TimelineLane;
  since?: string;
  until?: string;
}

export interface EventEvidence {
  event: TimelineEvent;
  artifacts: Artifact[];
  rawEvent: RawEventRef | null;
}

export interface ContextReplayResponse {
  journey: TaskJourney;
  snapshots: ContextSnapshot[];
  blocks: ContextBlock[];
  evidenceByEventId: Record<string, EventEvidence>;
  warnings: ContextWarning[];
}

export interface GitCommitRecord {
  id: string;
  projectId: string;
  repoRoot: string;
  hash: string;
  shortHash: string;
  authorName: string | null;
  authorEmail: string | null;
  timestamp: string;
  subject: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface CodexHistoryPrompt {
  sessionId: string;
  ts: string;
  text: string;
  sourcePath: string;
  lineNo: number;
}

export interface NormalizedBundle {
  project: ProjectRecord;
  session: SessionRecord;
  turns: TurnRecord[];
  rawEventRefs: RawEventRef[];
  events: TimelineEvent[];
  artifacts: Artifact[];
  historyPrompts?: CodexHistoryPrompt[];
  gitCommits?: GitCommitRecord[];
}
