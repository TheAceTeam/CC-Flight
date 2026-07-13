import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCodexJsonlContent } from "../core/parser";
import { redactString } from "../core/redactor";
import { normalizeCodexLines } from "../core/normalizer";
import { buildProjectTimeline } from "../core/timeline";
import { buildReplayNodes } from "../core/replay";
import type { TimelineEvent } from "../core/types";

function fixture(name: string) {
  return readFileSync(`tests/fixtures/codex-rollouts/${name}`, "utf8");
}

describe("Codex parser and normalizer", () => {
  it("parses session_meta, turn_context, response_item, and event_msg records", () => {
    const lines = parseCodexJsonlContent(fixture("failed-test-rollout.jsonl"), "failed-test-rollout.jsonl");
    expect(lines.map((line) => line.type)).toContain("session_meta");
    expect(lines.map((line) => line.type)).toContain("response_item");
    expect(lines.map((line) => line.type)).toContain("event_msg");
  });

  it("normalizes tool calls, patches, and tool outputs", () => {
    const lines = parseCodexJsonlContent(fixture("tool-call-rollout.jsonl"), "tool-call-rollout.jsonl");
    const bundle = normalizeCodexLines(lines, { repoRoot: "/tmp/superview-fixture" });
    expect(bundle).toBeTruthy();
    expect(bundle?.events.some((event) => event.kind === "verification")).toBe(true);
    expect(bundle?.events.some((event) => event.kind === "file_change")).toBe(true);
    const patchCall = bundle?.events.find((event) => event.callId === "call-2" && event.toolName === "functions.apply_patch");
    expect(patchCall?.outputEventId).toBeTruthy();
    expect(bundle?.events.some((event) => event.id === patchCall?.outputEventId)).toBe(true);
  });

  it("redacts obvious secrets before display or storage", () => {
    const redacted = redactString("OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz\nAuthorization: Bearer very-secret-token\nRESEND_API_KEY=re_1234567890abcdef");
    expect(redacted).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(redacted).not.toContain("very-secret-token");
    expect(redacted).not.toContain("1234567890abcdef");
    expect(redacted).toContain("[REDACTED]");
  });

  it("builds timeline episodes and replay nodes from fixture events", () => {
    const lines = parseCodexJsonlContent(fixture("failed-test-rollout.jsonl"), "failed-test-rollout.jsonl");
    const bundle = normalizeCodexLines(lines, { repoRoot: "/tmp/superview-fixture" });
    expect(bundle).toBeTruthy();

    const timeline = buildProjectTimeline(bundle!.project, bundle!.events);
    expect(timeline.episodes.length).toBeGreaterThan(0);
    expect(timeline.events.some((event) => event.lane === "Risks")).toBe(true);

    const nodes = buildReplayNodes(bundle!.events);
    expect(nodes.some((node) => node.type === "hazard")).toBe(true);
  });

  it("extracts token usage from response items and aggregates project totals", () => {
    const lines = parseCodexJsonlContent(fixture("token-usage-rollout.jsonl"), "token-usage-rollout.jsonl");
    const bundle = normalizeCodexLines(lines, { repoRoot: "/tmp/superview-fixture" });
    expect(bundle).toBeTruthy();

    const assistant = bundle!.events.find((event) => event.kind === "assistant_message");
    const reasoning = bundle!.events.find((event) => event.kind === "reasoning_marker");
    const timeline = buildProjectTimeline(bundle!.project, bundle!.events);

    expect(assistant?.tokenUsage).toEqual({
      input: 120,
      output: 30,
      reasoning: 10,
      cachedInput: 40,
      total: 160
    });
    expect(reasoning?.tokenUsage).toEqual({
      input: 5,
      output: 7,
      reasoning: 0,
      cachedInput: 2,
      total: 20
    });
    expect(reasoning?.title).toBe("Private reasoning segment");
    expect(reasoning?.detail).toBe("Reasoning summary is not available in this log.");
    expect(timeline.tokenUsage).toEqual({
      input: 125,
      output: 37,
      reasoning: 10,
      cachedInput: 42,
      total: 180
    });
    expect(timeline.taskJourneys[0]).toMatchObject({
      durationMs: 1500,
      tokenUsage: {
        input: 125,
        output: 37,
        reasoning: 10,
        cachedInput: 42,
        total: 180
      }
    });
  });

  it("shows public reasoning summaries without exposing private reasoning content", () => {
    const content = [
      JSON.stringify({ timestamp: "2026-05-25T05:00:00.000Z", type: "session_meta", payload: { id: "reasoning-summary-session", timestamp: "2026-05-25T05:00:00.000Z", cwd: "/tmp/superview-fixture" } }),
      JSON.stringify({ timestamp: "2026-05-25T05:00:01.000Z", type: "response_item", payload: { type: "reasoning", summary: [{ text: "Checked the failing test and narrowed the likely issue to token parsing." }] } }),
      JSON.stringify({ timestamp: "2026-05-25T05:00:02.000Z", type: "response_item", payload: { type: "reasoning", summary: [] } })
    ].join("\n");
    const lines = parseCodexJsonlContent(content, "reasoning-summary.jsonl");
    const bundle = normalizeCodexLines(lines, { repoRoot: "/tmp/superview-fixture" });
    expect(bundle).toBeTruthy();

    const reasoningEvents = bundle!.events.filter((event) => event.kind === "reasoning_marker");
    expect(reasoningEvents[0]).toMatchObject({
      title: "Reasoning summary",
      detail: "Checked the failing test and narrowed the likely issue to token parsing."
    });
    expect(reasoningEvents[1]).toMatchObject({
      title: "Private reasoning segment",
      detail: "Reasoning summary is not available in this log."
    });
  });

  it("extracts token_count snapshots as deltas instead of double-counting repeats", () => {
    const content = [
      JSON.stringify({ timestamp: "2026-05-25T05:00:00.000Z", type: "session_meta", payload: { id: "fixture-token-count-session", timestamp: "2026-05-25T05:00:00.000Z", cwd: "/tmp/superview-fixture", cli_version: "0.125.0", model_provider: "OpenAI", source: "cli" } }),
      JSON.stringify({ timestamp: "2026-05-25T05:00:01.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Inspect token count events" }] } }),
      JSON.stringify({ timestamp: "2026-05-25T05:00:02.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 25, output_tokens: 20, reasoning_output_tokens: 5, total_tokens: 120 }, last_token_usage: { input_tokens: 100, cached_input_tokens: 25, output_tokens: 20, reasoning_output_tokens: 5, total_tokens: 120 }, model_context_window: 258400 } } }),
      JSON.stringify({ timestamp: "2026-05-25T05:00:03.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 25, output_tokens: 20, reasoning_output_tokens: 5, total_tokens: 120 }, last_token_usage: { input_tokens: 100, cached_input_tokens: 25, output_tokens: 20, reasoning_output_tokens: 5, total_tokens: 120 }, model_context_window: 258400 } } }),
      JSON.stringify({ timestamp: "2026-05-25T05:00:04.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 150, cached_input_tokens: 30, output_tokens: 30, reasoning_output_tokens: 8, total_tokens: 180 }, last_token_usage: { input_tokens: 50, cached_input_tokens: 5, output_tokens: 10, reasoning_output_tokens: 3, total_tokens: 60 }, model_context_window: 258400 } } })
    ].join("\n");
    const lines = parseCodexJsonlContent(content, "token-count-rollout.jsonl");
    const bundle = normalizeCodexLines(lines, { repoRoot: "/tmp/superview-fixture" });
    expect(bundle).toBeTruthy();

    const tokenEvents = bundle!.events.filter((event) => event.title === "Token usage update");
    const timeline = buildProjectTimeline(bundle!.project, bundle!.events);

    expect(tokenEvents.map((event) => event.tokenUsage)).toEqual([
      { input: 100, output: 20, reasoning: 5, cachedInput: 25, total: 120 },
      null,
      { input: 50, output: 10, reasoning: 3, cachedInput: 5, total: 60 }
    ]);
    expect(timeline.tokenUsage).toEqual({
      input: 150,
      output: 30,
      reasoning: 8,
      cachedInput: 30,
      total: 180
    });
    expect(timeline.taskJourneys[0].tokenUsage).toEqual(timeline.tokenUsage);
  });

  it("extracts skill usage from Codex messages, tool payloads, and slash commands", () => {
    const lines = parseCodexJsonlContent(fixture("skill-usage-rollout.jsonl"), "skill-usage-rollout.jsonl");
    const bundle = normalizeCodexLines(lines, { repoRoot: "/tmp/superview-fixture" });
    expect(bundle).toBeTruthy();

    const timeline = buildProjectTimeline(bundle!.project, bundle!.events);
    const journey = timeline.taskJourneys[0];
    const skillNames = journey.skills.map((skill) => skill.name);
    const toolEvent = timeline.events.find((event) => event.callId === "call-skill");

    expect(skillNames).toEqual(expect.arrayContaining(["abtest", "ui-ux-pro-max", "design-taste-frontend"]));
    expect(skillNames).not.toContain("design-review");
    expect(toolEvent?.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "abtest",
          source: expect.stringMatching(/tool_/),
          path: expect.stringContaining("/skills/abtest")
        })
      ])
    );
  });

  it("builds task journeys from each user prompt boundary", () => {
    const lines = parseCodexJsonlContent(fixture("call-association-rollout.jsonl"), "call-association-rollout.jsonl");
    const bundle = normalizeCodexLines(lines, { repoRoot: "/tmp/superview-fixture" });
    expect(bundle).toBeTruthy();

    const timeline = buildProjectTimeline(bundle!.project, bundle!.events);
    const prompt = timeline.events.find((event) => event.kind === "user_prompt");
    const retryMessage = timeline.events.find((event) => event.title.includes("Retrying"));
    const journey = timeline.taskJourneys[0];

    expect(timeline.taskJourneys).toHaveLength(1);
    expect(journey).toMatchObject({
      projectId: bundle!.project.id,
      sessionId: "fixture-call-association-session",
      promptEventId: prompt?.id,
      title: "Update architecture docs and retry failing tests",
      startedAt: prompt?.timestamp,
      endedAt: retryMessage?.timestamp,
      status: "failed",
      exitType: "session_end"
    });
    expect(journey.eventIds[0]).toBe(prompt?.id);
    expect(journey.eventIds).toContain(retryMessage?.id);
    expect(journey.stageCounts).toMatchObject({
      Product: 1,
      Architecture: 2,
      Verification: 1,
      Risks: 1,
      "Agent Runs": 1
    });
    expect(journey.stages.map((stage) => stage.lane)).toEqual(["Product", "Architecture", "Agent Runs", "Verification", "Risks"]);
  });

  it("builds causal edges between prompts, patches, failed tests, and retries", () => {
    const lines = parseCodexJsonlContent(fixture("call-association-rollout.jsonl"), "call-association-rollout.jsonl");
    const bundle = normalizeCodexLines(lines, { repoRoot: "/tmp/superview-fixture" });
    expect(bundle).toBeTruthy();

    const timeline = buildProjectTimeline(bundle!.project, bundle!.events);
    const { causalEdges } = timeline;
    const docCall = timeline.events.find((event) => event.callId === "call-docs" && event.title === "Patched files");
    const docOutput = timeline.events.find((event) => event.id === docCall?.outputEventId);
    const testCall = timeline.events.find((event) => event.callId === "call-test" && event.toolName === "functions.exec_command");
    const testOutput = timeline.events.find((event) => event.id === testCall?.outputEventId);
    const retryMessage = timeline.events.find((event) => event.title.includes("Retrying"));

    expect(causalEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromEventId: docCall?.id,
          toEventId: docOutput?.id,
          type: "same_call",
          confidence: "deterministic"
        }),
        expect.objectContaining({
          toEventId: docCall?.id,
          type: "updates_design"
        }),
        expect.objectContaining({
          fromEventId: testCall?.id,
          toEventId: testOutput?.id,
          type: "failed_by"
        }),
        expect.objectContaining({
          fromEventId: testOutput?.id,
          toEventId: retryMessage?.id,
          type: "retried_by"
        })
      ])
    );
    expect(causalEdges.every((edge) => edge.reason.length > 0)).toBe(true);
  });

  it("builds large timelines without quadratic causal scans", () => {
    const project = {
      id: "project-large",
      name: "large",
      cwd: "/tmp/large",
      repoRoot: null,
      createdAt: "2026-05-25T00:00:00.000Z",
      updatedAt: "2026-05-25T00:00:00.000Z"
    };
    const baseTime = Date.parse("2026-05-25T00:00:00.000Z");
    const events: TimelineEvent[] = Array.from({ length: 12000 }, (_, index) => ({
      id: `event-${index}`,
      projectId: project.id,
      sessionId: `session-${Math.floor(index / 120)}`,
      turnId: `turn-${Math.floor(index / 12)}`,
      timestamp: new Date(baseTime + index * 1000).toISOString(),
      kind: index % 120 === 0 ? "user_prompt" : index % 17 === 0 ? "verification" : index % 7 === 0 ? "tool_call" : "assistant_message",
      lane: index % 120 === 0 ? "Product" : index % 17 === 0 ? "Verification" : index % 7 === 0 ? "Code" : "Agent Runs",
      title: `Event ${index}`,
      detail: index % 211 === 0 ? "retry after failure" : null,
      toolName: index % 7 === 0 ? "functions.exec_command" : null,
      callId: index % 7 === 0 ? `call-${index}` : null,
      status: index % 211 === 0 ? "failed" : "success",
      files: [],
      rawEventRefId: null
    }));

    const started = performance.now();
    const timeline = buildProjectTimeline(project, events);
    const elapsed = performance.now() - started;

    expect(timeline.events).toHaveLength(events.length);
    expect(timeline.taskJourneys.length).toBeGreaterThan(10);
    expect(elapsed).toBeLessThan(1000);
  });

  it("associates function call outputs with calls and derives lanes for docs, failures, and retries", () => {
    const lines = parseCodexJsonlContent(fixture("call-association-rollout.jsonl"), "call-association-rollout.jsonl");
    const bundle = normalizeCodexLines(lines, { repoRoot: "/tmp/superview-fixture" });
    expect(bundle).toBeTruthy();

    const docCall = bundle!.events.find((event) => event.callId === "call-docs" && event.title === "Patched files");
    expect(docCall).toBeTruthy();
    expect(docCall?.status).toBe("success");
    expect(docCall?.lane).toBe("Architecture");
    expect(docCall?.durationMs).toBe(3000);
    expect(docCall?.outputEventId).toBeTruthy();

    const docOutput = bundle!.events.find((event) => event.id === docCall?.outputEventId);
    expect(docOutput?.kind).toBe("file_change");
    expect(docOutput?.lane).toBe("Architecture");
    expect(docOutput?.status).toBe("success");

    const testCall = bundle!.events.find((event) => event.callId === "call-test" && event.toolName === "functions.exec_command");
    expect(testCall?.status).toBe("failed");
    expect(testCall?.durationMs).toBe(3000);
    expect(testCall?.outputEventId).toBeTruthy();

    const testOutput = bundle!.events.find((event) => event.id === testCall?.outputEventId);
    expect(testOutput?.kind).toBe("error");
    expect(testOutput?.lane).toBe("Risks");
    expect(testOutput?.status).toBe("failed");

    const nodes = buildReplayNodes(bundle!.events);
    expect(nodes.some((node) => node.eventId === testCall?.id && node.type === "hazard")).toBe(true);
    expect(nodes.some((node) => node.type === "loop" && node.label === "Retry")).toBe(true);
  });
});
