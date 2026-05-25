export type CodexOuterType = "session_meta" | "turn_context" | "response_item" | "event_msg";

export type EventKind =
  | "session"
  | "turn"
  | "user_prompt"
  | "assistant_message"
  | "tool_call"
  | "tool_result"
  | "reasoning_marker"
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
  lineNo: number;
  timestamp: string;
  type: string;
  redactedPayloadJson: string;
  sourcePath: string;
  sha256: string;
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
  startedAt: string;
  finishedAt: string | null;
  totalFiles: number;
  processedFiles: number;
  totalEvents: number;
  errors: string[];
  skippedFiles?: number;
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
