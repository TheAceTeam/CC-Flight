import { expect, test } from "@playwright/test";

test("scans fixture logs, renders timeline, opens replay, and toggles theme", async ({ page }) => {
  let timelineRequestCount = 0;
  let evidenceRequested = false;

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
      kind: index % 3 === 0 ? "tool_call" : "agent_message",
      lane: index % 2 === 0 ? "Code" : "Agent Runs",
      title: `Timeline event ${offset + index}`,
      detail: `Redacted event detail ${offset + index}`,
      toolName: index % 3 === 0 ? "exec_command" : null,
      callId: index % 3 === 0 ? `call-${offset + index}` : null,
      status: "success",
      files: [],
      rawEventRefId: `raw-${offset + index}`
    }));

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

  await page.goto("/");

  await page.getByRole("textbox", { name: "Codex home path", exact: true }).fill("tests/fixtures/fake-codex-home");
  await page.getByRole("button", { name: "Scan Codex Logs" }).first().click();

  await expect(page.getByText(/Ingest completed/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Engineering Timeline")).toBeVisible();
  await expect(page.getByText("1-300 of 340")).toBeVisible();
  await expect(page.getByText("300 events loaded, lane dots capped at 28 each")).toBeVisible();
  await expect(page.getByText("+122 more on this page").first()).toBeVisible();
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByText("301-340 of 340")).toBeVisible();
  await expect(page.getByText("Run Ledger")).toBeVisible();
  await page.getByRole("button", { name: "Timeline event 300" }).click();
  await expect(page.getByText("redacted command output")).toBeVisible();
  await expect(page.getByText("{\"token\":\"[REDACTED]\"}")).toBeVisible();
  expect(evidenceRequested).toBe(true);

  await page.locator(".run-row").first().click();
  await expect(page.getByText("Selected Run Replay")).toBeVisible();
  await page.getByRole("button", { name: /Play run/ }).click();
  await expect(page.locator(".agent")).toBeVisible();

  await page.getByLabel("Toggle theme").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
