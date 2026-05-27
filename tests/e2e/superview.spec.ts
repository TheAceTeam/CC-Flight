import { expect, test } from "@playwright/test";

test("scans fixture logs, renders an IM-style task thread, hides background detail, and toggles theme", async ({ page }) => {
  let timelineRequestCount = 0;
  let evidenceRequested = false;
  const journeyDetailRequests: string[] = [];
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
        startedAt: "2026-05-25T02:00:00.000Z",
        finishedAt: "2026-05-25T02:00:01.000Z",
        totalFiles: 1,
        processedFiles: 1,
        totalEvents: 340,
        errors: []
      })
    });
  });

  await page.route("**/api/projects/*/timeline?**", async (route) => {
    timelineRequestCount += 1;
    const url = new URL(route.request().url());
    expect(url.searchParams.get("limit")).toBe("300");
    expect(url.searchParams.get("offset")).toBe(timelineRequestCount === 1 ? "0" : "300");

    const baseTime = Date.parse("2026-05-25T02:00:00.000Z");
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const events = Array.from({ length: timelineRequestCount === 1 ? 300 : 40 }, (_, index) => ({
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
    if (offset === 0) {
      [75, 150, 225].forEach((index) => {
        events[index].kind = "user_prompt";
        events[index].lane = "Product";
        events[index].title = `User task ${index}`;
        events[index].detail = `Build task journey from input ${index}`;
        events[index].toolName = null;
        events[index].callId = null;
      });
    }
    const taskStarts = offset === 0 ? [0, 75, 150, 225] : [0];
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
    const causalEdges =
      offset === 300
        ? [
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
          ]
        : [];

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
        totalEvents: 340,
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

  await page.route("**/api/task-journeys/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    expect(requestUrl.searchParams.get("projectId")).toBe("project-fixture");
    const journeyId = requestUrl.pathname.match(/\/api\/task-journeys\/([^/?]+)/)?.[1] ?? "task-unknown";
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

  await page.getByRole("textbox", { name: "Codex home path", exact: true }).fill("tests/fixtures/fake-codex-home");
  await page.getByRole("button", { name: "Scan Codex Logs" }).first().click();

  await expect(page.getByText(/Ingest completed/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("CLI Conversation", { exact: true })).toBeVisible();
  await expect(page.getByText("User Inputs", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Run Ledger", { exact: true })).toHaveCount(0);
  await expect(page.locator(".run-row")).toHaveCount(0);
  await expect(page.getByLabel("Project")).toBeVisible();
  await expect(page.locator(".status-cluster").getByText("Tokens", { exact: true })).toBeVisible();
  await expect(page.locator(".status-cluster").getByText("6,414", { exact: true })).toBeVisible();
  await expect(page.locator(".status-cluster").getByText("KV hit", { exact: true })).toBeVisible();
  await expect(page.locator(".status-cluster").getByText("21.1%", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Project")).toHaveValue("project-fixture");
  await expect(page.getByLabel("Project")).toContainText("6.4K tokens / KV 21.1%");
  await expect(page.getByText("User", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Codex CLI", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".conversation-turn").first().getByText("Build task journey from input 0")).toBeVisible();
  await expect(page.locator(".conversation-turn").first().getByText("1m 14s")).toBeVisible();
  await expect(page.locator(".conversation-turn").first().getByText("1,420 tokens")).toBeVisible();
  await expect(page.locator(".conversation-turn").first().getByText("KV hit 25.0%")).toBeVisible();
  await expect(page.locator(".conversation-turn").first().locator(".message-row.user").getByText("Build task journey from input 0")).toHaveCount(1);
  await expect(page.locator(".conversation-turn").first().locator(".message-row.user .skill-chip", { hasText: "abtest" })).toBeVisible();
  await expect(page.locator(".conversation-turn").first().locator(".message-row.codex .skill-chip", { hasText: "design-review" }).first()).toBeVisible();
  await expect(page.locator(".conversation-turn")).toHaveCount(4);
  await expect(page.locator(".conversation-turn").filter({ hasText: "Build task journey from input 75" })).toBeVisible();
  await expect(page.locator(".conversation-turn").filter({ hasText: "Build task journey from input 150" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Agent work.*查看过程\.\.\./ })).toHaveCount(4);
  await expect(page.locator(".conversation-turn").first().locator(":scope > .message-row.user .conversation-message.user")).toBeVisible();
  await expect(page.locator(".conversation-turn").first().locator(":scope > .detail-message-row .conversation-message.codex.detail-toggle")).toBeVisible();
  await expect(page.locator(".conversation-turn").first().locator(":scope > .message-row.codex .conversation-message.codex:not(.detail-toggle)")).toBeVisible();
  await expect(page.getByText("Loaded task detail 2")).toHaveCount(0);
  await expect(page.getByText("Agent Trace", { exact: true })).toHaveCount(0);
  await expect(page.locator(".lane-label")).toHaveCount(0);
  await expect(page.getByText("1-300 of 340")).toBeVisible();
  await expect(page.getByText("4 task journeys loaded from 300 events")).toBeVisible();
  await expect(journeyDetailRequests).toEqual([]);
  await page.locator(".conversation-turn").first().getByRole("button", { name: /Agent work.*查看过程\.\.\./ }).click();
  await expect.poll(() => journeyDetailRequests.filter((id) => id === "task-0").length).toBe(1);
  await expect(journeyDetailRequests).not.toContain("task-225");
  await expect(journeyDetailRequests).not.toContain("task-225");
  await page.locator(".conversation-turn").filter({ hasText: "Build task journey from input 225" }).getByRole("button", { name: /Agent work.*查看过程\.\.\./ }).click();
  await expect.poll(() => journeyDetailRequests.filter((id) => id === "task-225").length).toBe(1);
  await expect(page.locator(".conversation-turn").filter({ hasText: "Codex completed task 225 in CLI output." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show causal paths" })).toHaveCount(0);
  await expect(page.getByText("Causal path", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Causal Links" })).toHaveCount(0);
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByText("301-340 of 340")).toBeVisible();
  await expect(page.locator(".conversation-turn")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Prev page" })).toBeEnabled();
  await expect(journeyDetailRequests).not.toContain("task-300");
  await page.locator(".conversation-turn").filter({ hasText: "Build task journey from input 300" }).getByRole("button", { name: /Agent work.*查看过程\.\.\./ }).click();
  await expect.poll(() => journeyDetailRequests.filter((id) => id === "task-300").length).toBe(1);
  await expect(page.getByText("Codex completed task 300 in CLI output.")).toBeVisible();
  await expect(page.locator(".conversation-turn").filter({ hasText: "Build task journey from input 300" }).locator(".skill-chip", { hasText: "ui-ux-pro-max" }).first()).toBeVisible();
  const task300CodexBody = page.locator(".conversation-turn").filter({ hasText: "Build task journey from input 300" }).locator(".message-row.codex .message-body");
  await expect(task300CodexBody).toHaveAttribute("data-expanded", "false");
  await expect.poll(async () => Math.round((await task300CodexBody.boundingBox())?.height ?? 0)).toBeLessThanOrEqual(250);
  await page.locator(".conversation-turn").filter({ hasText: "Build task journey from input 300" }).locator(".message-expand-toggle").filter({ hasText: "展开" }).click();
  await expect(task300CodexBody).toHaveAttribute("data-expanded", "true");
  await expect.poll(async () => Math.round((await task300CodexBody.boundingBox())?.height ?? 0)).toBeGreaterThan(250);
  await page.locator(".conversation-turn").filter({ hasText: "Build task journey from input 300" }).locator(".message-expand-toggle").filter({ hasText: "收起" }).click();
  await expect(task300CodexBody).toHaveAttribute("data-expanded", "false");
  await expect(page.getByText("Background Work", { exact: true })).toBeVisible();
  await expect(page.getByText("Log", { exact: true })).toBeVisible();
  await expect(page.getByText("Loaded task detail 302")).toBeVisible();
  await expect(page.getByRole("button", { name: /Agent work.*收起过程\.\.\./ })).toBeVisible();
  await page.getByRole("button", { name: /Codex CLI.*Codex completed task 300/ }).click({ force: true });
  await expect(page.getByText(/causal links on this page/)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Causal Links" })).toHaveCount(0);
  await expect(page.getByText("redacted command output")).toBeVisible();
  await expect(page.getByText("{\"token\":\"[REDACTED]\"}")).toBeVisible();
  expect(evidenceRequested).toBe(true);

  await page.getByLabel("Toggle theme").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
