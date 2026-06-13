import { expect, test } from "@playwright/test";

test("filters projects by agent provider", async ({ page }) => {
  await page.route("**/api/projects", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        projects: [
          projectFixture("project-codex", "CodexProject", "codex"),
          projectFixture("project-claude", "ClaudeProject", "claude-code"),
          projectFixture("project-opencode", "OpenCodeProject", "opencode")
        ]
      })
    });
  });
  await page.route("**/api/projects/*/timeline?**", async (route) => {
    const projectId = route.request().url().match(/\/api\/projects\/([^/]+)\/timeline/)?.[1] ?? "project-codex";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        project: { id: projectId, name: projectId, cwd: `/tmp/${projectId}`, repoRoot: `/tmp/${projectId}`, createdAt: "2026-05-25T02:00:00.000Z", updatedAt: "2026-05-25T02:00:00.000Z" },
        episodes: [],
        events: [],
        causalEdges: [],
        taskJourneys: [],
        tokenUsage: { input: 0, output: 0, reasoning: 0, cachedInput: 0, total: 0 },
        totalEvents: 0,
        limit: 300,
        offset: 0
      })
    });
  });
  await page.route("**/api/projects/*/token-usage/daily", async (route) => {
    const projectId = route.request().url().match(/\/api\/projects\/([^/]+)\/token-usage\/daily/)?.[1] ?? "project-codex";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        projectId,
        points: [],
        total: { input: 0, output: 0, reasoning: 0, cachedInput: 0, total: 0 }
      })
    });
  });

  await page.goto("/");

  const projectFilter = page.getByLabel("Project provider", { exact: true });
  const projectSelect = page.getByLabel("Project", { exact: true });
  await expect(projectFilter).toHaveValue("all");
  await expect(projectSelect).toContainText("CodexProject");
  await expect(projectSelect).toContainText("ClaudeProject");
  await expect(projectSelect).toContainText("OpenCodeProject");

  await projectFilter.selectOption("claude-code");
  await expect(projectSelect).toContainText("ClaudeProject");
  await expect(projectSelect).not.toContainText("CodexProject");
  await expect(projectSelect).not.toContainText("OpenCodeProject");
  await expect(projectSelect).toHaveValue("project-claude");

  await projectFilter.selectOption("opencode");
  await expect(projectSelect).toContainText("OpenCodeProject");
  await expect(projectSelect).not.toContainText("ClaudeProject");
  await expect(projectSelect).toHaveValue("project-opencode");

  await projectFilter.selectOption("all");
  await expect(projectSelect).toContainText("CodexProject");
  await expect(projectSelect).toContainText("ClaudeProject");
  await expect(projectSelect).toContainText("OpenCodeProject");
});

test("shows the Mario loading game while the project index loads", async ({ page }) => {
  let releaseProjects!: () => void;
  const projectsReady = new Promise<void>((resolve) => {
    releaseProjects = resolve;
  });

  await page.route("**/api/projects", async (route) => {
    await projectsReady;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ projects: [] })
    });
  });

  await page.goto("/");

  const blockingLoader = page.getByRole("status", { name: "Blocking operation" });
  await expect(blockingLoader).toContainText("Loading SuperView index");
  await expect(blockingLoader.getByRole("status", { name: /Ingest running, scanning, 3 of 12 files processed, 25 percent/ })).toBeVisible();
  await expect(page.getByRole("img", { name: "Pixel Mario running" })).toBeVisible();

  releaseProjects();
  await expect(blockingLoader).toHaveCount(0);
});

test("opens scan controls from the Scan Agent Logs dropdown", async ({ page }) => {
  let ingestBody: unknown = null;
  await page.route("**/api/projects", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ projects: [] })
    });
  });
  await page.route("**/api/ingest", async (route) => {
    ingestBody = route.request().postDataJSON();
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ jobId: "job-dropdown" }) });
  });
  await page.route("**/api/ingest/jobs/job-dropdown", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: "job-dropdown",
        status: "completed",
        phase: "completed",
        startedAt: "2026-05-25T02:00:00.000Z",
        finishedAt: "2026-05-25T02:00:01.000Z",
        totalFiles: 1,
        processedFiles: 1,
        totalEvents: 4,
        skippedFiles: 0,
        changedFiles: 1,
        currentFile: null,
        errors: []
      })
    });
  });

  await page.goto("/");

  await expect(page.getByRole("textbox", { name: "Agent log root path", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Scan Agent Logs" }).first().click();

  const scanPanel = page.getByRole("region", { name: "Scan Agent Logs" });
  await expect(scanPanel).toBeVisible();
  await scanPanel.getByLabel("Agent log source", { exact: true }).selectOption("claude-code");
  await scanPanel.getByRole("textbox", { name: "Agent log root path", exact: true }).fill("/tmp/claude-logs");
  await scanPanel.getByRole("button", { name: "Scan Agent Logs" }).click();

  await expect.poll(() => ingestBody).toEqual({
    sources: [{ provider: "claude-code", root: "/tmp/claude-logs", path: "/tmp/claude-logs" }]
  });
  await expect(scanPanel).toHaveCount(0);
});

function projectFixture(id: string, name: string, provider: "codex" | "claude-code" | "opencode") {
  return {
    id,
    name,
    cwd: `/tmp/${name}`,
    repoRoot: `/tmp/${name}`,
    createdAt: "2026-05-25T02:00:00.000Z",
    updatedAt: "2026-05-25T02:00:00.000Z",
    tokenUsage: { input: 0, output: 0, reasoning: 0, cachedInput: 0, total: 0 },
    sessions: [
      {
        id: `${provider}:session`,
        projectId: id,
        path: `/tmp/${name}/session.jsonl`,
        cwd: `/tmp/${name}`,
        startedAt: "2026-05-25T02:00:00.000Z",
        endedAt: "2026-05-25T02:01:00.000Z",
        cliVersion: "fixture",
        modelProvider: "fixture",
        source: "fixture",
        provider,
        externalSessionId: "session",
        agentName: provider
      }
    ]
  };
}

function contextReplayFixture(journeyId: string, offset: number) {
  const tokenUsage = {
    input: 1000 + offset,
    output: 300,
    reasoning: 120,
    cachedInput: 250,
    total: 1420 + offset
  };
  const promptBlock = {
    id: `context-block-${journeyId}-prompt`,
    type: "user_prompt",
    state: "cited",
    title: `User task ${offset}`,
    excerpt: `Build task journey from input ${offset}`,
    sourceEventId: `event-${offset}`,
    rawEventRefId: `raw-${offset}`,
    sourcePath: "rollout.jsonl",
    lineNo: 2,
    timestamp: "2026-05-25T02:00:00.000Z",
    tokenEstimate: 8,
    confidence: "inferred",
    reason: "Cited by the final response via observable prompt text.",
    files: [],
    skills: []
  };
  const fileBlock = {
    id: `context-block-${journeyId}-file`,
    type: "file_reference",
    state: "new",
    title: "ui/src/App.tsx",
    excerpt: "ui/src/App.tsx",
    sourceEventId: `event-${offset + 2}`,
    rawEventRefId: `raw-${offset + 2}`,
    sourcePath: "ui/src/App.tsx",
    lineNo: null,
    timestamp: "2026-05-25T02:00:02.000Z",
    tokenEstimate: 4,
    confidence: "direct",
    reason: "File path changed during this task.",
    files: ["ui/src/App.tsx"],
    skills: []
  };
  const warning = {
    id: "warning-unverified-final",
    severity: "high",
    title: "Unverified final response",
    detail: "The final assistant response is observable, but no verification event appears before it in this task journey.",
    blockIds: [promptBlock.id],
    eventIds: [`event-${offset + 3}`]
  };
  return {
    journey: {
      id: journeyId,
      projectId: "project-fixture",
      sessionId: "fixture-tool-session",
      promptEventId: `event-${offset}`,
      startedAt: "2026-05-25T02:00:00.000Z",
      endedAt: "2026-05-25T02:00:03.000Z",
      durationMs: 3000,
      title: `User task ${offset}`,
      summary: `Loaded dynamic detail for task ${offset}.`,
      status: "success",
      exitType: "session_end",
      eventIds: [`event-${offset}`, `event-${offset + 2}`, `event-${offset + 3}`],
      tokenUsage,
      skills: [],
      stageCounts: {},
      stages: []
    },
    snapshots: [
      {
        id: `snapshot-${journeyId}-prompt`,
        phase: "prompt",
        timestamp: "2026-05-25T02:00:00.000Z",
        eventId: `event-${offset}`,
        title: "Prompt",
        blocks: [promptBlock],
        addedBlockIds: [promptBlock.id],
        retainedBlockIds: [],
        changedBlockIds: [],
        droppedBlockIds: [],
        warnings: [],
        tokenUsage: null
      },
      {
        id: `snapshot-${journeyId}-response`,
        phase: "response",
        timestamp: "2026-05-25T02:00:03.000Z",
        eventId: `event-${offset + 3}`,
        title: "Response",
        blocks: [promptBlock, fileBlock],
        addedBlockIds: [fileBlock.id],
        retainedBlockIds: [promptBlock.id],
        changedBlockIds: [],
        droppedBlockIds: [],
        warnings: [warning],
        tokenUsage
      }
    ],
    blocks: [promptBlock, fileBlock],
    evidenceByEventId: {},
    warnings: [warning]
  };
}

test("scans fixture logs, renders an IM-style task thread, hides background detail, and toggles theme", async ({ page }) => {
  let timelineRequestCount = 0;
  let evidenceRequested = false;
  const journeyDetailRequests: string[] = [];
  const contextReplayRequests: string[] = [];
  const tokenUsageForTask = (taskOffset: number) => ({
    input: 1000 + taskOffset,
    output: 300 + Math.floor(taskOffset / 3),
    reasoning: 120 + Math.floor(taskOffset / 5),
    cachedInput: 250 + Math.floor(taskOffset / 4),
    total: 1420 + taskOffset + Math.floor(taskOffset / 3) + Math.floor(taskOffset / 5)
  });
  const durationForEvents = (events: Array<{ timestamp: string }>) => Date.parse(events.at(-1)?.timestamp ?? events[0].timestamp) - Date.parse(events[0].timestamp);

  await page.route("**/api/projects", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        projects: [
          {
            id: "project-fixture",
            name: "superview-fixture",
            cwd: "/tmp/superview-fixture",
            repoRoot: "/tmp/superview-fixture",
            createdAt: "2026-05-25T02:00:00.000Z",
            updatedAt: "2026-05-25T02:00:00.000Z",
            tokenUsage: {
              input: 4312,
              output: 1260,
              reasoning: 842,
              cachedInput: 910,
              total: 6414
            },
            sessions: [
              {
                id: "fixture-tool-session",
                projectId: "project-fixture",
                path: "/tmp/superview-fixture/rollout.jsonl",
                cwd: "/tmp/superview-fixture",
                startedAt: "2026-05-25T02:00:00.000Z",
                endedAt: "2026-05-25T02:05:00.000Z",
                cliVersion: "fixture",
                modelProvider: "openai",
                source: "fixture"
              }
            ]
          }
        ]
      })
    });
  });

  await page.route("**/api/ingest", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ jobId: "job-fixture" }) });
  });

  await page.route("**/api/ingest/jobs/job-fixture", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: "job-fixture",
        status: "completed",
        phase: "completed",
        startedAt: "2026-05-25T02:00:00.000Z",
        finishedAt: "2026-05-25T02:00:01.000Z",
        totalFiles: 1,
        processedFiles: 1,
        totalEvents: 340,
        skippedFiles: 4,
        changedFiles: 1,
        currentFile: "rollout.jsonl",
        errors: []
      })
    });
  });

  await page.route("**/api/projects/*/token-usage/daily", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        projectId: "project-fixture",
        points: [
          { date: "2026-05-25", input: 2200, output: 640, reasoning: 422, cachedInput: 520, total: 3262 },
          { date: "2026-05-26", input: 2112, output: 620, reasoning: 420, cachedInput: 390, total: 3152 }
        ],
        total: {
          input: 4312,
          output: 1260,
          reasoning: 842,
          cachedInput: 910,
          total: 6414
        }
      })
    });
  });

  await page.route("**/api/projects/*/timeline?**", async (route) => {
    timelineRequestCount += 1;
    const url = new URL(route.request().url());
    expect(Number(url.searchParams.get("limit"))).toBeGreaterThanOrEqual(100000);
    expect(url.searchParams.get("offset")).toBe("0");

    const baseTime = Date.parse("2026-05-25T02:00:00.000Z");
    const offset = 0;
    const events = Array.from({ length: 340 }, (_, index) => ({
      id: `event-${offset + index}`,
      projectId: "project-fixture",
      sessionId: "fixture-tool-session",
      turnId: "turn-1",
      timestamp: new Date(baseTime + offset * 1000 + index * 1000).toISOString(),
      kind: index % 3 === 0 ? "tool_call" : "assistant_message",
      lane: index % 2 === 0 ? "Code" : "Agent Runs",
      title: `Timeline event ${offset + index}`,
      detail: `Redacted event detail ${offset + index}`,
      toolName: index % 3 === 0 ? "exec_command" : null,
      callId: index % 3 === 0 ? `call-${offset + index}` : null,
      status: "success",
      files: [],
      rawEventRefId: `raw-${offset + index}`,
      tokenUsage: null
    }));
    if (events[0]) {
      events[0].kind = "user_prompt";
      events[0].lane = "Product";
      events[0].title = `User task ${offset}`;
      events[0].detail = `Build task journey from input ${offset}`;
      events[0].toolName = null;
      events[0].callId = null;
    }
    [75, 150, 225, 300].forEach((index) => {
      events[index].kind = "user_prompt";
      events[index].lane = "Product";
      events[index].title = `User task ${index}`;
      events[index].detail = `Build task journey from input ${index}`;
      events[index].toolName = null;
      events[index].callId = null;
    });
    const taskStarts = [0, 75, 150, 225, 300];
    const taskJourneySummaries = taskStarts.map((startIndex, taskIndex) => {
      const taskEvents = events.slice(startIndex, taskStarts[taskIndex + 1] ?? events.length);
      const prompt = taskEvents[0];
      const tokenUsage = tokenUsageForTask(offset + startIndex);
      return {
        id: `task-${offset + startIndex}`,
        projectId: "project-fixture",
        sessionId: "fixture-tool-session",
        promptEventId: prompt.id,
        startedAt: prompt.timestamp,
        endedAt: taskEvents.at(-1)?.timestamp ?? prompt.timestamp,
        durationMs: durationForEvents(taskEvents),
        title: `User task ${offset + startIndex}`,
        summary: `From user input through ${taskEvents.length} event(s), 3 stage(s), ending at session end.`,
        status: "success",
        exitType: "session_end",
        eventIds: taskEvents.map((event) => event.id),
        tokenUsage,
        skills: offset + startIndex === 0 ? [
          {
            name: "abtest",
            source: "user_prompt",
            confidence: "inferred",
            path: null,
            command: "/abtest",
            evidencePath: "rollout.jsonl",
            excerpt: "/abtest"
          },
          {
            name: "design-review",
            source: "assistant_message",
            confidence: "explicit",
            path: "/Users/sean/.agents/skills/gstack/design-review/SKILL.md",
            command: null,
            evidencePath: "rollout.jsonl",
            excerpt: "Using skill design-review"
          }
        ] : [],
        stageCounts: {
          Product: taskEvents.filter((event) => event.lane === "Product").length,
          Code: taskEvents.filter((event) => event.lane === "Code").length,
          "Agent Runs": taskEvents.filter((event) => event.lane === "Agent Runs").length
        },
        stages: [
          {
            lane: "Product",
            count: taskEvents.filter((event) => event.lane === "Product").length,
            status: "success",
            firstEventId: prompt.id,
            lastEventId: [...taskEvents].reverse().find((event) => event.lane === "Product")?.id ?? prompt.id,
            eventIds: taskEvents.filter((event) => event.lane === "Product").map((event) => event.id)
          },
          {
            lane: "Code",
            count: taskEvents.filter((event) => event.lane === "Code").length,
            status: "success",
            firstEventId: taskEvents.find((event) => event.lane === "Code")?.id ?? prompt.id,
            lastEventId: [...taskEvents].reverse().find((event) => event.lane === "Code")?.id ?? prompt.id,
            eventIds: taskEvents.filter((event) => event.lane === "Code").map((event) => event.id)
          },
          {
            lane: "Agent Runs",
            count: taskEvents.filter((event) => event.lane === "Agent Runs").length,
            status: "success",
            firstEventId: taskEvents.find((event) => event.lane === "Agent Runs")?.id ?? prompt.id,
            lastEventId: [...taskEvents].reverse().find((event) => event.lane === "Agent Runs")?.id ?? prompt.id,
            eventIds: taskEvents.filter((event) => event.lane === "Agent Runs").map((event) => event.id)
          }
        ]
      };
    });
    const causalEdges = [
      {
        id: "edge-300-301",
        projectId: "project-fixture",
        fromEventId: "event-300",
        toEventId: "event-301",
        type: "verified_by",
        confidence: "inferred",
        reason: "Nearest successful verification after this change in the same session.",
        evidence: null
      },
      {
        id: "edge-299-300",
        projectId: "project-fixture",
        fromEventId: "event-299",
        toEventId: "event-300",
        type: "implements_prompt",
        confidence: "inferred",
        reason: "First code change after this prompt in the same session.",
        evidence: "Timeline event 299"
      }
    ];

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        project: {
          id: "project-fixture",
          name: "superview-fixture",
          cwd: "/tmp/superview-fixture",
          repoRoot: "/tmp/superview-fixture",
          createdAt: "2026-05-25T02:00:00.000Z",
          updatedAt: "2026-05-25T02:00:00.000Z"
        },
        episodes: [
          {
            id: `episode-${offset}`,
            projectId: "project-fixture",
            startedAt: events[0].timestamp,
            endedAt: events.at(-1)?.timestamp ?? events[0].timestamp,
            title: `Episode ${offset}`,
            summary: "Grouped fixture events",
            status: "success",
            eventIds: [events[0].id]
          }
        ],
        events,
        causalEdges,
        taskJourneys: taskJourneySummaries,
        tokenUsage: {
          input: 4312,
          output: 1260,
          reasoning: 842,
          cachedInput: 910,
          total: 6414
        },
        totalEvents: events.length,
        limit: 300,
        offset
      })
    });
  });

  await page.route("**/api/events/*/evidence", async (route) => {
    evidenceRequested = true;
    const eventId = route.request().url().match(/\/api\/events\/([^/]+)\/evidence/)?.[1] ?? "event-0";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        event: {
          id: eventId,
          projectId: "project-fixture",
          sessionId: "fixture-tool-session",
          turnId: "turn-1",
          timestamp: "2026-05-25T02:00:00.000Z",
          kind: "tool_call",
          lane: "Code",
          title: `Evidence for ${eventId}`,
          detail: "Drawer detail is redacted",
          toolName: "exec_command",
          callId: "call-evidence",
          status: "success",
          files: [],
          rawEventRefId: `raw-${eventId}`
        },
        artifacts: [
          {
            id: `artifact-${eventId}`,
            eventId,
            type: "command_output",
            path: "/tmp/redacted.log",
            excerpt: "redacted command output",
            sha256: "abc123"
          }
        ],
        rawEvent: {
          id: `raw-${eventId}`,
          sessionId: "fixture-tool-session",
          lineNo: 7,
          timestamp: "2026-05-25T02:00:00.000Z",
          type: "response_item",
          redactedPayloadJson: "{\"token\":\"[REDACTED]\"}",
          sourcePath: "rollout.jsonl",
          sha256: "raw123"
        }
      })
    });
  });

  await page.route("**/api/task-journeys/**", async (route) => {
    const requestUrl = new URL(route.request().url());
    expect(requestUrl.searchParams.get("projectId")).toBe("project-fixture");
    const journeyId = requestUrl.pathname.match(/\/api\/task-journeys\/([^/?]+)/)?.[1] ?? "task-unknown";
    if (requestUrl.pathname.endsWith("/context-replay")) {
      contextReplayRequests.push(journeyId);
      const offset = Number(journeyId.replace("task-", "")) || 0;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(contextReplayFixture(journeyId, offset))
      });
      return;
    }
    journeyDetailRequests.push(journeyId);
    const offset = Number(journeyId.replace("task-", "")) || 0;
    const baseTime = Date.parse("2026-05-25T02:00:00.000Z");
    const events = Array.from({ length: offset === 0 ? 300 : 40 }, (_, index) => ({
      id: `event-${offset + index}`,
      projectId: "project-fixture",
      sessionId: "fixture-tool-session",
      turnId: "turn-1",
      timestamp: new Date(baseTime + offset * 1000 + index * 1000).toISOString(),
      kind: index === 0 ? "user_prompt" : index % 3 === 0 ? "tool_call" : "assistant_message",
      lane: index === 0 ? "Product" : index % 2 === 0 ? "Code" : "Agent Runs",
      title: index === 0 ? `User task ${offset}` : index === 1 ? `Codex CLI output ${offset}` : `Loaded detail event ${offset + index}`,
      detail:
        index === 1
          ? `Codex completed task ${offset} in CLI output.${offset === 300 ? ` ${Array.from({ length: 80 }, (_, repeatIndex) => `Long CLI output line ${repeatIndex} for truncation verification.`).join("\n")}` : ""}`
          : `Loaded task detail ${offset + index}`,
      toolName: index % 3 === 0 && index !== 0 ? "exec_command" : null,
      callId: index % 3 === 0 && index !== 0 ? `call-${offset + index}` : null,
      status: "success",
      files: [],
      rawEventRefId: `detail-raw-${offset + index}`,
      tokenUsage: index === 1 ? tokenUsageForTask(offset) : null,
      skills:
        offset === 300 && index === 1
          ? [
              {
                name: "ui-ux-pro-max",
                source: "assistant_message",
                confidence: "explicit",
                path: null,
                command: null,
                evidencePath: "rollout.jsonl",
                excerpt: "Using skill ui-ux-pro-max"
              }
            ]
          : []
    }));
    const tokenUsage = tokenUsageForTask(offset);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        journey: {
          id: journeyId,
          projectId: "project-fixture",
          sessionId: "fixture-tool-session",
          promptEventId: events[0].id,
          startedAt: events[0].timestamp,
          endedAt: events.at(-1)?.timestamp ?? events[0].timestamp,
          durationMs: durationForEvents(events),
          title: `User task ${offset}`,
          summary: `Loaded dynamic detail for task ${offset}.`,
          status: "success",
          exitType: "session_end",
          eventIds: events.map((event) => event.id),
          tokenUsage,
          skills: offset === 300 ? [
            {
              name: "ui-ux-pro-max",
              source: "assistant_message",
              confidence: "explicit",
              path: null,
              command: null,
              evidencePath: "rollout.jsonl",
              excerpt: "Using skill ui-ux-pro-max"
            }
          ] : [],
          stageCounts: {
            Product: 1,
            Code: events.filter((event) => event.lane === "Code").length,
            "Agent Runs": events.filter((event) => event.lane === "Agent Runs").length
          },
          stages: [
            { lane: "Product", count: 1, status: "success", firstEventId: events[0].id, lastEventId: events[0].id, eventIds: [events[0].id] },
            {
              lane: "Code",
              count: events.filter((event) => event.lane === "Code").length,
              status: "success",
              firstEventId: events.find((event) => event.lane === "Code")?.id ?? events[0].id,
              lastEventId: [...events].reverse().find((event) => event.lane === "Code")?.id ?? events[0].id,
              eventIds: events.filter((event) => event.lane === "Code").map((event) => event.id)
            },
            {
              lane: "Agent Runs",
              count: events.filter((event) => event.lane === "Agent Runs").length,
              status: "success",
              firstEventId: events.find((event) => event.lane === "Agent Runs")?.id ?? events[0].id,
              lastEventId: [...events].reverse().find((event) => event.lane === "Agent Runs")?.id ?? events[0].id,
              eventIds: events.filter((event) => event.lane === "Agent Runs").map((event) => event.id)
            }
          ]
        },
        events,
        causalEdges:
          offset === 300
            ? [
                {
                  id: "detail-edge-300-301",
                  projectId: "project-fixture",
                  fromEventId: "event-300",
                  toEventId: "event-301",
                  type: "verified_by",
                  confidence: "inferred",
                  reason: "Nearest successful verification after this change in the same session.",
                  evidence: null
                }
              ]
            : []
      })
    });
  });

  await page.goto("/");

  await page.getByRole("button", { name: "Scan Agent Logs" }).first().click();
  const scanPanel = page.getByRole("region", { name: "Scan Agent Logs" });
  await scanPanel.getByRole("textbox", { name: "Agent log root path", exact: true }).fill("tests/fixtures/fake-codex-home");
  await scanPanel.getByRole("button", { name: "Scan Agent Logs" }).click();

  await expect(page.getByRole("status", { name: /Ingest completed, completed, 1 of 1 files processed, 100 percent/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Castle clear")).toBeVisible();
  await expect(page.getByText("Coins 1")).toBeVisible();
  await expect(page.getByText("Cleared blocks 4")).toBeVisible();
  await expect(page.getByText("CLI Conversation", { exact: true })).toBeVisible();
  await expect(page.getByText("User Inputs", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Run Ledger", { exact: true })).toHaveCount(0);
  await expect(page.locator(".run-row")).toHaveCount(0);
  await expect(page.getByLabel("Project", { exact: true })).toBeVisible();
  await expect(page.locator(".status-cluster").getByText("Tokens", { exact: true })).toBeVisible();
  await expect(page.locator(".status-cluster").getByText("0.006M", { exact: true })).toBeVisible();
  await expect(page.locator(".status-cluster").getByText("KV hit", { exact: true })).toBeVisible();
  await expect(page.locator(".status-cluster").getByText("21.1%", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Token usage by day" })).toHaveCount(0);
  const tokensMetric = page.locator(".metric").filter({ hasText: "Tokens" });
  await expect(tokensMetric.getByRole("button", { name: /Show daily token usage chart/ })).toBeVisible();
  await expect(page.getByRole("img", { name: "Daily token usage by date" })).toHaveCount(0);
  await tokensMetric.getByRole("button", { name: /Show daily token usage chart/ }).click();
  await expect(tokensMetric.getByText("Daily usage by day")).toBeVisible();
  await expect(page.getByRole("img", { name: "Daily token usage by date" })).toBeVisible();
  await expect(page.getByLabel("Visible token usage breakdown").getByText("Input", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Visible token usage breakdown").getByText("Cached input", { exact: true })).toBeVisible();
  await tokensMetric.getByRole("button", { name: /Hide daily token usage chart/ }).click();
  await expect(page.getByRole("img", { name: "Daily token usage by date" })).toHaveCount(0);
  await expect(page.getByLabel("Project", { exact: true })).toHaveValue("project-fixture");
  await expect(page.getByLabel("Project", { exact: true })).toContainText("0.006M tokens / KV 21.1%");
  await expect(page.getByText("User", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Codex CLI", { exact: true }).first()).toBeVisible();
  const masterList = page.getByLabel("User input index");
  const detailsPane = page.getByLabel("Conversation details");
  await expect(masterList).toBeVisible();
  await expect(detailsPane).toBeVisible();
  await expect(page.locator(".conversation-master-item")).toHaveCount(5);
  await expect(page.locator(".conversation-master-item").first()).toContainText("Build task journey from input 300");
  await expect(page.locator(".conversation-master-item").nth(1)).toContainText("Build task journey from input 225");
  await expect(page.locator(".conversation-master-item").nth(2)).toContainText("Build task journey from input 150");
  await expect(page.locator(".conversation-master-item").nth(3)).toContainText("Build task journey from input 75");
  await expect(page.locator(".conversation-master-item").nth(4)).toContainText("Build task journey from input 0");
  await expect(detailsPane.getByText("Build task journey from input 300")).toBeVisible();
  await expect(detailsPane.locator(".conversation-turn")).toHaveCount(1);
  await expect(detailsPane.getByText("Build task journey from input 0")).toHaveCount(0);
  await page.locator(".conversation-master-item").filter({ hasText: "Build task journey from input 0" }).click();
  await expect(detailsPane.getByText("Build task journey from input 0")).toBeVisible();
  await expect(detailsPane.getByText("Build task journey from input 300")).toHaveCount(0);
  await expect(detailsPane.getByText("1m 14s")).toBeVisible();
  await expect(detailsPane.getByText("0.001M tokens")).toBeVisible();
  await expect(detailsPane.getByText("KV hit 25.0%")).toBeVisible();
  await expect(detailsPane.locator(".message-row.user").getByText("Build task journey from input 0")).toHaveCount(1);
  await expect(detailsPane.locator(".message-row.user .skill-chip", { hasText: "abtest" })).toBeVisible();
  await expect(detailsPane.locator(".message-row.codex .skill-chip", { hasText: "design-review" }).first()).toBeVisible();
  await expect(contextReplayRequests).toEqual([]);
  await detailsPane.getByRole("tab", { name: "Context Replay" }).click();
  await expect.poll(() => contextReplayRequests.filter((id) => id === "task-0").length).toBe(1);
  const contextReplayLedger = detailsPane.getByRole("region", { name: "Context Replay ledger" });
  await expect(contextReplayLedger).toContainText("Build task journey from input 0");
  await expect(contextReplayLedger).toContainText("ui/src/App.tsx");
  await expect(contextReplayLedger.locator(".context-snapshot-index")).toHaveText(["1", "2"]);
  await expect(contextReplayLedger.getByText("from step 1")).toBeVisible();
  await expect(contextReplayLedger.getByText("from step 2")).toBeVisible();
  await page.locator(".context-block-card").first().click();
  await page.keyboard.press("ArrowLeft");
  await expect(contextReplayLedger.getByRole("button", { name: /Step 1: Prompt/ })).toHaveClass(/active/);
  await page.keyboard.press("ArrowRight");
  await expect(contextReplayLedger.getByRole("button", { name: /Step 2: Response/ })).toHaveClass(/active/);
  await expect(detailsPane.getByText("Unverified final response")).toBeVisible();
  await detailsPane.getByRole("tab", { name: "Conversation" }).click();
  await page.locator(".conversation-master-item").filter({ hasText: "Build task journey from input 75" }).click();
  await expect(detailsPane.getByText("Build task journey from input 75")).toBeVisible();
  await expect(detailsPane.getByText("Build task journey from input 0")).toHaveCount(0);
  await page.locator(".conversation-master-item").filter({ hasText: "Build task journey from input 0" }).click();
  await expect(detailsPane.getByRole("button", { name: /Agent work.*View process\.\.\./ })).toHaveCount(1);
  await expect(detailsPane.locator(":scope .conversation-turn > .message-row.user .conversation-message.user")).toBeVisible();
  await expect(detailsPane.locator(":scope .conversation-turn > .detail-message-row .conversation-message.codex.detail-toggle")).toBeVisible();
  await expect(detailsPane.locator(":scope .conversation-turn > .message-row.codex .conversation-message.codex:not(.detail-toggle)")).toBeVisible();
  await expect(page.getByText("Loaded task detail 2")).toHaveCount(0);
  await expect(page.getByText("Agent Trace", { exact: true })).toHaveCount(0);
  await expect(page.locator(".lane-label")).toHaveCount(0);
  await expect(page.getByText("1-340 of 340")).toBeVisible();
  await expect(page.getByText("5 task journeys loaded from 340 events")).toBeVisible();
  await expect(page.getByRole("button", { name: "Prev page" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Next page" })).toHaveCount(0);
  await expect(journeyDetailRequests).toEqual([]);
  await detailsPane.getByRole("button", { name: /Agent work.*View process\.\.\./ }).click();
  await expect.poll(() => journeyDetailRequests.filter((id) => id === "task-0").length).toBe(1);
  await expect(journeyDetailRequests).not.toContain("task-225");
  await expect(journeyDetailRequests).not.toContain("task-225");
  await page.locator(".conversation-master-item").filter({ hasText: "Build task journey from input 225" }).click();
  await detailsPane.getByRole("button", { name: /Agent work.*View process\.\.\./ }).click();
  await expect.poll(() => journeyDetailRequests.filter((id) => id === "task-225").length).toBe(1);
  await expect(detailsPane.getByText("Codex completed task 225 in CLI output.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Show causal paths" })).toHaveCount(0);
  await expect(page.getByText("Causal path", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Causal Links" })).toHaveCount(0);
  await expect(journeyDetailRequests).not.toContain("task-300");
  await page.locator(".conversation-master-item").filter({ hasText: "Build task journey from input 300" }).click();
  await detailsPane.getByRole("button", { name: /Agent work.*View process\.\.\./ }).click();
  await expect.poll(() => journeyDetailRequests.filter((id) => id === "task-300").length).toBe(1);
  await expect(page.getByText("Codex completed task 300 in CLI output.")).toBeVisible();
  await expect(detailsPane.locator(".skill-chip", { hasText: "ui-ux-pro-max" }).first()).toBeVisible();
  const task300CodexBody = detailsPane.locator(".message-row.codex .message-body");
  await expect(task300CodexBody).toHaveAttribute("data-expanded", "false");
  await expect.poll(async () => Math.round((await task300CodexBody.boundingBox())?.height ?? 0)).toBeLessThanOrEqual(250);
  await detailsPane.locator(".message-expand-toggle").filter({ hasText: "Expand" }).click();
  await expect(task300CodexBody).toHaveAttribute("data-expanded", "true");
  await expect.poll(async () => Math.round((await task300CodexBody.boundingBox())?.height ?? 0)).toBeGreaterThan(250);
  await detailsPane.locator(".message-expand-toggle").filter({ hasText: "Collapse" }).click();
  await expect(task300CodexBody).toHaveAttribute("data-expanded", "false");
  await expect(page.getByText("Background Work", { exact: true })).toBeVisible();
  await expect(page.getByText("Log", { exact: true })).toBeVisible();
  await expect(page.getByText("Loaded task detail 302")).toBeVisible();
  await expect(page.getByRole("button", { name: /Agent work.*Hide process\.\.\./ })).toBeVisible();
  await page.getByRole("button", { name: /Codex CLI.*Codex completed task 300/ }).click({ force: true });
  await expect(page.getByText(/causal links on this page/)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Causal Links" })).toHaveCount(0);
  await expect(page.getByText("redacted command output")).toBeVisible();
  await expect(page.getByText("{\"token\":\"[REDACTED]\"}")).toBeVisible();
  expect(evidenceRequested).toBe(true);

  await page.getByLabel("Toggle theme").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("blocks conflicting controls while ingest is running", async ({ page }) => {
  let ingestJobRequests = 0;

  await page.route("**/api/projects", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        projects: [projectFixture("project-codex", "CodexProject", "codex")]
      })
    });
  });
  await page.route("**/api/projects/*/timeline?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        project: { id: "project-codex", name: "CodexProject", cwd: "/tmp/CodexProject", repoRoot: "/tmp/CodexProject", createdAt: "2026-05-25T02:00:00.000Z", updatedAt: "2026-05-25T02:00:00.000Z" },
        episodes: [],
        events: [],
        causalEdges: [],
        taskJourneys: [],
        tokenUsage: { input: 0, output: 0, reasoning: 0, cachedInput: 0, total: 0 },
        totalEvents: 0,
        limit: 300,
        offset: 0
      })
    });
  });
  await page.route("**/api/projects/*/token-usage/daily", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ projectId: "project-codex", points: [], total: { input: 0, output: 0, reasoning: 0, cachedInput: 0, total: 0 } })
    });
  });
  await page.route("**/api/ingest", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ jobId: "job-running" }) });
  });
  await page.route("**/api/ingest/jobs/job-running", async (route) => {
    ingestJobRequests += 1;
    const running = ingestJobRequests === 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: "job-running",
        status: running ? "running" : "completed",
        phase: running ? "parsing" : "completed",
        startedAt: "2026-05-25T02:00:00.000Z",
        finishedAt: running ? null : "2026-05-25T02:00:04.000Z",
        totalFiles: 20,
        processedFiles: running ? 7 : 20,
        totalEvents: running ? 80 : 120,
        skippedFiles: 5,
        changedFiles: 6,
        currentFile: running ? "/tmp/CodexProject/session.jsonl" : null,
        errors: []
      })
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Scan Agent Logs" }).first().click();
  const scanPanel = page.getByRole("region", { name: "Scan Agent Logs" });
  await scanPanel.getByRole("button", { name: "Scan Agent Logs" }).click();

  const blockingLoader = page.getByRole("status", { name: "Blocking operation" });
  await expect(blockingLoader).toContainText("Scanning agent logs");
  await expect(page.getByRole("button", { name: "Scan Agent Logs" }).first()).toBeDisabled();
  await expect(page.getByLabel("Toggle theme")).toBeEnabled();
  await expect(blockingLoader.getByRole("status", { name: /Ingest running, parsing, 7 of 20 files processed, 35 percent/ })).toBeVisible();
  await expect(page.locator(".workspace > .ingest-level-progress")).toHaveCount(0);
  await expect(page.getByRole("img", { name: "Pixel Mario running" })).toBeVisible();
  await expect(blockingLoader).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Scan Agent Logs" }).first()).toBeEnabled();
});
