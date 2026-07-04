import { cpSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import type express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "../runtime-node/server";
import { INGEST_PROCESSOR_VERSION } from "../runtime-node/ingest";

let dataDir: string;
let codexHome: string;
let claudeHome: string;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "superview-test-"));
  codexHome = mkdtempSync(path.join(tmpdir(), "superview-codex-home-"));
  claudeHome = mkdtempSync(path.join(tmpdir(), "superview-claude-home-"));
  cpSync(path.resolve("tests/fixtures/fake-codex-home"), codexHome, { recursive: true });
  mkdirSync(path.join(claudeHome, "projects", "-tmp-superview-multi-agent"), { recursive: true });
  cpSync(
    path.resolve("tests/fixtures/claude-code-transcripts/sample-session.jsonl"),
    path.join(claudeHome, "projects", "-tmp-superview-multi-agent", "sample-session.jsonl")
  );
  process.env.SUPERVIEW_DATA_DIR = dataDir;
});

afterEach(() => {
  delete process.env.SUPERVIEW_DATA_DIR;
  delete process.env.SUPERVIEW_TEST_INGEST_WORKER_FAIL;
  delete process.env.SUPERVIEW_TEST_INGEST_FILE_DELAY_MS;
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(codexHome, { recursive: true, force: true });
  rmSync(claudeHome, { recursive: true, force: true });
});

describe("CC Flight API", () => {
  it("reports health and starts an ingest job", async () => {
    const app = createServer();
    const health = await request(app).get("/api/health");
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);

    const ingest = await request(app).post("/api/ingest").send({ codexHome });
    expect(ingest.status).toBe(202);
    expect(ingest.body.jobId).toBeTruthy();
    const job = await waitForJob(app, ingest.body.jobId);
    expect(job.status).toBe("completed");
  });

  it("ingests multiple agent providers into the same API surface", async () => {
    const app = createServer();
    const ingest = await request(app)
      .post("/api/ingest")
      .send({
        sources: [
          { provider: "codex", root: codexHome },
          { provider: "claude-code", root: claudeHome }
        ]
      });
    expect(ingest.status).toBe(202);

    const job = await waitForJob(app, ingest.body.jobId);
    expect(job.status).toBe("completed");
    expect(job.totalFiles).toBe(2);

    const projects = await request(app).get("/api/projects");
    expect(projects.status).toBe(200);
    const sessions = projects.body.projects.flatMap((project: { sessions: Array<{ provider: string }> }) => project.sessions);
    expect(sessions.map((session: { provider: string }) => session.provider)).toEqual(expect.arrayContaining(["codex", "claude-code"]));
  });

  it("skips unchanged files, paginates timelines, and returns redacted event evidence", async () => {
    const app = createServer();

    const firstJob = await runIngest(app, codexHome);
    expect(firstJob.status).toBe("completed");
    expect(firstJob.totalFiles).toBe(1);
    expect(firstJob.processedFiles).toBe(1);
    expect(firstJob.skippedFiles).toBe(0);
    expect(firstJob.totalEvents).toBeGreaterThan(0);

    const secondJob = await runIngest(app, codexHome);
    expect(secondJob.status).toBe("completed");
    expect(secondJob.totalFiles).toBe(1);
    expect(secondJob.processedFiles).toBe(1);
    expect(secondJob.skippedFiles).toBe(1);
    expect(secondJob.totalEvents).toBe(0);

    const projects = await request(app).get("/api/projects");
    expect(projects.status).toBe(200);
    expect(projects.body.projects).toHaveLength(1);
    const projectId = projects.body.projects[0].id;

    const timeline = await request(app).get(`/api/projects/${projectId}/timeline`).query({ limit: 2, offset: 1 });
    expect(timeline.status).toBe(200);
    expect(timeline.body.events).toHaveLength(2);
    expect(timeline.body.totalEvents).toBe(firstJob.totalEvents);
    expect(timeline.body.limit).toBe(2);
    expect(timeline.body.offset).toBe(1);
    expect(timeline.body.episodes.length).toBeGreaterThan(0);
    expect(Array.isArray(timeline.body.causalEdges)).toBe(true);
    expect(Array.isArray(timeline.body.taskJourneys)).toBe(true);

    const evidenceEvent = timeline.body.events.find((event: { rawEventRefId: string | null }) => event.rawEventRefId);
    expect(evidenceEvent).toBeTruthy();

    const evidence = await request(app).get(`/api/events/${evidenceEvent.id}/evidence`);
    expect(evidence.status).toBe(200);
    expect(evidence.body.event.id).toBe(evidenceEvent.id);
    expect(Array.isArray(evidence.body.artifacts)).toBe(true);
    expect(evidence.body.rawEvent).toMatchObject({
      id: evidenceEvent.rawEventRefId,
      type: expect.any(String),
      redactedPayload: expect.anything()
    });
    expect(evidence.body.rawEvent.redactedPayloadJson).toBeUndefined();

      const fullTimeline = await request(app).get(`/api/projects/${projectId}/timeline`).query({ limit: 50 });
      const patchedCall = fullTimeline.body.events.find((event: { callId: string; toolName: string }) => event.callId === "call-2" && event.toolName === "functions.apply_patch");
    expect(patchedCall).toMatchObject({
      status: "success",
      durationMs: expect.any(Number),
      outputEventId: expect.any(String)
    });
    expect(fullTimeline.body.causalEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromEventId: patchedCall.id,
          toEventId: patchedCall.outputEventId,
          type: "same_call",
          confidence: "deterministic"
        })
      ])
    );
    expect(fullTimeline.body.taskJourneys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          promptEventId: expect.any(String),
          title: expect.any(String),
          eventIds: expect.any(Array),
          stages: expect.any(Array)
        })
      ])
    );

    const firstJourney = fullTimeline.body.taskJourneys[0];
    const journeyDetail = await request(app).get(`/api/task-journeys/${firstJourney.id}`);
    expect(journeyDetail.status).toBe(200);
    expect(journeyDetail.body.journey.id).toBe(firstJourney.id);
    expect(journeyDetail.body.events.map((event: { id: string }) => event.id)).toEqual(firstJourney.eventIds);
    expect(Array.isArray(journeyDetail.body.causalEdges)).toBe(true);
  });

  it("returns all timeline events when a full project timeline is requested", async () => {
    const eventCount = 650;
    const expectedTotalEvents = eventCount + 1;
    const largeTimelineCodexHome = createSingleSessionTimelineCodexHome(eventCount);
    try {
      const app = createServer();
      const job = await runIngest(app, largeTimelineCodexHome);
      expect(job.status).toBe("completed");

      const projects = await request(app).get("/api/projects");
      expect(projects.status).toBe(200);
      const project = projects.body.projects.find((candidate: { name: string }) => candidate.name === "superview-full-timeline");
      expect(project).toBeTruthy();

      const timeline = await request(app).get(`/api/projects/${project.id}/timeline`).query({ limit: 100000, offset: 0 });
      expect(timeline.status).toBe(200);
      expect(timeline.body.totalEvents).toBe(expectedTotalEvents);
      expect(timeline.body.events).toHaveLength(expectedTotalEvents);
      expect(timeline.body.limit).toBe(100000);
      expect(timeline.body.offset).toBe(0);
    } finally {
      rmSync(largeTimelineCodexHome, { recursive: true, force: true });
    }
  });

  it("persists skill usage and returns it in timelines and task journey details", async () => {
    const skillCodexHome = mkdtempSync(path.join(tmpdir(), "superview-skill-codex-home-"));
    try {
      mkdirSync(path.join(skillCodexHome, "sessions", "2026", "05", "25"), { recursive: true });
      cpSync(
        path.resolve("tests/fixtures/codex-rollouts/skill-usage-rollout.jsonl"),
        path.join(skillCodexHome, "sessions", "2026", "05", "25", "rollout-skill.jsonl")
      );

      const app = createServer();
      const job = await runIngest(app, skillCodexHome);
      expect(job.status).toBe("completed");

      const projects = await request(app).get("/api/projects");
      const projectId = projects.body.projects[0].id;
      const timeline = await request(app).get(`/api/projects/${projectId}/timeline`).query({ limit: 20 });
      const journey = timeline.body.taskJourneys[0];
      expect(journey.skills.map((skill: { name: string }) => skill.name)).toEqual(expect.arrayContaining(["abtest", "ui-ux-pro-max", "design-taste-frontend"]));

      const detail = await request(app).get(`/api/task-journeys/${journey.id}`);
      expect(detail.body.events.some((event: { skills?: Array<{ name: string }> }) => event.skills?.some((skill) => skill.name === "abtest"))).toBe(true);
      expect(detail.body.journey.skills.map((skill: { name: string }) => skill.name)).toContain("abtest");
    } finally {
      rmSync(skillCodexHome, { recursive: true, force: true });
    }
  });

  it("reprocesses unchanged files when their stored processor version is stale", async () => {
    const app = createServer();

    const firstJob = await runIngest(app, codexHome);
    expect(firstJob.status).toBe("completed");

    const dbPath = path.join(dataDir, "superview.sqlite");
    execFileSync("sqlite3", [dbPath, "UPDATE ingested_files SET processor_version = 'legacy-tokenless-parser'"]);

    const secondJob = await runIngest(app, codexHome);
    expect(secondJob.status).toBe("completed");
    expect(secondJob.processedFiles).toBe(1);
    expect(secondJob.skippedFiles).toBe(0);

    const storedVersion = execFileSync("sqlite3", [dbPath, "SELECT processor_version FROM ingested_files LIMIT 1"], { encoding: "utf8" }).trim();
    expect(storedVersion).toBe(INGEST_PROCESSOR_VERSION);
  });

  it("removes events from agent log files that disappeared before the next ingest", async () => {
    const staleClaudeHome = mkdtempSync(path.join(tmpdir(), "superview-stale-claude-home-"));
    const projectDir = path.join(staleClaudeHome, "projects", "-tmp-stale-project");
    const staleSourcePath = path.join(projectDir, "stale-session.jsonl");
    try {
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(
        staleSourcePath,
        [
          JSON.stringify({
            cwd: "/tmp/stale-project",
            sessionId: "stale-session",
            version: "1.2.3",
            type: "user",
            message: {
              role: "user",
              content: "Implement the following plan:\n\n# Plan: complete-mapping.md -> complete-mapping.toml 转换"
            },
            timestamp: "2026-04-25T04:01:45.308Z"
          }),
          JSON.stringify({
            cwd: "/tmp/stale-project",
            sessionId: "stale-session",
            version: "1.2.3",
            type: "assistant",
            message: {
              role: "assistant",
              content: "Converted the mapping plan."
            },
            timestamp: "2026-04-25T04:03:45.308Z"
          })
        ].join("\n")
      );

      const app = createServer();
      const firstJob = await runIngestSources(app, [{ provider: "claude-code", root: staleClaudeHome }]);
      expect(firstJob.status).toBe("completed");
      expect(firstJob.totalFiles).toBe(1);

      const firstProjects = await request(app).get("/api/projects");
      expect(firstProjects.body.projects.some((project: { name: string }) => project.name === "stale-project")).toBe(true);

      rmSync(staleSourcePath, { force: true });

      const secondJob = await runIngestSources(app, [{ provider: "claude-code", root: staleClaudeHome }]);
      expect(secondJob.status).toBe("completed");
      expect(secondJob.totalFiles).toBe(0);

      const secondProjects = await request(app).get("/api/projects");
      expect(secondProjects.body.projects.some((project: { name: string }) => project.name === "stale-project")).toBe(false);
    } finally {
      rmSync(staleClaudeHome, { recursive: true, force: true });
    }
  });

  it("adds git commits to the project timeline when sessions belong to a git repo", async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), "superview-api-git-"));
    const gitCodexHome = mkdtempSync(path.join(tmpdir(), "superview-git-codex-home-"));
    try {
      git(repoRoot, ["init"]);
      writeFileSync(path.join(repoRoot, "README.md"), "hello\n");
      git(repoRoot, ["add", "README.md"]);
      git(repoRoot, ["commit", "-m", "initial project commit"]);
      mkdirSync(path.join(gitCodexHome, "sessions", "2026", "05", "25"), { recursive: true });
      writeFileSync(
        path.join(gitCodexHome, "sessions", "2026", "05", "25", "rollout-git.jsonl"),
        [
          JSON.stringify({ timestamp: "2026-05-25T01:00:00.000Z", type: "session_meta", payload: { id: "git-session", timestamp: "2026-05-25T01:00:00.000Z", cwd: repoRoot, cli_version: "0.125.0", model_provider: "OpenAI", source: "cli" } }),
          JSON.stringify({ timestamp: "2026-05-25T01:00:01.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "show git timeline" }] } }),
          JSON.stringify({ timestamp: "2026-05-25T01:00:05.000Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "git timeline captured" }] } })
        ].join("\n")
      );

      const app = createServer();
      const job = await runIngest(app, gitCodexHome);
      expect(job.status).toBe("completed");

      const projects = await request(app).get("/api/projects");
      const projectId = projects.body.projects.find((project: { name: string }) => project.name === path.basename(repoRoot)).id;
      const timeline = await request(app).get(`/api/projects/${projectId}/timeline`).query({ limit: 20 });
      expect(timeline.body.events.some((event: { toolName: string; title: string; commitHash: string | null }) => event.toolName === "git" && event.title.includes("initial project commit") && event.commitHash)).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
      rmSync(gitCodexHome, { recursive: true, force: true });
    }
  });

  it("persists token usage and returns project totals from the API timeline", async () => {
    const tokenCodexHome = mkdtempSync(path.join(tmpdir(), "superview-token-codex-home-"));
    try {
      mkdirSync(path.join(tokenCodexHome, "sessions", "2026", "05", "25"), { recursive: true });
      writeFileSync(
        path.join(tokenCodexHome, "sessions", "2026", "05", "25", "rollout-token.jsonl"),
        [
          JSON.stringify({ timestamp: "2026-05-25T05:00:00.000Z", type: "session_meta", payload: { id: "token-session", timestamp: "2026-05-25T05:00:00.000Z", cwd: "/tmp/superview-token", cli_version: "0.125.0", model_provider: "OpenAI", source: "cli" } }),
          JSON.stringify({ timestamp: "2026-05-25T05:00:01.000Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "usage captured" }], usage: { input_tokens: 120, output_tokens: 30, output_tokens_details: { reasoning_tokens: 10 }, input_tokens_details: { cached_tokens: 40 } } } })
        ].join("\n")
      );

      const app = createServer();
      const job = await runIngest(app, tokenCodexHome);
      expect(job.status).toBe("completed");

      const projects = await request(app).get("/api/projects");
      const project = projects.body.projects.find((candidate: { name: string }) => candidate.name === "superview-token");
      const projectId = project.id;
      expect(project.tokenUsage).toEqual({
        input: 120,
        output: 30,
        reasoning: 10,
        cachedInput: 40,
        total: 160
      });
      const timeline = await request(app).get(`/api/projects/${projectId}/timeline`).query({ limit: 20 });
      expect(timeline.body.tokenUsage).toEqual({
        input: 120,
        output: 30,
        reasoning: 10,
        cachedInput: 40,
        total: 160
      });
      expect(timeline.body.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "assistant_message",
            tokenUsage: {
              input: 120,
              output: 30,
              reasoning: 10,
              cachedInput: 40,
              total: 160
            }
          })
        ])
      );
    } finally {
      rmSync(tokenCodexHome, { recursive: true, force: true });
    }
  });

  it("returns daily project token usage grouped by event day", async () => {
    const tokenCodexHome = mkdtempSync(path.join(tmpdir(), "superview-daily-token-codex-home-"));
    try {
      mkdirSync(path.join(tokenCodexHome, "sessions", "2026", "05", "25"), { recursive: true });
      writeFileSync(
        path.join(tokenCodexHome, "sessions", "2026", "05", "25", "rollout-daily-token.jsonl"),
        [
          JSON.stringify({ timestamp: "2026-05-25T05:00:00.000Z", type: "session_meta", payload: { id: "daily-token-session", timestamp: "2026-05-25T05:00:00.000Z", cwd: "/tmp/superview-daily-token", cli_version: "0.125.0", model_provider: "OpenAI", source: "cli" } }),
          JSON.stringify({ timestamp: "2026-05-25T05:00:01.000Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "day one first" }], usage: { input_tokens: 100, output_tokens: 20, output_tokens_details: { reasoning_tokens: 5 }, input_tokens_details: { cached_tokens: 30 } } } }),
          JSON.stringify({ timestamp: "2026-05-25T23:59:59.000Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "day one second" }], usage: { input_tokens: 50, output_tokens: 10, output_tokens_details: { reasoning_tokens: 2 }, input_tokens_details: { cached_tokens: 15 } } } }),
          JSON.stringify({ timestamp: "2026-05-26T00:00:01.000Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "day two" }], usage: { input_tokens: 25, output_tokens: 5, output_tokens_details: { reasoning_tokens: 1 }, input_tokens_details: { cached_tokens: 7 } } } })
        ].join("\n")
      );

      const app = createServer();
      const job = await runIngest(app, tokenCodexHome);
      expect(job.status).toBe("completed");

      const projects = await request(app).get("/api/projects");
      const project = projects.body.projects.find((candidate: { name: string }) => candidate.name === "superview-daily-token");
      const response = await request(app).get(`/api/projects/${project.id}/token-usage/daily`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        projectId: project.id,
        points: [
          {
            date: "2026-05-25",
            input: 150,
            output: 30,
            reasoning: 7,
            cachedInput: 45,
            total: 187
          },
          {
            date: "2026-05-26",
            input: 25,
            output: 5,
            reasoning: 1,
            cachedInput: 7,
            total: 31
          }
        ],
        total: {
          input: 175,
          output: 35,
          reasoning: 8,
          cachedInput: 52,
          total: 218
        }
      });
    } finally {
      rmSync(tokenCodexHome, { recursive: true, force: true });
    }
  });

  it("returns context replay snapshots with redacted evidence for a task journey", async () => {
    const contextCodexHome = createContextReplayCodexHome();
    try {
      const app = createServer();
      const job = await runIngest(app, contextCodexHome);
      expect(job.status).toBe("completed");

      const projects = await request(app).get("/api/projects");
      const project = projects.body.projects.find((candidate: { name: string }) => candidate.name === "superview-context-replay");
      expect(project).toBeTruthy();

      const timeline = await request(app).get(`/api/projects/${project.id}/timeline`).query({ limit: 20 });
      const journey = timeline.body.taskJourneys[0];
      const response = await request(app).get(`/api/task-journeys/${journey.id}/context-replay`).query({ projectId: project.id });

      expect(response.status).toBe(200);
      expect(response.body.journey.id).toBe(journey.id);
      expect(response.body.snapshots.map((snapshot: { phase: string }) => snapshot.phase)).toEqual(expect.arrayContaining(["prompt", "tool_result", "response"]));
      expect(response.body.blocks.some((block: { excerpt: string }) => block.excerpt.includes("OPENAI_API_KEY=[REDACTED]"))).toBe(true);
      expect(response.body.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "warning-unverified-final",
            severity: "high"
          })
        ])
      );
      const encoded = JSON.stringify(response.body);
      expect(encoded).toContain("[REDACTED]");
      expect(encoded).not.toContain("sk-live-secret");
      expect(Object.keys(response.body.evidenceByEventId).length).toBeGreaterThan(0);
    } finally {
      rmSync(contextCodexHome, { recursive: true, force: true });
    }
  });

  it("keeps read APIs responsive while ingesting 300+ rollout files", async () => {
    const largeCodexHome = createRolloutFixtureCodexHome(320);
    process.env.SUPERVIEW_TEST_INGEST_FILE_DELAY_MS = "1";
    try {
      const app = createServer();

      const ingest = await request(app).post("/api/ingest").send({ codexHome: largeCodexHome });
      expect(ingest.status).toBe(202);
      const jobId = runningJobIdFromResponse(ingest.body);
      expect(jobId).toBeTruthy();

      const readResponses = await Promise.all([
        requestWithin(app, "get", "/api/health", 500),
        requestWithin(app, "get", "/api/projects", 500),
        requestWithin(app, "get", "/api/health", 500),
        requestWithin(app, "get", "/api/projects", 500)
      ]);
      expect(readResponses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
      expect(readResponses[0].body.ok).toBe(true);
      expect(Array.isArray(readResponses[1].body.projects)).toBe(true);

      const job = await waitForJob(app, jobId);
      expect(job.status).toBe("completed");
      expect(job.totalFiles).toBeGreaterThanOrEqual(300);
    } finally {
      rmSync(largeCodexHome, { recursive: true, force: true });
    }
  });

  it("returns the existing running ingest job instead of starting a second full scan", async () => {
    const largeCodexHome = createRolloutFixtureCodexHome(320);
    process.env.SUPERVIEW_TEST_INGEST_FILE_DELAY_MS = "1";
    try {
      const app = createServer();

      const first = await request(app).post("/api/ingest").send({ codexHome: largeCodexHome });
      expect(first.status).toBe(202);
      const firstJobId = runningJobIdFromResponse(first.body);
      expect(firstJobId).toBeTruthy();

      const second = await request(app).post("/api/ingest").send({ codexHome: largeCodexHome });
      expect(second.status).toBe(202);
      const secondJobId = runningJobIdFromResponse(second.body);

      expect(second.body).toEqual(
        expect.objectContaining({
          alreadyRunning: true
        })
      );
      expect(secondJobId).toBe(firstJobId);

      const job = await waitForJob(app, firstJobId);
      expect(job.status).toBe("completed");
      expect(job.totalFiles).toBeGreaterThanOrEqual(300);
    } finally {
      rmSync(largeCodexHome, { recursive: true, force: true });
    }
  });

  it("marks a crashed ingest worker failed and keeps APIs responsive", async () => {
    const largeCodexHome = createRolloutFixtureCodexHome(320);
    process.env.SUPERVIEW_TEST_INGEST_WORKER_FAIL = "1";
    try {
      const app = createServer();

      const ingest = await request(app).post("/api/ingest").send({ codexHome: largeCodexHome });
      expect(ingest.status).toBe(202);
      const jobId = runningJobIdFromResponse(ingest.body);
      expect(jobId).toBeTruthy();

      const failedJob = await waitForJob(app, jobId);
      expect(failedJob.status).toBe("failed");
      expect(failedJob.finishedAt).toEqual(expect.any(String));
      expect(failedJob.errors.length).toBeGreaterThan(0);

      const [health, projects] = await Promise.all([
        requestWithin(app, "get", "/api/health", 500),
        requestWithin(app, "get", "/api/projects", 500)
      ]);
      expect(health.status).toBe(200);
      expect(health.body.ok).toBe(true);
      expect(projects.status).toBe(200);
      expect(Array.isArray(projects.body.projects)).toBe(true);
    } finally {
      rmSync(largeCodexHome, { recursive: true, force: true });
      delete process.env.SUPERVIEW_TEST_INGEST_WORKER_FAIL;
    }
  });
});

async function runIngest(app: express.Express, sourceCodexHome: string) {
  const ingest = await request(app).post("/api/ingest").send({ codexHome: sourceCodexHome });
  expect(ingest.status).toBe(202);
  return waitForJob(app, ingest.body.jobId);
}

async function runIngestSources(app: express.Express, sources: Array<{ provider: "codex" | "claude-code" | "opencode"; root: string }>) {
  const ingest = await request(app).post("/api/ingest").send({ sources });
  expect(ingest.status).toBe(202);
  return waitForJob(app, ingest.body.jobId);
}

function git(repoRoot: string, args: string[]) {
  execFileSync("git", ["-C", repoRoot, ...args], {
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test Author",
      GIT_AUTHOR_EMAIL: "author@example.com",
      GIT_COMMITTER_NAME: "Test Committer",
      GIT_COMMITTER_EMAIL: "committer@example.com",
      GIT_AUTHOR_DATE: "2026-05-25T01:00:02Z",
      GIT_COMMITTER_DATE: "2026-05-25T01:00:02Z"
    }
  });
}

async function waitForJob(app: express.Express, jobId: string) {
  for (let index = 0; index < 500; index += 1) {
    const response = await request(app).get(`/api/ingest/jobs/${jobId}`);
    expect(response.status).toBe(200);
    if (response.body.status === "completed" || response.body.status === "failed") {
      return response.body;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ingest job ${jobId}`);
}

function createRolloutFixtureCodexHome(fileCount: number) {
  const fixtureHome = mkdtempSync(path.join(tmpdir(), "superview-large-codex-home-"));
  const sessionsDir = path.join(fixtureHome, "sessions", "2026", "05", "26");
  mkdirSync(sessionsDir, { recursive: true });

  for (let index = 0; index < fileCount; index += 1) {
    const second = String(index % 60).padStart(2, "0");
    const minute = String(Math.floor(index / 60) % 60).padStart(2, "0");
    const timestamp = `2026-05-26T00:${minute}:${second}.000Z`;
    const sessionId = `large-fixture-session-${String(index).padStart(4, "0")}`;
    writeFileSync(
      path.join(sessionsDir, `rollout-2026-05-26T00-${minute}-${second}-${String(index).padStart(4, "0")}.jsonl`),
      [
        JSON.stringify({ timestamp, type: "session_meta", payload: { id: sessionId, timestamp, cwd: "/tmp/superview-large-fixture", cli_version: "fixture", model_provider: "OpenAI", source: "fixture" } }),
        JSON.stringify({ timestamp, type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: `processed fixture ${index}` }] } })
      ].join("\n")
    );
  }

  return fixtureHome;
}

function createSingleSessionTimelineCodexHome(eventCount: number) {
  const fixtureHome = mkdtempSync(path.join(tmpdir(), "superview-full-timeline-codex-home-"));
  const sessionsDir = path.join(fixtureHome, "sessions", "2026", "05", "27");
  mkdirSync(sessionsDir, { recursive: true });
  const sessionTimestamp = "2026-05-27T00:00:00.000Z";
  const lines = [
    JSON.stringify({
      timestamp: sessionTimestamp,
      type: "session_meta",
      payload: {
        id: "full-timeline-session",
        timestamp: sessionTimestamp,
        cwd: "/tmp/superview-full-timeline",
        cli_version: "fixture",
        model_provider: "OpenAI",
        source: "fixture"
      }
    })
  ];

  for (let index = 0; index < eventCount; index += 1) {
    const timestamp = new Date(Date.UTC(2026, 4, 27, 0, 0, index + 1)).toISOString();
    lines.push(
      JSON.stringify({
        timestamp,
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: `timeline event ${index}` }]
        }
      })
    );
  }

  writeFileSync(path.join(sessionsDir, "rollout-full-timeline.jsonl"), lines.join("\n"));
  return fixtureHome;
}

function createContextReplayCodexHome() {
  const fixtureHome = mkdtempSync(path.join(tmpdir(), "superview-context-codex-home-"));
  const sessionsDir = path.join(fixtureHome, "sessions", "2026", "05", "28");
  mkdirSync(sessionsDir, { recursive: true });
  writeFileSync(
    path.join(sessionsDir, "rollout-context-replay.jsonl"),
    [
      JSON.stringify({
        timestamp: "2026-05-28T00:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "context-replay-session",
          timestamp: "2026-05-28T00:00:00.000Z",
          cwd: "/tmp/superview-context-replay",
          cli_version: "fixture",
          model_provider: "OpenAI",
          source: "fixture"
        }
      }),
      JSON.stringify({
        timestamp: "2026-05-28T00:00:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Inspect context replay evidence and keep secrets redacted." }]
        }
      }),
      JSON.stringify({
        timestamp: "2026-05-28T00:00:02.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-secret",
          output: "OPENAI_API_KEY=sk-live-secret\nui/src/App.tsx"
        }
      }),
      JSON.stringify({
        timestamp: "2026-05-28T00:00:03.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Context replay evidence is available and secrets are redacted." }]
        }
      })
    ].join("\n")
  );
  return fixtureHome;
}

function runningJobIdFromResponse(body: Record<string, unknown>) {
  if (typeof body.jobId === "string") return body.jobId;
  if (typeof body.runningJobId === "string") return body.runningJobId;
  const job = body.job;
  if (job && typeof job === "object" && "id" in job && typeof job.id === "string") return job.id;
  return "";
}

async function requestWithin(app: express.Express, method: "get", url: string, timeoutMs: number) {
  return request(app)[method](url).timeout({ response: timeoutMs, deadline: timeoutMs + 250 });
}
