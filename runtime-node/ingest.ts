import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentLogAdapter, AgentLogSource, AgentProvider, AgentSourceConfig, CodexHistoryPrompt, GitCommitRecord, IngestJob, NormalizedBundle } from "../core/types";
import { CCFlightDatabase } from "../storage/database";
import { resolveCodexHome } from "../storage/paths";
import { adapterForProvider, defaultAdapters } from "./adapters";
import { getCommits, getRepoRoot } from "./git-provider";
import { parseCodexHistoryJsonlFile } from "./history";

export const INGEST_PROCESSOR_VERSION = "2026-06-14-project-by-provider-v1";

export interface IngestStartResult {
  job: IngestJob;
  alreadyRunning: boolean;
}

export interface IngestStartOptions {
  codexHome?: string;
  sources?: AgentSourceConfig[];
}

interface IngestCandidate {
  source: AgentLogSource;
  adapter: AgentLogAdapter;
}

export class IngestService {
  private workersByJobId = new Map<string, ChildProcess>();

  constructor(private db: CCFlightDatabase) {}

  start(options: IngestStartOptions | string = {}): IngestStartResult {
    const activeJob = this.recoverStaleActiveJob(this.db.getActiveIngestJob());
    if (activeJob) {
      return { job: activeJob, alreadyRunning: true };
    }

    const ingestOptions = typeof options === "string" ? { codexHome: options } : options;
    const now = new Date().toISOString();
    const job: IngestJob = {
      id: randomUUID(),
      status: "queued",
      phase: "queued",
      startedAt: now,
      finishedAt: null,
      totalFiles: 0,
      processedFiles: 0,
      totalEvents: 0,
      errors: [],
      skippedFiles: 0,
      candidateFiles: 0,
      changedFiles: 0,
      processedBytes: 0,
      totalBytes: 0,
      currentFile: null,
      workerPid: null,
      processorVersion: INGEST_PROCESSOR_VERSION
    };
    this.db.upsertJob(job);
    const worker = this.spawnWorker(job.id, ingestOptions);
    if (worker.pid) {
      job.workerPid = worker.pid;
      this.db.upsertJob(job);
    }
    return { job, alreadyRunning: false };
  }

  private recoverStaleActiveJob(job: IngestJob | null): IngestJob | null {
    if (!job) return null;
    if (isLikelyActiveJob(job)) return job;
    job.status = "failed";
    job.phase = "failed";
    job.finishedAt = new Date().toISOString();
    job.currentFile = null;
    job.errors.push("Ingest worker is no longer running; marked stale job failed.");
    this.db.upsertJob(job);
    return null;
  }

  getJob(jobId: string) {
    return this.db.getJob(jobId);
  }

  private spawnWorker(jobId: string, options: IngestStartOptions) {
    const { command, args } = buildWorkerCommand(jobId, options);
    const worker = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: ["ignore", "ignore", "pipe"]
    });
    this.workersByJobId.set(jobId, worker);

    let stderr = "";
    worker.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      stderr = stderr.slice(-4000);
    });
    worker.on("error", (error) => {
      this.workersByJobId.delete(jobId);
      this.failActiveJob(jobId, `Ingest worker failed to start: ${error.message}`);
    });
    worker.on("exit", (code, signal) => {
      this.workersByJobId.delete(jobId);
      if (code === 0) return;
      const reason = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
      const detail = stderr.trim() ? `${reason}: ${stderr.trim()}` : reason;
      this.failActiveJob(jobId, `Ingest worker exited with ${detail}`);
    });
    return worker;
  }

  private failActiveJob(jobId: string, message: string) {
    const job = this.db.getJob(jobId);
    if (!job || (job.status !== "queued" && job.status !== "running")) {
      return;
    }
    job.status = "failed";
    job.phase = "failed";
    job.finishedAt = new Date().toISOString();
    job.currentFile = null;
    job.errors.push(message);
    this.db.upsertJob(job);
  }
}

export async function runIngestJob(db: CCFlightDatabase, jobId: string, ingestOptions: IngestStartOptions | string = {}, options: { workerPid?: number | null } = {}) {
  const job = db.getJob(jobId);
  if (!job) {
    throw new Error(`Ingest job ${jobId} not found`);
  }

  try {
    job.status = "running";
    job.phase = "scanning";
    job.workerPid = options.workerPid ?? job.workerPid ?? null;
    job.processorVersion = INGEST_PROCESSOR_VERSION;
    db.upsertJob(job);

    const normalizedOptions = typeof ingestOptions === "string" ? { codexHome: ingestOptions } : ingestOptions;
    const adapterConfigs = resolveAdapterConfigs(normalizedOptions);
    const sources = await scanAgentSources(adapterConfigs);
    job.phase = "diffing";
    job.totalFiles = sources.length;
    job.candidateFiles = sources.length;
    db.upsertJob(job);
    const currentSourceIds = new Set(sources.map((candidate) => candidate.source.id));
    db.pruneMissingIngestedFiles(providersEligibleForPrune(adapterConfigs, sources), currentSourceIds);

    const candidates: IngestCandidate[] = [];
    let skippedFiles = 0;
    let skippedBytes = 0;
    let totalBytes = 0;

    for (const candidate of sources) {
      totalBytes += candidate.source.sizeBytes;
      const previous = db.getIngestedFile(candidate.source.id);
      if (previous && previous.mtimeMs === candidate.source.mtimeMs && previous.sizeBytes === candidate.source.sizeBytes && previous.processorVersion === INGEST_PROCESSOR_VERSION) {
        skippedFiles += 1;
        skippedBytes += candidate.source.sizeBytes;
      } else {
        candidates.push(candidate);
      }
    }

    // Parse the most recently active sessions first. The project the user just
    // launched superview from is the one they're actively working in, so its log
    // has the newest mtime — this surfaces it in the list within seconds instead
    // of minutes, letting launch-dir auto-select land quickly.
    candidates.sort((a, b) => b.source.mtimeMs - a.source.mtimeMs);

    job.skippedFiles = skippedFiles;
    job.changedFiles = candidates.length;
    job.processedFiles = skippedFiles;
    job.processedBytes = skippedBytes;
    job.totalBytes = totalBytes;
    db.upsertJob(job);

    const codexRoot = adapterConfigs.find((config) => config.provider === "codex")?.root ?? normalizedOptions.codexHome;
    const historyBySessionId = candidates.length > 0 ? await loadHistoryForJob(db, job, codexRoot) : new Map<string, CodexHistoryPrompt[]>();
    const repoRootsByCwd = new Map<string, string | null>();
    const commitsByRepoRoot = new Map<string, GitCommitRecord[]>();

    let projectCount = 0;
    let sessionCount = 0;

    for (const candidate of candidates) {
      job.phase = "parsing";
      job.currentFile = candidate.source.path;
      db.upsertJob(job);
      await maybeDelayForTests();

      try {
        const bundle = await parseCandidateWithRepoRoot(candidate, repoRootsByCwd);

        job.phase = "writing";
        db.upsertJob(job);
        if (bundle) {
          bundle.historyPrompts = normalizeHistoryPrompts(historyBySessionId.get(bundle.session.externalSessionId) ?? historyBySessionId.get(bundle.session.id) ?? [], bundle.session.id);
          bundle.gitCommits = bundle.project.repoRoot ? await cachedCommits(commitsByRepoRoot, bundle.project.repoRoot, bundle.session.startedAt, bundle.session.endedAt) : [];
          db.upsertBundle(bundle);
          db.upsertIngestedFile({
            path: candidate.source.id,
            mtimeMs: candidate.source.mtimeMs,
            sizeBytes: candidate.source.sizeBytes,
            sha256: null,
            sessionId: bundle.session.id,
            processorVersion: INGEST_PROCESSOR_VERSION,
            processedAt: new Date().toISOString()
          });
          projectCount += 1;
          sessionCount += 1;
          job.totalEvents += bundle.events.length;
        } else {
          db.upsertIngestedFile({
            path: candidate.source.id,
            mtimeMs: candidate.source.mtimeMs,
            sizeBytes: candidate.source.sizeBytes,
            sha256: null,
            sessionId: null,
            processorVersion: INGEST_PROCESSOR_VERSION,
            processedAt: new Date().toISOString()
          });
        }
      } catch (error) {
        job.errors.push(`${candidate.source.path}: ${error instanceof Error ? error.message : String(error)}`);
      }

      job.processedFiles += 1;
      job.processedBytes = (job.processedBytes ?? 0) + candidate.source.sizeBytes;
      job.currentFile = null;
      db.upsertJob(job);
    }

    job.status = "completed";
    job.phase = "completed";
    job.finishedAt = new Date().toISOString();
    job.currentFile = null;
    db.upsertJob(job);
    return { projects: projectCount, sessions: sessionCount, events: job.totalEvents };
  } catch (error) {
    job.status = "failed";
    job.phase = "failed";
    job.finishedAt = new Date().toISOString();
    job.currentFile = null;
    job.errors.push(error instanceof Error ? error.message : String(error));
    db.upsertJob(job);
    return null;
  }
}

function normalizeHistoryPrompts(prompts: CodexHistoryPrompt[], sessionId: string): CodexHistoryPrompt[] {
  return prompts.map((prompt) => ({ ...prompt, sessionId }));
}

function resolveAdapterConfigs(options: IngestStartOptions): AgentSourceConfig[] {
  if (options.sources && options.sources.length > 0) {
    return options.sources;
  }
  if (options.codexHome) {
    return [{ provider: "codex", root: options.codexHome }];
  }
  return defaultAdapters().map((adapter) => ({ provider: adapter.provider }));
}

async function scanAgentSources(configs: AgentSourceConfig[]): Promise<IngestCandidate[]> {
  const candidates: IngestCandidate[] = [];
  for (const config of configs) {
    const adapter = adapterForProvider(config.provider);
    const sources = await adapter.scan(config);
    candidates.push(...sources.map((source) => ({ source, adapter })));
  }
  return candidates;
}

function providersEligibleForPrune(configs: AgentSourceConfig[], candidates: IngestCandidate[]): AgentProvider[] {
  const providersWithCurrentSources = new Set(candidates.map((candidate) => candidate.source.provider));
  return Array.from(
    new Set(
      configs
        .filter((config) => Boolean(config.root ?? config.path) || providersWithCurrentSources.has(config.provider))
        .map((config) => config.provider)
    )
  );
}

async function parseCandidateWithRepoRoot(candidate: IngestCandidate, repoRootsByCwd: Map<string, string | null>): Promise<NormalizedBundle | null> {
  const initial = await candidate.adapter.parseSource(candidate.source);
  if (!initial) return null;
  const repoRoot = await cachedRepoRoot(repoRootsByCwd, initial.session.cwd);
  if (!repoRoot) return initial;
  if (initial.project.repoRoot === repoRoot) return initial;
  return candidate.adapter.parseSource(candidate.source, { repoRoot });
}

async function loadHistoryBySessionId(codexHome?: string) {
  try {
    const sourcePath = `${codexHome ?? resolveCodexHome()}/history.jsonl`;
    return (await parseCodexHistoryJsonlFile(sourcePath)).bySessionId;
  } catch {
    return new Map();
  }
}

async function loadHistoryForJob(db: CCFlightDatabase, job: IngestJob, codexHome?: string) {
  job.phase = "loading_history";
  db.upsertJob(job);
  return loadHistoryBySessionId(codexHome);
}

async function cachedRepoRoot(cache: Map<string, string | null>, cwd: string) {
  if (cache.has(cwd)) return cache.get(cwd) ?? null;
  const repoRoot = await getRepoRoot(cwd);
  cache.set(cwd, repoRoot);
  return repoRoot;
}

async function cachedCommits(cache: Map<string, GitCommitRecord[]>, repoRoot: string, from?: string | null, to?: string | null) {
  let commits = cache.get(repoRoot);
  if (!commits) {
    commits = await getCommits(repoRoot);
    cache.set(repoRoot, commits);
  }
  return commits.filter((commit) => isCommitInWindow(commit, from, to));
}

function isCommitInWindow(commit: GitCommitRecord, from?: string | null, to?: string | null) {
  const commitMs = Date.parse(commit.timestamp);
  if (!Number.isFinite(commitMs)) return true;
  const fromMs = from ? Date.parse(from) : null;
  const toMs = to ? Date.parse(to) : null;
  if (fromMs !== null && Number.isFinite(fromMs) && commitMs < fromMs) return false;
  if (toMs !== null && Number.isFinite(toMs) && commitMs > toMs) return false;
  return true;
}

function resolveTsxCli() {
  // Try package-local node_modules first (works when installed globally)
  const pkgTsx = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "tsx", "dist", "cli.mjs");
  if (existsSync(pkgTsx)) return pkgTsx;
  // Fall back to CWD (dev mode)
  const cwdTsx = path.resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  if (existsSync(cwdTsx)) return cwdTsx;
  // Last resort: .bin/tsx
  return path.resolve(process.cwd(), "node_modules", ".bin", "tsx");
}

function buildWorkerCommand(jobId: string, options: IngestStartOptions) {
  const workerPath = workerPathFromImportMeta();
  const tsxCli = resolveTsxCli();
  const encodedOptions = Buffer.from(JSON.stringify(options), "utf8").toString("base64url");
  const args = [workerPath, jobId, encodedOptions];
  return { command: process.execPath, args: [tsxCli, ...args] };
}

function workerPathFromImportMeta() {
  const workerUrl = new URL("./ingest-worker.ts", import.meta.url);
  if (workerUrl.protocol === "file:") {
    return fileURLToPath(workerUrl);
  }
  return path.resolve(process.cwd(), "runtime-node", "ingest-worker.ts");
}

async function maybeDelayForTests() {
  const delayMs = Number(process.env.SUPERVIEW_TEST_INGEST_FILE_DELAY_MS ?? 0);
  if (Number.isFinite(delayMs) && delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

function isLikelyActiveJob(job: IngestJob) {
  if (job.workerPid && isProcessRunning(job.workerPid)) return true;
  const startedMs = Date.parse(job.startedAt);
  const ageMs = Number.isFinite(startedMs) ? Date.now() - startedMs : Number.POSITIVE_INFINITY;
  return job.status === "queued" && ageMs < 30_000;
}

function isProcessRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function parseIngestOptions(value: string | undefined): IngestStartOptions {
  if (!value) return {};
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as IngestStartOptions;
  } catch {
    return { codexHome: value };
  }
}
